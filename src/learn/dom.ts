import type { PhoneData } from '../data/types';

/** Small DOM helpers shared by the Learn topics. */

export type TopicId = 'small-sensors' | 'equivalence' | 'periscope' | 'computational';

export interface TopicContext {
  phones: PhoneData[];
}

/** One explainer. The view mounts it the first time it is shown and tells it when it is visible. */
export interface Topic {
  readonly id: TopicId;
  /** Full title (article heading and desktop nav). */
  readonly title: string;
  /** Short name for the mobile chips. */
  readonly short: string;
  /** One-line summary under the title in the nav. */
  readonly blurb: string;
  mount(el: HTMLElement, ctx: TopicContext): void;
  /** Visible (open view, selected topic) or not: start / stop animations. */
  setActive(active: boolean): void;
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type TagKind = 'pub' | 'calc' | 'ex' | 'approx';
const TAG_TEXT: Record<TagKind, string> = { pub: 'published', calc: 'computed', ex: 'example', approx: 'approx.' };
const TAG_TITLE: Record<TagKind, string> = {
  pub: 'From the maker or a cited review (the lab’s phone data)',
  calc: 'Derived with the lab’s physics from published values',
  ex: 'Not published — a stand-in value used only to illustrate',
  approx: 'A rough rule of thumb, not an exact figure',
};

/** Provenance tag for a number: published / computed / example / approx. */
export const tag = (k: TagKind, text = TAG_TEXT[k]): string => `<span class="lt-tag ${k}" title="${TAG_TITLE[k]}">${esc(text)}</span>`;

export interface SliderOpts {
  id: string;
  label: string;
  /** Slider positions 0…1000 (the topic maps them to values). */
  value: number;
  ticks?: [number, string][];
  step?: number;
  max?: number;
}

/** Range input styled like the lab's sliders; `ticks` are [position 0…max, label]. */
export function sliderMarkup(o: SliderOpts): string {
  const max = o.max ?? 1000;
  const ticks = (o.ticks ?? []).map(([p, l]) => `<span style="left:${((p / max) * 100).toFixed(2)}%">${esc(l)}</span>`).join('');
  return `<div class="lt-slider">
  <div class="lt-sl-head"><label for="${o.id}">${esc(o.label)}</label><output for="${o.id}" data-out="${o.id}"></output></div>
  <div class="lt-sl-track"><input type="range" id="${o.id}" min="0" max="${max}" step="${o.step ?? 1}" value="${o.value}" /></div>
  ${ticks ? `<div class="lt-sl-ticks" aria-hidden="true">${ticks}</div>` : ''}
</div>`;
}

/** Keeps the filled part of a range input in sync (CSS custom property --p). */
export function syncFill(input: HTMLInputElement): void {
  const p = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty('--p', `${(p * 100).toFixed(2)}%`);
}

/** Calls fn at most once per animation frame. */
export function rafThrottle(fn: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

/** Width-change observer (height changes are ignored, so re-rendering inside cannot loop). */
export function onWidth(el: HTMLElement, fn: (width: number) => void): void {
  let last = -1;
  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === last || w <= 0) return;
    last = w;
    requestAnimationFrame(() => fn(w));
  });
  ro.observe(el);
}

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Mapping for log-scale sliders: position 0…1000 ↔ value in [lo, hi]. */
export const logScale = (lo: number, hi: number) => ({
  toValue: (p: number) => lo * Math.pow(hi / lo, p / 1000),
  toPos: (v: number) => Math.round((1000 * Math.log(v / lo)) / Math.log(hi / lo)),
});

/** f-number for display: f/1.68 stays f/1.68, animated values get one decimal (f/5.9). */
export function fNum(n: number): string {
  if (Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 && Math.round(n * 100) % 10 !== 0) return `f/${n.toFixed(2)}`;
  const r = Math.round(n * 10) / 10;
  return `f/${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}`;
}

/** Distance from the focal plane for readouts: 1.24 m, 69.5 cm, ∞. */
export function dist(mm: number): string {
  if (!Number.isFinite(mm)) return '∞';
  if (mm < 1000) return `${(mm / 10).toFixed(mm < 100 ? 1 : 0)} cm`;
  if (mm < 10000) return `${(mm / 1000).toFixed(2)} m`;
  if (mm < 100000) return `${(mm / 1000).toFixed(1)} m`;
  return `${Math.round(mm / 1000)} m`;
}

/** Length on the sensor: µm below 1 mm. */
export function micro(mm: number): string {
  return mm < 1 ? `${Math.round(mm * 1000)} µm` : `${mm.toFixed(2)} mm`;
}

export function pct(frac: number): string {
  const p = frac * 100;
  return `${p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : p.toFixed(0)} %`;
}

export function mm(v: number, digits = 1): string {
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(digits)} mm`;
}

/** "Google Pixel 11 Pro / Pro XL" (brand + product, without repeating the brand). */
export function phoneName(brand: string, phone: string): string {
  return phone.toLowerCase().startsWith(brand.toLowerCase()) ? phone : `${brand} ${phone}`;
}
