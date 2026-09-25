import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Revolves (r, h) profiles around the optical axis (world +X after orientation) and closes the
 * cut faces, producing *solid* sectioned parts: the upper-front quadrant (y > 0, z > 0) is
 * removed so the inside of the lens is visible, like a museum cutaway.
 *
 * Profile convention: a closed polygon in (r, h) traversed counter-clockwise (r to the right,
 * h up, h = axial position towards the subject). Points on the axis use r = 0.
 */

export const CUT_PHI_START = 0;
export const CUT_PHI_LENGTH = Math.PI * 1.5;

export interface RevolveOptions {
  segments?: number;
  phiStart?: number;
  phiLength?: number;
  /** Close the two cut faces with flat caps. */
  caps?: boolean;
  /** Corners sharper than this (radians) get split normals. */
  creaseAngle?: number;
  /** Multi-material groups: 0 = surface of revolution, 1 = caps. */
  groups?: boolean;
}

const ORIENT = new THREE.Matrix4().makeRotationZ(-Math.PI / 2); // lathe +Y → world +X

/** Split a closed polygon into open polylines at sharp corners. */
function splitAtCreases(pts: THREE.Vector2[], crease: number): THREE.Vector2[][] {
  const n = pts.length;
  const sharp: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const d1 = new THREE.Vector2().subVectors(b, a).normalize();
    const d2 = new THREE.Vector2().subVectors(c, b).normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
    // points on the axis always split (normals there are ill-defined for smoothing)
    sharp.push(angle > crease || b.x <= 1e-6);
  }
  const start = sharp.indexOf(true);
  if (start < 0) return [[...pts, pts[0]]];
  const out: THREE.Vector2[][] = [];
  let cur: THREE.Vector2[] = [pts[start]];
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    cur.push(pts[i]);
    if (sharp[i]) {
      out.push(cur);
      cur = [pts[i]];
    }
  }
  return out;
}

function capGeometry(profile: THREE.Vector2[], phi: number, outward: THREE.Vector3): THREE.BufferGeometry {
  const contour = profile.map((p) => new THREE.Vector2(p.x, p.y));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const v = contour.map((p) => new THREE.Vector3(p.x * sin, p.y, p.x * cos));
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (const f of faces) {
    let [a, b, c] = f;
    ab.subVectors(v[b], v[a]);
    ac.subVectors(v[c], v[a]);
    if (ab.cross(ac).dot(outward) < 0) [b, c] = [c, b];
    for (const idx of [a, b, c]) {
      positions.push(v[idx].x, v[idx].y, v[idx].z);
      normals.push(outward.x, outward.y, outward.z);
      uvs.push(contour[idx].x, contour[idx].y);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

export function revolve(profile: THREE.Vector2[], opts: RevolveOptions = {}): THREE.BufferGeometry {
  const segments = opts.segments ?? 96;
  const phiStart = opts.phiStart ?? CUT_PHI_START;
  const phiLength = opts.phiLength ?? CUT_PHI_LENGTH;
  const caps = opts.caps ?? phiLength < Math.PI * 2 - 1e-4;
  const crease = opts.creaseAngle ?? THREE.MathUtils.degToRad(35);

  const parts: THREE.BufferGeometry[] = [];
  for (const strip of splitAtCreases(profile, crease)) {
    if (strip.length < 2) continue;
    const lathe = new THREE.LatheGeometry(strip, segments, phiStart, phiLength);
    parts.push(lathe.index ? lathe.toNonIndexed() : lathe);
  }
  let surface = mergeGeometries(parts, false)!;

  if (!caps) {
    surface.applyMatrix4(ORIENT);
    return surface;
  }
  // outward normals (lathe space): at phiStart towards decreasing phi, at phiEnd towards increasing phi
  const tStart = new THREE.Vector3(Math.cos(phiStart), 0, -Math.sin(phiStart)).negate();
  const phiEnd = phiStart + phiLength;
  const tEnd = new THREE.Vector3(Math.cos(phiEnd), 0, -Math.sin(phiEnd));
  const capA = capGeometry(profile, phiStart, tStart);
  const capB = capGeometry(profile, phiEnd, tEnd);
  const caps2 = mergeGeometries([capA, capB], false)!;
  const merged = mergeGeometries([surface, caps2], opts.groups ?? false)!;
  merged.applyMatrix4(ORIENT);
  surface.dispose();
  return merged;
}

/** Rectangle profile helper (CCW) for tubes/rings: r ∈ [r0, r1], h ∈ [h0, h1]. */
export function ringProfile(r0: number, r1: number, h0: number, h1: number, chamfer = 0): THREE.Vector2[] {
  if (chamfer <= 0) {
    return [new THREE.Vector2(r0, h0), new THREE.Vector2(r1, h0), new THREE.Vector2(r1, h1), new THREE.Vector2(r0, h1)];
  }
  const c = Math.min(chamfer, (r1 - r0) / 3, (h1 - h0) / 3);
  return [
    new THREE.Vector2(r0, h0),
    new THREE.Vector2(r1 - c, h0),
    new THREE.Vector2(r1, h0 + c),
    new THREE.Vector2(r1, h1 - c),
    new THREE.Vector2(r1 - c, h1),
    new THREE.Vector2(r0, h1),
  ];
}
