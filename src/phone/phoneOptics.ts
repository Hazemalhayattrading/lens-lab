import type { PhoneCamera, PhoneData } from '../data/types';
import { FULL_FRAME_DIAGONAL, cocForSensor, diagonal, sensorFromOpticalFormat } from '../optics/formats';
import { dofLimits } from '../optics/thinLens';

/**
 * Values the phone view shows next to the published specs. Every number says where it comes from:
 * `published` (the maker's spec), or `computed` from published numbers (with the formula in the UI);
 * `null` when neither is possible. Nothing is estimated.
 */

export type Provenance = 'published' | 'computed';
export interface Valued<T> {
  value: T;
  source: Provenance;
  /** How a computed value was derived (shown as a tooltip / footnote). */
  how?: string;
}

export interface SensorSize {
  width: number;
  height: number;
}

export interface CameraOptics {
  camera: PhoneCamera;
  /** Active area in mm (4:3), from the optical format or from pixel count × pitch. */
  sensor: Valued<SensorSize> | null;
  crop: number | null;
  eqFocal: Valued<number> | null;
  realFocal: Valued<number> | null;
  /** f-number × crop factor: depth of field / total light for the same framing. */
  eqAperture: number | null;
  /** Diagonal angle of view in degrees. */
  fovDiag: Valued<number> | null;
  /** Depth of field at 2 m (from the focal plane), CoC = diagonal / 1442. */
  dofAt2m: { near: number; far: number } | null;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Sensor size of a camera: published optical format first, else pixel count × pixel pitch (4:3). */
export function cameraSensor(c: PhoneCamera): Valued<SensorSize> | null {
  if (c.sensorFormat) {
    const s = sensorFromOpticalFormat(c.sensorFormat);
    if (s) return { value: { width: round(s.width), height: round(s.height) }, source: 'computed', how: `${c.sensorFormat} optical format ≈ ${round(diagonal(s), 1)} mm diagonal, 4:3` };
  }
  if (c.megapixels && c.pixelSizeUm) {
    const px = Math.sqrt((c.megapixels * 1e6 * 4) / 3);
    const w = (px * c.pixelSizeUm) / 1000;
    return { value: { width: round(w), height: round((w * 3) / 4) }, source: 'computed', how: `${c.megapixels} MP × ${c.pixelSizeUm} µm pixels, 4:3` };
  }
  return null;
}

/** The main camera (1× reference for zoom factors). */
export function mainCamera(p: PhoneData): PhoneCamera | undefined {
  return p.cameras.find((c) => c.role === 'main');
}

export function cameraOptics(p: PhoneData, c: PhoneCamera): CameraOptics {
  const sensor = cameraSensor(c);
  const crop = sensor ? FULL_FRAME_DIAGONAL / diagonal(sensor.value) : null;

  // 35 mm-equivalent focal length: published, else main camera × published optical zoom factor
  let eqFocal: Valued<number> | null = c.eqFocalMm ? { value: c.eqFocalMm, source: 'published' } : null;
  const main = mainCamera(p);
  if (!eqFocal && c.opticalZoom && c.role !== 'front' && main?.eqFocalMm) {
    eqFocal = { value: round(main.eqFocalMm * c.opticalZoom, 1), source: 'computed', how: `${c.opticalZoom}× the main camera's ${main.eqFocalMm} mm` };
  }

  // real focal length: published, else equivalent ÷ crop factor
  let realFocal: Valued<number> | null = c.focalMm ? { value: c.focalMm, source: 'published' } : null;
  if (!realFocal && eqFocal && crop) realFocal = { value: round(eqFocal.value / crop, 2), source: 'computed', how: `${eqFocal.value} mm ÷ crop ${crop.toFixed(2)}` };

  const eqAperture = c.aperture && crop ? round(c.aperture * crop, 1) : null;

  let fovDiag: Valued<number> | null = c.fovDeg ? { value: c.fovDeg, source: 'published' } : null;
  if (!fovDiag && eqFocal) fovDiag = { value: round((2 * Math.atan(FULL_FRAME_DIAGONAL / (2 * eqFocal.value)) * 180) / Math.PI, 1), source: 'computed', how: `rectilinear, from ${eqFocal.value} mm equivalent` };

  const dofAt2m = realFocal && c.aperture && sensor ? depthOfField(realFocal.value, c.aperture, cocForSensor(sensor.value), 2000) : null;
  return { camera: c, sensor, crop: crop ? round(crop, 3) : null, eqFocal, realFocal, eqAperture, fovDiag, dofAt2m };
}

/**
 * Near / far limits (mm from the focal plane) for a thin lens of focal length f at f-number N
 * focused at T (from the focal plane), circle of confusion c — the same convention as the lab
 * (lensModel.lensState): the lens stays at its image distance v, so every limit is (distance from
 * the lens) + v.
 */
export function depthOfField(f: number, N: number, c: number, T: number): { near: number; far: number } {
  const u = (T + Math.sqrt(Math.max(0, T * T - 4 * T * f))) / 2;
  const v = T - u;
  const d = dofLimits(f, N, c, u);
  return { near: d.near + v, far: d.far + v };
}

/** Optical layout family of a camera's 3D model. */
export type ModuleKind = 'straight' | 'periscope' | 'tetraprism' | 'lenses-on-prism';

export function moduleKind(c: PhoneCamera): ModuleKind {
  if (!c.folded) return 'straight';
  const p = (c.prism ?? '').toLowerCase();
  if (p.includes('tetra')) return 'tetraprism';
  if (p.includes('alop') || p.includes('lenses on prism')) return 'lenses-on-prism';
  return 'periscope';
}

export const ROLE_LABEL: Record<PhoneCamera['role'], string> = {
  'ultra-wide': 'Ultra-wide',
  main: 'Main',
  telephoto: 'Telephoto',
  periscope: 'Periscope',
  front: 'Front',
};
