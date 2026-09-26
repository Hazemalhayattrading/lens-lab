/**
 * Phase 1 teaching lens (Lens Lab 50 mm f/2, unit focusing on a helicoid). All lengths in mm.
 * Its helicoid maths (helicoid.ts) and Phase 1 tests measure distances from the lens.
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

export type SubjectId = 'flower' | 'cabin' | 'trees' | 'hill' | 'bird' | 'tower' | 'peaks';

export interface Subject {
  id: SubjectId;
  /** Distance of the subject's focus point, mm from the focal plane (∞ for the far mountains). */
  distance: number;
  /** Colour of its light rays, labels and UI dots. */
  color: string;
}

/** The depth ladder of the diorama: a subject for every kind of lens, from macro to landscape. */
export const SUBJECTS: readonly Subject[] = [
  { id: 'flower', distance: 300, color: '#ff8ad8' },
  { id: 'cabin', distance: 800, color: '#ffb04f' },
  { id: 'trees', distance: 2000, color: '#5dffa2' },
  { id: 'hill', distance: 8000, color: '#d6b98c' },
  { id: 'bird', distance: 30000, color: '#ffe066' },
  { id: 'tower', distance: 200000, color: '#ff7a6b' },
  { id: 'peaks', distance: Number.POSITIVE_INFINITY, color: '#8fb0ff' },
];

export const subjectById = (id: SubjectId): Subject => SUBJECTS.find((s) => s.id === id)!;
