import * as THREE from 'three';
import { createNoise2D, fbm2, rng } from '../../util/noise';
import { LAYER_SENSOR_ONLY, OPTICAL_CENTER_X } from '../layout';
import { DIORAMA, GROUND_Y, groundColor, lakeMask, sampleTerrain } from './terrain';
import { buildTrees, type TreePlacement } from './trees';

/**
 * The world beyond the diorama, rendered only by the sensor camera (layer LAYER_SENSOR_ONLY): the
 * bench model is sized for a ~44° view, but a 10–16 mm lens sees ±50–60°. The same terrain function
 * continues outwards (so the seam is invisible), then rolls into forested hills and distant ranges.
 * In the orbit view it is hidden — the bench stays a tidy model.
 */
const nFar = createNoise2D(404);
const nRange = createNoise2D(505);

function insideFootprint(X: number, Z: number, margin: number): boolean {
  return X > DIORAMA.xFront + margin && X < DIORAMA.xBack - margin && Math.abs(Z) < DIORAMA.halfWidthAt(X) - margin;
}

function height(X: number, Z: number): { h: number; far: number } {
  const r = Math.hypot(X, Z);
  const near = sampleTerrain(X, Z).h;
  // beyond ~11 units: rolling hills, then mountain ranges on the horizon
  const far = THREE.MathUtils.smoothstep(r, 8, 16);
  let h = near;
  if (far > 0) {
    const rolling = 0.1 + fbm2(nFar, X * 0.12, Z * 0.12, 4) * 0.35 + r * 0.012;
    const ridges = Math.pow(Math.max(0, fbm2(nRange, X * 0.05 + 7, Z * 0.05, 5) * 0.5 + 0.55), 2.2);
    const range = THREE.MathUtils.smoothstep(r, 28, 50) * ridges * r * 0.085;
    h = THREE.MathUtils.lerp(near, rolling + range, far);
  }
  return { h, far };
}

export function buildWideWorld(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wide-world';
  const RINGS = 90;
  const SEG = 150;
  const R0 = 0.6;
  const R1 = 75;
  const A = THREE.MathUtils.degToRad(88);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const inside: boolean[] = [];
  const col = new THREE.Color();
  const snow = new THREE.Color('#e9eef5');
  const forest = new THREE.Color('#223a24');
  for (let i = 0; i <= RINGS; i++) {
    const r = R0 * Math.pow(R1 / R0, i / RINGS);
    for (let j = 0; j <= SEG; j++) {
      const a = -A + (2 * A * j) / SEG;
      const X = r * Math.cos(a);
      const Z = r * Math.sin(a);
      const { h, far } = height(X, Z);
      const lake = lakeMask(X, Z);
      // tuck under the diorama terrain near its edge so the two never z-fight
      const tuck = insideFootprint(X, Z, -0.05) ? 0.012 : 0;
      positions.push(OPTICAL_CENTER_X + X, GROUND_Y + h - tuck - lake * 0.02, Z);
      const s = sampleTerrain(X, Z);
      groundColor(X, Z, { ...s, h }, col);
      if (far > 0) {
        col.lerp(forest, far * 0.55);
        col.lerp(snow, THREE.MathUtils.smoothstep(h, r * 0.05 + 1.2, r * 0.05 + 2.2) * far);
      }
      colors.push(col.r, col.g, col.b);
      inside.push(insideFootprint(X, Z, 0.14));
    }
  }
  const W = SEG + 1;
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * W + j;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      if (inside[a] && inside[b] && inside[c] && inside[d]) continue;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  ground.name = 'wide-ground';
  group.add(ground);

  // forests around the diorama
  const random = rng(8080);
  const trees: TreePlacement[] = [];
  let guard = 0;
  while (trees.length < 150 && guard++ < 4000) {
    const r = 4.2 + Math.pow(random(), 1.5) * 15;
    const a = (random() * 2 - 1) * THREE.MathUtils.degToRad(80);
    const X = r * Math.cos(a);
    const Z = r * Math.sin(a);
    if (insideFootprint(X, Z, -0.25)) continue;
    // keep the lens' central view (±32°) clear until well behind the light-box
    if (Math.abs(a) < THREE.MathUtils.degToRad(32) && r < 11.5) continue;
    const s = sampleTerrain(X, Z);
    if (s.lake > 0.05 || s.mountain > 0.5) continue;
    const { h } = height(X, Z);
    const size = 0.7 + random() * 0.8 + r * 0.02;
    const kind = random() < 0.85 ? 'pine' : 'birch';
    trees.push({ x: OPTICAL_CENTER_X + X, y: GROUND_Y + h - 0.02, z: Z, height: size, kind, hue: kind === 'birch' ? 0.06 + random() * 0.05 : (random() - 0.5) * 0.04 });
  }
  group.add(buildTrees(trees));

  group.traverse((o) => o.layers.set(LAYER_SENSOR_ONLY));
  return group;
}
