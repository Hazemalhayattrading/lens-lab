import type { LensCategory, LensData, SensorFormat, SourceRef } from '../data/types';
import { FORMAT_SIZES, diagonal } from '../optics/formats';

/**
 * Human-readable spec values for the library / compare views. Every function returns `null` when the
 * value is unverified (the caller renders the "unverified" marker) — nothing is ever filled in.
 */

export const CATEGORY_LABEL: Record<LensCategory, string> = {
  'ultra-wide': 'Ultra-wide',
  'wide-prime': 'Wide',
  'standard-prime': 'Standard',
  'portrait-prime': 'Portrait',
  macro: 'Macro',
  'standard-zoom': 'Standard zoom',
  'telephoto-zoom': 'Telephoto zoom',
  'telephoto-prime': 'Telephoto',
  'super-telephoto': 'Super-telephoto',
};

/** Library filter order (roughly by field of view). */
export const CATEGORY_ORDER: LensCategory[] = [
  'ultra-wide',
  'wide-prime',
  'standard-prime',
  'portrait-prime',
  'macro',
  'standard-zoom',
  'telephoto-zoom',
  'telephoto-prime',
  'super-telephoto',
];

export const FORMAT_LABEL: Record<SensorFormat, string> = {
  'full-frame': 'Full frame',
  'aps-c': 'APS-C',
  'micro-four-thirds': 'Micro Four Thirds',
  'medium-format': 'Medium format',
};

const trimNum = (n: number, digits = 2) => {
  const s = n.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

export const isZoomData = (d: LensData) => d.focalLength.max > d.focalLength.min * 1.0001;

export function focalText(d: LensData): string {
  return isZoomData(d) ? `${trimNum(d.focalLength.min, 1)}–${trimNum(d.focalLength.max, 1)} mm` : `${trimNum(d.focalLength.min, 1)} mm`;
}

export function apertureText(d: LensData): string {
  const { wide, tele } = d.maxAperture;
  return Math.abs(wide - tele) < 1e-9 ? `f/${trimNum(wide)}` : `f/${trimNum(wide)}–${trimNum(tele)}`;
}

function endValues(v: { wide: number | null; tele: number | null }, fmt: (n: number) => string, zoom: boolean): string | null {
  if (v.wide === null && v.tele === null) return null;
  if (!zoom || v.tele === null || v.wide === null || Math.abs(v.wide - v.tele) < 1e-9) return fmt((v.wide ?? v.tele)!);
  return `${fmt(v.wide)}–${fmt(v.tele)}`;
}

export function minApertureText(d: LensData): string | null {
  return endValues(d.minAperture, (n) => `f/${trimNum(n)}`, isZoomData(d));
}

export function mfdText(d: LensData): string | null {
  return endValues(d.minFocusM, (n) => `${trimNum(n, 3)} m`, isZoomData(d));
}

export function magnificationText(m: number | null): string | null {
  if (m === null) return null;
  if (m >= 0.995) return m > 1.005 ? `${trimNum(m)}× (${trimNum(m)}:1)` : '1× (life size, 1:1)';
  return `${trimNum(m)}× (1:${trimNum(1 / m, 1)})`;
}

export function constructionText(d: LensData): string | null {
  if (d.elements === null) return null;
  if (d.groups === null) return `${d.elements} elements (groups not published)`;
  return `${d.elements} elements in ${d.groups} groups`;
}

export function stabilizationText(d: LensData): string | null {
  const s = d.stabilization;
  if (s === null) return null;
  if (!s.optical) return 'None in the lens';
  return s.stops !== null ? `Optical, ${trimNum(s.stops, 1)} stops (CIPA)` : 'Optical (rating not published)';
}

export function weightText(g: number | null): string | null {
  return g === null ? null : `${g.toLocaleString('en-US')} g`;
}

export function dimensionsText(d: LensData): string | null {
  return d.dimensionsMm ? `⌀ ${trimNum(d.dimensionsMm.diameter, 1)} × ${trimNum(d.dimensionsMm.length, 1)} mm` : null;
}

export function filterText(d: LensData): string | null {
  return d.filterMm === null ? null : `${trimNum(d.filterMm, 1)} mm`;
}

export function priceText(d: LensData): string | null {
  if (!d.launchPrice) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: d.launchPrice.currency, maximumFractionDigits: 0 }).format(d.launchPrice.amount);
  } catch {
    return `${d.launchPrice.amount} ${d.launchPrice.currency}`;
  }
}

/** Diagonal angle of view at infinity (rectilinear), e.g. "84° – 34°". */
export function fovText(d: LensData): string {
  const diag = diagonal(FORMAT_SIZES[d.format]);
  const fov = (f: number) => (2 * Math.atan(diag / (2 * f)) * 180) / Math.PI;
  const a = fov(d.focalLength.min);
  const b = fov(d.focalLength.max);
  const r = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1));
  return isZoomData(d) ? `${r(a)}° – ${r(b)}° diagonal` : `${r(a)}° diagonal`;
}

/** 35 mm-equivalent focal length / aperture for crop formats (null for full frame). */
export function equivalentText(d: LensData): string | null {
  if (d.format === 'full-frame') return null;
  const crop = diagonal(FORMAT_SIZES['full-frame']) / diagonal(FORMAT_SIZES[d.format]);
  const f = (n: number) => Math.round(n * crop);
  const focal = isZoomData(d) ? `${f(d.focalLength.min)}–${f(d.focalLength.max)} mm` : `${f(d.focalLength.min)} mm`;
  const n = (x: number) => trimNum(x * crop, 1);
  const ap = Math.abs(d.maxAperture.wide - d.maxAperture.tele) < 1e-9 ? `f/${n(d.maxAperture.wide)}` : `f/${n(d.maxAperture.wide)}–${n(d.maxAperture.tele)}`;
  return `${focal} ${ap} (field of view and depth of field, ×${crop.toFixed(2)} crop)`;
}

export function mechanismText(d: LensData): string | null {
  const parts: string[] = [];
  if (isZoomData(d) && d.zoomMechanism) parts.push(d.zoomMechanism === 'internal' ? 'internal zoom' : 'extending zoom');
  if (d.focusMechanism) {
    const map = { internal: 'internal focus', rear: 'rear focus', 'front-group': 'front-group focus', unit: 'unit focus (whole optics move)', floating: 'floating focus groups' } as const;
    parts.push(map[d.focusMechanism]);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** Number of headline specs that are unverified (shown on cards). */
export function unverifiedCount(d: LensData): number {
  const values: unknown[] = [
    d.minAperture.wide ?? d.minAperture.tele,
    d.elements,
    d.groups,
    d.specialElements,
    d.apertureBlades,
    d.minFocusM.wide ?? d.minFocusM.tele,
    d.maxMagnification,
    d.stabilization,
    d.autofocus,
    d.weightG,
    d.dimensionsMm,
    d.releaseYear,
    d.launchPrice,
  ];
  return values.filter((v) => v === null || v === undefined).length;
}

export function sourceDomain(s: SourceRef): string {
  try {
    return new URL(s.url).hostname.replace(/^www\./, '');
  } catch {
    return s.url;
  }
}

/** Haystack for the library search (lower case). */
export function searchText(d: LensData): string {
  const parts = [
    d.brand,
    d.name,
    d.mount,
    ...(d.mounts ?? []),
    CATEGORY_LABEL[d.category],
    FORMAT_LABEL[d.format],
    focalText(d).replace(/\s/g, ''),
    `${d.focalLength.min}mm`,
    `${d.focalLength.max}mm`,
    apertureText(d),
    `f${d.maxAperture.wide}`,
    ...(d.specialElements ?? []).map((s) => s.label),
    d.stabilization?.optical ? 'stabilized stabilised ois is vr' : '',
    d.category === 'macro' ? 'macro close-up' : '',
    isZoomData(d) ? 'zoom' : 'prime',
    ...d.bestFor,
  ];
  return parts.join(' ').toLowerCase();
}

/** Every whitespace-separated token must occur (numbers match "85mm", "f/1.2" …). */
export function matchesQuery(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().replace(/ƒ/g, 'f').split(/[\s,]+/).filter(Boolean);
  return tokens.every((t) => haystack.includes(t.replace(/^f\/?/, 'f/')) || haystack.includes(t));
}
