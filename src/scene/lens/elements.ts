import * as THREE from 'three';
import { revolve } from './revolve';

/**
 * Visual prescription of the six glass elements (world units, h = axial position relative to
 * the iris, + towards the subject). Radii are signed: r1 > 0 means the front surface is convex
 * towards the subject, r2 > 0 means the rear surface is convex towards the sensor.
 * Layout follows a classic double-Gauss ("Planar") 50 mm f/2.
 */
export interface ElementSpec {
  id: string;
  name: string;
  glass: string;
  /** Front vertex, assembled. */
  hFront: number;
  /** Front vertex, exploded. */
  hFrontExploded: number;
  thickness: number;
  r1: number;
  r2: number;
  /** Clear (semi-)aperture radius. */
  radius: number;
  ior: number;
  tint: string;
}

export const ELEMENTS: ElementSpec[] = [
  { id: 'L1', name: 'Positive meniscus', glass: 'Crown · N-SK16', hFront: 1.18, hFrontExploded: 1.78, thickness: 0.3, r1: 2.0, r2: -6.0, radius: 0.98, ior: 1.62, tint: '#f2fffb' },
  { id: 'L2', name: 'Positive meniscus', glass: 'Lanthanum crown · N-LAK9', hFront: 0.84, hFrontExploded: 1.22, thickness: 0.3, r1: 1.5, r2: -4.5, radius: 0.84, ior: 1.69, tint: '#f6fff4' },
  { id: 'L3', name: 'Negative meniscus', glass: 'Dense flint · SF5', hFront: 0.5, hFrontExploded: 0.72, thickness: 0.1, r1: 3.5, r2: -1.05, radius: 0.76, ior: 1.67, tint: '#fffbee' },
  { id: 'L4', name: 'Negative meniscus', glass: 'Dense flint · SF5', hFront: -0.34, hFrontExploded: -0.5, thickness: 0.1, r1: -1.0, r2: 3.2, radius: 0.72, ior: 1.67, tint: '#fffbee' },
  { id: 'L5', name: 'Positive meniscus (cemented)', glass: 'Lanthanum crown · N-LAK9', hFront: -0.44, hFrontExploded: -0.6, thickness: 0.3, r1: -3.2, r2: 1.6, radius: 0.78, ior: 1.69, tint: '#f6fff4' },
  { id: 'L6', name: 'Biconvex', glass: 'Crown · N-SK16', hFront: -0.8, hFrontExploded: -1.28, thickness: 0.38, r1: 3.0, r2: 2.2, radius: 0.84, ior: 1.62, tint: '#f2fffb' },
];

/** Sag of a spherical surface of signed radius R at height r (positive for convex-forward). */
export function sag(R: number, r: number): number {
  if (!Number.isFinite(R)) return 0;
  const R2 = R * R;
  const rr = Math.min(r * r, R2 * 0.999);
  return R - Math.sign(R) * Math.sqrt(R2 - rr);
}

/** Axial position of the element's front surface at height r (element-local, front vertex = 0). */
export function frontSurfaceH(e: ElementSpec, r: number): number {
  return -sag(e.r1, r);
}

/** Axial position of the element's rear surface at height r (element-local, front vertex = 0). */
export function rearSurfaceH(e: ElementSpec, r: number): number {
  return -e.thickness + sag(e.r2, r);
}

/** Closed CCW cross-section profile (r, h) in element-local coordinates. */
export function elementProfile(e: ElementSpec, steps = 28): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  // rear surface: axis → rim
  for (let i = 0; i <= steps; i++) {
    const r = (i / steps) * e.radius;
    pts.push(new THREE.Vector2(r, rearSurfaceH(e, r)));
  }
  // front surface: rim → axis (edge is implied between the two rim points)
  for (let i = steps; i >= 0; i--) {
    const r = (i / steps) * e.radius;
    pts.push(new THREE.Vector2(r, frontSurfaceH(e, r)));
  }
  return pts;
}

/**
 * Builds the sectioned element: group 0 = optical surfaces + cut faces (glass),
 * group 1 = ground edge (blackened, as on real elements).
 */
export function buildElementGeometry(e: ElementSpec): THREE.BufferGeometry {
  const profile = elementProfile(e);
  // Full (uncut) element so rays always travel through glass; the rim is re-skinned in black.
  return revolve(profile, { segments: 128, phiLength: Math.PI * 2, caps: false, creaseAngle: THREE.MathUtils.degToRad(25) });
}

export function buildElementEdge(e: ElementSpec): THREE.BufferGeometry {
  const hTop = frontSurfaceH(e, e.radius);
  const hBot = rearSurfaceH(e, e.radius);
  const r = e.radius + 0.0015;
  const lathe = new THREE.LatheGeometry([new THREE.Vector2(r, hBot), new THREE.Vector2(r, hTop)], 128, 0, Math.PI * 2);
  lathe.applyMatrix4(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
  return lathe;
}
