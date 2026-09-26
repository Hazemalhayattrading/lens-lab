import { loadPhones } from '../data/library';
import type { PhoneData } from '../data/types';
import { cameraOptics, moduleKind, ROLE_LABEL, type CameraOptics, type Valued } from '../phone/phoneOptics';
import type { PhoneViewer } from '../phone/PhoneViewer';
import '../styles/library.css';
import '../styles/phones.css';
import { sourceDomain } from './specFormat';

export interface PhonesHandlers {
  onClose(): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const UNVERIFIED = '<span class="unverified" title="Not published by the maker (or not verified) — left empty on purpose">unverified</span>';
const computedTag = (how?: string) => `<span class="ph-computed" title="${esc(how ?? 'computed from published values')}">computed</span>`;
const trim = (n: number, d = 2) => {
  const s = n.toFixed(d);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};
const valued = (v: Valued<number> | null, unit: string, d = 1) => (v ? `${trim(v.value, d)}${unit}${v.source === 'computed' ? ` ${computedTag(v.how)}` : ''}` : UNVERIFIED);

/**
 * Phone cameras: the current flagships, a 3D teardown of each camera module (the three.js viewer is
 * its own small renderer, created on first open and paused while the view is closed) and every camera's
 * published specs next to values computed from them (sensor size, real focal length, equivalent aperture).
 */
export class PhonesView {
  readonly root: HTMLElement;
  private phones: PhoneData[] = [];
  private phone: PhoneData | null = null;
  private cam = 0;
  private exploded = false;
  private light = true;
  private viewer: PhoneViewer | null = null;
  private readonly ready: Promise<void>;
  private readonly $phones: HTMLElement;
  private readonly $cams: HTMLElement;
  private readonly $side: HTMLElement;
  private readonly $stage: HTMLElement;
  private readonly $labels: HTMLElement;
  private readonly $note: HTMLElement;
  private readonly $count: HTMLElement;
  private lastFocus: HTMLElement | null = null;
  private resizeObs: ResizeObserver | null = null;
  onSelect: (id: string) => void = () => {};

  constructor(
    host: HTMLElement,
    private readonly h: PhonesHandlers,
  ) {
    const root = document.createElement('div');
    root.className = 'ph';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Phone cameras');
    root.innerHTML = `
<div class="ph-shell">
  <header class="ph-head">
    <div class="lib-title"><h2>Phone cameras</h2><p data-ref="count">Loading…</p></div>
    <button class="icon-btn" data-act="close" aria-label="Close phone cameras (Esc)">✕</button>
  </header>
  <nav class="ph-phones" role="tablist" aria-label="Phone" data-ref="phones"></nav>
  <div class="ph-body">
    <section class="ph-stage-wrap">
      <div class="ph-stage" data-ref="stage"><div class="ph-labels labels" data-ref="labels"></div></div>
      <div class="ph-toolbar">
        <div class="ph-cams" role="group" aria-label="Camera" data-ref="cams"></div>
        <div class="ph-toggles">
          <div class="seg" role="group" aria-label="Teardown">
            <button data-act="assembled" aria-pressed="true">Assembled</button>
            <button data-act="exploded" aria-pressed="false">Exploded</button>
          </div>
          <button class="btn" data-act="light" aria-pressed="true" title="Show the path of light">Light path</button>
        </div>
      </div>
      <p class="ph-note" data-ref="note"></p>
    </section>
    <aside class="ph-side" data-ref="side" aria-live="polite"></aside>
  </div>
</div>`;
    host.appendChild(root);
    this.root = root;
    const ref = (n: string) => root.querySelector<HTMLElement>(`[data-ref="${n}"]`)!;
    this.$phones = ref('phones');
    this.$cams = ref('cams');
    this.$side = ref('side');
    this.$stage = ref('stage');
    this.$labels = ref('labels');
    this.$note = ref('note');
    this.$count = ref('count');

    root.querySelector('[data-act="close"]')!.addEventListener('click', () => this.close());
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const ph = t.closest<HTMLElement>('[data-phone]');
      if (ph) return this.showPhone(ph.dataset.phone!);
      const cam = t.closest<HTMLElement>('[data-cam]');
      if (cam) return this.selectCamera(Number(cam.dataset.cam));
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'assembled' || act === 'exploded') this.setExploded(act === 'exploded');
      else if (act === 'light') {
        this.light = !this.light;
        this.viewer?.setLight(this.light);
        root.querySelector('[data-act="light"]')!.setAttribute('aria-pressed', String(this.light));
      }
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key.toLowerCase() === 'x' && !(e.target instanceof HTMLInputElement)) this.setExploded(!this.exploded);
    });

    this.ready = loadPhones().then((all) => {
      this.phones = all;
      const brands = new Set(all.map((p) => p.brand));
      this.$count.innerHTML = `${all.length} flagships · ${brands.size} makers<span class="long"> · cameras, sensors and how the light folds</span>`;
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  async open(phoneId?: string): Promise<void> {
    if (!this.isOpen) this.lastFocus = document.activeElement as HTMLElement | null;
    this.root.classList.add('open');
    document.body.classList.add('lib-open');
    await this.ready;
    if (!this.viewer) {
      const { PhoneViewer } = await import('../phone/PhoneViewer');
      this.viewer ??= new PhoneViewer(this.$stage, this.$labels);
      this.viewer.setLight(this.light);
      this.resizeObs ??= new ResizeObserver(() => this.viewer?.resize());
      this.resizeObs.observe(this.$stage);
    }
    if (!this.isOpen) return; // closed while loading: do not start the render loop
    const id = phoneId && this.phones.some((p) => p.id === phoneId) ? phoneId : (this.phone?.id ?? this.phones[0]?.id);
    if (id) this.showPhone(id);
    this.viewer.resize();
    this.viewer.start();
    this.root.querySelector<HTMLElement>('[data-act="close"]')!.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.viewer?.stop();
    this.root.classList.remove('open');
    document.body.classList.remove('lib-open');
    this.h.onClose();
    this.lastFocus?.focus?.({ preventScroll: true });
  }

  /** Renders the 3D view synchronously (screenshot tooling). */
  renderNow(): void {
    this.viewer?.renderOnce(1 / 60, true);
  }

  private setExploded(on: boolean): void {
    this.exploded = on;
    this.viewer?.setExploded(on);
    this.root.querySelector('[data-act="assembled"]')!.setAttribute('aria-pressed', String(!on));
    this.root.querySelector('[data-act="exploded"]')!.setAttribute('aria-pressed', String(on));
  }

  private showPhone(id: string): void {
    const p = this.phones.find((x) => x.id === id);
    if (!p) return;
    const changed = this.phone?.id !== id;
    this.phone = p;
    this.onSelect(id);
    this.$phones.innerHTML = this.phones
      .map((x) => `<button role="tab" data-phone="${x.id}" aria-selected="${x.id === id}" class="${x.id === id ? 'on' : ''}"><small>${esc(x.brand)}</small>${esc(x.name)}</button>`)
      .join('');
    if (changed) {
      this.viewer?.setPhone(p);
      this.cam = Math.max(0, p.cameras.findIndex((c) => c.role === 'main'));
    }
    this.renderCams();
    this.renderSide();
  }

  private selectCamera(i: number): void {
    if (!this.phone || i < 0 || i >= this.phone.cameras.length) return;
    this.cam = i;
    this.viewer?.select(i);
    this.renderCams();
    this.renderSide();
  }

  private renderCams(): void {
    const p = this.phone!;
    this.$cams.innerHTML = p.cameras
      .map((c, i) => {
        const o = cameraOptics(p, c);
        const eq = o.eqFocal ? `${trim(o.eqFocal.value, 0)} mm` : c.opticalZoom ? `${c.opticalZoom}×` : '';
        return `<button class="chip-f${i === this.cam ? ' on' : ''}" data-cam="${i}" aria-pressed="${i === this.cam}">${ROLE_LABEL[c.role]}${eq ? ` <small>${eq}</small>` : ''}</button>`;
      })
      .join('');
    const notes = this.viewer?.illustrative() ?? [];
    const kind = moduleKind(p.cameras[this.cam]);
    const fold = kind === 'tetraprism' ? 'The maker describes a tetraprism (light reflected four times); the path drawn is illustrative. ' : kind === 'lenses-on-prism' ? 'The maker describes the lenses sitting on the prism; drawn schematically. ' : kind === 'periscope' ? 'Periscope: a prism folds the light 90° into the phone. ' : '';
    this.$note.innerHTML = `<span class="lc-note">Illustrative teardown</span> ${fold}Parts and spacings are schematic; sensor size and element count follow the published specs where they exist${notes.length ? ` — here: ${esc(notes.join('; '))}` : ''}.`;
  }

  private renderSide(): void {
    const p = this.phone!;
    const c = p.cameras[this.cam];
    const o: CameraOptics = cameraOptics(p, c);
    const sensorTxt = c.sensorFormat
      ? `${esc(c.sensorFormat)}${o.sensor ? ` <small>≈ ${o.sensor.value.width.toFixed(1)} × ${o.sensor.value.height.toFixed(1)} mm</small> ${computedTag(o.sensor.how)}` : ''}`
      : o.sensor
        ? `≈ ${o.sensor.value.width.toFixed(1)} × ${o.sensor.value.height.toFixed(1)} mm ${computedTag(o.sensor.how)}`
        : UNVERIFIED;
    const ap = c.aperture ? `f/${trim(c.aperture)}${c.apertureSteps?.length ? ` <small>variable: ${c.apertureSteps.map((n) => `f/${trim(n)}`).join(' · ')}</small>` : ''}` : UNVERIFIED;
    const eqAp = o.eqAperture ? `≈ f/${trim(o.eqAperture, 1)} ${computedTag(`f/${c.aperture} × crop ${o.crop}: depth of field and total light for the same framing (exposure is still f/${c.aperture})`)}` : '—';
    const dof = o.dofAt2m ? `${(o.dofAt2m.near / 1000).toFixed(2)} m – ${Number.isFinite(o.dofAt2m.far) ? `${(o.dofAt2m.far / 1000).toFixed(2)} m` : '∞'} ${computedTag('thin lens, focused at 2 m from the sensor, CoC = diagonal / 1442, wide open')}` : '—';
    const rows: [string, string][] = [
      ['Resolution', c.megapixels ? `${c.megapixels} MP` : UNVERIFIED],
      ['Sensor', sensorTxt],
      ...(c.sensorModel ? ([['Sensor model', esc(c.sensorModel)]] as [string, string][]) : []),
      ['Pixel size', c.pixelSizeUm ? `${c.pixelSizeUm} µm${c.binnedPixelUm ? ` <small>${c.binnedPixelUm} µm binned</small>` : ''}` : UNVERIFIED],
      ['Focal length', `${valued(o.eqFocal, ' mm', 1)} <small>35 mm-equiv.</small>`],
      ['Real focal length', valued(o.realFocal, ' mm', 2)],
      ['Aperture', ap],
      ['Equivalent aperture', eqAp],
      ['Angle of view', `${valued(o.fovDiag, '°', 0)} <small>diagonal</small>`],
      ['Optical zoom', c.opticalZoom ? `${trim(c.opticalZoom, 1)}×` : c.role === 'front' ? '—' : UNVERIFIED],
      ['Stabilization', c.stabilization ? esc(c.stabilization) : UNVERIFIED],
      ['Autofocus', c.autofocus ? esc(c.autofocus) : UNVERIFIED],
      ['Lens elements', c.lensElements ? `${c.lensElements}` : UNVERIFIED],
      ...(c.folded ? ([['Folded optics', esc(c.prism ?? 'yes')]] as [string, string][]) : []),
      ['Depth of field at 2 m', dof],
    ];
    const all = p.cameras
      .map((x, i) => {
        const xo = cameraOptics(p, x);
        return `<tr class="${i === this.cam ? 'on' : ''}" data-cam="${i}"><th>${ROLE_LABEL[x.role]}</th><td>${x.megapixels ? `${x.megapixels} MP` : '—'}</td><td>${esc(x.sensorFormat ?? '—')}</td><td>${xo.eqFocal ? `${trim(xo.eqFocal.value, 0)} mm${xo.eqFocal.source === 'computed' ? '*' : ''}` : '—'}</td><td>${x.aperture ? `f/${trim(x.aperture)}` : '—'}</td></tr>`;
      })
      .join('');
    const hasStar = p.cameras.some((x) => cameraOptics(p, x).eqFocal?.source === 'computed');
    const sources = p.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a> <span class="src-kind ${s.kind}">${s.kind}</span> <span class="src-dom">${esc(sourceDomain(s))}</span></li>`).join('');
    this.$side.innerHTML = `
<div class="lib-d">
  <div class="lib-d-brand">${esc(p.brand)} · announced ${esc(p.announced)}</div>
  <h3>${esc(p.name)}</h3>
  <p class="lib-d-famous">${esc(p.summary)}</p>
  <h4>${ROLE_LABEL[c.role]} camera <small>${esc(c.label)}</small></h4>
  <dl class="lib-d-specs">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
  ${c.notes ? `<p class="muted ph-cam-note">${esc(c.notes)}</p>` : ''}
  <h4>All cameras</h4>
  <table class="ph-all"><thead><tr><th></th><th>MP</th><th>Sensor</th><th>Equiv.</th><th>f/</th></tr></thead><tbody>${all}</tbody></table>
  ${hasStar ? '<p class="muted">* computed from the published zoom factor × the main camera.</p>' : ''}
  <h4>Computational photography <small>as named by ${esc(p.brand)}</small></h4>
  <ul class="ph-comp">${p.computational.map((x) => `<li><strong>${esc(x.name)}</strong> — ${esc(x.description)}</li>`).join('')}</ul>
  <section class="lib-d-sources">
    <h4>Sources <small>checked ${esc(p.checked)}</small></h4>
    <ul>${sources}</ul>
  </section>
</div>`;
    this.$side.querySelectorAll<HTMLElement>('tr[data-cam]').forEach((tr) => tr.addEventListener('click', () => this.selectCamera(Number(tr.dataset.cam))));
  }
}
