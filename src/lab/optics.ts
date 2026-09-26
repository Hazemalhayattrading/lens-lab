import { SUBJECTS, type SubjectId } from '../optics/config';
import { cocAt, lensState, maxApertureAtZoom, minApertureAtZoom, type LensState } from '../optics/lensModel';
import type { LabLens } from './labLens';

export type Sharpness = 'sharp' | 'soft' | 'blurred';

export interface SubjectOptics {
  id: SubjectId;
  /** mm from the focal plane (∞ for the mountains). */
  distance: number;
  /** Signed blur-disc diameter on the sensor, mm (negative = nearer than the plane of focus). */
  cocSigned: number;
  coc: number;
  /** CoC relative to the acceptable limit c. */
  cocRatio: number;
  sharpness: Sharpness;
  /** Where this subject's image forms relative to the sensor, mm (+ = behind the sensor). */
  imageOffset: number;
  /** Closer than the lens can focus (at this zoom position). */
  tooClose: boolean;
  /** Inside the frame (set by the scene, which knows where the subject is). */
  inFrame: boolean;
}

export interface OpticsFrame extends LensState {
  lens: LabLens;
  subjects: SubjectOptics[];
  /** Widest / smallest aperture available at this zoom position. */
  maxApertureNow: number;
  minApertureNow: number;
  /** Focus-ring position as a fraction of its throw (0 = ∞, 1 = closest focus). */
  ringFraction: number;
}

export function classifySharpness(cocRatio: number): Sharpness {
  if (cocRatio <= 1) return 'sharp';
  if (cocRatio <= 3) return 'soft';
  return 'blurred';
}

/** Everything the lab needs to know for lens `lens` at zoom z, focus distance T (mm) and f-number N. */
export function computeFrame(lens: LabLens, zoom: number, T: number, N: number): OpticsFrame {
  const s = lensState(lens.physics, zoom, T, N);
  const fe = s.effectiveFocal;
  const subjects = SUBJECTS.map((subject): SubjectOptics => {
    const cocSigned = cocAt(s, subject.distance);
    const coc = Math.abs(cocSigned);
    let imageOffset: number;
    if (!Number.isFinite(subject.distance)) {
      imageOffset = fe - s.imageDistance;
    } else {
      const ud = subject.distance - s.imageDistance;
      imageOffset = ud <= fe ? Number.POSITIVE_INFINITY : (fe * ud) / (ud - fe) - s.imageDistance;
    }
    return {
      id: subject.id,
      distance: subject.distance,
      cocSigned,
      coc,
      cocRatio: coc / s.coc,
      sharpness: classifySharpness(coc / s.coc),
      imageOffset,
      tooClose: subject.distance < s.curve.mfd * 0.999,
      inFrame: true,
    };
  });
  return {
    ...s,
    lens,
    subjects,
    maxApertureNow: maxApertureAtZoom(lens.physics, zoom),
    minApertureNow: minApertureAtZoom(lens.physics, zoom),
    ringFraction: s.curve.mMax > 0 ? Math.min(1, s.magnification / s.curve.mMax) : 0,
  };
}
