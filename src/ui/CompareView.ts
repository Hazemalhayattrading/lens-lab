import { loadLenses, loadPhones } from '../data/library';
import type { LensData, PhoneData } from '../data/types';
import { labLensFromData, TEACHING_LENS, type LabLens } from '../lab/labLens';
import type { OpticsFrame } from '../lab/optics';
import { labLensFromPhone } from '../lab/phoneLens';
import { SUBJECTS, type SubjectId } from '../optics/config';
import { FULL_FRAME_DIAGONAL, diagonal } from '../optics/formats';
import { apertureButtons, focalAtZoom, maxApertureAtZoom, minApertureAtZoom } from '../optics/lensModel';
import { ROLE_LABEL } from '../phone/phoneOptics';
import '../styles/library.css';
import '../styles/compare.css';
import { SUBJECT_NAME } from './explain';
import { fmtDeg, fmtDistance, fmtDofCm, fmtF, fmtFocal, fmtRange } from './format';

export interface CompareSide {
  key: string;
  lens: LabLens;
  zoom: number;
  fNumber: number;
}

export interface CompareHandlers {
  onClose(): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Preset {
  id: string;
  label: string;
  a: string;
  b: string;
  focus: SubjectId;
  /** Optional f-numbers per side (else wide open). */
  nA?: number;
  nB?: number;
}

/** Presets use products from the library (each resolves only if the data exists). */
const PRESETS: Preset[] = [
  { id: 'phone-vs-ff', label: 'Phone vs full frame', a: 'phone:apple-iphone-18-pro-pro-max:main', b: 'lens:canon-rf-24-f14-l-vcm', focus: 'cabin' },
  { id: 'crop-vs-ff', label: 'APS-C vs full frame', a: 'lens:fujifilm-xf-33mm-f14-r-lm-wr', b: 'lens:canon-rf-50-f12-l-usm', focus: 'cabin' },
  { id: 'wide-vs-tele', label: 'Wide vs tele', a: 'lens:sony-fe-16-35-f28-gm-ii', b: 'lens:canon-rf-600-f4-l-is-usm', focus: 'bird' },
  { id: 'aperture', label: 'f/1.2 vs f/8', a: 'lens:canon-rf-85-f12-l-usm', b: 'lens:canon-rf-85-f12-l-usm', focus: 'trees', nB: 8 },
];

/**
 * Compare mode: any two lenses or phone cameras, focused at the same distance from the same spot.
 * The two sensor images are rendered by the app into the transparent frame windows of this view; the
 * table compares the physics (angle of view, depth of field, background blur relative to the frame).
 */
export class CompareView {
  readonly root: HTMLElement;
  sides: [CompareSide, CompareSide] | null = null;
  /** Focus distance (mm from the focal plane) both sides aim at. */
  focus = 800;
  focusSubject: SubjectId | null = 'cabin';
  private lenses: LensData[] = [];
  private phones: PhoneData[] = [];
  private readonly ready: Promise<void>;
  private readonly $frames: HTMLElement[];
  private readonly $selects: HTMLSelectElement[];
  private readonly $ctl: HTMLElement[];
  private readonly $cap: HTMLElement[];
  private readonly $table: HTMLElement;
  private readonly $focus: HTMLElement;
  private readonly $presets: HTMLElement;
  private lastKey = '';
  private lastFocus: HTMLElement | null = null;

  constructor(
    host: HTMLElement,
    private readonly h: CompareHandlers,
  ) {
    const root = document.createElement('div');
    root.className = 'cmp';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Compare two lenses or phone cameras');
    const side = (i: number) => `
  <section class="cmp-side" data-side="${i}">
    <label class="cmp-pick"><span>${i === 0 ? 'A' : 'B'}</span><select data-ref="sel${i}" aria-label="Lens or camera ${i === 0 ? 'A' : 'B'}"></select></label>
    <div class="cmp-frame" data-ref="frame${i}"><div class="cmp-cap" data-ref="cap${i}"></div></div>
    <div class="cmp-ctl" data-ref="ctl${i}"></div>
  </section>`;
    root.innerHTML = `
<div class="cmp-shell">
  <header class="cmp-head">
    <div class="lib-title"><h2>Compare</h2><p>Same spot, same focus distance<span class="long"> — two lenses or phone cameras side by side</span></p></div>
    <div class="cmp-presets" role="group" aria-label="Presets" data-ref="presets"></div>
    <button class="icon-btn" data-act="close" aria-label="Close compare (Esc)">✕</button>
  </header>
  <div class="cmp-focus" role="group" aria-label="Focus distance" data-ref="focus"></div>
  <div class="cmp-sides">${side(0)}${side(1)}</div>
  <div class="cmp-table" data-ref="table" aria-live="polite"></div>
</div>`;
    host.appendChild(root);
    this.root = root;
    const ref = (n: string) => root.querySelector<HTMLElement>(`[data-ref="${n}"]`)!;
    this.$frames = [ref('frame0'), ref('frame1')];
    this.$selects = [ref('sel0') as HTMLSelectElement, ref('sel1') as HTMLSelectElement];
    this.$ctl = [ref('ctl0'), ref('ctl1')];
    this.$cap = [ref('cap0'), ref('cap1')];
    this.$table = ref('table');
    this.$focus = ref('focus');
    this.$presets = ref('presets');

    root.querySelector('[data-act="close"]')!.addEventListener('click', () => this.close());
    this.$selects.forEach((sel, i) => sel.addEventListener('change', () => this.setSide(i, sel.value)));
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const p = t.closest<HTMLElement>('[data-preset]');
      if (p) return this.applyPreset(p.dataset.preset!);
      const f = t.closest<HTMLElement>('[data-focus]');
      if (f) return this.setFocusSubject(f.dataset.focus as SubjectId);
      const ap = t.closest<HTMLElement>('[data-ap]');
      if (ap && this.sides) {
        const i = Number(ap.closest<HTMLElement>('[data-side]')!.dataset.side);
        this.sides[i].fNumber = Number(ap.dataset.ap);
        this.renderControls(i);
      }
    });
    root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (!t.matches('[data-zoom]') || !this.sides) return;
      const i = Number(t.closest<HTMLElement>('[data-side]')!.dataset.side);
      const s = this.sides[i];
      const wasWide = s.fNumber <= maxApertureAtZoom(s.lens.physics, s.zoom) * 1.01;
      s.zoom = Number(t.value) / 1000;
      // stay wide open while zooming a variable-aperture lens; otherwise keep the f-number inside the new range
      const maxN = maxApertureAtZoom(s.lens.physics, s.zoom);
      const minN = minApertureAtZoom(s.lens.physics, s.zoom);
      s.fNumber = wasWide ? maxN : Math.min(minN, Math.max(maxN, s.fNumber));
      this.renderControls(i);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    this.ready = Promise.all([loadLenses(), loadPhones()]).then(([lenses, phones]) => {
      this.lenses = lenses;
      this.phones = phones;
      const options: string[] = [`<option value="teaching">Lens Lab 50 mm f/2 (teaching lens)</option>`];
      const brands = [...new Set(lenses.map((l) => l.brand))];
      for (const b of brands) {
        options.push(`<optgroup label="${esc(b)}">${lenses
          .filter((l) => l.brand === b)
          .map((l) => `<option value="lens:${l.id}">${esc(l.name)}</option>`)
          .join('')}</optgroup>`);
      }
      const phoneOpts = phones
        .flatMap((p) => p.cameras.map((c, i) => ({ p, c, i })))
        .filter(({ p, i }) => labLensFromPhone(p, i) !== null)
        .map(({ p, c, i }) => `<option value="phone:${p.id}:${c.role === 'main' ? 'main' : i}">${esc(`${p.brand} ${p.name} — ${ROLE_LABEL[c.role]} (${c.label})`)}</option>`);
      if (phoneOpts.length) options.push(`<optgroup label="Phone cameras">${phoneOpts.join('')}</optgroup>`);
      for (const s of this.$selects) s.innerHTML = options.join('');
      this.$presets.innerHTML = PRESETS.filter((p) => this.resolve(p.a) && this.resolve(p.b))
        .map((p) => `<button class="chip-f" data-preset="${p.id}">${esc(p.label)}</button>`)
        .join('');
      this.$focus.innerHTML = `<span class="cmp-focus-label">Focus both at</span>${SUBJECTS.map(
        (s) => `<button class="chip-f" data-focus="${s.id}" style="--c:${s.color}"><i></i>${SUBJECT_NAME[s.id]} <small>${fmtDistance(s.distance, 1)}</small></button>`,
      ).join('')}`;
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  async open(presetId?: string): Promise<void> {
    if (!this.isOpen) this.lastFocus = document.activeElement as HTMLElement | null;
    this.root.classList.add('open');
    document.body.classList.add('lib-open');
    await this.ready;
    if (!this.isOpen) return; // closed while the data loaded
    if (presetId || !this.sides) this.applyPreset(presetId && PRESETS.some((p) => p.id === presetId) ? presetId : (PRESETS.find((p) => this.resolve(p.a) && this.resolve(p.b))?.id ?? ''));
    this.root.querySelector<HTMLElement>('[data-act="close"]')!.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove('open');
    document.body.classList.remove('lib-open');
    this.h.onClose();
    this.lastFocus?.focus?.({ preventScroll: true });
  }

  /** Screen rects (CSS px) of the two frame windows the app draws the sensor images into. */
  frameRects(): ({ x: number; y: number; width: number; height: number } | null)[] {
    return this.$frames.map((f) => {
      const r = f.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) return null;
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    });
  }

  // ------------------------------------------------------------------ state

  private resolve(key: string): LabLens | null {
    if (key === 'teaching') return TEACHING_LENS;
    if (key.startsWith('lens:')) {
      const d = this.lenses.find((l) => l.id === key.slice(5));
      return d ? labLensFromData(d) : null;
    }
    if (key.startsWith('phone:')) {
      const [, id, which] = key.split(':');
      const p = this.phones.find((x) => x.id === id);
      if (!p) return null;
      const index = which === 'main' ? p.cameras.findIndex((c) => c.role === 'main') : Number(which);
      return labLensFromPhone(p, index);
    }
    return null;
  }

  private sideFor(key: string, n?: number): CompareSide | null {
    const lens = this.resolve(key);
    if (!lens) return null;
    const maxN = maxApertureAtZoom(lens.physics, 0);
    return { key, lens, zoom: 0, fNumber: n ?? maxN };
  }

  private applyPreset(id: string): void {
    const p = PRESETS.find((x) => x.id === id);
    const a = p ? this.sideFor(p.a, p.nA) : this.sideFor('teaching');
    const b = p ? this.sideFor(p.b, p.nB) : this.sideFor('teaching', 8);
    if (!a || !b) return;
    this.sides = [a, b];
    this.$selects[0].value = a.key;
    this.$selects[1].value = b.key;
    this.$presets.querySelectorAll<HTMLElement>('[data-preset]').forEach((el) => el.classList.toggle('on', el.dataset.preset === id));
    this.setFocusSubject(p?.focus ?? 'cabin');
    this.renderControls(0);
    this.renderControls(1);
  }

  private setSide(i: number, key: string): void {
    const s = this.sideFor(key);
    if (!s || !this.sides) return;
    this.sides[i] = s;
    this.$presets.querySelectorAll('[data-preset]').forEach((el) => el.classList.remove('on'));
    this.renderControls(i);
  }

  private setFocusSubject(id: SubjectId): void {
    const s = SUBJECTS.find((x) => x.id === id)!;
    this.focusSubject = id;
    this.focus = s.distance;
    this.$focus.querySelectorAll<HTMLElement>('[data-focus]').forEach((el) => el.classList.toggle('on', el.dataset.focus === id));
  }

  private renderControls(i: number): void {
    const s = this.sides![i];
    const p = s.lens.physics;
    const maxN = maxApertureAtZoom(p, s.zoom);
    const minN = minApertureAtZoom(p, s.zoom);
    const list = apertureButtons(maxN, minN, 5);
    const zoom = s.lens.isZoom
      ? `<label class="cmp-zoom"><span>${fmtFocal(focalAtZoom(p, s.zoom))}</span><input type="range" min="0" max="1000" step="1" value="${Math.round(s.zoom * 1000)}" data-zoom aria-label="Zoom ${i === 0 ? 'A' : 'B'}" /></label>`
      : '';
    const aps = list
      .map((n) => `<button class="btn${Math.abs(n - s.fNumber) / n < 0.02 ? ' on' : ''}" data-ap="${n}" aria-pressed="${Math.abs(n - s.fNumber) / n < 0.02}">${fmtF(n)}</button>`)
      .join('');
    this.$ctl[i].innerHTML = `${zoom}<div class="cmp-aps" role="group" aria-label="Aperture ${i === 0 ? 'A' : 'B'}">${list.length > 1 ? aps : `<span class="cmp-fixed">${fmtF(maxN)} · fixed aperture</span>`}</div>`;
    this.$frames[i].style.aspectRatio = `${p.sensor.width} / ${p.sensor.height}`;
    this.lastKey = '';
  }

  // ------------------------------------------------------------------ readouts

  /** Refreshes captions and the table from this frame's optics (cheap when nothing changed). */
  update(frames: [OpticsFrame, OpticsFrame]): void {
    if (!this.sides) return;
    const key = frames.map((o) => `${o.lens.id}|${o.focalLength.toFixed(2)}|${o.fNumber}|${o.focusDistance.toFixed(0)}`).join('/');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const crop = (o: OpticsFrame) => FULL_FRAME_DIAGONAL / diagonal(o.sensor);
    frames.forEach((o, i) => {
      const eq = Math.round(o.focalLength * crop(o));
      this.$cap[i].innerHTML = `<span>${esc(o.lens.brand)}</span> ${esc(fmtFocal(o.focalLength))} <small>(${eq} mm eq.)</small> · ${fmtF(o.fNumber)} · focused ${fmtDistance(o.focusDistance)}`;
    });
    const blurPct = (o: OpticsFrame) => {
      const inf = o.subjects.find((s) => s.id === 'peaks')!;
      return (inf.coc / o.sensor.width) * 100;
    };
    const subj = (o: OpticsFrame) => (this.focusSubject ? o.subjects.find((s) => s.id === this.focusSubject) : undefined);
    const row = (label: string, f: (o: OpticsFrame, i: number) => string, note = '') =>
      `<tr><th>${label}${note ? `<small>${note}</small>` : ''}</th>${frames.map((o, i) => `<td>${f(o, i)}</td>`).join('')}</tr>`;
    const lensData = (i: number) => this.sides![i].lens.data;
    const clamped = (o: OpticsFrame) => o.focusDistance > this.focus * 1.001 && Number.isFinite(this.focus);
    const wide = (o: OpticsFrame) => (o.lens.data ? '' : o.lens.format === 'phone' ? ' <span class="ph-computed" title="real focal length computed from the 35 mm-equivalent focal length and the sensor size">computed</span>' : '');
    this.$table.innerHTML = `
<table>
  <thead><tr><th></th>${frames.map((o, i) => `<th><span class="cmp-badge">${i === 0 ? 'A' : 'B'}</span>${esc(o.lens.name)}</th>`).join('')}</tr></thead>
  <tbody>
    ${row('Sensor', (o) => `${o.sensor.width.toFixed(1)} × ${o.sensor.height.toFixed(1)} mm <small>crop ×${crop(o).toFixed(2)}</small>`)}
    ${row('Focal length', (o) => `${fmtFocal(o.focalLength)}${wide(o)} <small>≈ ${Math.round(o.focalLength * crop(o))} mm equivalent</small>`)}
    ${row('Aperture', (o) => `${fmtF(o.fNumber)} <small>≈ f/${(o.fNumber * crop(o)).toFixed(1)} equivalent</small>`, 'equivalent = N × crop: depth of field and total light for the same framing')}
    ${row('Angle of view', (o) => `${fmtDeg(o.fovHorizontal)} × ${fmtDeg(o.fovVertical)}`)}
    ${row('Focused at', (o) => `${fmtDistance(o.focusDistance)}${clamped(o) ? ' <small class="warn">closest focus — cannot get nearer</small>' : ''}`)}
    ${row('Depth of field', (o) => `${fmtDofCm(o.depthOfField)} <small>${fmtRange(o.near, o.far)}</small>`)}
    ${row('Hyperfocal distance', (o) => fmtDistance(o.hyperfocal))}
    ${row('Background blur', (o) => `${blurPct(o) < 0.05 ? '< 0.05' : blurPct(o).toFixed(blurPct(o) < 1 ? 2 : 1)} % <small>of the frame width (disc of a point at ∞)</small>`, 'comparable across sensor sizes')}
    ${row(`${this.focusSubject ? SUBJECT_NAME[this.focusSubject] : 'Subject'} in the frame`, (o) => {
      const s = subj(o);
      return s ? (s.inFrame ? `${s.sharpness === 'sharp' ? 'sharp' : s.sharpness}` : 'outside the frame') : '—';
    })}
    ${row('Weight', (_o, i) => (lensData(i)?.weightG ? `${lensData(i)!.weightG!.toLocaleString('en-US')} g` : this.sides![i].lens.format === 'phone' ? '<small>part of the phone</small>' : '—'))}
  </tbody>
</table>
${frames.some((o) => o.lens.format === 'phone') ? '<p class="muted">Phone cameras: sensor size from the published optical format; closest focus assumed (10 cm) — not published by the makers.</p>' : ''}`;
  }
}
