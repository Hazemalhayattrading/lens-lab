/**
 * Numbers for the Learn explainers. Nothing in here is a spec of its own: every value either comes
 * straight from the researched phone data (data/phones — "published") or is derived from it with the
 * lab's physics in src/optics ("computed"). The UI labels them that way.
 *
 * All lengths in mm; focus / subject distances are measured from the focal plane (PLAN.md, Phase 2
 * decision 3), exactly like the lab.
 */
import type { PhoneCamera, PhoneCameraRole, PhoneData } from '../data/types';
import {
  FORMAT_SIZES,
  FULL_FRAME,
  cocForSensor,
  cropFactor,
  diagonal,
  equivalentAperture,
  equivalentFocalLength,
  focalFromEquivalent,
  sensorFromOpticalFormat,
  type SensorSize,
} from '../optics/formats';
import { cocAt, lensState, type LensPhysicsSpec } from '../optics/lensModel';
import { angleOfView } from '../optics/thinLens';

/** The "1-inch type" image area (13.2 × 8.8 mm, 3:2) used by compact and bridge cameras. */
export const ONE_INCH_TYPE: SensorSize = { width: 13.2, height: 8.8 };

/**
 * Example optical format for a telephoto camera whose maker publishes no sensor size. Used only in
 * the periscope explainer and always shown as "example", never as the phone's spec.
 */
export const EXAMPLE_TELE_FORMAT = '1/2.5"';

/** Typical body thickness of a current flagship phone, for the periscope drawing (illustrative, not from the data). */
export const TYPICAL_PHONE_THICKNESS = 8;

/** A fixed-focal-length lens (no breathing) for the lab's lens model. */
export function fixedLens(f: number, N: number, sensor: SensorSize): LensPhysicsSpec {
  // 4f is the closest a thin lens can focus (T = f(1+m)²/m at m = 1); the explainers stay far beyond it
  return {
    focal: { min: f, max: f },
    maxAperture: { wide: N, tele: N },
    minAperture: { wide: 64, tele: 64 },
    mfd: { wide: 4 * f, tele: 4 * f },
    maxMagnification: null,
    maxMagAt: 'tele',
    sensor,
  };
}

// ------------------------------------------------------------------ phone cameras from the data

export interface CameraExample {
  phoneId: string;
  brand: string;
  /** Product name as in the data, e.g. "Pixel 11 Pro / Pro XL". */
  phone: string;
  /** The maker's name for the camera, e.g. "50MP Main". */
  camera: string;
  role: PhoneCameraRole;
  /** Published optical format (null = the maker / reviews publish none). */
  sensorFormat: string | null;
  /** Format the maths uses: the published one, or EXAMPLE_TELE_FORMAT. */
  formatUsed: string;
  /** True when the sensor size is an example (not published). */
  sensorIsExample: boolean;
  /** Sensor size from the optical format (≈, see sensorFromOpticalFormat). */
  sensor: SensorSize;
  /** Crop factor (computed from the sensor diagonal). */
  crop: number;
  /** 35 mm-equivalent focal length. */
  eqFocal: number;
  /** 'published', or 'zoom' = computed as optical zoom × the main camera's equivalent focal length. */
  eqFocalFrom: 'published' | 'zoom';
  /** Published default f-number. */
  aperture: number;
  /** Real focal length (published if the maker gives it, otherwise computed = eqFocal / crop). */
  realFocal: number;
  realFocalFrom: 'published' | 'computed';
  /** Equivalent f-number N × crop (computed). */
  eqAperture: number;
  /** Acceptable circle of confusion for the sensor (diagonal / 1442). */
  coc: number;
  opticalZoom: number | null;
  prism: string | null;
  notes: string | null;
}

function example(
  p: PhoneData,
  c: PhoneCamera,
  eqFocal: number,
  eqFocalFrom: CameraExample['eqFocalFrom'],
  allowExampleSensor: boolean,
): CameraExample | null {
  if (c.aperture === null) return null;
  const published = c.sensorFormat ? sensorFromOpticalFormat(c.sensorFormat) : null;
  if (!published && !allowExampleSensor) return null;
  const formatUsed = published ? c.sensorFormat! : EXAMPLE_TELE_FORMAT;
  const sensor = published ?? sensorFromOpticalFormat(EXAMPLE_TELE_FORMAT)!;
  const crop = cropFactor(sensor);
  const realFocal = c.focalMm ?? focalFromEquivalent(eqFocal, crop);
  return {
    phoneId: p.id,
    brand: p.brand,
    phone: p.name,
    camera: c.label,
    role: c.role,
    sensorFormat: c.sensorFormat,
    formatUsed,
    sensorIsExample: !published,
    sensor,
    crop,
    eqFocal,
    eqFocalFrom,
    aperture: c.aperture,
    realFocal,
    realFocalFrom: c.focalMm ? 'published' : 'computed',
    eqAperture: equivalentAperture(c.aperture, crop),
    coc: cocForSensor(sensor),
    opticalZoom: c.opticalZoom,
    prism: c.prism ?? null,
    notes: c.notes ?? null,
  };
}

/** Main cameras with a published optical format, equivalent focal length and f-number. */
export function mainCameras(phones: readonly PhoneData[]): CameraExample[] {
  const out: CameraExample[] = [];
  for (const p of phones) {
    const c = p.cameras.find((k) => k.role === 'main');
    if (!c || c.eqFocalMm === null) continue;
    const ex = example(p, c, c.eqFocalMm, 'published', false);
    if (ex) out.push(ex);
  }
  return out;
}

/**
 * Folded (periscope) telephoto cameras. The equivalent focal length is the published one, or — when
 * only the zoom factor is published — optical zoom × the main camera's published equivalent focal length.
 * A missing sensor size is replaced by EXAMPLE_TELE_FORMAT (flagged sensorIsExample).
 */
export function periscopeCameras(phones: readonly PhoneData[]): CameraExample[] {
  const out: CameraExample[] = [];
  for (const p of phones) {
    const main = p.cameras.find((k) => k.role === 'main');
    for (const c of p.cameras) {
      if (!(c.folded || c.role === 'periscope')) continue;
      let eq = c.eqFocalMm;
      let from: CameraExample['eqFocalFrom'] = 'published';
      if (eq === null && c.opticalZoom !== null && main?.eqFocalMm) {
        eq = c.opticalZoom * main.eqFocalMm;
        from = 'zoom';
      }
      if (eq === null) continue;
      const ex = example(p, c, eq, from, true);
      if (ex) out.push(ex);
    }
  }
  return out;
}

// ------------------------------------------------------------------ depth of field comparison

export interface DofResult {
  focal: number;
  fNumber: number;
  sensor: SensorSize;
  coc: number;
  /** Near / far limit of acceptable sharpness, mm from the focal plane (far may be ∞). */
  near: number;
  far: number;
  /** far − near (∞ when far is ∞). */
  depth: number;
  hyperfocal: number;
  /** Blur-disc diameter (mm on the sensor) of the background. */
  backgroundBlur: number;
  /** The same disc as a fraction of the frame width. */
  backgroundBlurFrac: number;
}

/** Depth of field of a fixed lens focused on a subject `subject` mm from the focal plane. */
export function depthOfField(f: number, N: number, sensor: SensorSize, subject: number, background = Number.POSITIVE_INFINITY): DofResult {
  const s = lensState(fixedLens(f, N, sensor), 0, subject, N);
  const bg = Math.abs(cocAt(s, background));
  return {
    focal: f,
    fNumber: N,
    sensor,
    coc: s.coc,
    near: s.near,
    far: s.far,
    depth: Number.isFinite(s.far) ? s.far - s.near : Number.POSITIVE_INFINITY,
    hyperfocal: s.hyperfocal,
    backgroundBlur: bg,
    backgroundBlurFrac: bg / sensor.width,
  };
}

export interface DofComparison {
  /** The phone's main camera at its published f-number. */
  phone: DofResult;
  /** Full frame, equivalent focal length, the phone's f-number. */
  sameN: DofResult;
  /** Full frame, equivalent focal length, the chosen f-number. */
  chosen: DofResult;
  /** N × crop: the full-frame f-number that gives (almost) the same depth of field. */
  equivalentN: number;
}

/** Phone vs a full-frame camera with the equivalent lens (same framing), focused on the same subject. */
export function compareWithFullFrame(cam: CameraExample, subject: number, fullFrameN: number, background = Number.POSITIVE_INFINITY): DofComparison {
  return {
    phone: depthOfField(cam.realFocal, cam.aperture, cam.sensor, subject, background),
    sameN: depthOfField(cam.eqFocal, cam.aperture, FULL_FRAME, subject, background),
    chosen: depthOfField(cam.eqFocal, fullFrameN, FULL_FRAME, subject, background),
    equivalentN: cam.eqAperture,
  };
}

// ------------------------------------------------------------------ equivalence calculator

export interface Equivalence {
  crop: number;
  eqFocal: number;
  /** N × crop — same depth of field and total light for the same framing (not exposure). */
  eqAperture: number;
  /** Angles of view (radians) of a rectilinear lens focused at ∞. */
  aovDiagonal: number;
  aovHorizontal: number;
  aovVertical: number;
  /** Sensor area in mm². */
  area: number;
  /** Total light vs full frame at the same f-number, shutter speed and framing: 1 / crop². */
  lightVsFullFrame: number;
}

export function equivalence(sensor: SensorSize, f: number, N: number): Equivalence {
  const crop = cropFactor(sensor);
  return {
    crop,
    eqFocal: equivalentFocalLength(f, crop),
    eqAperture: equivalentAperture(N, crop),
    aovDiagonal: angleOfView(diagonal(sensor), f),
    aovHorizontal: angleOfView(sensor.width, f),
    aovVertical: angleOfView(sensor.height, f),
    area: sensor.width * sensor.height,
    lightVsFullFrame: 1 / (crop * crop),
  };
}

// ------------------------------------------------------------------ sensor formats

export interface FormatEntry {
  id: string;
  /** Display name, e.g. "APS-C" or '1/1.3"'. */
  name: string;
  kind: 'camera' | 'phone';
  sensor: SensorSize;
  /** Size derived from an optical format (the inch type is a rounded legacy name → "≈"). */
  approx: boolean;
  crop: number;
  diagonal: number;
  area: number;
  /** Phone cameras in the data that use the format, e.g. "Pixel 11 Pro / Pro XL · main". */
  usedBy: string[];
}

const ROLE_TEXT: Record<PhoneCameraRole, string> = {
  main: 'main',
  'ultra-wide': 'ultra-wide',
  telephoto: 'telephoto',
  periscope: 'periscope telephoto',
  front: 'front',
};

export function cameraRoleText(c: Pick<PhoneCamera, 'role' | 'opticalZoom'>): string {
  const base = ROLE_TEXT[c.role];
  return (c.role === 'telephoto' || c.role === 'periscope') && c.opticalZoom ? `${c.opticalZoom}× ${base}` : base;
}

/** Normalises an optical-format string for grouping: ‘1/1.3”’ → '1/1.3"'. */
export function normalizeFormat(s: string): string {
  return s.replace(/[”″]/g, '"').replace(/\s+/g, '');
}

function entry(id: string, name: string, kind: FormatEntry['kind'], sensor: SensorSize, approx: boolean, usedBy: string[] = []): FormatEntry {
  return { id, name, kind, sensor, approx, crop: cropFactor(sensor), diagonal: diagonal(sensor), area: sensor.width * sensor.height, usedBy };
}

/** Camera formats plus every phone optical format in the data, largest first. */
export function sensorFormats(phones: readonly PhoneData[]): FormatEntry[] {
  const list: FormatEntry[] = [
    entry('full-frame', 'Full frame', 'camera', FORMAT_SIZES['full-frame'], false),
    entry('aps-c', 'APS-C', 'camera', FORMAT_SIZES['aps-c'], false),
    entry('micro-four-thirds', 'Micro Four Thirds', 'camera', FORMAT_SIZES['micro-four-thirds'], false),
    entry('1-inch', '1-inch type', 'camera', ONE_INCH_TYPE, false),
  ];
  const phoneFormats = new Map<string, FormatEntry>();
  for (const p of phones) {
    for (const c of p.cameras) {
      if (!c.sensorFormat) continue;
      const name = normalizeFormat(c.sensorFormat);
      const sensor = sensorFromOpticalFormat(name);
      if (!sensor) continue;
      let e = phoneFormats.get(name);
      if (!e) {
        e = entry(`phone-${name.replace(/[^\d.]+/g, '-').replace(/^-|-$/g, '')}`, name, 'phone', sensor, true);
        phoneFormats.set(name, e);
      }
      e.usedBy.push(`${p.name} · ${cameraRoleText(c)}`);
    }
  }
  return [...list, ...phoneFormats.values()].sort((a, b) => b.diagonal - a.diagonal);
}

// ------------------------------------------------------------------ periscope

export interface PeriscopeNumbers {
  /** Lens-to-sensor length, ≈ the focal length for a simple telephoto (approximate). */
  track: number;
  /** Entrance-pupil diameter f/N. */
  pupil: number;
  /** How far a straight (unfolded) lens would stick out of a phone of the given thickness. */
  overhang: number;
}

export function periscopeNumbers(cam: CameraExample, thickness = TYPICAL_PHONE_THICKNESS): PeriscopeNumbers {
  const track = cam.realFocal;
  return { track, pupil: cam.realFocal / cam.aperture, overhang: Math.max(0, track - thickness) };
}

// ------------------------------------------------------------------ display helpers

/** Rounds to a readable number of significant digits (≥ 2 decimals below 10). */
export function fmtNum(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '∞';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(Math.max(0, digits - 1));
  return v.toFixed(digits);
}
