import { LENS, SUBJECTS, type SubjectId } from './config';
import { ringAngleForFocus } from './helicoid';
import {
  angleOfView,
  apertureDiameter,
  blurDiameterSigned,
  dofLimits,
  extensionForFocus,
  hyperfocal,
  imageDistance,
  magnification,
} from './thinLens';

export type Sharpness = 'sharp' | 'soft' | 'blurred';

export interface SubjectOptics {
  id: SubjectId;
  distance: number;
  /** Signed CoC diameter, mm (negative = in front of the plane of focus). */
  cocSigned: number;
  coc: number;
  /** Where this subject's image forms, mm behind the lens. */
  imageDistance: number;
  /** Image position relative to the sensor, mm (+ = behind the sensor). */
  focusError: number;
  /** CoC relative to the acceptable limit c. */
  cocRatio: number;
  sharpness: Sharpness;
}

export interface OpticsState {
  focalLength: number;
  fNumber: number;
  focusDistance: number;
  cocLimit: number;
  /** Lens-to-sensor distance, mm. */
  imageDistance: number;
  /** Travel of the focusing group from the ∞ position, mm. */
  extension: number;
  apertureDiameter: number;
  hyperfocal: number;
  near: number;
  far: number;
  depthOfField: number;
  magnification: number;
  fovHorizontal: number;
  fovVertical: number;
  ringAngle: number;
  subjects: SubjectOptics[];
}

export function classifySharpness(cocRatio: number): Sharpness {
  if (cocRatio <= 1) return 'sharp';
  if (cocRatio <= 3) return 'soft';
  return 'blurred';
}

/** Everything the app needs to know about the lens for a focus distance s and f-number N. */
export function computeOptics(focusDistance: number, fNumber: number): OpticsState {
  const f = LENS.focalLength;
  const c = LENS.cocLimit;
  const s = focusDistance;
  const di = imageDistance(f, s);
  const dof = dofLimits(f, fNumber, c, s);

  const subjects = SUBJECTS.map((subject): SubjectOptics => {
    const cocSigned = blurDiameterSigned(f, fNumber, s, subject.distance);
    const coc = Math.abs(cocSigned);
    const subjectImage = imageDistance(f, subject.distance);
    return {
      id: subject.id,
      distance: subject.distance,
      cocSigned,
      coc,
      imageDistance: subjectImage,
      focusError: subjectImage - di,
      cocRatio: coc / c,
      sharpness: classifySharpness(coc / c),
    };
  });

  return {
    focalLength: f,
    fNumber,
    focusDistance: s,
    cocLimit: c,
    imageDistance: di,
    extension: extensionForFocus(f, s),
    apertureDiameter: apertureDiameter(f, fNumber),
    hyperfocal: hyperfocal(f, fNumber, c),
    near: dof.near,
    far: dof.far,
    depthOfField: dof.depth,
    magnification: magnification(f, s),
    fovHorizontal: angleOfView(LENS.sensorWidth, di),
    fovVertical: angleOfView(LENS.sensorHeight, di),
    ringAngle: ringAngleForFocus(s),
    subjects,
  };
}

/** CoC (mm on the sensor) → blur-disc diameter in pixels of an image `widthPx` wide. */
export function cocToPixels(cocMm: number, widthPx: number): number {
  return (cocMm * widthPx) / LENS.sensorWidth;
}
