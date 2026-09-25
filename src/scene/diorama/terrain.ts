import * as THREE from 'three';
import { createNoise2D, fbm2 } from '../../util/noise';
import { LAYOUT, OPTICAL_CENTER_X, worldXForDistance } from '../layout';

/**
 * Terrain of the diorama, in "relative" coordinates: X = world x − optical centre
 * (≈ distance along the axis in world units), Z = world z. Heights are above GROUND_Y.
 */
export const GROUND_Y = LAYOUT.axisY - 0.8;
export const PLINTH_TOP = GROUND_Y - 0.1;

/** Trapezoid footprint: it follows the lens' field of view with some margin. */
export const DIORAMA = {
  xFront: LAYOUT.xNearRel - 0.02,
  xBack: LAYOUT.xInfRel + 0.5,
  halfWidthAt(X: number): number {
    // tan(19.8°) ≈ 0.36 (half angle of view at ∞) + margin
    return 0.32 + X * 0.405;
  },
};

const rel = (d: number) => worldXForDistance(d) - OPTICAL_CENTER_X;
export const SUBJECT_X = {
  cabin: rel(800),
  trees: rel(2000),
  mountain: rel(8000),
};

export const CABIN = { x: SUBJECT_X.cabin + 0.26, z: -0.62, rotY: 0 };
export const MOUNTAIN_PEAK = { x: SUBJECT_X.mountain, z: 0.25, height: 2.05 };

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
  // quadratic bezier: front centre → bend → cabin door
  const p0 = new THREE.Vector2(DIORAMA.xFront, 0.35);
  const p1 = new THREE.Vector2(DIORAMA.xFront + 0.45, -0.1);
  const p2 = new THREE.Vector2(CABIN.x - 0.34, CABIN.z + 0.02);
  let best = Infinity;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    const px = a * p0.x + b * p1.x + c * p2.x;
    const pz = a * p0.y + b * p1.y + c * p2.y;
    best = Math.min(best, Math.hypot(X - px, Z - pz));
  }
  return best;
}

export interface TerrainSample {
  h: number;
  path: number; // 0..1 path mask
  mountain: number; // 0..1 mountain mask
}

export function sampleTerrain(X: number, Z: number): TerrainSample {
  // gentle meadow undulation
  let h = fbm2(n1, X * 0.9, Z * 0.9, 4) * 0.06 + 0.02;
  // midground hills
  const hill = Math.max(0, 1 - Math.hypot((X - 5.9) / 1.2, (Z - 1.5) / 1.4));
  h += hill * hill * 0.22;
  const hill2 = Math.max(0, 1 - Math.hypot((X - 6.4) / 1.1, (Z + 1.9) / 1.3));
  h += hill2 * hill2 * 0.3;

  // mountain range at the back
  const dx = (X - MOUNTAIN_PEAK.x) / 1.05;
  const dz = (Z - MOUNTAIN_PEAK.z) / 2.1;
  const r = Math.hypot(dx, dz);
  const cone = Math.max(0, 1 - r);
  const peak2 = Math.max(0, 1 - Math.hypot((X - (MOUNTAIN_PEAK.x + 0.45)) / 0.9, (Z + 1.75) / 1.25));
  const peak3 = Math.max(0, 1 - Math.hypot((X - (MOUNTAIN_PEAK.x + 0.5)) / 0.8, (Z - 2.3) / 1.05));
  const ridge = ridged(X * 0.9 + 3.1, Z * 0.9 - 1.7);
  let mountain = Math.pow(cone, 1.25) * MOUNTAIN_PEAK.height * (0.8 + 0.35 * ridge);
  mountain = Math.max(mountain, Math.pow(peak2, 1.3) * 1.35 * (0.8 + 0.35 * ridge));
  mountain = Math.max(mountain, Math.pow(peak3, 1.3) * 1.0 * (0.8 + 0.35 * ridge));
  // the back of the diorama rises so the backdrop's lower edge is hidden
  const backRise = THREE.MathUtils.smoothstep(X, DIORAMA.xBack - 1.2, DIORAMA.xBack) * (0.55 + 0.25 * ridge);
  mountain = Math.max(mountain, backRise);
  h = Math.max(h, h * 0.4 + mountain);

  // flatten the cabin site
  const cabinD = Math.hypot((X - CABIN.x) / 0.62, (Z - CABIN.z) / 0.62);
  const flat = THREE.MathUtils.smoothstep(cabinD, 0.9, 1.4);
  h = THREE.MathUtils.lerp(0.02, h, flat);

  // carve the path slightly
  const pd = pathDistance(X, Z);
  const path = 1 - THREE.MathUtils.smoothstep(pd, 0.05, 0.11);
  h -= path * 0.012;

  const mountainMask = THREE.MathUtils.clamp(mountain / 0.5, 0, 1);
  return { h, path, mountain: mountainMask };
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
const SOIL = C('#4a3526');
const SOIL_DARK = C('#2f2219');

/** Builds the terrain mesh (top surface + soil-cut skirt) with vertex colours. */
export function buildTerrain(): THREE.Mesh {
  const NX = 150;
  const NZ = 110;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const col = new THREE.Color();
  const grid: number[][] = [];

  const heightAt: number[] = [];
  for (let i = 0; i <= NX; i++) {
    const u = i / NX;
    const X = DIORAMA.xFront + (DIORAMA.xBack - DIORAMA.xFront) * u;
    const hw = DIORAMA.halfWidthAt(X);
    grid[i] = [];
    for (let j = 0; j <= NZ; j++) {
      const v = j / NZ;
      const Z = -hw + 2 * hw * v;
      const s = sampleTerrain(X, Z);
      grid[i][j] = positions.length / 3;
      positions.push(OPTICAL_CENTER_X + X, GROUND_Y + s.h, Z);
      heightAt.push(s.h);
      // colour
      const g = fbm2(n3, X * 2.2, Z * 2.2, 3) * 0.5 + 0.5;
      col.copy(GRASS_A).lerp(GRASS_B, g);
      col.lerp(GRASS_DRY, THREE.MathUtils.smoothstep(fbm2(n1, X * 0.7 + 9, Z * 0.7, 3), 0.1, 0.5) * 0.45);
      if (s.mountain > 0) {
        const rockMix = THREE.MathUtils.smoothstep(s.mountain, 0.05, 0.6);
        const rc = new THREE.Color().copy(ROCK).lerp(ROCK_DARK, n2(X * 6, Z * 6) * 0.5 + 0.5);
        col.lerp(rc, rockMix);
        const snowLine = 1.15 + n1(X * 3, Z * 3) * 0.18;
        const snow = THREE.MathUtils.smoothstep(s.h, snowLine, snowLine + 0.16);
        col.lerp(SNOW, snow);
      }
      col.lerp(DIRT, s.path * 0.9);
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
  for (let k = 0; k < border.length; k++) {
    const idx = border[k];
    const x = positions[idx * 3];
    const y = positions[idx * 3 + 1];
    const z = positions[idx * 3 + 2];
    // top edge (duplicate for hard crease) + bottom edge
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
