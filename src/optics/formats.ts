/**
 * Sensor formats, crop factors, circles of confusion and 35 mm equivalence. All lengths in mm.
 *
 *   diagonal          d = √(w² + h²)
 *   crop factor       k = d_FF / d            (d_FF = √(36² + 24²) = 43.27 mm)
 *   circle of conf.   c = d / 1442           (0.030 mm on full frame, as in Phase 1)
 *   equiv. focal      f_eq = f · k           (same diagonal angle of view)
 *   equiv. aperture   N_eq = N · k           (same depth of field and total light at the same f_eq)
 */

export interface SensorSize {
  width: number;
  height: number;
}

export const FULL_FRAME: SensorSize = { width: 36, height: 24 };
export const FULL_FRAME_DIAGONAL = Math.hypot(FULL_FRAME.width, FULL_FRAME.height);

/** Nominal image areas of the lens formats in the library. */
export const FORMAT_SIZES = {
  'full-frame': FULL_FRAME,
  /** Fujifilm X-Trans sensors. */
  'aps-c': { width: 23.5, height: 15.6 },
  'micro-four-thirds': { width: 17.3, height: 13.0 },
  /** Fujifilm GFX ("44 × 33"). */
  'medium-format': { width: 43.8, height: 32.9 },
} as const satisfies Record<string, SensorSize>;

export type FormatId = keyof typeof FORMAT_SIZES;

export function diagonal(s: SensorSize): number {
  return Math.hypot(s.width, s.height);
}

export function cropFactor(s: SensorSize): number {
  return FULL_FRAME_DIAGONAL / diagonal(s);
}

/** Acceptable circle of confusion for a format (diagonal / 1442). */
export function cocForSensor(s: SensorSize): number {
  return diagonal(s) / 1442;
}

export function equivalentFocalLength(focal: number, crop: number): number {
  return focal * crop;
}

export function equivalentAperture(fNumber: number, crop: number): number {
  return fNumber * crop;
}

/** Real focal length from a published 35 mm-equivalent focal length. */
export function focalFromEquivalent(eqFocal: number, crop: number): number {
  return eqFocal / crop;
}

/**
 * Size of a sensor from its "optical format" (e.g. `1/1.28"`, `1"`, `1/2.55"`).
 * The inch type is a legacy of video camera tubes: a "1-inch" sensor has a diagonal of ≈16 mm,
 * so a 1/x" sensor has a diagonal of ≈16/x mm. Phone sensors are 4:3. This is an approximation
 * (makers round the type), so results derived from it are shown with "≈".
 */
export function sensorFromOpticalFormat(format: string, aspect: [number, number] = [4, 3]): SensorSize | null {
  const s = format.replace(/[”″]/g, '"').replace(/\s+/g, '').replace(/-?inch(type)?|type/gi, '"');
  const m = /^(?:(\d+(?:\.\d+)?)\/)?(\d+(?:\.\d+)?)"?$/.exec(s);
  if (!m) return null;
  const inch = m[1] ? Number(m[1]) / Number(m[2]) : Number(m[2]);
  if (!Number.isFinite(inch) || inch <= 0) return null;
  const d = 16 * inch;
  const [a, b] = aspect;
  const k = d / Math.hypot(a, b);
  return { width: a * k, height: b * k };
}

/** Sensor size that reproduces a known crop factor (e.g. from real vs. equivalent focal length). */
export function sensorFromCrop(crop: number, aspect: [number, number] = [4, 3]): SensorSize {
  const d = FULL_FRAME_DIAGONAL / crop;
  const k = d / Math.hypot(aspect[0], aspect[1]);
  return { width: aspect[0] * k, height: aspect[1] * k };
}
