import * as THREE from 'three';
import { createNoise2D, fbm2 } from '../../util/noise';
import { LAYOUT, OPTICAL_CENTER_X, worldXForDistance } from '../layout';

/**
 * Terrain of the diorama, in "relative" coordinates: X = world x − perspective centre
 * (distance along the axis in world units), Z = world z (+Z is to the right as the lens sees it).
 * Heights are above GROUND_Y.
 *
 * Depth ladder (mm from the focal plane → X): flower 0.3 m, cabin 0.8 m, trees 2 m, rocky hill 8 m,
 * bird on a snag at the lake shore 30 m, lighthouse on a rock in the lake 200 m, mountains ∞.
 */
export const GROUND_Y = LAYOUT.axisY - 0.8;
export const PLINTH_TOP = GROUND_Y - 0.1;

/** Trapezoid footprint following a ~44° field of view (plus margin). */
export const DIORAMA = {
  xFront: LAYOUT.xNearRel - 0.02,
  xBack: LAYOUT.xInfRel + 0.92,
  halfWidthAt(X: number): number {
    return 0.32 + X * 0.405;
  },
};

const rel = (d: number) => worldXForDistance(d) - OPTICAL_CENTER_X;
export const SUBJECT_X = {
  flower: rel(300),
  cabin: rel(800),
  trees: rel(2000),
  hill: rel(8000),
  bird: rel(30000),
  tower: rel(200000),
};

export const CABIN = { x: SUBJECT_X.cabin + 0.26, z: -0.62, rotY: 0 };
export const HILL = { x: SUBJECT_X.hill + 0.22, z: -1.55, height: 0.95 };
/** Lake: ellipse in (X, Z). */
export const LAKE = { x: 8.36, z: 1.32, rx: 0.78, rz: 1.24, level: 0.012 };
/** Dead tree the bird perches on, on the lake's near shore, right on the optical axis. */
export const SNAG = { x: SUBJECT_X.bird + 0.035, z: 0.05 };
/** Rock islet with the lighthouse (≈3° right of the axis). */
export const TOWER = { x: SUBJECT_X.tower, z: SUBJECT_X.tower * Math.tan(THREE.MathUtils.degToRad(3.2)) };
export const PEAKS = [
  { x: 9.56, z: 0.35, h: 2.3, rx: 1.0, rz: 1.9 },
  { x: 9.72, z: -2.05, h: 1.75, rx: 0.9, rz: 1.3 },
  { x: 9.78, z: 2.55, h: 1.55, rx: 0.8, rz: 1.1 },
  { x: 9.4, z: -0.95, h: 1.25, rx: 0.6, rz: 0.8 },
];
export const MAIN_PEAK = PEAKS[0];

const n1 = createNoise2D(21);
const n2 = createNoise2D(57);
const n3 = createNoise2D(93);

function ridged(x: number, y: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let prev = 1;
  for (let i = 0; i < octaves; i++) {
    let v = 1 - Math.abs(n2(x * freq, y * freq));
    v *= v;
    sum += v * amp * prev;
    prev = v;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/** Dirt path from the front of the diorama to the cabin door. */
function pathDistance(X: number, Z: number): number {
  const p0 = new THREE.Vector2(DIORAMA.xFront, 0.42);
  const p1 = new THREE.Vector2(DIORAMA.xFront + 0.75, -0.05);
  const p2 = new THREE.Vector2(CABIN.x - 0.34, CABIN.z + 0.02);
  let best = Infinity;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    best = Math.min(best, Math.hypot(X - (a * p0.x + b * p1.x + c * p2.x), Z - (a * p0.y + b * p1.y + c * p2.y)));
  }
  return best;
}

/** 0 outside the lake, 1 in its middle (smooth shore). */
export function lakeMask(X: number, Z: number): number {
  const d = Math.hypot((X - LAKE.x) / LAKE.rx, (Z - LAKE.z) / LAKE.rz) + n1(X * 3.1, Z * 3.1) * 0.05;
  return 1 - THREE.MathUtils.smoothstep(d, 0.82, 1.0);
}

export interface TerrainSample {
  h: number;
  path: number; // 0..1 path mask
  mountain: number; // 0..1 rock mask
  lake: number; // 0..1
}

export function sampleTerrain(X: number, Z: number): TerrainSample {
  // gentle meadow undulation, rising a little towards the back
  let h = fbm2(n1, X * 0.9, Z * 0.9, 4) * 0.055 + 0.02;
  h += THREE.MathUtils.smoothstep(X, 5.5, 7.4) * 0.04;
  // soft midground knolls
  const knoll = Math.max(0, 1 - Math.hypot((X - 6.65) / 0.9, (Z - 1.95) / 1.1));
  h += knoll * knoll * 0.2;

  // rocky hill at 8 m (left)
  const ridge = ridged(X * 0.95 + 3.1, Z * 0.95 - 1.7);
  const hillCone = Math.max(0, 1 - Math.hypot((X - HILL.x) / 0.95, (Z - HILL.z) / 1.15));
  let rock = Math.pow(hillCone, 1.35) * HILL.height * (0.78 + 0.4 * ridge);

  // far mountain range (∞) and the rising back edge that hides the light-box's lower rim
  for (const p of PEAKS) {
    const c = Math.max(0, 1 - Math.hypot((X - p.x) / p.rx, (Z - p.z) / p.rz));
    rock = Math.max(rock, Math.pow(c, 1.25) * p.h * (0.8 + 0.35 * ridge));
  }
  // only behind the light-box (±22.5°), whose lower rim it hides; beyond it wide lenses see open land
  const az = Math.abs(Math.atan2(Z, Math.max(X, 1e-3)));
  const behindBox = 1 - THREE.MathUtils.smoothstep(az, THREE.MathUtils.degToRad(17), THREE.MathUtils.degToRad(22));
  const backRise = THREE.MathUtils.smoothstep(X, DIORAMA.xBack - 1.35, DIORAMA.xBack) * (0.7 + 0.3 * ridge) * behindBox;
  rock = Math.max(rock, backRise);
  h = Math.max(h, h * 0.4 + rock);

  // flatten the cabin site
  const cabinD = Math.hypot((X - CABIN.x) / 0.62, (Z - CABIN.z) / 0.62);
  h = THREE.MathUtils.lerp(0.02, h, THREE.MathUtils.smoothstep(cabinD, 0.9, 1.4));

  // small mound under the snag
  const mound = Math.max(0, 1 - Math.hypot(X - SNAG.x, Z - SNAG.z) / 0.35);
  h += mound * mound * 0.05;

  // lake basin
  const lake = lakeMask(X, Z);
  h = THREE.MathUtils.lerp(h, LAKE.level - 0.07, lake);

  // carve the path slightly
  const path = 1 - THREE.MathUtils.smoothstep(pathDistance(X, Z), 0.05, 0.11);
  h -= path * 0.012;

  return { h, path, mountain: THREE.MathUtils.clamp(rock / 0.45, 0, 1), lake };
}

export function terrainHeight(X: number, Z: number): number {
  return sampleTerrain(X, Z).h;
}

const C = (hex: string) => new THREE.Color(hex);
const GRASS_A = C('#3d5a2c');
const GRASS_B = C('#58773a');
const GRASS_DRY = C('#7d7743');
const DIRT = C('#8a6a45');
const ROCK = C('#6f6a66');
const ROCK_DARK = C('#4a4644');
const SNOW = C('#eef3f8');
const SAND = C('#9c8a66');
const LAKEBED = C('#2d3b3a');
const SOIL = C('#4a3526');
const SOIL_DARK = C('#2f2219');

/** Colour of the ground at (X, Z) for a sample (shared by the diorama and the wide-angle world). */
export function groundColor(X: number, Z: number, s: TerrainSample, out: THREE.Color): THREE.Color {
  const g = fbm2(n3, X * 2.2, Z * 2.2, 3) * 0.5 + 0.5;
  out.copy(GRASS_A).lerp(GRASS_B, g);
  out.lerp(GRASS_DRY, THREE.MathUtils.smoothstep(fbm2(n1, X * 0.7 + 9, Z * 0.7, 3), 0.1, 0.5) * 0.45);
  if (s.mountain > 0) {
    const rockMix = THREE.MathUtils.smoothstep(s.mountain, 0.05, 0.6);
    const rc = new THREE.Color().copy(ROCK).lerp(ROCK_DARK, n2(X * 6, Z * 6) * 0.5 + 0.5);
    out.lerp(rc, rockMix);
    const snowLine = 1.2 + n1(X * 3, Z * 3) * 0.18;
    out.lerp(SNOW, THREE.MathUtils.smoothstep(s.h, snowLine, snowLine + 0.16));
  }
  if (s.lake > 0) {
    out.lerp(SAND, THREE.MathUtils.smoothstep(s.lake, 0.0, 0.35) * 0.8);
    out.lerp(LAKEBED, THREE.MathUtils.smoothstep(s.lake, 0.35, 0.9));
  }
  out.lerp(DIRT, s.path * 0.9);
  return out;
}

/** Builds the terrain mesh (top surface + soil-cut skirt) with vertex colours. */
export function buildTerrain(): THREE.Mesh {
  const NX = 180;
  const NZ = 120;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const col = new THREE.Color();
  const grid: number[][] = [];

  for (let i = 0; i <= NX; i++) {
    const u = i / NX;
    const X = DIORAMA.xFront + (DIORAMA.xBack - DIORAMA.xFront) * u;
    const hw = DIORAMA.halfWidthAt(X);
    grid[i] = [];
    for (let j = 0; j <= NZ; j++) {
      const Z = -hw + (2 * hw * j) / NZ;
      const s = sampleTerrain(X, Z);
      grid[i][j] = positions.length / 3;
      positions.push(OPTICAL_CENTER_X + X, GROUND_Y + s.h, Z);
      groundColor(X, Z, s, col);
      colors.push(col.r, col.g, col.b);
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ; j++) {
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i + 1][j + 1];
      const d = grid[i][j + 1];
      indices.push(a, d, b, b, d, c);
    }
  }

  // skirt: walk the border and drop walls to the plinth top
  const border: number[] = [];
  for (let i = 0; i <= NX; i++) border.push(grid[i][0]);
  for (let j = 1; j <= NZ; j++) border.push(grid[NX][j]);
  for (let i = NX - 1; i >= 0; i--) border.push(grid[i][NZ]);
  for (let j = NZ - 1; j >= 1; j--) border.push(grid[0][j]);
  const skirtStart = positions.length / 3;
  for (const idx of border) {
    const x = positions[idx * 3];
    const y = positions[idx * 3 + 1];
    const z = positions[idx * 3 + 2];
    positions.push(x, y, z, x, PLINTH_TOP, z);
    const strata = 0.5 + 0.5 * Math.sin(y * 38);
    col.copy(SOIL).lerp(SOIL_DARK, strata * 0.6);
    colors.push(col.r * 1.1, col.g * 1.1, col.b * 1.1, SOIL_DARK.r, SOIL_DARK.g, SOIL_DARK.b);
  }
  for (let k = 0; k < border.length; k++) {
    const a = skirtStart + k * 2;
    const b = skirtStart + ((k + 1) % border.length) * 2;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
