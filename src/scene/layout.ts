import { PowerDepthMap } from '../optics/depthMap';

/**
 * World layout of the optics bench (1 world unit ≈ one "model" unit; the bench top is y = 0).
 *
 * The optical axis runs along +X at height axisY. The sensor is on the left, the lens in the
 * middle and the diorama to the right. The object side (lens → diorama) is a depth ladder: the
 * physical distance of a subject (from the focal plane) maps to world X through a smooth
 * power-law map, so the lens sees everything from a flower at 30 cm to mountains at ∞.
 * The image side (lens → sensor) is schematic (PLAN.md, Phase 2 decision 6).
 */
export const LAYOUT = {
  axisY: 1.9,
  axisZ: 0,
  /** World X of the sensor plane. */
  sensorX: -3.75,
  /** World units per millimetre across the axis on the image side (sensor size, blur discs). */
  kLateral: 0.058,
  /** World X of the lens mount flange (every lens is built forward from here). */
  mountX: -1.46,
  /** Largest length and radius a lens may be drawn with (world units). */
  lensMaxLength: 4.35,
  lensMaxRadius: 1.25,
  /** World X (relative to the perspective centre) of the depth-ladder start (u = 0)… */
  xNearRel: 3.25,
  /** …and of infinity (the sky light-box). */
  xInfRel: 9.2,
  /** Depth ladder: distance (mm from the focal plane) at u = 0, and its exponent. */
  depthNear: 200,
  depthGamma: 0.3,
} as const;

export const depthMap = new PowerDepthMap(LAYOUT.depthNear, LAYOUT.depthGamma);

/**
 * Perspective centre of the lens (its entrance pupil in this model): the sensor-view camera sits
 * here and the field-of-view cone starts here, whatever lens is mounted.
 */
export const OPTICAL_CENTER_X = 0;

/** World X of a subject at physical distance d (mm from the focal plane). */
export function worldXForDistance(d: number): number {
  const u = depthMap.toU(d);
  return OPTICAL_CENTER_X + LAYOUT.xNearRel + u * (LAYOUT.xInfRel - LAYOUT.xNearRel);
}

/** Physical distance (mm from the focal plane) of a world X on the object side. */
export function distanceForWorldX(x: number): number {
  const u = (x - OPTICAL_CENTER_X - LAYOUT.xNearRel) / (LAYOUT.xInfRel - LAYOUT.xNearRel);
  return depthMap.fromU(u);
}

/** Sensor chip on the bench: always the 36 × 24 mm full-frame part (lateral scale kLateral). */
export const SENSOR_W = 36 * LAYOUT.kLateral;
export const SENSOR_H = 24 * LAYOUT.kLateral;

/** Render layers. */
export const LAYER_MAIN = 0;
/** Objects the lens can "see" (rendered by the sensor camera and by the orbit camera). */
export const LAYER_SENSOR = 1;
/** World extension seen only by the sensor camera (wide-angle surroundings, sky dome). */
export const LAYER_SENSOR_ONLY = 2;
