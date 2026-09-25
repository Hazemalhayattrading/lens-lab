import { LENS } from '../optics/config';
import { DepthMap } from '../optics/depthMap';

/**
 * World layout of the optics bench (1 world unit ≈ one "model" unit; the bench top is y = 0).
 *
 * The optical axis runs along +X at height AXIS_Y. The sensor is on the left, the lens in the
 * middle and the diorama to the right. The image side (lens → sensor) is a scaled copy of the
 * real millimetre geometry; the object side (lens → diorama) is compressed with the DepthMap.
 */
export const LAYOUT = {
  axisY: 1.9,
  axisZ: 0,
  /** World X of the sensor plane. */
  sensorX: -3.75,
  /** World units per millimetre along the axis on the image side. */
  kAxial: 0.075,
  /** World units per millimetre across the axis on the image side (sensor, aperture). */
  kLateral: 0.058,
  /** World X (relative to the optical centre at ∞ focus) of the closest focus distance… */
  xNearRel: 3.25,
  /** …and of infinity (the sky backdrop). */
  xInfRel: 8.45,
  /** Depth map shape parameter d₀ (mm). */
  depthD0: 1200,
} as const;

export const depthMap = new DepthMap(LAYOUT.depthD0, LENS.minFocus);

/** Optical centre of the lens when focused at infinity; the sensor camera sits here. */
export const OPTICAL_CENTER_X = LAYOUT.sensorX + LAYOUT.kAxial * LENS.focalLength;

/** Current world X of the lens' principal plane for an image distance dᵢ (mm). */
export function lensPlaneX(imageDistanceMm: number): number {
  return LAYOUT.sensorX + LAYOUT.kAxial * imageDistanceMm;
}

/** World X of a subject at physical distance d (mm). */
export function worldXForDistance(d: number): number {
  const u = depthMap.toU(d);
  return OPTICAL_CENTER_X + LAYOUT.xNearRel + u * (LAYOUT.xInfRel - LAYOUT.xNearRel);
}

/** Physical distance (mm) of a world X on the object side. */
export function distanceForWorldX(x: number): number {
  const u = (x - OPTICAL_CENTER_X - LAYOUT.xNearRel) / (LAYOUT.xInfRel - LAYOUT.xNearRel);
  return depthMap.fromU(u);
}

/** Sensor size in world units. */
export const SENSOR_W = LENS.sensorWidth * LAYOUT.kLateral;
export const SENSOR_H = LENS.sensorHeight * LAYOUT.kLateral;

/** Render layers. */
export const LAYER_MAIN = 0;
/** Objects the lens can "see" (rendered by the sensor camera). */
export const LAYER_SENSOR = 1;
