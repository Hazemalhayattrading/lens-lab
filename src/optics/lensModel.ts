/**
 * Physics of a real (zoom or prime) lens, built on the Phase 1 thin-lens maths.
 * All lengths in mm. Focus distances T are measured from the focal plane (the ⦶ mark), like
 * minimum-focus specs and distance scales; the thin-lens formulas use the object distance u
 * from the lens, with T = u + v and 1/f = 1/u + 1/v.
 *
 * Zoom          f(z) = f_min · (f_max / f_min)^z               z ∈ [0, 1] = zoom-ring position
 * Max aperture  N(z) = N_wide · (N_tele / N_wide)^z           (published only at the ends; in between
 *               snapped to the camera's 1/3-stop scale → marked "≈" in the UI)
 * Close focus   the focus state is the magnification m ∈ [0, m_max]; the effective focal length
 *               f_e(m) = f + (f_mfd − f)·m/m_max, where f_mfd = MFD·m_max/(1 + m_max)² makes the lens
 *               reach its *published* maximum magnification exactly at its *published* MFD
 *               (thin-lens conjugates: u = f(1+m)/m, v = f(1+m), T = f(1+m)²/m).
 *               This is focus breathing: most internally focusing lenses get shorter up close.
 */
import { cocForSensor, diagonal, type SensorSize } from './formats';
import { angleOfView, blurDiameterSigned, dofLimits, hyperfocal } from './thinLens';

export interface LensPhysicsSpec {
  focal: { min: number; max: number };
  maxAperture: { wide: number; tele: number };
  minAperture: { wide: number; tele: number };
  /** Closest focus in mm from the focal plane, at the wide / tele end. */
  mfd: { wide: number; tele: number };
  /** Published maximum magnification (null = unverified → fixed focal length, no breathing). */
  maxMagnification: number | null;
  /** Zoom end the published magnification refers to. */
  maxMagAt: 'wide' | 'tele';
  sensor: SensorSize;
  /** Override for the acceptable circle of confusion (default: diagonal / 1442). */
  coc?: number;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const geo = (a: number, b: number, t: number) => a * Math.pow(b / a, t);

/** 1/3-stop f-number scale as marked by cameras. */
export const THIRD_STOPS = [
  0.95, 1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20,
  22, 25, 29, 32, 36, 40, 45, 51, 57, 64,
];
/** Full stops (√2 steps). */
export const FULL_STOPS = [1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22, 32, 45, 64];

/** Aperture in stops relative to f/1: s = 2·log₂N. */
export const stopsOf = (n: number) => 2 * Math.log2(n);

export function isZoom(spec: LensPhysicsSpec): boolean {
  return spec.focal.max > spec.focal.min * 1.0001;
}

/** Focal length (at ∞) for zoom-ring position z. */
export function focalAtZoom(spec: LensPhysicsSpec, z: number): number {
  return isZoom(spec) ? geo(spec.focal.min, spec.focal.max, clamp01(z)) : spec.focal.min;
}

/** Zoom-ring position for a focal length (inverse of focalAtZoom). */
export function zoomForFocal(spec: LensPhysicsSpec, f: number): number {
  if (!isZoom(spec)) return 0;
  return clamp01(Math.log(f / spec.focal.min) / Math.log(spec.focal.max / spec.focal.min));
}

function snapThird(n: number): number {
  let best = THIRD_STOPS[0];
  for (const s of THIRD_STOPS) if (Math.abs(stopsOf(s) - stopsOf(n)) < Math.abs(stopsOf(best) - stopsOf(n))) best = s;
  return best;
}

/** Maximum aperture (smallest f-number) at zoom z. Exact at both ends, ≈ in between. */
export function maxApertureAtZoom(spec: LensPhysicsSpec, z: number): number {
  const { wide, tele } = spec.maxAperture;
  const t = clamp01(z);
  if (!isZoom(spec) || Math.abs(tele - wide) < 1e-9) return wide;
  if (t <= 0) return wide;
  if (t >= 1) return tele;
  return Math.min(Math.max(snapThird(geo(wide, tele, t)), wide), tele);
}

/** Minimum aperture (largest f-number) at zoom z. */
export function minApertureAtZoom(spec: LensPhysicsSpec, z: number): number {
  const { wide, tele } = spec.minAperture;
  const t = clamp01(z);
  if (!isZoom(spec) || Math.abs(tele - wide) < 1e-9 || t <= 0) return wide;
  if (t >= 1) return tele;
  return Math.min(Math.max(snapThird(geo(wide, tele, t)), Math.min(wide, tele)), Math.max(wide, tele));
}

/** Closest focus (mm from the focal plane) at zoom z, interpolated between the published ends. */
export function mfdAtZoom(spec: LensPhysicsSpec, z: number): number {
  return lerp(spec.mfd.wide, spec.mfd.tele, isZoom(spec) ? clamp01(z) : 0);
}

/**
 * Magnification (m ≤ 1 branch) of a fixed-f thin lens focused at total conjugate T:
 * T = f(1+m)²/m  ⇔  f·m² + (2f − T)·m + f = 0. Null when T < 4f (a thin lens cannot focus that close).
 */
export function thinLensMagnification(f: number, T: number): number | null {
  if (!Number.isFinite(T)) return 0;
  const b = T - 2 * f;
  const disc = b * b - 4 * f * f;
  if (disc < 0) return null;
  return (b - Math.sqrt(disc)) / (2 * f);
}

export interface FocusCurve {
  /** Focal length at ∞ (this zoom position). */
  f: number;
  /** Effective focal length at the closest focus. */
  fMfd: number;
  /** Magnification at the closest focus. */
  mMax: number;
  /** Closest focus the model reaches, mm from the focal plane. */
  mfd: number;
  /** True when f_mfd was fitted to a published magnification (focus breathing is modelled). */
  fitted: boolean;
}

/** Effective focal length at magnification m. */
export function effectiveFocal(c: FocusCurve, m: number): number {
  return c.mMax > 0 ? c.f + (c.fMfd - c.f) * Math.min(1, m / c.mMax) : c.f;
}

/** Focus distance (from the focal plane) at magnification m: T = f_e(1+m)²/m. */
export function distanceForMagnification(c: FocusCurve, m: number): number {
  if (m <= 0) return Number.POSITIVE_INFINITY;
  return (effectiveFocal(c, m) * (1 + m) * (1 + m)) / m;
}

function monotonic(c: FocusCurve): boolean {
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 1; i <= 64; i++) {
    const T = distanceForMagnification(c, (i / 64) * c.mMax);
    if (!(T < prev)) return false;
    prev = T;
  }
  return true;
}

/** The focus curve of the lens at zoom z (see the header for the model). */
export function focusCurve(spec: LensPhysicsSpec, z: number): FocusCurve {
  const t = isZoom(spec) ? clamp01(z) : 0;
  const f = focalAtZoom(spec, t);
  const mfd = mfdAtZoom(spec, t);
  const endM = (end: 'wide' | 'tele'): number => {
    if (spec.maxMagnification !== null && (end === spec.maxMagAt || !isZoom(spec))) return spec.maxMagnification;
    const fe = end === 'wide' ? spec.focal.min : spec.focal.max;
    return thinLensMagnification(fe, end === 'wide' ? spec.mfd.wide : spec.mfd.tele) ?? 1;
  };
  const mMax = isZoom(spec) ? lerp(endM('wide'), endM('tele'), t) : endM(spec.maxMagAt);
  const fitted: FocusCurve = { f, fMfd: (mfd * mMax) / ((1 + mMax) * (1 + mMax)), mMax, mfd, fitted: true };
  if (spec.maxMagnification !== null && mMax > 0 && monotonic(fitted)) {
    fitted.fitted = Math.abs(fitted.fMfd - f) > 1e-6;
    return fitted;
  }
  // fixed focal length (no published magnification, or a curve that would not focus monotonically)
  const m = thinLensMagnification(f, mfd) ?? 1;
  return { f, fMfd: f, mMax: m, mfd: distanceForMagnification({ f, fMfd: f, mMax: m, mfd, fitted: false }, m), fitted: false };
}

/** Magnification when focused at T mm from the focal plane (clamped to the lens' range). */
export function magnificationForDistance(c: FocusCurve, T: number): number {
  if (!Number.isFinite(T) || T <= 0) return T <= 0 ? c.mMax : 0;
  if (T <= distanceForMagnification(c, c.mMax)) return c.mMax;
  let lo = 0;
  let hi = c.mMax;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (distanceForMagnification(c, mid) > T) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface LensState {
  zoom: number;
  /** Focal length at ∞ for this zoom position (the number on the zoom ring). */
  focalLength: number;
  /** Effective focal length in the current focus state (breathing). */
  effectiveFocal: number;
  fNumber: number;
  /** Focus distance, mm from the focal plane. */
  focusDistance: number;
  magnification: number;
  /** Object distance from the (thin) lens, u. */
  objectDistance: number;
  /** Lens → sensor, v. */
  imageDistance: number;
  /** Entrance pupil diameter f_e / N. */
  apertureDiameter: number;
  /** Effective (working) f-number N·(1 + m) — what matters for exposure up close. */
  workingFNumber: number;
  coc: number;
  /** Hyperfocal distance from the focal plane. */
  hyperfocal: number;
  near: number;
  far: number;
  depthOfField: number;
  fovHorizontal: number;
  fovVertical: number;
  fovDiagonal: number;
  sensor: SensorSize;
  curve: FocusCurve;
}

/** Complete optical state for zoom z, focus distance T (mm from the focal plane) and f-number N. */
export function lensState(spec: LensPhysicsSpec, z: number, T: number, N: number): LensState {
  const zoom = isZoom(spec) ? clamp01(z) : 0;
  const curve = focusCurve(spec, zoom);
  const m = magnificationForDistance(curve, T);
  const fe = effectiveFocal(curve, m);
  const u = m > 0 ? (fe * (1 + m)) / m : Number.POSITIVE_INFINITY;
  const v = fe * (1 + m);
  const T0 = m > 0 ? u + v : Number.POSITIVE_INFINITY;
  const c = spec.coc ?? cocForSensor(spec.sensor);
  const dof = dofLimits(fe, N, c, u);
  const H = hyperfocal(fe, N, c);
  const vH = (fe * H) / (H - fe);
  return {
    zoom,
    focalLength: curve.f,
    effectiveFocal: fe,
    fNumber: N,
    focusDistance: T0,
    magnification: m,
    objectDistance: u,
    imageDistance: v,
    apertureDiameter: fe / N,
    workingFNumber: N * (1 + m),
    coc: c,
    hyperfocal: H + vH,
    near: dof.near + v,
    far: dof.far + v,
    depthOfField: dof.far - dof.near,
    fovHorizontal: angleOfView(spec.sensor.width, v),
    fovVertical: angleOfView(spec.sensor.height, v),
    fovDiagonal: angleOfView(diagonal(spec.sensor), v),
    sensor: spec.sensor,
    curve,
  };
}

/**
 * Signed blur-disc diameter (mm on the sensor) of an object T_d mm from the focal plane, for a lens
 * in state `s`. The lens stays where it is (v fixed), so the object's distance from it is T_d − v.
 * Negative = nearer than the plane of focus.
 */
export function cocAt(s: LensState, Td: number): number {
  const ud = Number.isFinite(Td) ? Td - s.imageDistance : Number.POSITIVE_INFINITY;
  if (ud <= s.effectiveFocal * 1.0001) return -s.apertureDiameter; // inside the focal length: huge blur
  return blurDiameterSigned(s.effectiveFocal, s.fNumber, s.objectDistance, ud);
}

/**
 * Aperture buttons for a lens: wide open, a few full stops spread evenly, and the smallest aperture.
 * e.g. f/1.2–16 → [1.2, 2, 4, 8, 16].
 */
export function apertureButtons(maxN: number, minN: number, count = 5): number[] {
  if (minN <= maxN * 1.05) return [maxN];
  const out = [maxN];
  const candidates = FULL_STOPS.filter((n) => stopsOf(n) > stopsOf(maxN) + 0.25 && stopsOf(n) < stopsOf(minN) - 0.25);
  const want = Math.max(0, count - 2);
  if (candidates.length <= want) {
    out.push(...candidates);
  } else {
    const s0 = stopsOf(maxN);
    const s1 = stopsOf(minN);
    for (let i = 0; i < want; i++) {
      const target = s0 + ((i + 1) / (want + 1)) * (s1 - s0);
      let best = candidates[0];
      for (const n of candidates) if (Math.abs(stopsOf(n) - target) < Math.abs(stopsOf(best) - target)) best = n;
      if (!out.includes(best)) out.push(best);
    }
  }
  out.push(minN);
  return out.sort((a, b) => a - b);
}

/**
 * Image-side schematic (Phase 2 decision 6): cone from an aperture of radius r at distance D in
 * front of the sensor. Returns the signed offset a of the convergence point from the sensor
 * (+ = towards the lens / in front, − = behind the sensor) so that the cone cuts the sensor in a
 * disc of the given diameter. far = true for subjects beyond the plane of focus.
 */
export function convergenceOffset(discDiameter: number, apertureRadius: number, D: number, far: boolean): number {
  const t = Math.max(0, discDiameter) / (2 * apertureRadius);
  if (far) return (t * D) / (1 + t);
  if (t >= 0.999) return -D * 999;
  return -(t * D) / (1 - t);
}
