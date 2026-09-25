import type { LensCategory, LensData, SensorFormat, SpecialElement } from '../data/types';
import { FORMAT_SIZES, cropFactor } from '../optics/formats';
import type { LensPhysicsSpec } from '../optics/lensModel';
import { thinLensMagnification } from '../optics/lensModel';

/** Optical design family used to draw the (illustrative) cutaway. */
export type LayoutKind =
  | 'double-gauss'
  | 'retrofocus'
  | 'ultra-wide'
  | 'portrait'
  | 'macro'
  | 'telephoto'
  | 'super-tele'
  | 'zoom-wide'
  | 'zoom-standard'
  | 'zoom-tele'
  | 'zoom-super';

/** A value the simulation had to assume because the spec is unverified. */
export type Assumption = 'minAperture' | 'minFocus' | 'dimensions' | 'elements' | 'blades';

export interface LabLens {
  id: string;
  brand: string;
  name: string;
  /** Full record from the library (null for the built-in teaching lens). */
  data: LensData | null;
  category: LensCategory;
  format: SensorFormat;
  /** Mount throat diameter in mm (draws the bayonet to scale). */
  mountDiameter: number;
  physics: LensPhysicsSpec;
  isZoom: boolean;
  layout: LayoutKind;
  /** Element / group count used by the cutaway (published, or an assumption listed in `assumed`). */
  elements: number;
  groups: number;
  special: SpecialElement[];
  blades: number;
  /** Maximum diameter × length in mm. */
  dims: { diameter: number; length: number };
  stabilized: boolean;
  /** Barrel extends when zooming (otherwise internal zoom). */
  zoomExtends: boolean;
  /** Focusing moves the whole optical cell (Phase 1 teaching lens) or an internal group. */
  unitFocus: boolean;
  assumed: Assumption[];
  /** Crop factor of the lens' format relative to full frame. */
  crop: number;
}

const MOUNT_THROAT: Record<string, number> = {
  'Canon RF': 54,
  'Nikon Z': 55,
  'Sony E': 46,
  'Fujifilm X': 44,
  'Fujifilm G': 65,
  'L-Mount': 51.6,
  'Leica M': 44,
  'Micro Four Thirds': 38,
};

function layoutFor(category: LensCategory, zoom: boolean, eqMin: number): LayoutKind {
  if (zoom) {
    if (category === 'ultra-wide' || eqMin <= 20) return 'zoom-wide';
    if (category === 'super-telephoto') return 'zoom-super';
    if (category === 'telephoto-zoom') return 'zoom-tele';
    return 'zoom-standard';
  }
  switch (category) {
    case 'ultra-wide':
      return 'ultra-wide';
    case 'wide-prime':
      return 'retrofocus';
    case 'standard-prime':
      return 'double-gauss';
    case 'portrait-prime':
      return 'portrait';
    case 'macro':
      return 'macro';
    case 'telephoto-prime':
      return 'telephoto';
    case 'super-telephoto':
      return 'super-tele';
    default:
      return 'double-gauss';
  }
}

/** Typical proportions per design family — used only when the maker's dimensions are unverified. */
const FALLBACK_DIMS: Record<LayoutKind, (fMax: number) => { diameter: number; length: number }> = {
  'double-gauss': () => ({ diameter: 75, length: 80 }),
  retrofocus: () => ({ diameter: 75, length: 90 }),
  'ultra-wide': () => ({ diameter: 88, length: 110 }),
  portrait: () => ({ diameter: 85, length: 100 }),
  macro: () => ({ diameter: 80, length: 130 }),
  telephoto: (f) => ({ diameter: Math.max(80, f / 3), length: f * 0.8 }),
  'super-tele': (f) => ({ diameter: Math.max(110, f / 3.8), length: f * 0.75 }),
  'zoom-wide': () => ({ diameter: 88, length: 120 }),
  'zoom-standard': () => ({ diameter: 85, length: 125 }),
  'zoom-tele': (f) => ({ diameter: 88, length: Math.max(180, f * 0.9) }),
  'zoom-super': (f) => ({ diameter: 105, length: f * 0.55 }),
};

const FALLBACK_ELEMENTS: Record<LayoutKind, [number, number]> = {
  'double-gauss': [12, 9],
  retrofocus: [13, 10],
  'ultra-wide': [15, 11],
  portrait: [13, 9],
  macro: [15, 11],
  telephoto: [15, 11],
  'super-tele': [16, 12],
  'zoom-wide': [16, 12],
  'zoom-standard': [18, 14],
  'zoom-tele': [19, 15],
  'zoom-super': [22, 16],
};

/** Builds the lab description of a library lens. */
export function labLensFromData(d: LensData): LabLens {
  const zoom = d.focalLength.max > d.focalLength.min * 1.0001;
  const sensor = FORMAT_SIZES[d.format];
  const crop = cropFactor(sensor);
  const layout = layoutFor(d.category, zoom, d.focalLength.min * crop);
  const assumed: Assumption[] = [];

  // minimum aperture (largest f-number)
  let minW = d.minAperture.wide ?? d.minAperture.tele;
  let minT = d.minAperture.tele ?? d.minAperture.wide;
  if (minW === null || minT === null) {
    minW = minT = 16;
    assumed.push('minAperture');
  }

  // closest focus (mm from the focal plane); assumption: 1:10 at each end
  const fallbackMfd = (f: number) => (f * 1.21) / 0.1;
  let mfdW = d.minFocusM.wide ?? d.minFocusM.tele;
  let mfdT = d.minFocusM.tele ?? d.minFocusM.wide;
  let mfd: { wide: number; tele: number };
  if (mfdW === null || mfdT === null) {
    mfd = { wide: fallbackMfd(d.focalLength.min), tele: fallbackMfd(d.focalLength.max) };
    assumed.push('minFocus');
  } else {
    mfd = { wide: mfdW * 1000, tele: mfdT * 1000 };
  }

  // which end the published magnification refers to (default: the tele end, as for most zooms)
  let maxMagAt: 'wide' | 'tele' = 'tele';
  if (zoom && d.maxMagnification !== null) {
    const mw = thinLensMagnification(d.focalLength.min, mfd.wide) ?? 1;
    const mt = thinLensMagnification(d.focalLength.max, mfd.tele) ?? 1;
    // pick the end whose plain thin-lens magnification is closer to the published value
    maxMagAt = Math.abs(Math.log(mw / d.maxMagnification)) < Math.abs(Math.log(mt / d.maxMagnification)) ? 'wide' : 'tele';
  }

  let elements = d.elements;
  let groups = d.groups;
  if (elements === null || groups === null) {
    [elements, groups] = FALLBACK_ELEMENTS[layout];
    assumed.push('elements');
  }
  let blades = d.apertureBlades;
  if (blades === null) {
    blades = 9;
    assumed.push('blades');
  }
  let dims = d.dimensionsMm;
  if (!dims) {
    dims = FALLBACK_DIMS[layout](d.focalLength.max);
    assumed.push('dimensions');
  }

  return {
    id: d.id,
    brand: d.brand,
    name: d.name,
    data: d,
    category: d.category,
    format: d.format,
    mountDiameter: MOUNT_THROAT[d.mount] ?? 50,
    physics: {
      focal: { ...d.focalLength },
      maxAperture: { ...d.maxAperture },
      minAperture: { wide: minW, tele: minT },
      mfd,
      maxMagnification: d.maxMagnification,
      maxMagAt,
      sensor,
    },
    isZoom: zoom,
    layout,
    elements,
    groups,
    special: dedupeSpecial(d.specialElements ?? []),
    blades,
    dims,
    stabilized: d.stabilization?.optical ?? false,
    zoomExtends: zoom && d.zoomMechanism === 'extending',
    unitFocus: d.focusMechanism === 'unit',
    assumed,
    crop,
  };
}

/**
 * Special elements as physical glass: the research lists e.g. an "ED aspherical" element under both
 * kinds; the cutaway must draw it once (with both tags). Same label → keep the larger count.
 */
function dedupeSpecial(list: SpecialElement[]): SpecialElement[] {
  const byLabel = new Map<string, SpecialElement>();
  for (const s of list) {
    const key = s.label.toLowerCase().replace(/\s+/g, ' ').trim();
    const prev = byLabel.get(key);
    if (!prev || s.count > prev.count) byLabel.set(key, s);
  }
  return [...byLabel.values()];
}

/** The Phase 1 teaching lens: a classic 6-element double-Gauss 50 mm f/2 with unit focusing. */
export const TEACHING_LENS: LabLens = {
  id: 'lens-lab-50-f2',
  brand: 'Lens Lab',
  name: 'Lens Lab 50 mm f/2 (teaching lens)',
  data: null,
  category: 'standard-prime',
  format: 'full-frame',
  mountDiameter: 50,
  physics: {
    focal: { min: 50, max: 50 },
    maxAperture: { wide: 2, tele: 2 },
    minAperture: { wide: 16, tele: 16 },
    // 0.30 m from the lens = 0.36 m from the focal plane at 1:5 (thin-lens conjugates)
    mfd: { wide: 360, tele: 360 },
    maxMagnification: 0.2,
    maxMagAt: 'tele',
    sensor: FORMAT_SIZES['full-frame'],
    coc: 0.03,
  },
  isZoom: false,
  layout: 'double-gauss',
  elements: 6,
  groups: 4,
  special: [],
  blades: 9,
  dims: { diameter: 72, length: 64 },
  stabilized: false,
  zoomExtends: false,
  unitFocus: true,
  assumed: [],
  crop: 1,
};
