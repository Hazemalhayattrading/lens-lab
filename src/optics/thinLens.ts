/**
 * Thin-lens optics. Every function works in millimetres and accepts
 * `Infinity` for "focused at / object at infinity".
 *
 *   Thin-lens equation     1/f = 1/dₒ + 1/dᵢ
 *   Aperture diameter      A = f / N
 *   Hyperfocal distance    H = f² / (N·c) + f
 *   DoF near limit         Dₙ = s(H − f) / (H + s − 2f)
 *   DoF far limit          D_f = s(H − f) / (H − s)      (∞ when s ≥ H)
 *   Blur disc (CoC)        b = f²·|d − s| / (N·(s − f)·d)
 */

export const INF = Number.POSITIVE_INFINITY;

/** Image distance dᵢ behind the lens for an object at distance d (1/f = 1/d + 1/dᵢ). */
export function imageDistance(f: number, d: number): number {
  if (!Number.isFinite(d)) return f;
  if (d <= f) return INF; // inside the focal length: no real image
  return (f * d) / (d - f);
}

/** Object distance dₒ that is imaged at dᵢ (inverse of imageDistance). */
export function objectDistance(f: number, di: number): number {
  if (!Number.isFinite(di)) return f;
  if (di <= f) return INF;
  return (f * di) / (di - f);
}

/** How far the focusing group must move forward from the ∞ position: Δ = dᵢ − f = f²/(s − f). */
export function extensionForFocus(f: number, s: number): number {
  if (!Number.isFinite(s)) return 0;
  return (f * f) / (s - f);
}

/** Focus distance produced by a given extension Δ (inverse of extensionForFocus). */
export function focusForExtension(f: number, extension: number): number {
  if (extension <= 0) return INF;
  return f + (f * f) / extension;
}

/** Entrance-pupil (aperture) diameter A = f/N. */
export function apertureDiameter(f: number, N: number): number {
  return f / N;
}

/** Hyperfocal distance H = f²/(N·c) + f. */
export function hyperfocal(f: number, N: number, c: number): number {
  return (f * f) / (N * c) + f;
}

export interface DofLimits {
  near: number;
  far: number;
  /** far − near (∞ if far is ∞). */
  depth: number;
}

/** Near/far limits of acceptable sharpness when focused at s. */
export function dofLimits(f: number, N: number, c: number, s: number): DofLimits {
  const H = hyperfocal(f, N, c);
  if (!Number.isFinite(s)) return { near: H - f, far: INF, depth: INF };
  const near = (s * (H - f)) / (H + s - 2 * f);
  const far = s >= H ? INF : (s * (H - f)) / (H - s);
  return { near, far, depth: far - near };
}

/**
 * Signed blur-disc diameter (circle of confusion) on the sensor, in mm, for an
 * object at distance d when the lens is focused at s.
 * Negative = object nearer than the plane of focus (image forms behind the sensor),
 * positive = farther (image forms in front of the sensor).
 */
export function blurDiameterSigned(f: number, N: number, s: number, d: number): number {
  if (!Number.isFinite(s)) {
    return Number.isFinite(d) ? -(f * f) / (N * d) : 0;
  }
  if (!Number.isFinite(d)) return (f * f) / (N * (s - f));
  return (f * f * (d - s)) / (N * (s - f) * d);
}

export function blurDiameter(f: number, N: number, s: number, d: number): number {
  return Math.abs(blurDiameterSigned(f, N, s, d));
}

/** Lateral magnification m = dᵢ/dₒ = f/(s − f). */
export function magnification(f: number, s: number): number {
  if (!Number.isFinite(s)) return 0;
  return f / (s - f);
}

/** Angle of view (radians) across a sensor dimension, for image distance dᵢ. */
export function angleOfView(sensorDimension: number, di: number): number {
  return 2 * Math.atan(sensorDimension / (2 * di));
}
