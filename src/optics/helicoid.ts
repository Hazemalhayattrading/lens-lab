import { LENS } from './config';
import { extensionForFocus, focusForExtension } from './thinLens';

/**
 * The focus ring turns a helicoid: rotation is converted linearly into axial
 * travel of the focusing group. That is why real distance scales bunch up
 * towards ∞ — travel (Δ = f²/(s − f)) is tiny for distant subjects.
 */
const f = LENS.focalLength;
export const MAX_EXTENSION = extensionForFocus(f, LENS.minFocus); // 10 mm for 50 mm / 0.3 m
export const RING_THROW = (LENS.ringThrowDeg * Math.PI) / 180;

/** Ring angle (radians, 0 = ∞) for an extension Δ (mm). */
export function ringAngleForExtension(extension: number): number {
  return (extension / MAX_EXTENSION) * RING_THROW;
}

export function extensionForRingAngle(angle: number): number {
  const a = Math.min(Math.max(angle, 0), RING_THROW);
  return (a / RING_THROW) * MAX_EXTENSION;
}

export function ringAngleForFocus(s: number): number {
  return ringAngleForExtension(extensionForFocus(f, s));
}

export function focusForRingAngle(angle: number): number {
  return focusForExtension(f, extensionForRingAngle(angle));
}
