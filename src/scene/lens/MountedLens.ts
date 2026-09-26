import type * as THREE from 'three';
import type { RingTarget } from '../../interaction/FocusRingDrag';
import type { LabLens } from '../../lab/labLens';
import type { OpticsFrame } from '../../lab/optics';
import type { RayLens } from '../rays/RayBundles';

/** A label the app places next to a part of the lens (special glass, moving groups). */
export interface LensCallout {
  id: string;
  html: string;
  color: string;
  world: THREE.Vector3;
  /** Shown only in the exploded view. */
  explodedOnly: boolean;
}

/** What the app needs from whichever lens is mounted on the bench (teaching lens or a library lens). */
export interface MountedLens extends RayLens, RingTarget {
  readonly lens: LabLens;
  readonly group: THREE.Group;
  /** World X of the front of the lens (where the field-of-view cone starts). */
  readonly frontX: number;
  /** The zoom ring as a drag target (zooms only). */
  readonly zoomRing: RingTarget | null;
  /** Rotation of the zoom ring from the wide to the tele end (radians). */
  readonly zoomThrow: number;
  /** Where the bench cradle supports the barrel (world X, barrel radius). */
  readonly support: { x: number; radius: number };
  /** Pose the lens for the current optics (focus, zoom, aperture) and exploded amount (0…1). */
  apply(o: OpticsFrame, explode: number): void;
  /** Anchor of the "drag the focus ring" hint. */
  ringHintPoint(out: THREE.Vector3): THREE.Vector3;
  /** Anchor of the iris label in the exploded view. */
  irisLabelPoint(out: THREE.Vector3): THREE.Vector3;
  callouts(): readonly LensCallout[];
  dispose(): void;
}
