import type { SpecialElementKind } from '../data/types';
import { focalAtZoom, maxApertureAtZoom } from '../optics/lensModel';
import type { LabLens, LayoutKind } from './labLens';

/**
 * Illustrative optical layout of a lens (PLAN.md, Phase 2 decision 2).
 *
 * The makers publish the element / group counts and which elements are special, but not the
 * prescription (radii, spacings). This module builds a plausible cross-section for the lens'
 * design family with exactly the published counts: elements are packed front → rear into moving
 * sections (front group, variator, focus group …), cemented doublets are formed until the group
 * count matches, and special elements are placed where such glass typically sits (ED glass in
 * positive elements of a telephoto front group, aspherical surfaces at the rear or front …).
 * Positions, curvatures and zoom / focus motions are schematic, and the UI labels the cutaway
 * "Illustrative layout".
 *
 * Units: mm. h = axial position measured forward from the mount flange (h = 0) towards the subject.
 */

export type SectionRole = 'front' | 'variator' | 'compensator' | 'master' | 'middle' | 'focus' | 'stabilizer' | 'rear' | 'converter';

export interface LayoutElement {
  /** 0 = front element. */
  index: number;
  /** Air-spaced group (0 = front); cemented elements share a group. */
  group: number;
  section: number;
  power: 1 | -1;
  /** Front vertex h at the wide end, focused at ∞ (section offset 0). */
  h: number;
  thickness: number;
  /** Signed radii (see scene/lens/elements.ts): r1 > 0 = front convex, r2 > 0 = rear convex. */
  r1: number;
  r2: number;
  /** Clear semi-aperture. */
  a: number;
  cementedToNext: boolean;
  special: SpecialGlass | null;
}

export interface SpecialGlass {
  /** The maker's term, e.g. "Super UD", "XA (extreme aspherical)". */
  label: string;
  kinds: SpecialElementKind[];
}

export interface LayoutSection {
  name: string;
  role: SectionRole;
  /** Element indices, front → rear. */
  elements: number[];
  /** The iris moves with this section. */
  carriesStop: boolean;
  moves: 'fixed' | 'zoom' | 'focus' | 'zoom+focus';
}

export interface SpecialSummary {
  label: string;
  kinds: SpecialElementKind[];
  /** Elements that carry this glass, front → rear. */
  elements: number[];
}

export interface OpticalLayout {
  /** Barrel length (retracted) and maximum diameter, from the maker's dimensions. */
  length: number;
  diameter: number;
  /** Mount throat diameter. */
  throat: number;
  elements: LayoutElement[];
  sections: LayoutSection[];
  groupCount: number;
  /** Iris position (h, wide end, ∞) and its semi-diameter wide open. */
  stopH: number;
  stopSemi: number;
  stopSection: number;
  specials: SpecialSummary[];
  /** Barrel outer radius at h (retracted). */
  outerRadius(h: number): number;
  /** Axial offset of a section (mm, + = towards the subject) at zoom z ∈ [0, 1] and focus fraction f ∈ [0, 1]. */
  sectionOffset(section: number, zoom: number, focus: number): number;
  /** Forward travel of the extending front barrel at zoom z (0 for internal zooms and primes). */
  extension(zoom: number): number;
  /**
   * Entrance-pupil ÷ iris semi-diameter at zoom z, wide open. Telephotos have a pupil much larger than
   * the iris (> 1), retrofocus wide-angles a smaller one (< 1); the rays are drawn through the pupil.
   */
  pupilRatio(zoom: number): number;
}

// ---------------------------------------------------------------- templates

interface SectionTemplate {
  name: string;
  role: SectionRole;
  /** Track fractions from the front (0) to the rear (1); gaps between spans weight the air spaces. */
  span: [number, number];
  share: number;
  powers: (1 | -1)[];
  /** Semi-aperture envelope at the section's front / rear: 0 = iris size, 1 = front (before the stop) or rear size. */
  semi: [number, number];
  /** Curvature: 'wide' = deep front menisci, 'flat' = gentle curves for big elements. */
  shape?: 'wide' | 'flat';
  /** Zoom motion, track fraction (+ = forward) as a function of z. */
  zoom?: (z: number) => number;
  /** Focus motion at the closest distance, track fraction (+ = forward). */
  focus?: number;
  /** Rides on the extending front barrel. */
  rides?: boolean;
}

interface Template {
  sections: SectionTemplate[];
  /** Index of the section that carries the iris (the stop sits at its front). */
  stop: number;
  /** Iris semi-diameter ÷ entrance-pupil semi-diameter at max aperture. */
  irisRatio: number;
  /** Minimum front semi-aperture as a fraction of the inner radius. */
  frontMin: number;
  /** Maximum rear semi-aperture as a fraction of the throat radius. */
  rearMax: number;
  barrel: 'standard' | 'super-tele' | 'tele-zoom';
  /** Front-barrel extension at the tele end as a fraction of the length (extending zooms only). */
  extension?: (z: number) => number;
}

const P = 1 as const;
const N = -1 as const;
const bump = (z: number) => Math.sin(Math.PI * z);

const TEMPLATES: Record<LayoutKind, Template> = {
  'double-gauss': {
    sections: [
      { name: 'Front group', role: 'front', span: [0, 0.38], share: 0.42, powers: [P, P, N], semi: [1, 0.35] },
      { name: 'Focus group', role: 'focus', span: [0.5, 0.8], share: 0.4, powers: [N, P, P], semi: [0.2, 0.7], focus: 0.09 },
      { name: 'Rear group', role: 'rear', span: [0.86, 1], share: 0.18, powers: [P, N], semi: [0.8, 1] },
    ],
    stop: 1,
    irisRatio: 0.82,
    frontMin: 0.6,
    rearMax: 0.8,
    barrel: 'standard',
  },
  retrofocus: {
    sections: [
      { name: 'Front group', role: 'front', span: [0, 0.3], share: 0.3, powers: [N, P, N], semi: [1, 0.55], shape: 'wide' },
      { name: 'Middle group', role: 'middle', span: [0.36, 0.5], share: 0.18, powers: [P, N], semi: [0.35, 0.1] },
      { name: 'Focus group', role: 'focus', span: [0.58, 0.8], share: 0.32, powers: [P, N, P], semi: [0.15, 0.6], focus: 0.08 },
      { name: 'Rear group', role: 'rear', span: [0.86, 1], share: 0.2, powers: [P, N], semi: [0.75, 1] },
    ],
    stop: 2,
    irisRatio: 1.15,
    frontMin: 0.8,
    rearMax: 0.82,
    barrel: 'standard',
  },
  'ultra-wide': {
    sections: [
      { name: 'Front group', role: 'front', span: [0, 0.34], share: 0.32, powers: [N, N, N, P], semi: [1, 0.45], shape: 'wide' },
      { name: 'Focus group', role: 'focus', span: [0.4, 0.5], share: 0.14, powers: [P, N], semi: [0.3, 0.1], focus: -0.05 },
      { name: 'Master group', role: 'master', span: [0.56, 0.8], share: 0.32, powers: [P, N, P, P], semi: [0.1, 0.6] },
      { name: 'Rear group', role: 'rear', span: [0.86, 1], share: 0.22, powers: [N, P, P], semi: [0.75, 1] },
    ],
    stop: 2,
    irisRatio: 1.4,
    frontMin: 0.94,
    rearMax: 0.85,
    barrel: 'standard',
  },
  portrait: {
    sections: [
      { name: 'Front group', role: 'front', span: [0, 0.32], share: 0.34, powers: [P, P, N], semi: [1, 0.6], shape: 'flat' },
      { name: 'Middle group', role: 'middle', span: [0.38, 0.52], share: 0.2, powers: [N, P], semi: [0.4, 0.15] },
      { name: 'Focus group', role: 'focus', span: [0.6, 0.78], share: 0.24, powers: [P, N], semi: [0.1, 0.4], focus: 0.08 },
      { name: 'Rear group', role: 'rear', span: [0.84, 1], share: 0.22, powers: [N, P], semi: [0.7, 1] },
    ],
    stop: 2,
    irisRatio: 0.72,
    frontMin: 0.7,
    rearMax: 0.8,
    barrel: 'standard',
  },
  macro: {
    sections: [
      { name: 'Front group', role: 'front', span: [0, 0.24], share: 0.24, powers: [P, P, N], semi: [1, 0.7] },
      { name: 'Focus group 1', role: 'focus', span: [0.3, 0.44], share: 0.18, powers: [N, P], semi: [0.5, 0.2], focus: -0.14 },
      { name: 'Middle group', role: 'middle', span: [0.54, 0.66], share: 0.18, powers: [P, N], semi: [0.1, 0.3] },
      { name: 'Focus group 2', role: 'focus', span: [0.72, 0.84], share: 0.2, powers: [P, N], semi: [0.4, 0.6], focus: 0.08 },
      { name: 'Rear group', role: 'rear', span: [0.88, 1], share: 0.2, powers: [N, P], semi: [0.8, 1] },
    ],
    stop: 2,
    irisRatio: 0.78,
    frontMin: 0.62,
    rearMax: 0.8,
    barrel: 'standard',
  },
  telephoto: {
    sections: [
      { name: 'Front group', role: 'front', span: [0, 0.24], share: 0.3, powers: [P, P, N, P], semi: [1, 0.85], shape: 'flat' },
      { name: 'Focus group', role: 'focus', span: [0.5, 0.6], share: 0.14, powers: [P, N], semi: [0.45, 0.3], focus: -0.1 },
      { name: 'Stabilizer group', role: 'stabilizer', span: [0.7, 0.8], share: 0.22, powers: [P, N, N], semi: [0.05, 0.2] },
      { name: 'Rear group', role: 'rear', span: [0.86, 1], share: 0.34, powers: [P, N, P], semi: [0.5, 1] },
    ],
    stop: 2,
    irisRatio: 0.45,
    frontMin: 0.7,
    rearMax: 0.75,
    barrel: 'standard',
  },
  'super-tele': {
    sections: [
      { name: 'Front group', role: 'front', span: [0, 0.2], share: 0.26, powers: [P, P, N, P], semi: [1, 0.9], shape: 'flat' },
      { name: 'Focus group', role: 'focus', span: [0.5, 0.58], share: 0.12, powers: [P, N], semi: [0.35, 0.28], focus: -0.08 },
      { name: 'Stabilizer group', role: 'stabilizer', span: [0.7, 0.8], share: 0.22, powers: [P, N, N], semi: [0.05, 0.15] },
      { name: 'Rear group', role: 'rear', span: [0.86, 1], share: 0.4, powers: [P, N, P], semi: [0.4, 1] },
    ],
    stop: 2,
    irisRatio: 0.34,
    frontMin: 0.7,
    rearMax: 0.7,
    barrel: 'super-tele',
  },
  'zoom-wide': {
    sections: [
      { name: 'Front group (negative)', role: 'front', span: [0, 0.3], share: 0.3, powers: [N, N, N, P], semi: [1, 0.45], shape: 'wide', zoom: (z) => -0.035 * bump(z), rides: true },
      { name: 'Focus group', role: 'focus', span: [0.34, 0.42], share: 0.12, powers: [P, N], semi: [0.3, 0.1], zoom: (z) => -0.035 * bump(z), focus: -0.04 },
      { name: 'Master group', role: 'master', span: [0.52, 0.76], share: 0.34, powers: [P, N, P, P], semi: [0.1, 0.55], zoom: (z) => 0.05 * z },
      { name: 'Rear group', role: 'rear', span: [0.84, 1], share: 0.24, powers: [N, P, P], semi: [0.7, 1], zoom: (z) => 0.03 * z },
    ],
    stop: 2,
    irisRatio: 1.35,
    frontMin: 0.92,
    rearMax: 0.85,
    barrel: 'standard',
    // negative-lead zooms are longest at the wide end
    extension: (z) => 0.07 * (1 - z) * (1 - z),
  },
  'zoom-standard': {
    sections: [
      { name: 'Front group (G1)', role: 'front', span: [0, 0.2], share: 0.16, powers: [N, P, P], semi: [1, 0.8], rides: true },
      { name: 'Variator (G2)', role: 'variator', span: [0.24, 0.42], share: 0.26, powers: [N, N, P, N], semi: [0.5, 0.2], zoom: (z) => -0.03 * z },
      { name: 'Master group (G3)', role: 'master', span: [0.52, 0.68], share: 0.24, powers: [P, P, N, P], semi: [0.1, 0.45], zoom: (z) => 0.05 * z },
      { name: 'Focus group (G4)', role: 'focus', span: [0.72, 0.8], share: 0.12, powers: [N, P], semi: [0.5, 0.55], zoom: (z) => 0.04 * z, focus: 0.035 },
      { name: 'Rear group (G5)', role: 'rear', span: [0.86, 1], share: 0.22, powers: [P, N, P], semi: [0.7, 1] },
    ],
    stop: 2,
    irisRatio: 0.9,
    frontMin: 0.82,
    rearMax: 0.85,
    barrel: 'standard',
    extension: (z) => 0.3 * z,
  },
  'zoom-tele': {
    sections: [
      { name: 'Front group (G1)', role: 'front', span: [0, 0.2], share: 0.2, powers: [P, N, P], semi: [1, 0.85], shape: 'flat', rides: true },
      { name: 'Variator (G2)', role: 'variator', span: [0.24, 0.34], share: 0.2, powers: [N, N, P], semi: [0.45, 0.35], zoom: (z) => -0.2 * z },
      { name: 'Compensator (G3)', role: 'compensator', span: [0.6, 0.66], share: 0.1, powers: [P, N], semi: [0.3, 0.25], zoom: (z) => 0.03 * bump(z) },
      { name: 'Master group', role: 'master', span: [0.72, 0.82], share: 0.2, powers: [P, P, N], semi: [0.05, 0.2] },
      { name: 'Focus + stabilizer', role: 'stabilizer', span: [0.86, 1], share: 0.3, powers: [N, P, N], semi: [0.5, 1], focus: 0.04 },
    ],
    stop: 3,
    irisRatio: 0.5,
    frontMin: 0.8,
    rearMax: 0.8,
    barrel: 'tele-zoom',
    extension: (z) => 0.28 * z,
  },
  'zoom-super': {
    sections: [
      { name: 'Front group (G1)', role: 'front', span: [0, 0.18], share: 0.2, powers: [P, N, P], semi: [1, 0.85], shape: 'flat', rides: true },
      { name: 'Variator (G2)', role: 'variator', span: [0.22, 0.32], share: 0.2, powers: [N, P, N], semi: [0.45, 0.35], zoom: (z) => -0.18 * z },
      { name: 'Focus group', role: 'focus', span: [0.58, 0.66], share: 0.14, powers: [P, N], semi: [0.3, 0.25], focus: -0.04 },
      { name: 'Master group', role: 'master', span: [0.72, 0.82], share: 0.2, powers: [P, P, N], semi: [0.05, 0.2] },
      { name: 'Stabilizer group', role: 'stabilizer', span: [0.86, 1], share: 0.26, powers: [N, P, N], semi: [0.5, 1] },
    ],
    stop: 3,
    irisRatio: 0.45,
    frontMin: 0.8,
    rearMax: 0.8,
    barrel: 'tele-zoom',
    extension: (z) => 0.32 * z,
  },
};

// ---------------------------------------------------------------- geometry helpers

/** Sag of a spherical surface of signed radius R at height r (positive for R > 0). */
export function sag(R: number, r: number): number {
  if (!Number.isFinite(R)) return 0;
  const R2 = R * R;
  const rr = Math.min(r * r, R2 * 0.999);
  return R - Math.sign(R) * Math.sqrt(R2 - rr);
}

/** Axial position of the front surface at height r, relative to the front vertex. */
export const frontAt = (e: { r1: number; a: number }, r: number) => -sag(e.r1, Math.min(r, e.a));
/** Axial position of the rear surface at height r, relative to the front vertex. */
export const rearAt = (e: { r2: number; a: number; thickness: number }, r: number) => -e.thickness + sag(e.r2, Math.min(r, e.a));

/** Retaining lip / spacer beyond the clear aperture. */
const LIP = 0.6;
/** Axial half-thickness of the iris housing. */
const STOP_HALF = 1.6;
const R_SAMPLES = 24;

interface Solid {
  kind: 'glass' | 'stop';
  r1: number;
  r2: number;
  a: number;
  thickness: number;
}

/** Forward boundary (relative to the vertex) of a solid at height r, including its cell beyond the clear aperture. */
function frontBoundary(e: Solid, r: number): number {
  if (e.kind === 'stop') return STOP_HALF;
  return r <= e.a ? frontAt(e, r) : frontAt(e, e.a) + LIP;
}
function rearBoundary(e: Solid, r: number): number {
  if (e.kind === 'stop') return -STOP_HALF;
  return r <= e.a ? rearAt(e, r) : rearAt(e, e.a) - LIP;
}
/** Smallest axial gap between solid `i` (front, vertex hi) and solid `j` (behind it, vertex hj). */
export function clearance(i: Solid, hi: number, j: Solid, hj: number): number {
  const rMax = Math.max(i.kind === 'glass' ? i.a : 0, j.kind === 'glass' ? j.a : 0);
  let min = Infinity;
  for (let k = 0; k <= R_SAMPLES; k++) {
    const r = (k / R_SAMPLES) * rMax;
    min = Math.min(min, hi + rearBoundary(i, r) - (hj + frontBoundary(j, r)));
  }
  return min;
}
function maxFront(e: Solid): number {
  let m = -Infinity;
  const rMax = e.kind === 'glass' ? e.a * 1.01 : 0;
  for (let k = 0; k <= R_SAMPLES; k++) m = Math.max(m, frontBoundary(e, (k / R_SAMPLES) * rMax));
  return m;
}
function minRear(e: Solid): number {
  let m = Infinity;
  const rMax = e.kind === 'glass' ? e.a * 1.01 : 0;
  for (let k = 0; k <= R_SAMPLES; k++) m = Math.min(m, rearBoundary(e, (k / R_SAMPLES) * rMax));
  return m;
}

type Shape = 'biconvex' | 'pos-meniscus-front' | 'pos-meniscus-rear' | 'biconcave' | 'neg-meniscus-front' | 'neg-meniscus-rear';
const SHAPES: Record<Shape, [number, number]> = {
  biconvex: [2.4, 3.2],
  'pos-meniscus-front': [1.8, -6],
  'pos-meniscus-rear': [-6, 1.8],
  biconcave: [-3.2, -2.8],
  'neg-meniscus-front': [5, -1.4],
  'neg-meniscus-rear': [-1.4, 5],
};

function thicknessFor(power: 1 | -1, r1: number, r2: number, a: number): number {
  const edge = Math.max(0.9, 0.06 * a);
  const t = edge + sag(r1, a) + sag(r2, a);
  return power > 0 ? Math.max(t, Math.max(1.6, 0.14 * a)) : Math.max(t, Math.max(1.0, 0.07 * a));
}

// ---------------------------------------------------------------- barrel

/** Barrel outer radius along h (retracted), by barrel style. */
function barrelProfile(style: Template['barrel'], L: number, D: number, throat: number): (h: number) => number {
  const R = D / 2;
  const mountR = throat / 2 + 3;
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  if (style === 'super-tele') {
    const rearR = Math.max(mountR + 4, 0.56 * R);
    return (h) => (h < 0.035 * L ? mountR : rearR + (R - rearR) * smooth(0.34 * L, 0.5 * L, h));
  }
  const rearR = Math.max(mountR + 3, (style === 'tele-zoom' ? 0.82 : 0.86) * R);
  return (h) => {
    if (h < Math.min(4, 0.04 * L)) return mountR;
    return rearR + (R - rearR) * smooth(0.06 * L, 0.14 * L, h);
  };
}

/** Wall thickness of the barrel (outer shell + helicoids). */
export const wallFor = (D: number) => Math.max(3, 0.075 * D);

// ---------------------------------------------------------------- builder

export function buildOpticalLayout(lens: LabLens): OpticalLayout {
  const tpl = TEMPLATES[lens.layout];
  const L = lens.dims.length;
  const D = lens.dims.diameter;
  const throat = lens.mountDiameter;
  const outer = barrelProfile(tpl.barrel, L, D, throat);
  const wall = wallFor(D);
  const innerAt = (h: number) => outer(h) - wall;

  // optical track: rear element a little ahead of the flange, front element just behind the front rim
  const trackRear = Math.max(2, 0.025 * L);
  const trackFront = L - Math.max(2, 0.03 * L);
  const T = trackFront - trackRear;
  const hOf = (p: number) => trackFront - p * T;

  // ---- element counts per section (sections left empty by a very small element count are dropped)
  const E = lens.elements;
  const allCounts = distribute(E, tpl.sections.map((s) => s.share));
  const active = tpl.sections.map((_, i) => i).filter((i) => allCounts[i] > 0 || i === tpl.stop);
  const secs = active.map((i) => tpl.sections[i]);
  const counts = active.map((i) => allCounts[i]);
  const stop = active.indexOf(tpl.stop);

  // ---- aperture envelope
  const ph = lens.physics;
  const epSemiAt = (z: number) => focalAtZoom(ph, z) / maxApertureAtZoom(ph, z) / 2;
  const epMax = Math.max(epSemiAt(0), epSemiAt(1));
  const frontInner = innerAt(hOf(0));
  const aFront = Math.min(frontInner * 0.94, Math.max(frontInner * tpl.frontMin, epMax * 1.06));
  const rearInner = innerAt(hOf(1));
  const aRear = Math.min(rearInner * 0.9, (throat / 2) * tpl.rearMax);
  const stopH0 = hOf(secs[stop].span[0]);
  const stopSemi = Math.min(innerAt(stopH0) * 0.72, epSemiAt(0) * tpl.irisRatio, Math.min(aFront, aRear) * 0.95);

  // ---- elements (shape + semi-aperture), front → rear
  const els: LayoutElement[] = [];
  secs.forEach((s, si) => {
    const n = counts[si];
    const before = si < stop;
    const edge = before ? aFront : aRear;
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      const w = s.semi[0] + (s.semi[1] - s.semi[0]) * t;
      const p = s.span[0] + (s.span[1] - s.span[0]) * t;
      let a = stopSemi * 1.12 + (edge - stopSemi * 1.12) * w;
      a = Math.min(a, innerAt(hOf(p)) - 1.2);
      const power = s.powers[k % s.powers.length];
      els.push({ index: els.length, group: 0, section: si, power, h: 0, thickness: 0, r1: 0, r2: 0, a, cementedToNext: false, special: null });
    }
  });

  // ---- cemented doublets until the published group count is reached
  const joins = Math.max(0, E - lens.groups);
  chooseJoins(els, joins);

  // ---- shapes
  const flattenBase = (si: number) => (secs[si].shape === 'flat' ? 2.4 : 1);
  const assignShapes = (flatten: number) => {
    for (const e of els) {
      const s = secs[e.section];
      const before = e.section < stop;
      const k = e.index - els.findIndex((x) => x.section === e.section);
      let shape: Shape;
      if (e.power > 0) shape = before ? (k % 2 === 0 ? 'biconvex' : 'pos-meniscus-front') : k % 2 === 0 ? 'pos-meniscus-rear' : 'biconvex';
      else if (s.shape === 'wide' && before) shape = 'neg-meniscus-front';
      else shape = !before && k === 0 ? 'neg-meniscus-rear' : 'biconcave';
      const f = flatten * flattenBase(e.section) * (s.shape === 'wide' && e.power < 0 ? 0.92 : 1);
      const [m1, m2] = SHAPES[shape];
      e.r1 = m1 * e.a * f;
      e.r2 = m2 * e.a * f;
    }
    // cemented partners share the contact surface (and the clear aperture)
    for (let i = 0; i < els.length - 1; i++) {
      if (!els[i].cementedToNext) continue;
      const a = Math.max(els[i].a, els[i + 1].a);
      els[i].a = els[i + 1].a = a;
    }
    for (let i = 0; i < els.length - 1; i++) {
      if (els[i].cementedToNext) {
        const contact = Math.abs(els[i].r2) < 1.25 * els[i].a ? Math.sign(els[i].r2) * 1.25 * els[i].a : els[i].r2;
        els[i].r2 = contact;
        els[i + 1].r1 = -contact;
      }
    }
    for (const e of els) {
      for (const key of ['r1', 'r2'] as const) if (Math.abs(e[key]) < 1.08 * e.a) e[key] = Math.sign(e[key]) * 1.08 * e.a;
      e.thickness = thicknessFor(e.power, e.r1, e.r2, e.a);
    }
  };

  // ---- packing: each section as a compact stack, then sections spread over the track
  const stopSolid: Solid = { kind: 'stop', r1: 0, r2: 0, a: 0, thickness: 0 };
  const minAir = (a: number) => Math.max(0.5, 0.025 * a);
  interface Stack {
    /** Vertex positions relative to the stack origin (first solid's vertex = 0). */
    local: number[];
    solids: (Solid & { el?: LayoutElement })[];
    front: number;
    rear: number;
  }
  const packSection = (si: number): Stack => {
    const solids: (Solid & { el?: LayoutElement })[] = [];
    if (si === stop) solids.push(stopSolid);
    for (const e of els) if (e.section === si) solids.push({ kind: 'glass', r1: e.r1, r2: e.r2, a: e.a, thickness: e.thickness, el: e });
    const local = [0];
    for (let k = 1; k < solids.length; k++) {
      const prev = solids[k - 1];
      const cur = solids[k];
      if (prev.el?.cementedToNext) local.push(local[k - 1] - prev.thickness);
      else local.push(local[k - 1] + clearanceOffset(prev, cur) - minAir(Math.max(prev.a, cur.a)));
    }
    const front = maxFront(solids[0]);
    const lastK = solids.length - 1;
    const rear = local[lastK] + minRear(solids[lastK]);
    return { local, solids, front, rear };
  };

  // ---- motion laws (track fractions → mm); scaled down later if anything would collide
  const ext = lens.isZoom && lens.zoomExtends && tpl.extension ? (z: number) => tpl.extension!(z) * L : () => 0;
  let motionScale = 1;
  const zoomMotion = (si: number, z: number) => (lens.isZoom && secs[si].zoom ? secs[si].zoom!(z) * T : 0);
  const focusMotion = (si: number) => {
    if (lens.unitFocus) return 0.06 * T;
    return secs[si].focus !== undefined ? secs[si].focus! * T : 0;
  };
  const offset = (si: number, z: number, f: number) => {
    const ride = secs[si].rides ? ext(z) : 0;
    return ride + motionScale * (zoomMotion(si, z) + focusMotion(si) * f);
  };
  const MOTION_Z = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  const worst = (fn: (z: number, f: number) => number) => {
    let m = 0;
    for (const z of MOTION_Z) for (const f of [0, 1]) m = Math.max(m, fn(z, f));
    return m;
  };
  // air the motions need: front section vs. the front rim, each pair of sections, last section vs. the flange
  const last = secs.length - 1;
  const motionNeed = [
    worst((z, f) => offset(0, z, f) - ext(z)),
    ...secs.slice(1).map((_, i) => worst((z, f) => offset(i + 1, z, f) - offset(i, z, f))),
    worst((z, f) => -offset(last, z, f)),
  ].map((v) => (v > 0 ? v + 0.6 : 0));

  let stacks: Stack[] = [];
  let origins: number[] = [];
  let flatten = 1;
  for (let attempt = 0; attempt < 10; attempt++) {
    assignShapes(flatten);
    stacks = secs.map((_, si) => packSection(si));
    // tight global pack
    origins = [];
    for (let si = 0; si < secs.length; si++) {
      if (si === 0) origins.push(trackFront - stacks[0].front);
      else {
        const pa = stacks[si - 1];
        const lastSolid = pa.solids[pa.solids.length - 1];
        origins.push(origins[si - 1] + pa.local[pa.local.length - 1] + clearanceOffset(lastSolid, stacks[si].solids[0]) - 1.2);
      }
    }
    const usedRear = origins[last] + stacks[last].rear;
    const leftover = usedRear - trackRear;
    if (leftover >= 0) {
      // 1. reserve the air every moving group needs (shared out if the lens is tightly packed)
      const reserve = motionNeed.reduce((a, b) => a + b, 0);
      const kReserve = reserve > leftover * 0.9 ? (leftover * 0.9) / reserve : 1;
      const spare = leftover - reserve * kReserve;
      // 2. spread the rest: mostly between sections (weighted by the template's gaps), some inside sections
      const weights = secs.slice(1).map((sec, i) => Math.max(0.01, sec.span[0] - secs[i].span[1]));
      const wSum = weights.reduce((a, b) => a + b, 0);
      const between = spare * 0.86;
      const inside = spare - between;
      const airCount = stacks.map((st) => st.solids.filter((sol, k) => k < st.solids.length - 1 && !sol.el?.cementedToNext).length);
      const totalAir = airCount.reduce((a, b) => a + b, 0);
      const per = totalAir ? Math.min(inside / totalAir, (0.2 * T) / Math.max(1, E)) : 0;
      let shift = motionNeed[0] * kReserve;
      for (let si = 0; si < secs.length; si++) {
        if (si > 0) shift += motionNeed[si] * kReserve + between * (weights[si - 1] / wSum);
        const st = stacks[si];
        let acc = 0;
        for (let k = 1; k < st.local.length; k++) {
          if (!st.solids[k - 1].el?.cementedToNext) acc += per;
          st.local[k] -= acc;
        }
        st.rear -= acc;
        origins[si] -= shift;
        shift += acc;
      }
      break;
    }
    flatten *= 1.25;
    if (attempt >= 5) for (const e of els) e.a *= 0.93;
  }

  // absolute vertex positions
  let stopH = stopH0;
  stacks.forEach((st, si) => {
    st.solids.forEach((sol, k) => {
      const h = origins[si] + st.local[k];
      if (sol.kind === 'stop') stopH = h;
      else if (sol.el) sol.el.h = h;
    });
  });

  // groups (air-spaced units)
  let g = 0;
  for (let i = 0; i < els.length; i++) {
    els[i].group = g;
    if (!els[i].cementedToNext) g++;
  }

  // ---- make sure nothing ever collides (scale the motions down if the air is too tight)
  const sectionSolids = secs.map((_, si) => stacks[si].solids.map((sol, k) => ({ s: sol, h: origins[si] + stacks[si].local[k] })));
  const collides = () => {
    for (const z of MOTION_Z) {
      for (const f of [0, 1]) {
        for (let si = 1; si < secs.length; si++) {
          const a = sectionSolids[si - 1][sectionSolids[si - 1].length - 1];
          const b = sectionSolids[si][0];
          if (clearance(a.s, a.h + offset(si - 1, z, f), b.s, b.h + offset(si, z, f)) < 0.4) return true;
        }
        const first = sectionSolids[0][0];
        if (first.h + offset(0, z, f) + maxFront(first.s) > L + ext(z) - 0.5) return true;
        const lastSec = sectionSolids[last];
        const lastSolid = lastSec[lastSec.length - 1];
        if (lastSolid.h + offset(last, z, f) + minRear(lastSolid.s) < 0.5) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < 30 && collides(); i++) motionScale *= 0.85;
  if (collides()) motionScale = 0;

  // ---- sections
  const sections: LayoutSection[] = secs.map((s, si) => {
    const zoomMoves = lens.isZoom && (!!s.zoom || (!!s.rides && lens.zoomExtends));
    const focusMoves = lens.unitFocus || s.focus !== undefined;
    return {
      name: s.name,
      role: s.role,
      elements: els.filter((e) => e.section === si).map((e) => e.index),
      carriesStop: si === stop,
      moves: zoomMoves && focusMoves ? 'zoom+focus' : zoomMoves ? 'zoom' : focusMoves ? 'focus' : 'fixed',
    };
  });

  // ---- special glass
  const specials = assignSpecials(lens, els, stop);

  return {
    length: L,
    diameter: D,
    throat,
    elements: els,
    sections,
    groupCount: g,
    stopH,
    stopSemi,
    stopSection: stop,
    specials,
    outerRadius: outer,
    sectionOffset: offset,
    extension: ext,
    pupilRatio: (z) => {
      const frontA = els.length ? els[0].a : aFront;
      return Math.min(epSemiAt(z), frontA * 0.92) / stopSemi;
    },
  };
}

/** Offset between consecutive vertices so that `cur` just touches `prev` (before subtracting the air gap). */
function clearanceOffset(prev: Solid, cur: Solid): number {
  const rMax = Math.max(prev.kind === 'glass' ? prev.a : 0, cur.kind === 'glass' ? cur.a : 0);
  let min = Infinity;
  for (let k = 0; k <= R_SAMPLES; k++) {
    const r = (k / R_SAMPLES) * rMax;
    min = Math.min(min, rearBoundary(prev, r) - frontBoundary(cur, r));
  }
  return min;
}

/** Largest-remainder split of n items by weights (every bucket gets ≥ 1 while n allows). */
export function distribute(n: number, weights: number[]): number[] {
  const k = weights.length;
  if (n <= k) {
    // one element each for the heaviest buckets
    const top = weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w).slice(0, n).map((x) => x.i);
    return weights.map((_, i) => (top.includes(i) ? 1 : 0));
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * n);
  const out = raw.map((r) => Math.max(1, Math.floor(r)));
  const frac = (i: number) => raw[i] - Math.floor(raw[i]);
  let diff = n - out.reduce((a, b) => a + b, 0);
  // hand out (or take back) the remainder by largest (smallest) fractional part
  const order = raw.map((_, i) => i).sort((a, b) => frac(b) - frac(a));
  for (let j = 0; diff > 0; j = (j + 1) % k, diff--) out[order[j]]++;
  for (let j = k - 1; diff < 0; j = (j + k - 1) % k) {
    if (out[order[j]] > 1) {
      out[order[j]]--;
      diff++;
    }
  }
  return out;
}

/** Marks `joins` adjacent pairs inside sections as cemented, preferring +/− achromatic doublets. */
function chooseJoins(els: LayoutElement[], joins: number): void {
  if (joins <= 0) return;
  const candidates: { i: number; score: number }[] = [];
  for (let i = 0; i < els.length - 1; i++) {
    if (els[i].section !== els[i + 1].section) continue;
    const opposite = els[i].power !== els[i + 1].power;
    candidates.push({ i, score: (opposite ? 10 : 0) + (i % 2 === 0 ? 0.5 : 0) - Math.abs(els[i].a - els[i + 1].a) / Math.max(1, els[i].a) });
  }
  candidates.sort((a, b) => b.score - a.score);
  let made = 0;
  // first pass: doublets only (no element in two joins); second pass: allow triplets
  for (const pass of [0, 1]) {
    for (const c of candidates) {
      if (made >= joins) return;
      if (els[c.i].cementedToNext) continue;
      const touching = (c.i > 0 && els[c.i - 1].cementedToNext) || els[c.i + 1].cementedToNext;
      if (pass === 0 && touching) continue;
      els[c.i].cementedToNext = true;
      made++;
    }
  }
}

const KIND_ORDER: SpecialElementKind[] = ['fluorite', 'super-low-dispersion', 'anomalous-dispersion', 'other', 'diffractive', 'low-dispersion', 'high-refractive', 'aspherical'];

/** Places the published special elements on plausible elements of the illustrative layout. */
function assignSpecials(lens: LabLens, els: LayoutElement[], stopSection: number): SpecialSummary[] {
  // same label listed under several kinds (e.g. "Aspherical ED") is one piece of glass with both properties
  const byLabel = new Map<string, SpecialSummary & { count: number }>();
  for (const s of lens.special) {
    const key = s.label.toLowerCase().replace(/\s+/g, ' ').trim();
    const prev = byLabel.get(key);
    if (prev) {
      if (!prev.kinds.includes(s.kind)) prev.kinds.push(s.kind);
      prev.count = Math.max(prev.count, s.count);
    } else byLabel.set(key, { label: s.label, kinds: [s.kind], elements: [], count: s.count });
  }
  const list = [...byLabel.values()];
  const rank = (s: SpecialSummary) => Math.min(...s.kinds.map((k) => KIND_ORDER.indexOf(k)));
  list.sort((a, b) => rank(a) - rank(b));

  const tele = ['telephoto', 'super-tele', 'zoom-tele', 'zoom-super', 'portrait'].includes(lens.layout);
  const wide = ['retrofocus', 'ultra-wide', 'zoom-wide'].includes(lens.layout);
  const firstAfterStop = els.findIndex((e) => e.section >= stopSection);
  const stopIdx = firstAfterStop < 0 ? els.length / 2 : firstAfterStop - 0.5;
  const positives = els.filter((e) => e.power > 0);
  const negatives = els.filter((e) => e.power < 0);
  const byStop = (arr: LayoutElement[]) => arr.slice().sort((a, b) => Math.abs(a.index - stopIdx) - Math.abs(b.index - stopIdx));

  const preference = (kinds: SpecialElementKind[]): LayoutElement[] => {
    const k = kinds[0];
    if (k === 'aspherical' && !kinds.some((x) => x !== 'aspherical')) {
      const order: number[] = [els.length - 1];
      if (wide) order.push(0, 1);
      if (firstAfterStop >= 0) order.push(firstAfterStop);
      if (firstAfterStop > 0) order.push(firstAfterStop - 1);
      order.push(els.length - 2, 0, 2, els.length - 3);
      const seen = new Set<number>();
      const out: LayoutElement[] = [];
      for (const i of [...order, ...els.map((e) => e.index)]) {
        if (i < 0 || i >= els.length || seen.has(i)) continue;
        seen.add(i);
        out.push(els[i]);
      }
      return out;
    }
    if (k === 'high-refractive') return [...byStop(negatives), ...byStop(positives)];
    if (k === 'diffractive' || k === 'other') {
      // organic / special layers usually sit in a cemented doublet
      const cem = els.filter((e) => e.cementedToNext || (e.index > 0 && els[e.index - 1].cementedToNext));
      return [...(tele ? cem : byStop(cem)), ...els];
    }
    // low-dispersion family: positive elements; telephotos concentrate them in the front group
    const pos = tele ? positives.slice().sort((a, b) => a.index - b.index) : byStop(positives);
    return [...pos, ...byStop(negatives)];
  };

  for (const s of list) {
    let left = s.count;
    for (const e of preference(s.kinds)) {
      if (left <= 0) break;
      if (e.special) continue;
      e.special = { label: s.label, kinds: s.kinds };
      s.elements.push(e.index);
      left--;
    }
    s.elements.sort((a, b) => a - b);
  }
  return list.filter((s) => s.elements.length).map(({ label, kinds, elements }) => ({ label, kinds, elements }));
}
