/**
 * Geometry of the periscope explainer: the same lens (track length ≈ focal length) laid out straight,
 * folded once by a 45° prism, or folded four times (a tetraprism-style path). Side section of a phone
 * lying on its screen: x runs along the phone's length, y runs down into the phone from its back
 * (y = 0 is the back glass the camera looks out of, y = thickness is the screen). Light arrives from
 * above (y < 0) travelling +y. All lengths in mm.
 *
 * Rays are traced exactly: flat mirrors reflect (d' = d − 2(d·n)n) and the lens is ideal, sending every
 * ray of the parallel beam towards its focus one track length down the (unfolded) axis. Because
 * reflections are isometries, the folded beam still converges on the sensor and the chief ray still
 * travels exactly one track length from the lens to the sensor.
 */

export interface Pt {
  x: number;
  y: number;
}

export type FoldMode = 'straight' | 'prism' | 'tetra';

export interface FoldInput {
  /** Lens → sensor path length (≈ focal length for a simple telephoto). */
  track: number;
  /** Entrance-pupil (beam) diameter. */
  pupil: number;
  /** Phone body thickness. */
  thickness: number;
  /** Sensor extent drawn in the section (mm). */
  sensorSize: number;
}

export interface LensElement {
  center: Pt;
  /** Unit vector along the optical axis. */
  axis: Pt;
  /** Clear aperture (diameter). */
  width: number;
  thickness: number;
  kind: 'pos' | 'neg';
}

export interface Mirror {
  /** Reflection point of the chief ray. */
  at: Pt;
  a: Pt;
  b: Pt;
}

export interface FoldLayout {
  mode: FoldMode;
  /** Chief ray from above the phone to the sensor centre. */
  chief: Pt[];
  /** Both marginal rays of the beam (same vertex count as the chief ray). */
  edges: [Pt[], Pt[]];
  /** Index of the lens vertex in the ray polylines. */
  lensIndex: number;
  lensCenter: Pt;
  elements: LensElement[];
  mirrors: Mirror[];
  /** Glass outline of the prism (null when there is none). */
  prism: Pt[] | null;
  sensor: { center: Pt; along: Pt; size: number };
  /** Chief-ray length from the lens to the sensor (= track). */
  pathLength: number;
  /** Bounding box of the optics (lens, prism, sensor), for the "module size" readout. */
  module: { minX: number; maxX: number; minY: number; maxY: number };
}

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const norm = (a: Pt): Pt => mul(a, 1 / Math.hypot(a.x, a.y));
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });

type Surface =
  | { kind: 'mirror'; at: Pt; n: Pt }
  | { kind: 'lens'; at: Pt; n: Pt; focus: Pt }
  | { kind: 'sensor'; at: Pt; n: Pt };

/** Traces a ray through the ordered surfaces; returns the polyline (start + one vertex per surface). */
function trace(p0: Pt, d0: Pt, surfaces: Surface[]): Pt[] {
  const pts = [p0];
  let p = p0;
  let d = d0;
  for (const s of surfaces) {
    const t = dot(sub(s.at, p), s.n) / dot(d, s.n);
    p = add(p, mul(d, t));
    pts.push(p);
    if (s.kind === 'mirror') d = sub(d, mul(s.n, 2 * dot(d, s.n)));
    else if (s.kind === 'lens') d = norm(sub(s.focus, p));
  }
  return pts;
}

/** Mirror whose normal bisects the incoming and outgoing directions. */
function mirrorAt(at: Pt, dIn: Pt, dOut: Pt): Surface {
  return { kind: 'mirror', at, n: norm(sub(dOut, dIn)) };
}

/** Polyline length. */
export function polylineLength(pts: readonly Pt[], from = 0): number {
  let L = 0;
  for (let i = from + 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** Point at arc length s along a polyline (clamped). */
export function pointAt(pts: readonly Pt[], s: number): Pt {
  let left = Math.max(0, s);
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (left <= seg || i === pts.length - 1) {
      const t = seg > 0 ? Math.min(1, left / seg) : 0;
      return add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), t));
    }
    left -= seg;
  }
  return pts[pts.length - 1];
}

/** Height above the back glass where incoming rays start. */
export const RAY_START = -4.5;

export function foldLayout(mode: FoldMode, input: FoldInput): FoldLayout {
  const { track, pupil, thickness: T, sensorSize } = input;
  const w = pupil / 2;
  const down: Pt = { x: 0, y: 1 };
  const right: Pt = { x: 1, y: 0 };
  const up: Pt = { x: 0, y: -1 };
  const surfaces: Surface[] = [];
  const elements: LensElement[] = [];
  let prism: Pt[] | null = null;
  let lensCenter: Pt;
  let sensorAlong: Pt;

  const lensGroup = (c: Pt, axis: Pt, offsets: number[], kinds: LensElement['kind'][], width: number) => {
    offsets.forEach((o, i) => elements.push({ center: add(c, mul(axis, o)), axis, width: width * (kinds[i] === 'neg' ? 0.9 : 1), thickness: kinds[i] === 'neg' ? 0.42 : 0.62, kind: kinds[i] }));
  };

  if (mode === 'straight') {
    const yl = 1.3;
    lensCenter = { x: 0, y: yl };
    surfaces.push({ kind: 'lens', at: lensCenter, n: down, focus: { x: 0, y: yl + track } });
    surfaces.push({ kind: 'sensor', at: { x: 0, y: yl + track }, n: down });
    lensGroup(lensCenter, down, [-0.45, 0.35, 1.3], ['pos', 'pos', 'neg'], pupil);
    sensorAlong = right;
  } else if (mode === 'prism') {
    // right-angle prism under the entrance window, then the lens group lying along the phone
    const yc = T / 2;
    const s = Math.min(w + 0.3, yc - 0.15);
    prism = [
      { x: -s, y: yc - s },
      { x: s, y: yc - s },
      { x: s, y: yc + s },
    ];
    surfaces.push(mirrorAt({ x: 0, y: yc }, down, right));
    lensCenter = { x: s + 0.9, y: yc };
    surfaces.push({ kind: 'lens', at: lensCenter, n: right, focus: { x: lensCenter.x + track, y: yc } });
    surfaces.push({ kind: 'sensor', at: { x: lensCenter.x + track, y: yc }, n: right });
    lensGroup(lensCenter, right, [-0.35, 0.45, 1.4], ['pos', 'pos', 'neg'], Math.min(pupil, 2 * (yc - 0.15)));
    sensorAlong = up;
  } else {
    // lens group under the entrance window, then four reflections: down → right → up → right → down
    const yl = 1.3;
    const ys = T - 0.8;
    const hMin = Math.max(2, 0.9 * w);
    const g = Math.max(0.8, Math.min(3.6, (track - 2 * hMin - (ys - yl)) / 2));
    const c = (yl + ys) / 2 + 0.1;
    const yt = c - g / 2;
    const yb = c + g / 2;
    const h = Math.max(0.5, (track - (yb - yl) - (yb - yt) - (ys - yt)) / 2);
    lensCenter = { x: 0, y: yl };
    const R1 = { x: 0, y: yb };
    const R2 = { x: h, y: yb };
    const R3 = { x: h, y: yt };
    const R4 = { x: 2 * h, y: yt };
    surfaces.push({ kind: 'lens', at: lensCenter, n: down, focus: { x: 0, y: yl + track } });
    surfaces.push(mirrorAt(R1, down, right), mirrorAt(R2, right, up), mirrorAt(R3, up, right), mirrorAt(R4, right, down));
    surfaces.push({ kind: 'sensor', at: { x: 2 * h, y: ys }, n: down });
    lensGroup(lensCenter, down, [-0.4, 0.3], ['pos', 'neg'], pupil);
    const m = 0.5;
    const cham = Math.min(g / 2 + m, 1.6);
    const x0 = -Math.min(w * 0.7, 1.6) - m;
    const x1 = 2 * h + Math.min(w * 0.4, 1.2) + m;
    const top = yt - m;
    const bot = yb + m;
    prism = [
      { x: x0, y: top },
      { x: x1 - cham, y: top },
      { x: x1, y: top + cham },
      { x: x1, y: bot },
      { x: x0 + cham, y: bot },
      { x: x0, y: bot - cham },
    ];
    sensorAlong = right;
  }

  const start = (dx: number): Pt => ({ x: dx, y: RAY_START });
  const chief = trace(start(0), down, surfaces);
  const edges: [Pt[], Pt[]] = [trace(start(-w), down, surfaces), trace(start(w), down, surfaces)];
  const lensIndex = surfaces.findIndex((s) => s.kind === 'lens') + 1;

  const mirrors: Mirror[] = [];
  surfaces.forEach((s, i) => {
    if (s.kind !== 'mirror') return;
    const at = chief[i + 1];
    const e0 = edges[0][i + 1];
    const e1 = edges[1][i + 1];
    const along = perp(s.n);
    const reach = Math.max(Math.abs(dot(sub(e0, at), along)), Math.abs(dot(sub(e1, at), along))) + 0.35;
    mirrors.push({ at, a: add(at, mul(along, -reach)), b: add(at, mul(along, reach)) });
  });

  const sensorCenter = chief[chief.length - 1];
  const pts: Pt[] = [...chief.slice(lensIndex), ...(prism ?? [])];
  for (const e of elements) {
    const side = mul(perp(e.axis), e.width / 2);
    pts.push(add(e.center, side), sub(e.center, side));
  }
  const sHalf = mul(sensorAlong, sensorSize / 2);
  pts.push(add(sensorCenter, sHalf), sub(sensorCenter, sHalf));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);

  return {
    mode,
    chief,
    edges,
    lensIndex,
    lensCenter,
    elements,
    mirrors,
    prism,
    sensor: { center: sensorCenter, along: sensorAlong, size: sensorSize },
    pathLength: polylineLength(chief, lensIndex),
    module: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
  };
}
