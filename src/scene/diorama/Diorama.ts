import * as THREE from 'three';
import type { SubjectId } from '../../optics/config';
import { rng } from '../../util/noise';
import { canvasTexture, makeCanvas } from '../../util/textures';
import { LAYER_SENSOR, LAYOUT, OPTICAL_CENTER_X, worldXForDistance } from '../layout';
import { buildCabin, CABIN_DIM } from './cabin';
import { buildSkyPanel } from './sky';
import { CABIN, DIORAMA, GROUND_Y, MOUNTAIN_PEAK, PLINTH_TOP, sampleTerrain, SUBJECT_X, terrainHeight, buildTerrain } from './terrain';
import { buildScatter, buildTrees, type TreePlacement } from './trees';

function walnutTexture(): THREE.Texture {
  const W = 1024;
  const H = 256;
  const [c, x] = makeCanvas(W, H);
  x.fillStyle = '#2a1a10';
  x.fillRect(0, 0, W, H);
  const random = rng(31);
  for (let i = 0; i < 160; i++) {
    const y = random() * H;
    const a = 0.04 + random() * 0.12;
    x.strokeStyle = random() > 0.5 ? `rgba(90,58,34,${a})` : `rgba(10,6,4,${a})`;
    x.lineWidth = 1 + random() * 3;
    x.beginPath();
    x.moveTo(0, y);
    for (let px = 0; px <= W; px += 64) x.lineTo(px, y + Math.sin(px * 0.01 + i) * 4 + (random() - 0.5) * 2);
    x.stroke();
  }
  return canvasTexture(c, { srgb: true, repeat: [3, 1] });
}

/** Distance scale engraved along the plinth's front-right edge (matches the depth map). */
function distanceStripTexture(xFront: number, xBack: number): THREE.Texture {
  const W = 4096;
  const H = 128;
  const [c, x] = makeCanvas(W, H);
  x.fillStyle = '#1a1714';
  x.fillRect(0, 0, W, H);
  const toPx = (X: number) => ((X - xFront) / (xBack - xFront)) * W;
  const marks: [number, string][] = [
    [300, '0.3'], [400, '0.4'], [500, '0.5'], [700, '0.7'], [1000, '1 m'], [1500, '1.5'],
    [2000, '2 m'], [3000, '3'], [5000, '5 m'], [10000, '10'], [20000, '20'], [Infinity, '∞'],
  ];
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (const [d, label] of marks) {
    const X = worldXForDistance(d) - OPTICAL_CENTER_X;
    const px = toPx(X);
    const major = label.includes('m') || label === '∞';
    x.fillStyle = major ? '#e8c07a' : 'rgba(232,192,122,0.75)';
    x.fillRect(px - 2, 0, 4, major ? 44 : 30);
    x.font = `${major ? 700 : 600} ${major ? 40 : 32}px "JetBrains Mono Variable", ui-monospace, monospace`;
    x.fillText(label, Math.min(W - 40, Math.max(40, px)), 84);
  }
  return canvasTexture(c, { srgb: true, anisotropy: 16 });
}

export interface SubjectPoint {
  id: SubjectId;
  /** World-space point whose light we trace (window, tree tip, summit). */
  position: THREE.Vector3;
}

export class Diorama {
  readonly group = new THREE.Group();
  readonly subjects: SubjectPoint[] = [];
  readonly cabinLight: THREE.PointLight;

  constructor() {
    this.group.name = 'diorama';

    // ---- plinth (walnut, trapezoid following the field of view) ----
    const hwF = DIORAMA.halfWidthAt(DIORAMA.xFront) + 0.08;
    const hwB = DIORAMA.halfWidthAt(DIORAMA.xBack) + 0.08;
    const x0 = OPTICAL_CENTER_X + DIORAMA.xFront - 0.08;
    const x1 = OPTICAL_CENTER_X + DIORAMA.xBack + 0.08;
    const shape = new THREE.Shape();
    shape.moveTo(x0, -hwF);
    shape.lineTo(x1, -hwB);
    shape.lineTo(x1, hwB);
    shape.lineTo(x0, hwF);
    shape.closePath();
    const plinthGeo = new THREE.ExtrudeGeometry(shape, { depth: PLINTH_TOP - 0.03, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3 });
    plinthGeo.rotateX(Math.PI / 2);
    plinthGeo.translate(0, PLINTH_TOP - 0.03, 0);
    // rotateX(+90°): extrusion runs down −Y and the shape's y becomes world z
    const walnut = new THREE.MeshPhysicalMaterial({ map: walnutTexture(), roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const plinth = new THREE.Mesh(plinthGeo, walnut);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    this.group.add(plinth);

    // brass edge band on top of the plinth
    const brass = new THREE.MeshPhysicalMaterial({ color: '#a8874e', metalness: 1, roughness: 0.4 });
    const edgeLen = Math.hypot(x1 - x0, hwB - hwF);
    const edgeAngle = Math.atan2(hwB - hwF, x1 - x0);
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(edgeLen, 0.16),
      new THREE.MeshPhysicalMaterial({ map: distanceStripTexture(DIORAMA.xFront - 0.08, DIORAMA.xBack + 0.08), metalness: 0.3, roughness: 0.4, clearcoat: 0.5 }),
    );
    // front-facing (+z) sloped side of the plinth
    strip.position.set((x0 + x1) / 2, PLINTH_TOP - 0.12, (hwF + hwB) / 2 + 0.035);
    strip.rotation.y = -edgeAngle;
    this.group.add(strip);
    const band = new THREE.Mesh(new THREE.BoxGeometry(edgeLen, 0.018, 0.02), brass);
    band.position.set((x0 + x1) / 2, PLINTH_TOP - 0.025, (hwF + hwB) / 2 + 0.03);
    band.rotation.y = -edgeAngle;
    this.group.add(band);

    // ---- terrain ----
    const sensorVisible: THREE.Object3D[] = [];
    const terrain = buildTerrain();
    this.group.add(terrain);
    sensorVisible.push(terrain);

    // ---- cabin ----
    const cabin = buildCabin();
    const cabinGroundY = GROUND_Y + terrainHeight(CABIN.x, CABIN.z);
    cabin.group.position.set(OPTICAL_CENTER_X + CABIN.x, cabinGroundY, CABIN.z);
    cabin.group.rotation.y = CABIN.rotY;
    this.group.add(cabin.group);
    sensorVisible.push(cabin.group);
    this.cabinLight = cabin.light;
    const windowWorld = CABIN_DIM.window.clone();
    cabin.group.updateMatrixWorld(true);
    windowWorld.applyMatrix4(cabin.group.matrixWorld);
    windowWorld.x -= CABIN_DIM.logR + 0.004;
    this.subjects.push({ id: 'cabin', position: windowWorld });

    // ---- trees ----
    const random = rng(2024);
    const placements: TreePlacement[] = [];
    const place = (X: number, Z: number, height: number, kind: 'pine' | 'birch', hue?: number) => {
      placements.push({ x: OPTICAL_CENTER_X + X, y: GROUND_Y + terrainHeight(X, Z) - 0.01, z: Z, height, kind, hue });
    };
    // the subject tree: its tip sits exactly at 2.0 m
    const mainTree = { X: SUBJECT_X.trees, Z: 0.62, H: 1.28 };
    place(mainTree.X, mainTree.Z, mainTree.H, 'pine');
    const mainTip = new THREE.Vector3(OPTICAL_CENTER_X + mainTree.X, GROUND_Y + terrainHeight(mainTree.X, mainTree.Z) - 0.01 + mainTree.H, mainTree.Z);
    this.subjects.push({ id: 'trees', position: mainTip });
    // midground cluster
    const cluster: [number, number, number][] = [
      [0.28, 1.05, 1.05], [-0.22, 1.25, 0.92], [0.35, 0.18, 0.86], [-0.3, 0.08, 1.0], [0.1, 1.62, 1.12],
      [0.55, 0.85, 0.95], [-0.45, 1.6, 0.8], [0.62, 1.95, 1.0], [0.05, -0.35, 0.78],
    ];
    for (const [dx, z, h] of cluster) place(mainTree.X + dx, z, h, 'pine');
    // left group on the far hill
    for (const [X, Z, h] of [[6.2, -1.7, 0.95], [6.55, -2.05, 1.1], [6.0, -2.3, 0.85], [6.8, -1.35, 0.9], [5.7, -1.45, 0.72]] as [number, number, number][]) {
      place(X, Z, h, 'pine', -0.02);
    }
    // autumn birches for colour
    place(5.05, 0.55, 0.62, 'birch', 0.08);
    place(5.3, 1.05, 0.7, 'birch', 0.11);
    place(4.9, -1.25, 0.58, 'birch', 0.06);
    place(5.45, -0.95, 0.66, 'birch', 0.1);
    // a pine beside the cabin
    place(CABIN.x + 0.5, CABIN.z - 0.55, 0.85, 'pine');
    place(CABIN.x + 0.3, CABIN.z + 0.75, 0.55, 'birch', 0.09);
    const trees = buildTrees(placements);
    this.group.add(trees);
    sensorVisible.push(trees);

    // ---- scatter: rocks, grass tufts and flowers across the meadow ----
    const scatter: { x: number; y: number; z: number; kind: 'rock' | 'tuft' | 'flower'; s: number }[] = [];
    for (let i = 0; i < 260; i++) {
      const X = DIORAMA.xFront + 0.1 + random() * (6.4 - DIORAMA.xFront);
      const hw = DIORAMA.halfWidthAt(X) - 0.08;
      const Z = (random() * 2 - 1) * hw;
      const s = sampleTerrain(X, Z);
      if (s.path > 0.3 || s.mountain > 0.4) continue;
      if (Math.hypot(X - CABIN.x, Z - CABIN.z) < 0.45) continue;
      const r = random();
      const kind = r < 0.22 ? 'rock' : r < 0.8 ? 'tuft' : 'flower';
      const size = kind === 'rock' ? 0.018 + random() * 0.035 : kind === 'tuft' ? 0.018 + random() * 0.02 : 0.008 + random() * 0.006;
      scatter.push({ x: OPTICAL_CENTER_X + X, y: GROUND_Y + s.h, z: Z, kind, s: size });
    }
    const scatterMesh = buildScatter(scatter);
    this.group.add(scatterMesh);
    sensorVisible.push(scatterMesh);

    // ---- mountain summit (highest terrain point near the planned peak) ----
    let best = { X: MOUNTAIN_PEAK.x, Z: MOUNTAIN_PEAK.z, h: -1 };
    for (let dz = -0.25; dz <= 0.25; dz += 0.01) {
      const h = terrainHeight(MOUNTAIN_PEAK.x, MOUNTAIN_PEAK.z + dz);
      if (h > best.h) best = { X: MOUNTAIN_PEAK.x, Z: MOUNTAIN_PEAK.z + dz, h };
    }
    this.subjects.push({ id: 'mountain', position: new THREE.Vector3(OPTICAL_CENTER_X + best.X, GROUND_Y + best.h, best.Z) });

    // ---- sky backdrop at "infinity" ----
    // Every point of the backdrop must lie beyond the depth map's "∞" so the DoF pass treats
    // the whole sky as infinitely far: radius · cos(halfAngle) ≥ xInfRel.
    const skyHalfAngle = THREE.MathUtils.degToRad(22.5);
    const skyRadius = (LAYOUT.xInfRel + 0.06) / Math.cos(skyHalfAngle);
    const sky = buildSkyPanel(OPTICAL_CENTER_X, skyRadius, PLINTH_TOP, LAYOUT.axisY + 2.45, skyHalfAngle);
    this.group.add(sky.group);
    sensorVisible.push(sky.panel);

    for (const o of sensorVisible) o.traverse((c) => c.layers.enable(LAYER_SENSOR));
  }
}
