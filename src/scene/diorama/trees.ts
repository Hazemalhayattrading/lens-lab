import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../util/noise';

function colorize(geo: THREE.BufferGeometry, color: THREE.Color, jitter: number, random: () => number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    // per-face colour variation (faceted miniature look)
    const f = 1 + (random() - 0.5) * jitter;
    c.copy(color).multiplyScalar(f);
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = c.r;
      colors[(i + k) * 3 + 1] = c.g;
      colors[(i + k) * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

function jitterVertices(geo: THREE.BufferGeometry, amount: number, random: () => number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const map = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let d = map.get(key);
    if (!d) {
      d = new THREE.Vector3((random() - 0.5) * amount, (random() - 0.5) * amount * 0.6, (random() - 0.5) * amount);
      map.set(key, d);
    }
    pos.setXYZ(i, pos.getX(i) + d.x, pos.getY(i) + d.y, pos.getZ(i) + d.z);
  }
}

export interface TreePlacement {
  x: number;
  y: number;
  z: number;
  height: number;
  kind: 'pine' | 'birch';
  hue?: number;
}

/** Stylised conifer: stacked jittered cones, faceted. Returns [foliage, trunk] geometries. */
function pine(t: TreePlacement, random: () => number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = 4;
  const h = t.height;
  const trunkH = h * 0.18;
  const baseR = h * 0.3;
  const green = new THREE.Color().setHSL(0.36 + (t.hue ?? 0) + (random() - 0.5) * 0.03, 0.42 + random() * 0.1, 0.13 + random() * 0.04);
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers;
    const r = baseR * (1 - f * 0.7);
    const th = h * 0.36 * (1 - f * 0.25);
    const y = trunkH + f * (h - trunkH - th * 0.6);
    const cone = new THREE.ConeGeometry(r, th, 9, 2, false);
    jitterVertices(cone, r * 0.12, random);
    cone.rotateY(random() * Math.PI);
    cone.translate(0, y + th / 2, 0);
    parts.push(colorize(cone, green.clone().multiplyScalar(1 + f * 0.25), 0.22, random));
  }
  const foliage = mergeGeometries(parts)!;
  foliage.translate(t.x, t.y, t.z);
  const trunk = colorize(new THREE.CylinderGeometry(h * 0.025, h * 0.04, trunkH * 1.4, 6), new THREE.Color('#4a3322'), 0.2, random);
  trunk.translate(t.x, t.y + trunkH * 0.7, t.z);
  return [foliage, trunk];
}

/** Deciduous tree with an autumn canopy of jittered icosahedra. */
function birch(t: TreePlacement, random: () => number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const h = t.height;
  const parts: THREE.BufferGeometry[] = [];
  const hue = t.hue ?? 0.09;
  for (let i = 0; i < 4; i++) {
    const r = h * (0.2 + random() * 0.08);
    const ico = new THREE.IcosahedronGeometry(r, 1);
    jitterVertices(ico, r * 0.25, random);
    const a = random() * Math.PI * 2;
    ico.translate(Math.cos(a) * h * 0.1, h * (0.62 + random() * 0.18), Math.sin(a) * h * 0.1);
    const c = new THREE.Color().setHSL(hue + (random() - 0.5) * 0.04, 0.62 + random() * 0.15, 0.42 + random() * 0.08);
    parts.push(colorize(ico, c, 0.25, random));
  }
  const foliage = mergeGeometries(parts)!;
  foliage.translate(t.x, t.y, t.z);
  const trunk = colorize(new THREE.CylinderGeometry(h * 0.02, h * 0.03, h * 0.7, 6), new THREE.Color('#d9d3c6'), 0.15, random);
  trunk.translate(t.x, t.y + h * 0.35, t.z);
  return [foliage, trunk];
}

export function buildTrees(placements: TreePlacement[]): THREE.Group {
  const random = rng(99);
  const foliage: THREE.BufferGeometry[] = [];
  const trunks: THREE.BufferGeometry[] = [];
  for (const t of placements) {
    const [f, tr] = t.kind === 'pine' ? pine(t, random) : birch(t, random);
    foliage.push(f);
    trunks.push(tr);
  }
  const group = new THREE.Group();
  group.name = 'trees';
  const fMesh = new THREE.Mesh(
    mergeGeometries(foliage)!,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true }),
  );
  fMesh.geometry.computeVertexNormals();
  fMesh.castShadow = true;
  fMesh.receiveShadow = true;
  const tMesh = new THREE.Mesh(mergeGeometries(trunks)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  tMesh.castShadow = true;
  group.add(fMesh, tMesh);
  return group;
}

/** Small rocks and grass tufts scattered on the meadow. */
export function buildScatter(points: { x: number; y: number; z: number; kind: 'rock' | 'tuft' | 'flower'; s: number }[]): THREE.Mesh {
  const random = rng(123);
  const geos: THREE.BufferGeometry[] = [];
  for (const p of points) {
    if (p.kind === 'rock') {
      const g = new THREE.DodecahedronGeometry(p.s, 0);
      jitterVertices(g, p.s * 0.4, random);
      g.scale(1, 0.6, 1);
      g.translate(p.x, p.y + p.s * 0.2, p.z);
      geos.push(colorize(g, new THREE.Color().setHSL(0.08, 0.05, 0.38 + random() * 0.1), 0.25, random));
    } else if (p.kind === 'tuft') {
      const g = new THREE.ConeGeometry(p.s * 0.5, p.s * 1.6, 5, 1);
      jitterVertices(g, p.s * 0.3, random);
      g.translate(p.x, p.y + p.s * 0.8, p.z);
      geos.push(colorize(g, new THREE.Color().setHSL(0.24 + random() * 0.05, 0.45, 0.3), 0.3, random));
    } else {
      const g = new THREE.IcosahedronGeometry(p.s, 0);
      g.translate(p.x, p.y + p.s, p.z);
      const hues = [0.0, 0.12, 0.62, 0.85];
      geos.push(colorize(g, new THREE.Color().setHSL(hues[Math.floor(random() * hues.length)], 0.7, 0.6), 0.1, random));
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
