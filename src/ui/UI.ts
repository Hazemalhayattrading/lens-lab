import { SUBJECTS, type SubjectId } from '../optics/config';
import { apertureButtons, focalAtZoom, zoomForFocal } from '../optics/lensModel';
import { FULL_FRAME_DIAGONAL, diagonal } from '../optics/formats';
import type { LabLens } from '../lab/labLens';
import type { OpticsFrame } from '../lab/optics';
import { depthMap } from '../scene/layout';
import { explain, SUBJECT_NAME } from './explain';
import { fmtApertureRange, fmtCoc, fmtDeg, fmtDistance, fmtDofCm, fmtF, fmtFocal, fmtFocalRange, fmtMm, fmtRange, fmtRatio, splitDistance } from './format';

export type QualityChoice = 'auto' | 'low' | 'medium' | 'high';
export type CameraPreset = 'hero' | 'lens' | 'sensor' | 'diorama' | 'far';

export interface UIHandlers {
  /** Focus slider moved (ladder position u). */
  onSlider(u: number): void;
  onFocusSubject(id: SubjectId): void;
  onAperture(n: number): void;
  /** Zoom slider moved (ring position z). */
  onZoom(z: number): void;
  onExploded(on: boolean): void;
  onQuality(q: QualityChoice): void;
  onCamera(preset: CameraPreset): void;
  onPeaking(on: boolean): void;
  onHighlight(id: SubjectId | null): void;
  onLibrary?(): void;
}

export interface UIState {
  u: number;
  uMin: number;
  exploded: boolean;
  apertureTarget: number;
  wideOpen: boolean;
  zoom: number;
  focusTargetSubject: SubjectId | null;
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

/** Small iris icon whose opening reflects the f-number relative to the lens' widest aperture. */
function irisIcon(n: number, maxN: number, blades: number): string {
  const open = 10.5 * (maxN / n) ** 0.55;
  const k = Math.max(5, Math.min(15, blades));
  const paths = Array.from({ length: k }, (_, i) => {
    const a = (i / k) * Math.PI * 2;
    const p = (r: number, t: number) => `${(16 + Math.cos(t) * r).toFixed(2)} ${(16 + Math.sin(t) * r).toFixed(2)}`;
    const w = (Math.PI * 2) / k;
    return `<path class="blade" d="M${p(15, a)} L${p(15, a + w * 1.2)} L${p(open, a + w * 0.9)} L${p(open, a)} Z"/>`;
  }).join('');
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/><g fill="rgba(255,255,255,.14)" stroke="rgba(255,255,255,.45)" stroke-width=".6">${paths}</g></svg>`;
}

const SLIDER_TICKS: [number, string][] = [
  [300, '0.3'],
  [1000, '1 m'],
  [3000, '3'],
  [10000, '10'],
  [30000, '30'],
  [100000, '100'],
  [1000000, '1 km'],
  [Infinity, '∞'],
];
const TRACK_TICKS: [number, string][] = [
  [300, '0.3'],
  [2000, '2'],
  [30000, '30'],
  [200000, '200'],
  [Infinity, '∞'],
];
const ZOOM_STOPS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 35, 40, 45, 50, 55, 60, 70, 85, 100, 105, 135, 140, 150, 180, 200, 280, 300, 400, 500, 600, 800];

const uPct = (d: number) => (Math.min(1, Math.max(0, depthMap.toU(d))) * 100).toFixed(3);

export class UI {
  readonly root: HTMLElement;
  private readonly $: Record<string, HTMLElement> = {};
  private readonly slider: HTMLInputElement;
  private readonly zoomSlider: HTMLInputElement;
  private readonly filmDock: HTMLElement;
  private readonly filmModalFrame: HTMLElement;
  private readonly filmModal: HTMLElement;
  private readonly helpModal: HTMLElement;
  private readonly explainPanel: HTMLElement;
  private readonly subjectRows = new Map<SubjectId, { li: HTMLElement; coc: HTMLElement; state: HTMLElement; bar: HTMLElement }>();
  private readonly chips = new Map<SubjectId, HTMLButtonElement>();
  private readonly trackZone: HTMLElement;
  private readonly trackFocus: HTMLElement;
  private readonly sliderZone: HTMLElement;
  private readonly sliderFill: HTMLElement;
  private readonly sliderBlocked: HTMLElement;
  private readonly apButtons: HTMLElement;
  private lastExplainKey = '';
  private lastApertureKey = '';
  private sliderActive = false;
  private zoomActive = false;
  private filmOpen = false;
  private peaking = false;
  private camIndex = 0;
  private explodedState = true;
  private lens: LabLens | null = null;
  private apertureList: number[] = [];

  constructor(parent: HTMLElement, private readonly h: UIHandlers) {
    const root = document.createElement('div');
    root.id = 'ui';
    root.innerHTML = this.markup();
    parent.appendChild(root);
    this.root = root;
    root.querySelectorAll<HTMLElement>('[data-bind]').forEach((el) => (this.$[el.dataset.bind!] = el));
    this.slider = root.querySelector('#focus')!;
    this.zoomSlider = root.querySelector('#zoom')!;
    this.filmDock = root.querySelector('[data-film="dock"]')!;
    this.filmModalFrame = root.querySelector('[data-film="modal"]')!;
    this.filmModal = root.querySelector('.film-modal')!;
    this.helpModal = root.querySelector('.help-modal')!;
    this.explainPanel = root.querySelector('.explain')!;
    this.trackZone = root.querySelector('.dof-track .zone')!;
    this.trackFocus = root.querySelector('.dof-track .focus-mark')!;
    this.sliderZone = root.querySelector('.slider-wrap.focus .zone')!;
    this.sliderFill = root.querySelector('.slider-wrap.focus .fill')!;
    this.sliderBlocked = root.querySelector('.slider-wrap.focus .blocked')!;
    this.apButtons = root.querySelector('.ap-buttons')!;
    root.querySelectorAll<HTMLElement>('.subjects li').forEach((li) => {
      const id = li.dataset.subject as SubjectId;
      this.subjectRows.set(id, { li, coc: li.querySelector('.coc')!, state: li.querySelector('.state')!, bar: li.querySelector('.bar i')! });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => this.chips.set(b.dataset.focus as SubjectId, b));
    this.bind();
    this.layoutVars();
    window.addEventListener('resize', () => this.layoutVars());
  }

  // ------------------------------------------------------------------ markup
  private markup(): string {
    const ticks = SLIDER_TICKS.map(([d, l]) => `<span style="left:${uPct(d)}%">${l}</span>`).join('');
    const marks = SUBJECTS.map((s) => `<i style="left:${uPct(s.distance)}%;color:${s.color}" title="${SUBJECT_NAME[s.id]}"></i>`).join('');
    const trackTicks = TRACK_TICKS.map(([d, l]) => `<span class="tick" style="left:${uPct(d)}%">${l}</span>`).join('');
    const trackDots = SUBJECTS.map((s) => `<span class="sdot" data-subject="${s.id}" style="left:${uPct(s.distance)}%;background:${s.color}"></span>`).join('');
    const subjects = SUBJECTS.map(
      (s) => `<li data-subject="${s.id}" style="color:${s.color}" title="Focus on the ${SUBJECT_NAME[s.id].toLowerCase()}">
        <span class="dot"></span>
        <span class="name" style="color:var(--text)">${SUBJECT_NAME[s.id]}<small>${fmtDistance(s.distance, 1)}</small><span class="state">sharp</span></span>
        <span class="coc">—</span>
        <span class="bar"><i></i><b style="left:18%"></b></span>
      </li>`,
    ).join('');
    const chips = SUBJECTS.map(
      (s, i) =>
        `<button class="btn chip-s" data-focus="${s.id}" aria-pressed="false" title="Focus on the ${SUBJECT_NAME[s.id].toLowerCase()} (${fmtDistance(s.distance, 1)}) · key ${i + 1}"><span class="sw" style="color:${s.color}"></span>${SUBJECT_NAME[s.id]}</button>`,
    ).join('');

    return `
<header class="topbar">
  <div class="brand">${LOGO}<div><h1>Lens Lab</h1><p>The lens &amp; camera encyclopedia</p></div></div>
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
  <button class="icon-btn close drawer-only" data-action="close-learn" aria-label="Close">✕</button>
  <div class="lens-card">
    <div class="lc-brand" data-bind="lensBrand"></div>
    <div class="lc-name" data-bind="lensName"></div>
    <div class="lc-specs" data-bind="lensSpecs"></div>
    <div class="lc-foot">
      <button class="btn lc-change" data-action="library" hidden>Change lens</button>
      <span class="lc-note" data-bind="lensNote" title="The cutaway uses the lens' real element and group counts; shapes and positions are schematic because the maker's construction diagram could not be reproduced exactly.">Illustrative layout</span>
    </div>
  </div>
  <div class="eyebrow" data-bind="eyebrow">Focused</div>
  <h2>The Plane of Focus</h2>
  <p class="lead" data-bind="lead"></p>
  <div class="body" data-bind="body"></div>
  <div class="hint desktop-only">Drag the <strong>focus ring</strong> on the lens or the slider. Keys: <kbd>1</kbd>–<kbd>7</kbd> subjects · <kbd>[</kbd> <kbd>]</kbd> aperture · <kbd>-</kbd> <kbd>=</kbd> zoom · <kbd>X</kbd> explode · <kbd>F</kbd> sensor view</div>
</aside>

<aside class="panel readouts" aria-label="Live lens readouts">
  <div class="ro-grid">
    <div class="ro big accent"><label>Focus</label><div class="val"><span data-bind="focusVal">2.00</span><small data-bind="focusUnit">m</small></div></div>
    <div class="ro big"><label>Aperture</label><div class="val" data-bind="aperture">f/2</div></div>
    <div class="ro"><label>Focal length</label><div class="val" data-bind="focal">50<small>mm</small></div><div class="sub" data-bind="focalSub"></div></div>
    <div class="ro"><label>Sharp zone</label><div class="val" data-bind="dof">—</div><div class="sub" data-bind="dofRange">—</div></div>
  </div>
  <div class="dof-track" aria-hidden="true"><div class="rail"></div><div class="blocked"></div><div class="zone"></div>${trackDots}<div class="focus-mark"></div>${trackTicks}</div>
  <dl class="ro-extra">
    <div><dt>Lens → sensor</dt><dd data-bind="di">—</dd></div>
    <div><dt>Magnification</dt><dd data-bind="mag">—</dd></div>
    <div><dt>Hyperfocal</dt><dd data-bind="hyper">—</dd></div>
    <div><dt>Aperture ⌀</dt><dd data-bind="apd">—</dd></div>
    <div><dt>Angle of view</dt><dd data-bind="aov">—</dd></div>
    <div><dt data-bind="extraLabel">Working f/</dt><dd data-bind="extra">—</dd></div>
  </dl>
  <ul class="subjects" aria-label="Blur of each subject (circle of confusion)">${subjects}</ul>
</aside>

<div class="filmstrip" data-action="film" role="button" tabindex="0" aria-label="Sensor view — open large">
  <div class="film-perf top"></div>
  <div class="film-edge">LENS·LAB 400 ▸ 24</div>
  <div class="film-frame" data-film="dock"><div class="film-hud"><span class="rec">LIVE</span><span data-bind="filmHud">50 mm · f/2</span></div></div>
  <div class="film-perf bottom"></div>
  <div class="film-caption">Sensor view</div>
</div>

<section class="panel dock" aria-label="Lens controls">
  <div class="ctl focus-ctl">
    <div class="ctl-head"><label for="focus">Focus distance</label><output data-bind="focusOut">2.00 m</output></div>
    <div class="slider-wrap focus">
      <div class="track"></div><div class="blocked" title="Closer than this lens can focus"></div><div class="zone"></div><div class="fill"></div>
      <div class="marks">${marks}</div>
      <input id="focus" type="range" min="0" max="1000" step="1" value="500" aria-valuetext="2 metres">
      <div class="ticks">${ticks}</div>
    </div>
    <div class="quick">${chips}</div>
  </div>
  <div class="ctl zoom-ctl" hidden>
    <div class="ctl-head"><label for="zoom">Zoom ring</label><output data-bind="zoomOut">24 mm</output></div>
    <div class="slider-wrap zoom">
      <div class="track"></div><div class="fill"></div>
      <input id="zoom" type="range" min="0" max="1000" step="1" value="0" aria-valuetext="24 millimetres">
      <div class="ticks" data-bind="zoomTicks"></div>
    </div>
    <div class="sub zoom-sub" data-bind="zoomSub"></div>
  </div>
  <div class="ctl ap-ctl">
    <div class="ctl-head"><span class="lbl">Aperture</span><output data-bind="apOut">f/2</output></div>
    <div class="ap-buttons"></div>
  </div>
  <div class="ctl view-ctl">
    <div class="ctl-head"><span class="lbl">Lens</span></div>
    <div class="seg" role="group" aria-label="Lens view">
      <button data-explode="0" aria-pressed="false">Assembled</button>
      <button data-explode="1" aria-pressed="true">Exploded</button>
    </div>
    <button class="btn tablet-only" data-action="learn" aria-label="Show the explanation">Learn</button>
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
      <div class="film-hud"><span class="rec" data-bind="filmFormat">LIVE · 36 × 24 mm</span><span data-bind="filmHud2"></span></div>
      <div class="film-hud film-hud-bottom"><span data-bind="filmHud3"></span><span data-bind="filmHud4"></span></div>
    </div>
    <p class="caption" data-bind="filmCaption"></p>
  </div>
</div>

<div class="help-modal" role="dialog" aria-modal="true" aria-label="How to use Lens Lab">
  <div class="card">
    <h3>How to use Lens Lab</h3>
    <ul>
      <li><strong>Turn the focus ring</strong> — grab the knurled ring on the lens and drag. The focusing group moves and the glowing plane of focus travels through the diorama.</li>
      <li><strong>Slider &amp; subjects</strong> — from the lens’ closest focus to ∞, or jump to a subject: flower 0.3 m, cabin 0.8 m, trees 2 m, hill 8 m, bird 30 m, lighthouse 200 m, mountains ∞.</li>
      <li><strong>Aperture &amp; zoom</strong> — the buttons follow the lens’ real aperture range; zoom lenses get a working zoom ring. Watch the iris, the light cones, the field-of-view cone and the sharp zone change.</li>
      <li><strong>Read the sensor</strong> — in-focus light lands as a point, out-of-focus light as a disc. Open the sensor view (<kbd>F</kbd>) to see the real blur.</li>
      <li><strong>Orbit</strong> — drag to rotate, scroll / pinch to zoom, right-drag / two fingers to pan.</li>
    </ul>
    <div class="foot"><span>Physics: thin lens with each lens’ real focal length, apertures, closest focus and magnification; distances from the focal plane.</span><button class="btn" data-action="close-help">Got it</button></div>
  </div>
</div>`;
  }

  // ------------------------------------------------------------------ events
  private bind(): void {
    const r = this.root;
    this.slider.addEventListener('pointerdown', () => (this.sliderActive = true));
    this.zoomSlider.addEventListener('pointerdown', () => (this.zoomActive = true));
    window.addEventListener('pointerup', () => {
      this.sliderActive = false;
      this.zoomActive = false;
    });
    this.slider.addEventListener('input', () => this.h.onSlider(Number(this.slider.value) / 1000));
    this.zoomSlider.addEventListener('input', () => this.h.onZoom(Number(this.zoomSlider.value) / 1000));
    for (const s of [this.slider, this.zoomSlider]) s.addEventListener('keydown', (e) => e.stopPropagation());

    r.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => {
      b.addEventListener('click', () => this.h.onFocusSubject(b.dataset.focus as SubjectId));
      b.addEventListener('pointerenter', () => this.h.onHighlight(b.dataset.focus as SubjectId));
      b.addEventListener('pointerleave', () => this.h.onHighlight(null));
    });
    this.apButtons.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-f]');
      if (b) this.h.onAperture(Number(b.dataset.f));
    });
    r.querySelectorAll<HTMLButtonElement>('[data-explode]').forEach((b) => b.addEventListener('click', () => this.h.onExploded(b.dataset.explode === '1')));
    r.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) =>
      b.addEventListener('click', () => {
        this.h.onQuality(b.dataset.quality as QualityChoice);
        this.setQuality(b.dataset.quality as QualityChoice);
      }),
    );
    r.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.addEventListener('click', () => this.h.onCamera(b.dataset.cam as CameraPreset)));
    r.querySelectorAll<HTMLElement>('.subjects li').forEach((li) => {
      li.addEventListener('click', () => this.h.onFocusSubject(li.dataset.subject as SubjectId));
      li.addEventListener('pointerenter', () => this.h.onHighlight(li.dataset.subject as SubjectId));
      li.addEventListener('pointerleave', () => this.h.onHighlight(null));
    });
    r.querySelector('[data-action="library"]')!.addEventListener('click', () => this.h.onLibrary?.());

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
    r.querySelectorAll('[data-action="learn"]').forEach((b) => b.addEventListener('click', () => this.explainPanel.classList.toggle('open')));
    r.querySelector('[data-action="close-learn"]')!.addEventListener('click', () => this.explainPanel.classList.remove('open'));
    const presets: CameraPreset[] = ['hero', 'lens', 'sensor', 'diorama'];
    r.querySelector('[data-action="cam-cycle"]')!.addEventListener('click', () => {
      this.camIndex = (this.camIndex + 1) % presets.length;
      this.h.onCamera(presets[this.camIndex]);
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (this.root.classList.contains('overlay-open')) return;
      const k = e.key.toLowerCase();
      const n = Number(k);
      if (k === 'escape') {
        this.openFilm(false);
        this.helpModal.classList.remove('open');
        this.explainPanel.classList.remove('open');
      } else if (n >= 1 && n <= SUBJECTS.length) this.h.onFocusSubject(SUBJECTS[n - 1].id);
      else if (k === '[' || k === ']') this.stepAperture(k === ']' ? 1 : -1);
      else if (k === '-' || k === '=' || k === '+') this.stepZoom(k === '-' ? -1 : 1);
      else if (k === 'x') this.h.onExploded(!this.explodedState);
      else if (k === 'f') this.openFilm(!this.filmOpen);
      else if (k === 'l') this.h.onLibrary?.();
      else if (k === 'arrowleft' || k === 'arrowright') {
        const u = Number(this.slider.value) / 1000 + (k === 'arrowleft' ? -0.02 : 0.02);
        this.h.onSlider(Math.min(1, Math.max(0, u)));
      } else return;
      e.preventDefault();
    });
  }

  private currentN = 2;
  private stepAperture(dir: number): void {
    if (!this.apertureList.length) return;
    let i = this.apertureList.findIndex((v) => Math.abs(v - this.currentN) / v < 0.03);
    if (i < 0) i = this.apertureList.findIndex((v) => v > this.currentN) - (dir > 0 ? 1 : 0);
    const j = Math.min(this.apertureList.length - 1, Math.max(0, i + dir));
    this.h.onAperture(this.apertureList[j]);
  }

  private stepZoom(dir: number): void {
    if (!this.lens?.isZoom) return;
    const p = this.lens.physics;
    const stops = ZOOM_STOPS.filter((f) => f > p.focal.min * 1.01 && f < p.focal.max * 0.99);
    const all = [p.focal.min, ...stops, p.focal.max];
    const f = focalAtZoom(p, Number(this.zoomSlider.value) / 1000);
    let target = dir > 0 ? all.find((v) => v > f * 1.02) : [...all].reverse().find((v) => v < f * 0.98);
    target ??= dir > 0 ? p.focal.max : p.focal.min;
    this.h.onZoom(zoomForFocal(p, target));
  }

  openFilm(open: boolean): void {
    this.filmOpen = open;
    this.filmModal.classList.toggle('open', open);
    // the sensor image is drawn on the canvas *under* the DOM: hide every panel above it
    this.root.classList.toggle('film-open', open);
  }

  get filmIsOpen(): boolean {
    return this.filmOpen;
  }

  setQuality(q: QualityChoice): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.quality === q)));
  }

  /** Show the library button once the library exists. */
  enableLibrary(): void {
    this.root.querySelector<HTMLElement>('[data-action="library"]')!.hidden = false;
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
    const top = readouts.top - 10;
    const drawer = W <= 1100;
    const left = drawer ? 12 : explain.right + 8;
    return { left, top: Math.max(56, top), right: readouts.left - 8, bottom: dock.top - 10 };
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

  // ------------------------------------------------------------------ lens
  /** Rebuild everything that depends on the mounted lens. */
  setLens(lens: LabLens): void {
    this.lens = lens;
    const d = lens.data;
    this.$.lensBrand.textContent = lens.brand;
    this.$.lensName.textContent = lens.name;
    const p = lens.physics;
    const chips: string[] = [fmtFocalRange(p.focal.min, p.focal.max), fmtApertureRange(p.maxAperture.wide, p.maxAperture.tele)];
    if (lens.format !== 'full-frame') chips.push(lens.format === 'aps-c' ? 'APS-C' : lens.format === 'micro-four-thirds' ? 'Micro Four Thirds' : 'Medium format');
    const unver = (label: string) => `<span class="unverified" title="Could not be verified — the lab uses an assumed value">${label} unverified</span>`;
    const mfd = d ? d.minFocusM : null;
    if (mfd && mfd.wide !== null) chips.push(`MFD ${mfd.wide === mfd.tele || mfd.tele === null ? `${mfd.wide} m` : `${mfd.wide}–${mfd.tele} m`}`);
    else if (d) chips.push(unver('MFD'));
    else chips.push(`MFD ${(p.mfd.wide / 1000).toFixed(2)} m`);
    const verifiedElements = !lens.assumed.includes('elements');
    chips.push(verifiedElements ? `${lens.elements} elements / ${lens.groups} groups` : unver('elements'));
    if (d?.maxMagnification) chips.push(`${d.maxMagnification}× max`);
    this.$.lensSpecs.innerHTML = chips.map((c) => (c.startsWith('<') ? c : `<span>${c}</span>`)).join('');
    const assumed = lens.assumed.filter((a) => a !== 'elements' && a !== 'dimensions' && a !== 'blades');
    this.$.lensNote.textContent = assumed.length
      ? `Illustrative layout · lab assumes ${assumed.map((a) => (a === 'minAperture' ? 'f/16 minimum' : 'a 1:10 closest focus')).join(', ')}`
      : 'Illustrative layout';

    // zoom control
    const zoomCtl = this.root.querySelector<HTMLElement>('.zoom-ctl')!;
    zoomCtl.hidden = !lens.isZoom;
    this.root.querySelector('.dock')!.classList.toggle('has-zoom', lens.isZoom);
    if (lens.isZoom) {
      const stops = [p.focal.min, ...ZOOM_STOPS.filter((f) => f > p.focal.min * 1.12 && f < p.focal.max * 0.9), p.focal.max];
      // thin out ticks that would crowd
      const kept: number[] = [];
      for (const f of stops) if (!kept.length || zoomForFocal(p, f) - zoomForFocal(p, kept[kept.length - 1]) > 0.14 || f === p.focal.max) kept.push(f);
      if (kept.length > 2 && zoomForFocal(p, kept[kept.length - 1]) - zoomForFocal(p, kept[kept.length - 2]) < 0.14) kept.splice(kept.length - 2, 1);
      this.$.zoomTicks.innerHTML = kept.map((f) => `<span style="left:${(zoomForFocal(p, f) * 100).toFixed(2)}%">${Math.round(f)}</span>`).join('');
    }
    // sensor aspect for the film frames
    const aspect = `${p.sensor.width} / ${p.sensor.height}`;
    this.filmDock.style.aspectRatio = aspect;
    this.filmModalFrame.style.aspectRatio = aspect;
    this.$.filmFormat.textContent = `LIVE · ${p.sensor.width.toFixed(1).replace('.0', '')} × ${p.sensor.height.toFixed(1).replace('.0', '')} mm`;
    this.lastApertureKey = '';
    this.lastExplainKey = '';
    this.layoutVars();
  }

  // ------------------------------------------------------------------ updates
  update(o: OpticsFrame, state: UIState): void {
    const $ = this.$;
    const lens = o.lens;
    const fd = splitDistance(o.focusDistance);
    $.focusVal.textContent = fd.value;
    $.focusUnit.textContent = fd.unit;
    $.aperture.textContent = fmtF(o.fNumber);
    $.apOut.textContent = o.fNumber <= o.maxApertureNow * 1.01 ? `${fmtF(o.fNumber)} · wide open` : fmtF(o.fNumber);
    $.focusOut.textContent = o.focusDistance <= o.curve.mfd * 1.001 ? `${fmtDistance(o.focusDistance)} · closest` : fmtDistance(o.focusDistance);
    const fl = o.focalLength;
    $.focal.innerHTML = `${fl >= 10 ? Math.round(fl) : fl.toFixed(1)}<small>mm</small>`;
    const crop = lens.crop;
    $.focalSub.textContent = Math.abs(crop - 1) > 0.02 ? `≈ ${Math.round(fl * crop)} mm f/${(o.fNumber * crop).toFixed(1)} FF-equiv.` : o.curve.fitted && o.magnification > 0.02 ? `effective ${fmtFocal(o.effectiveFocal)} (breathing)` : '';
    $.dof.textContent = fmtDofCm(o.depthOfField);
    $.dofRange.textContent = fmtRange(o.near, o.far);
    $.di.textContent = fmtMm(o.imageDistance, 1);
    $.mag.textContent = fmtRatio(o.magnification);
    $.hyper.textContent = fmtDistance(o.hyperfocal, 1);
    $.apd.textContent = fmtMm(o.apertureDiameter, 1);
    $.aov.textContent = `${fmtDeg(o.fovHorizontal)} × ${fmtDeg(o.fovVertical)}`;
    $.extraLabel.textContent = 'Working f/';
    $.extra.textContent = fmtF(o.workingFNumber);
    const hud = `${fmtFocal(fl)} · ${fmtF(o.fNumber)} · ${fmtDistance(o.focusDistance)}`;
    $.filmHud.textContent = hud;
    $.filmHud2.textContent = `${fmtFocal(fl)} · ${fmtF(o.fNumber)} · focus ${fmtDistance(o.focusDistance)}`;
    $.filmHud3.textContent = `sharp ${fmtRange(o.near, o.far)}`;
    $.filmHud4.textContent = `CoC limit ${fmtCoc(o.coc)}`;

    // focus slider (don't fight the user's thumb)
    if (!this.sliderActive && document.activeElement !== this.slider) this.slider.value = String(Math.round(state.u * 1000));
    this.slider.setAttribute('aria-valuetext', fmtDistance(o.focusDistance).replace(' m', ' metres'));
    const uNear = Math.min(1, Math.max(0, depthMap.toU(o.near)));
    const uFar = Math.min(1, Math.max(0, depthMap.toU(o.far)));
    const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
    const inner = (v: number) => `calc(11px + (100% - 22px) * ${v.toFixed(4)})`;
    this.sliderFill.style.width = inner(state.u);
    this.sliderZone.style.left = inner(uNear);
    this.sliderZone.style.width = `calc((100% - 22px) * ${Math.max(0.004, uFar - uNear).toFixed(4)})`;
    this.sliderBlocked.style.width = state.uMin > 0.001 ? inner(state.uMin) : '0px';
    this.trackZone.style.left = pct(uNear);
    this.trackZone.style.width = pct(Math.max(0.006, uFar - uNear));
    this.trackFocus.style.left = pct(state.u);
    (this.root.querySelector('.dof-track .blocked') as HTMLElement).style.width = pct(state.uMin);

    // zoom slider
    if (lens.isZoom) {
      if (!this.zoomActive && document.activeElement !== this.zoomSlider) this.zoomSlider.value = String(Math.round(state.zoom * 1000));
      $.zoomOut.textContent = fmtFocal(fl);
      this.zoomSlider.setAttribute('aria-valuetext', `${Math.round(fl)} millimetres`);
      (this.root.querySelector('.slider-wrap.zoom .fill') as HTMLElement).style.width = inner(state.zoom);
      const maxNow = fmtF(o.maxApertureNow);
      const variable = Math.abs(lens.physics.maxAperture.tele - lens.physics.maxAperture.wide) > 1e-6;
      $.zoomSub.textContent = variable ? `Widest aperture here: ${maxNow}${o.zoom > 0.001 && o.zoom < 0.999 ? ' (≈, between the published ends)' : ''}` : `Constant ${maxNow} through the zoom range`;
    }

    // subjects
    for (const s of o.subjects) {
      const row = this.subjectRows.get(s.id)!;
      row.coc.textContent = fmtCoc(s.coc);
      const label = !s.inFrame ? 'out of frame' : s.tooClose ? 'too close' : s.sharpness;
      row.state.textContent = label;
      row.state.className = `state ${s.inFrame ? (s.tooClose ? 'close' : s.sharpness) : 'out'}`;
      row.li.classList.toggle('out', !s.inFrame);
      const w = s.coc <= 1e-6 ? 0 : Math.min(100, Math.max(2, 18 + (Math.log10(s.cocRatio) / 2) * 82));
      row.bar.style.width = `${w}%`;
      const chip = this.chips.get(s.id)!;
      chip.disabled = s.tooClose;
      chip.classList.toggle('out', !s.inFrame);
      chip.setAttribute('aria-pressed', String(s.id === state.focusTargetSubject));
    }

    // aperture buttons follow the lens (and the zoom position of variable-aperture zooms)
    const list = apertureButtons(o.maxApertureNow, o.minApertureNow, 5);
    const key = list.join('|') + lens.id;
    if (key !== this.lastApertureKey) {
      this.lastApertureKey = key;
      this.apertureList = list;
      this.apButtons.style.setProperty('--n', String(list.length));
      this.apButtons.innerHTML = list
        .map((n) => `<button class="btn" data-f="${n}" aria-pressed="false" aria-label="Aperture ${fmtF(n)}">${irisIcon(n, list[0], lens.blades)}<span>${fmtF(n)}</span></button>`)
        .join('');
    }
    this.currentN = o.fNumber;
    this.apButtons.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b, i) => {
      const n = Number(b.dataset.f);
      const pressed = state.wideOpen ? i === 0 : Math.abs(n - state.apertureTarget) / n < 0.02;
      b.setAttribute('aria-pressed', String(pressed));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-explode]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.explode === '1') === state.exploded)));
    this.explodedState = state.exploded;

    // explanation (only rebuilt when the words would change)
    const ekey = [
      lens.id,
      Math.round(o.focusDistance / 10),
      Math.round(o.fNumber * 10),
      Math.round(o.focalLength),
      ...o.subjects.map((s) => `${s.sharpness}${s.inFrame ? 1 : 0}${Math.round(s.coc * 100)}`),
    ].join('|');
    if (ekey !== this.lastExplainKey) {
      this.lastExplainKey = ekey;
      const ex = explain(o);
      $.eyebrow.textContent = ex.eyebrow;
      $.lead.innerHTML = ex.lead;
      $.body.innerHTML = ex.body.map((p) => `<p>${p}</p>`).join('');
      const inFrame = o.subjects.filter((s) => s.inFrame);
      const sharp = inFrame.filter((s) => s.sharpness === 'sharp').map((s) => SUBJECT_NAME[s.id].toLowerCase());
      const diag = (o.fovDiagonal * 180) / Math.PI;
      const eqNote = Math.abs(crop - 1) > 0.02 ? ` (${diagonal(lens.physics.sensor).toFixed(1)} mm sensor diagonal vs ${FULL_FRAME_DIAGONAL.toFixed(1)} mm full frame)` : '';
      $.filmCaption.innerHTML = `Rendered from the lens’ perspective centre with its real ${fmtDeg(o.fovHorizontal)} × ${fmtDeg(o.fovVertical)} angle of view (${diag.toFixed(1)}° diagonal)${eqNote}. Every pixel is blurred by its own thin-lens circle of confusion: ${inFrame
        .map((s) => `${SUBJECT_NAME[s.id].toLowerCase()} <strong>${fmtCoc(s.coc)}</strong>`)
        .join(', ')}. ${sharp.length ? `Sharp: ${sharp.join(', ')}.` : 'Nothing in frame is within the sharp zone.'}`;
    }
  }
}
