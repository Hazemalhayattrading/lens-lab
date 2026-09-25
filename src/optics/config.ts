/**
 * Physical description of the simulated camera. All lengths in millimetres.
 */
export const LENS = {
  /** Effective focal length of the whole lens system. */
  focalLength: 50,
  /** Full-frame sensor. */
  sensorWidth: 36,
  sensorHeight: 24,
  /** Acceptable circle of confusion for full frame (≈ diagonal / 1442). */
  cocLimit: 0.03,
  /** Closest focus distance (measured from the lens). */
  minFocus: 300,
  /** Focus-ring rotation from ∞ to the closest focus distance. */
  ringThrowDeg: 240,
  /** Selectable apertures (f-numbers). */
  apertures: [2, 5.6, 16] as const,
  /** Iris blade count. */
  bladeCount: 9,
} as const;

export type SubjectId = 'cabin' | 'trees' | 'mountain';

export interface Subject {
  id: SubjectId;
  label: string;
  role: 'Foreground' | 'Middle' | 'Background';
  /** Distance of the subject's focus point from the lens, mm. */
  distance: number;
}

/** The three diorama subjects and the distances the lens "sees" them at. */
export const SUBJECTS: readonly Subject[] = [
  { id: 'cabin', label: 'Cabin', role: 'Foreground', distance: 800 },
  { id: 'trees', label: 'Trees', role: 'Middle', distance: 2000 },
  { id: 'mountain', label: 'Mountain', role: 'Background', distance: 8000 },
];
