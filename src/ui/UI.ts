import { LENS, SUBJECTS, type SubjectId } from '../optics/config';
import type { OpticsState } from '../optics/opticsState';
import { depthMap } from '../scene/layout';
import { explain } from './explain';
import { fmtCoc, fmtDistance, fmtDofCm, fmtF, fmtMm, fmtRatio, splitDistance } from './format';

export type QualityChoice = 'auto' | 'low' | 'medium' | 'high';
export type CameraPreset = 'hero' | 'lens' | 'sensor' | 'diorama';

export interface UIHandlers {
  onSlider(u: number): void;
  onFocusSubject(id: SubjectId): void;
  onFocusDistance(mm: number): void;
  onAperture(n: number): void;
  onExploded(on: boolean): void;
  onQuality(q: QualityChoice): void;
  onCamera(preset: CameraPreset): void;
  onPeaking(on: boolean): void;
  onHighlight(id: SubjectId | null): void;
}

const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <defs>
    <radialGradient id="lg" cx="42%" cy="38%" r="62%"><stop offset="0" stop-color="#d7f7ff"/><stop offset=".45" stop-color="#4fd3ff"/><stop offset="1" stop-color="#0a1a2a"/></radialGradient>
  </defs>
  <circle cx="24" cy="24" r="22" fill="#0b0f16" stroke="rgba(255,255,255,.18)"/>
  <circle cx="24" cy="24" r="15.5" fill="url(#lg)"/>
  <g fill="#0b0f16" opacity=".92">${Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    const x1 = 24 + Math.cos(a) * 16;
    const y1 = 24 + Math.sin(a) * 16;
    const x2 = 24 + Math.cos(a + 0.9) * 16;
    const y2 = 24 + Math.sin(a + 0.9) * 16;
    const x3 = 24 + Math.cos(a + 0.45) * 7.5;
    const y3 = 24 + Math.sin(a + 0.45) * 7.5;
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${x3.toFixed(1)} ${y3.toFixed(1)} Z"/>`;
  }).join('')}</g>
  <circle cx="20" cy="19" r="2.6" fill="#fff" opacity=".85"/>
</svg>`;

/** Small iris icon whose opening reflects the f-number. */
function irisIcon(n: number): string {
  const open = 10.5 * (2 / n) ** 0.55;
  const blades = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    const p = (r: number, t: number) => `${(16 + Math.cos(t) * r).toFixed(2)} ${(16 + Math.sin(t) * r).toFixed(2)}`;
    return `<path class="blade" d="M${p(15, a)} L${p(15, a + 0.95)} L${p(open, a + 0.7)} L${p(open, a)} Z"/>`;
  }).join('');
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/><g fill="rgba(255,255,255,.14)" stroke="rgba(255,255,255,.45)" stroke-width=".6">${blades}</g></svg>`;
}

const SUBJECT_COLOR: Record<SubjectId, string> = { cabin: 'var(--cabin)', trees: 'var(--trees)', mountain: 'var(--mountain)' };
const QUICK_LABEL: Record<SubjectId, string> = { cabin: 'Foreground', trees: 'Middle', mountain: 'Background' };
const SLIDER_TICKS: [number, string][] = [
  [300, '0.3'],
  [500, '0.5'],
  [1000, '1 m'],
  [2000, '2'],
  [5000, '5'],
  [20000, '20'],
  [Infinity, '∞'],
];

export class UI {
  readonly root: HTMLElement;
  private readonly $: Record<string, HTMLElement> = {};
  private readonly slider: HTMLInputElement;
  private readonly filmDock: HTMLElement;
  private readonly filmModalFrame: HTMLElement;
  private readonly filmModal: HTMLElement;
  private readonly helpModal: HTMLElement;
  private readonly explainPanel: HTMLElement;
  private readonly subjectRows = new Map<SubjectId, { coc: HTMLElement; state: HTMLElement; bar: HTMLElement }>();
  private readonly trackDots = new Map<SubjectId, HTMLElement>();
  private readonly trackZone: HTMLElement;
  private readonly trackFocus: HTMLElement;
  private readonly sliderZone: HTMLElement;
  private readonly sliderFill: HTMLElement;
  private lastExplainKey = '';
  private sliderActive = false;
  private filmOpen = false;
  private peaking = false;
  private camIndex = 0;

  constructor(parent: HTMLElement, private readonly h: UIHandlers) {
    const root = document.createElement('div');
    root.id = 'ui';
    root.innerHTML = this.markup();
    parent.appendChild(root);
    this.root = root;
    root.querySelectorAll<HTMLElement>('[data-bind]').forEach((el) => (this.$[el.dataset.bind!] = el));
    this.slider = root.querySelector('#focus')!;
    this.filmDock = root.querySelector('[data-film="dock"]')!;
    this.filmModalFrame = root.querySelector('[data-film="modal"]')!;
    this.filmModal = root.querySelector('.film-modal')!;
    this.helpModal = root.querySelector('.help-modal')!;
    this.explainPanel = root.querySelector('.explain')!;
    this.trackZone = root.querySelector('.dof-track .zone')!;
    this.trackFocus = root.querySelector('.dof-track .focus-mark')!;
    this.sliderZone = root.querySelector('.slider-wrap .zone')!;
    this.sliderFill = root.querySelector('.slider-wrap .fill')!;
    root.querySelectorAll<HTMLElement>('.dof-track .sdot').forEach((el) => this.trackDots.set(el.dataset.subject as SubjectId, el));
    root.querySelectorAll<HTMLElement>('.subjects li').forEach((li) => {
      const id = li.dataset.subject as SubjectId;
      this.subjectRows.set(id, { coc: li.querySelector('.coc')!, state: li.querySelector('.state')!, bar: li.querySelector('.bar i')! });
    });
    this.bind();
    this.layoutVars();
    window.addEventListener('resize', () => this.layoutVars());
  }

  // ------------------------------------------------------------------ markup
  private markup(): string {
    const u = (d: number) => (Math.min(1, Math.max(0, depthMap.toU(d))) * 100).toFixed(3);
    const ticks = SLIDER_TICKS.map(([d, l]) => `<span style="left:${u(d)}%">${l}</span>`).join('');
    const marks = SUBJECTS.map((s) => `<i style="left:${u(s.distance)}%;color:${SUBJECT_COLOR[s.id]}" title="${s.label}"></i>`).join('');
    const trackTicks = ([[300, '0.3'], [1000, '1'], [2000, '2'], [8000, '8'], [Infinity, '∞']] as [number, string][])
      .map(([d, l]) => `<span class="tick" style="left:${u(d)}%">${l}</span>`)
      .join('');
    const trackDots = SUBJECTS.map((s) => `<span class="sdot" data-subject="${s.id}" style="left:${u(s.distance)}%;background:${SUBJECT_COLOR[s.id]}"></span>`).join('');
    const subjects = SUBJECTS.map(
      (s) => `<li data-subject="${s.id}" style="color:${SUBJECT_COLOR[s.id]}" title="Focus on the ${s.label.toLowerCase()}">
        <span class="dot"></span>
        <span class="name" style="color:var(--text)">${s.label}<small>${fmtDistance(s.distance, 1)}</small><span class="state">sharp</span></span>
        <span class="coc">—</span>
        <span class="bar"><i></i><b style="left:${(Math.log10(1) / 2) * 100 + 18}%"></b></span>
      </li>`,
    ).join('');
    const quick = SUBJECTS.map(
      (s) => `<button class="btn" data-focus="${s.id}" aria-pressed="false"><span class="sw" style="color:${SUBJECT_COLOR[s.id]}"></span>${QUICK_LABEL[s.id]} <small>${fmtDistance(s.distance, 1)}</small></button>`,
    ).join('');
    const apertures = LENS.apertures.map((n) => `<button class="btn" data-f="${n}" aria-pressed="false" aria-label="Aperture f/${n}">${irisIcon(n)}<span>f/${n}</span></button>`).join('');

    return `
<header class="topbar">
  <div class="brand">${LOGO}<div><h1>Lens Lab</h1><p>How camera focus really works</p></div></div>
  <div class="top-actions">
    <div class="chip desktop-only"><div class="seg" role="group" aria-label="Render quality">
      <button data-quality="auto" aria-pressed="true" title="Adapts to your device">Auto</button>
      <button data-quality="low" aria-pressed="false">Low</button>
      <button data-quality="medium" aria-pressed="false">Medium</button>
      <button data-quality="high" aria-pressed="false">High</button>
    </div></div>
    <button class="icon-btn" data-action="help" aria-label="How to use Lens Lab">?</button>
  </div>
</header>

<aside class="panel explain" aria-live="polite">
  <button class="icon-btn close mobile-only" data-action="close-learn" aria-label="Close">✕</button>
  <div class="eyebrow" data-bind="eyebrow">Focused</div>
  <h2>The Plane of Focus</h2>
  <p class="lead" data-bind="lead"></p>
  <div class="body" data-bind="body"></div>
  <div class="hint desktop-only">Drag the <strong>focus ring</strong> on the lens or the slider. Keys: <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> focus · <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> aperture · <kbd>X</kbd> explode · <kbd>F</kbd> sensor view</div>
</aside>

<aside class="panel readouts" aria-label="Live lens readouts">
  <div class="ro-grid">
    <div class="ro big accent"><label>Focus</label><div class="val"><span data-bind="focusVal">2.00</span><small data-bind="focusUnit">m</small></div></div>
    <div class="ro big"><label>Aperture</label><div class="val" data-bind="aperture">f/5.6</div></div>
    <div class="ro"><label>Focal length</label><div class="val">50<small>mm</small></div></div>
    <div class="ro"><label>Sharp zone</label><div class="val" data-bind="dof">—</div><div class="sub" data-bind="dofRange">—</div></div>
  </div>
  <div class="dof-track" aria-hidden="true"><div class="rail"></div><div class="zone"></div>${trackDots}<div class="focus-mark"></div>${trackTicks}</div>
  <dl class="ro-extra">
    <div><dt>Lens → sensor</dt><dd data-bind="di">—</dd></div>
    <div><dt>Focus travel</dt><dd data-bind="travel">—</dd></div>
    <div><dt>Hyperfocal</dt><dd data-bind="hyper">—</dd></div>
    <div><dt>Magnification</dt><dd data-bind="mag">—</dd></div>
    <div><dt>Aperture ⌀</dt><dd data-bind="apd">—</dd></div>
    <div><dt>Angle of view</dt><dd data-bind="aov">—</dd></div>
  </dl>
  <ul class="subjects" aria-label="Blur of each subject (circle of confusion)">${subjects}</ul>
</aside>

<div class="filmstrip" data-action="film" role="button" tabindex="0" aria-label="Sensor view — open large">
  <div class="film-perf top"></div>
  <div class="film-edge">LENS·LAB 400 ▸ 24</div>
  <div class="film-frame" data-film="dock"><div class="film-hud"><span class="rec">LIVE</span><span data-bind="filmHud">50 mm · f/5.6</span></div></div>
  <div class="film-perf bottom"></div>
  <div class="film-caption">Sensor view</div>
</div>

<section class="panel dock" aria-label="Lens controls">
  <div class="ctl focus-ctl">
    <div class="ctl-head"><label for="focus">Focus distance</label><output data-bind="focusOut">2.00 m</output></div>
    <div class="slider-wrap">
      <div class="track"></div><div class="zone"></div><div class="fill"></div>
      <div class="marks">${marks}</div>
      <input id="focus" type="range" min="0" max="1000" step="1" value="500" aria-valuetext="2 metres">
      <div class="ticks">${ticks}</div>
    </div>
    <div class="quick">${quick}</div>
  </div>
  <div class="ctl ap-ctl">
    <div class="ctl-head"><span class="lbl">Aperture</span><output data-bind="apOut">f/5.6</output></div>
    <div class="ap-buttons">${apertures}</div>
  </div>
  <div class="ctl view-ctl">
    <div class="ctl-head"><span class="lbl">Lens</span></div>
    <div class="seg" role="group" aria-label="Lens view">
      <button data-explode="0" aria-pressed="false">Assembled</button>
      <button data-explode="1" aria-pressed="true">Exploded</button>
    </div>
    <div class="cams">
      <button class="btn" data-cam="hero">Overview</button>
      <button class="btn" data-cam="lens">Lens</button>
      <button class="btn" data-cam="sensor">Sensor</button>
      <button class="btn" data-cam="diorama">Diorama</button>
    </div>
  </div>
  <div class="mobile-bar mobile-only">
    <div class="seg" role="group" aria-label="Lens view">
      <button data-explode="0" aria-pressed="false">Assembled</button>
      <button data-explode="1" aria-pressed="true">Exploded</button>
    </div>
    <button class="btn" data-action="cam-cycle" aria-label="Next camera view">View</button>
    <button class="btn" data-action="learn">Learn</button>
  </div>
</section>

<div class="labels"></div>

<div class="film-modal" role="dialog" aria-modal="true" aria-label="What the sensor sees">
  <div class="sheet">
    <div class="sheet-head">
      <h3>What the sensor sees</h3>
      <div class="sheet-actions">
        <button class="btn" data-action="peaking" aria-pressed="false" title="Highlight edges that are within the acceptable circle of confusion">Focus peaking</button>
        <button class="icon-btn" data-action="close-film" aria-label="Close sensor view">✕</button>
      </div>
    </div>
    <div class="film-frame" data-film="modal">
      <div class="film-hud"><span class="rec">LIVE · 36 × 24 mm</span><span data-bind="filmHud2"></span></div>
      <div class="film-hud film-hud-bottom"><span data-bind="filmHud3"></span><span>CoC limit ${fmtCoc(LENS.cocLimit)}</span></div>
    </div>
    <p class="caption" data-bind="filmCaption"></p>
  </div>
</div>

<div class="help-modal" role="dialog" aria-modal="true" aria-label="How to use Lens Lab">
  <div class="card">
    <h3>How to use Lens Lab</h3>
    <ul>
      <li><strong>Turn the focus ring</strong> — grab the knurled ring on the lens and drag. The whole optical cell slides on its helicoid and the glowing plane of focus moves through the diorama.</li>
      <li><strong>Slider &amp; quick focus</strong> — 30 cm to ∞, or jump to the foreground cabin, midground trees or background mountain.</li>
      <li><strong>Aperture</strong> — f/2, f/5.6, f/16. Watch the iris blades, the light cones and the sharp zone change.</li>
      <li><strong>Read the sensor</strong> — in-focus light lands as a point, out-of-focus light as a disc. Open the sensor view (<kbd>F</kbd>) to see the real blur.</li>
      <li><strong>Orbit</strong> — drag to rotate, scroll / pinch to zoom, right-drag / two fingers to pan.</li>
    </ul>
    <div class="foot"><span>Physics: thin lens, f = 50 mm, full frame, c = 0.03 mm.</span><button class="btn" data-action="close-help">Got it</button></div>
  </div>
</div>`;
  }

  // ------------------------------------------------------------------ events
  private bind(): void {
    const r = this.root;
    this.slider.addEventListener('pointerdown', () => (this.sliderActive = true));
    window.addEventListener('pointerup', () => (this.sliderActive = false));
    this.slider.addEventListener('input', () => {
      this.h.onSlider(Number(this.slider.value) / 1000);
    });
    this.slider.addEventListener('keydown', (e) => e.stopPropagation());

    r.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) =>
      b.addEventListener('click', () => this.h.onFocusSubject(b.dataset.focus as SubjectId)),
    );
    r.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => b.addEventListener('click', () => this.h.onAperture(Number(b.dataset.f))));
    r.querySelectorAll<HTMLButtonElement>('[data-explode]').forEach((b) =>
      b.addEventListener('click', () => this.h.onExploded(b.dataset.explode === '1')),
    );
    r.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) =>
      b.addEventListener('click', () => {
        this.h.onQuality(b.dataset.quality as QualityChoice);
        this.setQuality(b.dataset.quality as QualityChoice);
      }),
    );
    r.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) =>
      b.addEventListener('click', () => this.h.onCamera(b.dataset.cam as CameraPreset)),
    );
    r.querySelectorAll<HTMLElement>('.subjects li').forEach((li) => {
      li.addEventListener('click', () => this.h.onFocusSubject(li.dataset.subject as SubjectId));
      li.addEventListener('pointerenter', () => this.h.onHighlight(li.dataset.subject as SubjectId));
      li.addEventListener('pointerleave', () => this.h.onHighlight(null));
    });
    r.querySelectorAll<HTMLElement>('[data-focus]').forEach((b) => {
      b.addEventListener('pointerenter', () => this.h.onHighlight(b.dataset.focus as SubjectId));
      b.addEventListener('pointerleave', () => this.h.onHighlight(null));
    });

    const film = r.querySelector<HTMLElement>('[data-action="film"]')!;
    film.addEventListener('click', () => this.openFilm(true));
    film.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openFilm(true);
      }
    });
    r.querySelector('[data-action="close-film"]')!.addEventListener('click', () => this.openFilm(false));
    this.filmModal.addEventListener('click', (e) => {
      if (e.target === this.filmModal) this.openFilm(false);
    });
    const peakBtn = r.querySelector<HTMLButtonElement>('[data-action="peaking"]')!;
    peakBtn.addEventListener('click', () => {
      this.peaking = !this.peaking;
      peakBtn.setAttribute('aria-pressed', String(this.peaking));
      this.h.onPeaking(this.peaking);
    });

    r.querySelector('[data-action="help"]')!.addEventListener('click', () => this.helpModal.classList.add('open'));
    r.querySelector('[data-action="close-help"]')!.addEventListener('click', () => this.helpModal.classList.remove('open'));
    this.helpModal.addEventListener('click', (e) => {
      if (e.target === this.helpModal) this.helpModal.classList.remove('open');
    });
    r.querySelector('[data-action="learn"]')!.addEventListener('click', () => this.explainPanel.classList.add('open'));
    r.querySelector('[data-action="close-learn"]')!.addEventListener('click', () => this.explainPanel.classList.remove('open'));
    const presets: CameraPreset[] = ['hero', 'lens', 'sensor', 'diorama'];
    r.querySelector('[data-action="cam-cycle"]')!.addEventListener('click', () => {
      this.camIndex = (this.camIndex + 1) % presets.length;
      this.h.onCamera(presets[this.camIndex]);
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        this.openFilm(false);
        this.helpModal.classList.remove('open');
        this.explainPanel.classList.remove('open');
      } else if (k === '1') this.h.onFocusSubject('cabin');
      else if (k === '2') this.h.onFocusSubject('trees');
      else if (k === '3') this.h.onFocusSubject('mountain');
      else if (k === 'q') this.h.onAperture(2);
      else if (k === 'w') this.h.onAperture(5.6);
      else if (k === 'e') this.h.onAperture(16);
      else if (k === 'x') this.h.onExploded(!this.explodedState);
      else if (k === 'f') this.openFilm(!this.filmOpen);
      else if (k === 'arrowleft' || k === 'arrowright') {
        const u = Number(this.slider.value) / 1000 + (k === 'arrowleft' ? -0.02 : 0.02);
        this.h.onSlider(Math.min(1, Math.max(0, u)));
      } else return;
      e.preventDefault();
    });
  }

  private explodedState = true;

  openFilm(open: boolean): void {
    this.filmOpen = open;
    this.filmModal.classList.toggle('open', open);
  }

  get filmIsOpen(): boolean {
    return this.filmOpen;
  }

  setQuality(q: QualityChoice): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.quality === q)));
  }

  /** Exposes panel sizes to CSS so side panels never run under the bottom elements. */
  private layoutVars(): void {
    const film = this.root.querySelector<HTMLElement>('.filmstrip')!;
    const dock = this.root.querySelector<HTMLElement>('.dock')!;
    document.documentElement.style.setProperty('--film-h', `${film.offsetHeight}px`);
    document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
  }

  /** Screen region not covered by panels (CSS px), used to frame the 3D view. */
  safeArea(): { left: number; top: number; right: number; bottom: number } {
    const W = window.innerWidth;
    const q = (sel: string) => this.root.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
    if (W <= 820) {
      const top = q('.readouts').bottom + 8;
      const bottom = q('.dock').top - 8;
      return { left: 0, top, right: W, bottom: Math.max(top + 160, bottom) };
    }
    const explain = q('.explain');
    const readouts = q('.readouts');
    const dock = q('.dock');
    const top = Math.min(explain.top, readouts.top) - 10;
    return { left: explain.right + 8, top: Math.max(56, top), right: readouts.left - 8, bottom: dock.top - 10 };
  }

  /** Rect (CSS px, relative to the viewport) where the sensor image must be drawn. */
  filmRect(): { x: number; y: number; width: number; height: number } | null {
    const el = this.filmOpen ? this.filmModalFrame : this.filmDock;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  /** Pixel width the sensor view should render at for the current display. */
  filmDisplayWidth(): number {
    const el = this.filmOpen ? this.filmModalFrame : this.filmDock;
    return el.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 2);
  }

  // ------------------------------------------------------------------ updates
  update(o: OpticsState, state: { u: number; exploded: boolean; apertureTarget: number; focusTargetSubject: SubjectId | null }): void {
    const $ = this.$;
    const fd = splitDistance(o.focusDistance);
    $.focusVal.textContent = fd.value;
    $.focusUnit.textContent = fd.unit;
    $.aperture.textContent = fmtF(o.fNumber);
    $.apOut.textContent = fmtF(o.fNumber);
    $.focusOut.textContent = fmtDistance(o.focusDistance);
    $.dof.textContent = fmtDofCm(o.depthOfField);
    $.dofRange.textContent = `${fmtDistance(o.near)} – ${fmtDistance(o.far)}`;
    $.di.textContent = fmtMm(o.imageDistance);
    $.travel.textContent = `+${o.extension.toFixed(2)} mm`;
    $.hyper.textContent = fmtDistance(o.hyperfocal, 1);
    $.mag.textContent = fmtRatio(o.magnification);
    $.apd.textContent = fmtMm(o.apertureDiameter, 1);
    $.aov.textContent = `${((o.fovHorizontal * 180) / Math.PI).toFixed(1)}°`;
    $.filmHud.textContent = `50 mm · ${fmtF(o.fNumber)} · ${fmtDistance(o.focusDistance)}`;
    $.filmHud2.textContent = `50 mm · ${fmtF(o.fNumber)} · focus ${fmtDistance(o.focusDistance)}`;
    $.filmHud3.textContent = `sharp ${fmtDistance(o.near)} – ${fmtDistance(o.far)}`;

    // slider (don't fight the user's thumb)
    if (!this.sliderActive && document.activeElement !== this.slider) {
      this.slider.value = String(Math.round(state.u * 1000));
    }
    this.slider.setAttribute('aria-valuetext', fmtDistance(o.focusDistance).replace('m', 'metres'));
    const uNear = Math.min(1, Math.max(0, depthMap.toU(o.near)));
    const uFar = Math.min(1, Math.max(0, depthMap.toU(o.far)));
    const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
    // the range input's thumb travels over (width − thumb); map to the inner span
    const inner = (v: number) => `calc(11px + (100% - 22px) * ${v.toFixed(4)})`;
    this.sliderFill.style.width = inner(state.u);
    this.sliderZone.style.left = inner(uNear);
    this.sliderZone.style.width = `calc((100% - 22px) * ${Math.max(0.004, uFar - uNear).toFixed(4)})`;
    this.trackZone.style.left = pct(uNear);
    this.trackZone.style.width = pct(Math.max(0.006, uFar - uNear));
    this.trackFocus.style.left = pct(state.u);

    // subjects
    for (const s of o.subjects) {
      const row = this.subjectRows.get(s.id)!;
      row.coc.textContent = fmtCoc(s.coc);
      row.state.textContent = s.sharpness;
      row.state.className = `state ${s.sharpness}`;
      // log scale: CoC = c → 18 %, 100·c → 100 %
      const w = s.coc <= 1e-6 ? 0 : Math.min(100, Math.max(2, 18 + (Math.log10(s.cocRatio) / 2) * 82));
      row.bar.style.width = `${w}%`;
    }

    // buttons
    this.root.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) =>
      b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.f) - state.apertureTarget) < 0.01)),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-explode]').forEach((b) =>
      b.setAttribute('aria-pressed', String((b.dataset.explode === '1') === state.exploded)),
    );
    this.explodedState = state.exploded;
    this.root.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.focus === state.focusTargetSubject)),
    );

    // explanation (only rebuilt when the words would change)
    const key = [
      Math.round(o.focusDistance / 10),
      Math.round(o.fNumber * 10),
      ...o.subjects.map((s) => `${s.sharpness}${Math.round(s.coc * 100)}`),
    ].join('|');
    if (key !== this.lastExplainKey) {
      this.lastExplainKey = key;
      const ex = explain(o);
      $.eyebrow.textContent = ex.eyebrow;
      $.lead.innerHTML = ex.lead;
      $.body.innerHTML = ex.body.map((p) => `<p>${p}</p>`).join('');
      const sharp = o.subjects.filter((s) => s.sharpness === 'sharp').map((s) => s.id);
      $.filmCaption.innerHTML = `Rendered from the lens' optical centre with the real ${((o.fovHorizontal * 180) / Math.PI).toFixed(1)}° angle of view. Every pixel is blurred by its own thin-lens circle of confusion: ${o.subjects
        .map((s) => `${s.id} <strong>${fmtCoc(s.coc)}</strong>`)
        .join(', ')}. ${sharp.length ? `Sharp: ${sharp.join(', ')}.` : 'Nothing is within the sharp zone.'}`;
    }
  }
}
