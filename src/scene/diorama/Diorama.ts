import * as THREE from 'three';
import type { SubjectId } from '../../optics/config';
import { rng } from '../../util/noise';
import { canvasTexture, makeCanvas } from '../../util/textures';
import { LAYER_SENSOR, LAYOUT, OPTICAL_CENTER_X, worldXForDistance } from '../layout';
import { buildCabin, CABIN_DIM } from './cabin';
import { buildSkyDome, buildSkyPanel } from './sky';
import { buildFlower, buildLighthouse, buildSnagAndBird, buildWater } from './subjects';
import { buildTerrain, CABIN, DIORAMA, GROUND_Y, HILL, MAIN_PEAK, PLINTH_TOP, sampleTerrain, SUBJECT_X, terrainHeight } from './terrain';
import { buildScatter, buildTrees, type TreePlacement } from './trees';
import { buildWideWorld } from './wideWorld';

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

/** Distance scale engraved along the plinth's front edge (follows the depth ladder). */
function distanceStripTexture(xFront: number, xBack: number): THREE.Texture {
  const W = 4096;
  const H = 128;
  const [c, x] = makeCanvas(W, H);
  x.fillStyle = '#1a1714';
  x.fillRect(0, 0, W, H);
  const toPx = (X: number) => ((X - xFront) / (xBack - xFront)) * W;
  const marks: [number, string, boolean][] = [
    [200, '0.2', false], [300, '0.3', false], [500, '0.5', false], [800, '0.8', false], [1000, '1 m', true], [2000, '2', false],
    [5000, '5', false], [10000, '10 m', true], [30000, '30', false], [100000, '100 m', true], [200000, '200', false],
    [1000000, '1 km', true], [Infinity, '∞', true],
  ];
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (const [d, label, major] of marks) {
    const px = toPx(worldXForDistance(d) - OPTICAL_CENTER_X);
    x.fillStyle = major ? '#e8c07a' : 'rgba(232,192,122,0.75)';
    x.fillRect(px - 2, 0, 4, major ? 44 : 30);
    x.font = `${major ? 700 : 600} ${major ? 40 : 32}px "JetBrains Mono Variable", ui-monospace, monospace`;
    x.fillText(label, Math.min(W - 40, Math.max(40, px)), 84);
  }
  return canvasTexture(c, { srgb: true, anisotropy: 16 });
}

export interface SubjectPoint {
  id: SubjectId;
  /** World-space point whose light we trace. */
  position: THREE.Vector3;
}

export class Diorama {
  readonly group = new THREE.Group();
  /** Seen only by the sensor camera (wide-angle surroundings + sky dome). */
  readonly sensorWorld = new THREE.Group();
  readonly subjects: SubjectPoint[] = [];
  readonly cabinLight: THREE.PointLight;
  readonly lighthouseLamp: THREE.PointLight;

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
    const walnut = new THREE.MeshPhysicalMaterial({ map: walnutTexture(), roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const plinth = new THREE.Mesh(plinthGeo, walnut);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    this.group.add(plinth);

    // distance strip + brass band on the front-facing (+z) sloped side
    const brass = new THREE.MeshPhysicalMaterial({ color: '#a8874e', metalness: 1, roughness: 0.4 });
    const edgeLen = Math.hypot(x1 - x0, hwB - hwF);
    const edgeAngle = Math.atan2(hwB - hwF, x1 - x0);
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(edgeLen, 0.16),
      new THREE.MeshPhysicalMaterial({ map: distanceStripTexture(DIORAMA.xFront - 0.08, DIORAMA.xBack + 0.08), metalness: 0.3, roughness: 0.4, clearcoat: 0.5 }),
    );
    strip.position.set((x0 + x1) / 2, PLINTH_TOP - 0.12, (hwF + hwB) / 2 + 0.035);
    strip.rotation.y = -edgeAngle;
    this.group.add(strip);
    const band = new THREE.Mesh(new THREE.BoxGeometry(edgeLen, 0.018, 0.02), brass);
    band.position.set((x0 + x1) / 2, PLINTH_TOP - 0.025, (hwF + hwB) / 2 + 0.03);
    band.rotation.y = -edgeAngle;
    this.group.add(band);

    const sensorVisible: THREE.Object3D[] = [];
    const add = (o: THREE.Object3D) => {
      this.group.add(o);
      sensorVisible.push(o);
    };

    // ---- terrain + lake ----
    add(buildTerrain());
    add(buildWater());

    // ---- flower (0.3 m) ----
    const flower = buildFlower();
    add(flower.group);
    this.subjects.push({ id: 'flower', position: flower.point });

    // ---- cabin (0.8 m) ----
    const cabin = buildCabin();
    cabin.group.position.set(OPTICAL_CENTER_X + CABIN.x, GROUND_Y + terrainHeight(CABIN.x, CABIN.z), CABIN.z);
    cabin.group.rotation.y = CABIN.rotY;
    add(cabin.group);
    this.cabinLight = cabin.light;
    const windowWorld = CABIN_DIM.window.clone();
    cabin.group.updateMatrixWorld(true);
    windowWorld.applyMatrix4(cabin.group.matrixWorld);
    windowWorld.x -= CABIN_DIM.logR + 0.004;
    this.subjects.push({ id: 'cabin', position: windowWorld });

    // ---- trees (2 m) and the rest of the vegetation ----
    const random = rng(2024);
    const placements: TreePlacement[] = [];
    const place = (X: number, Z: number, height: number, kind: 'pine' | 'birch', hue?: number) => {
      placements.push({ x: OPTICAL_CENTER_X + X, y: GROUND_Y + terrainHeight(X, Z) - 0.01, z: Z, height, kind, hue });
    };
    const mainTree = { X: SUBJECT_X.trees, Z: 0.98, H: 1.22 };
    place(mainTree.X, mainTree.Z, mainTree.H, 'pine');
    this.subjects.push({
      id: 'trees',
      position: new THREE.Vector3(OPTICAL_CENTER_X + mainTree.X, GROUND_Y + terrainHeight(mainTree.X, mainTree.Z) - 0.01 + mainTree.H, mainTree.Z),
    });
    const cluster: [number, number, number][] = [
      [0.3, 1.45, 1.0], [-0.24, 1.6, 0.88], [0.1, 1.95, 1.08], [0.55, 1.25, 0.92], [0.62, 2.25, 0.98], [0.28, 2.6, 0.86], [-0.3, 2.35, 0.8],
    ];
    for (const [dx, z, h] of cluster) place(mainTree.X + dx, z, h, 'pine');
    // birches between the cabin and the hill
    place(5.95, -1.3, 0.62, 'birch', 0.08);
    place(6.2, -0.72, 0.56, 'birch', 0.11);
    place(5.72, -1.75, 0.66, 'birch', 0.06);
    place(4.6, 0.95, 0.5, 'birch', 0.1);
    // pines on the hill's flanks and along the far shore
    for (const [X, Z, h] of [[6.95, -2.35, 0.7], [7.3, -2.7, 0.62], [6.75, -0.95, 0.55], [7.55, -0.8, 0.5], [7.1, -2.0, 0.66]] as [number, number, number][]) {
      place(X, Z, h, 'pine', -0.02);
    }
    for (const [X, Z, h] of [[9.0, 2.35, 0.42], [9.15, 1.7, 0.38], [8.9, 2.9, 0.45], [9.25, 0.95, 0.34], [7.6, 2.55, 0.5]] as [number, number, number][]) {
      place(X, Z, h, 'pine', 0.0);
    }
    place(CABIN.x + 0.5, CABIN.z - 0.55, 0.8, 'pine');
    place(CABIN.x + 0.3, CABIN.z + 0.72, 0.52, 'birch', 0.09);
    add(buildTrees(placements));

    // ---- scatter: rocks, grass tufts and flowers across the meadow ----
    const scatter: { x: number; y: number; z: number; kind: 'rock' | 'tuft' | 'flower'; s: number }[] = [];
    for (let i = 0; i < 320; i++) {
      const X = DIORAMA.xFront + 0.1 + random() * (7.6 - DIORAMA.xFront);
      const hw = DIORAMA.halfWidthAt(X) - 0.08;
      const Z = (random() * 2 - 1) * hw;
      const s = sampleTerrain(X, Z);
      if (s.path > 0.3 || s.mountain > 0.4 || s.lake > 0.02) continue;
      if (Math.hypot(X - CABIN.x, Z - CABIN.z) < 0.45) continue;
      if (Math.hypot(X - SUBJECT_X.flower, Z + 0.24) < 0.12) continue;
      const r = random();
      const kind = r < 0.22 ? 'rock' : r < 0.8 ? 'tuft' : 'flower';
      const size = kind === 'rock' ? 0.018 + random() * 0.035 : kind === 'tuft' ? 0.018 + random() * 0.02 : 0.008 + random() * 0.006;
      scatter.push({ x: OPTICAL_CENTER_X + X, y: GROUND_Y + s.h, z: Z, kind, s: size });
    }
    add(buildScatter(scatter));

    // ---- rocky hill (8 m): its summit ----
    this.subjects.push({ id: 'hill', position: this.summit(HILL.x, HILL.z, 0.5) });

    // ---- kingfisher on the snag (30 m, on the axis) ----
    const snag = buildSnagAndBird();
    add(snag.group);
    this.subjects.push({ id: 'bird', position: snag.point });

    // ---- lighthouse (200 m) ----
    const lh = buildLighthouse();
    add(lh.group);
    this.lighthouseLamp = lh.lamp;
    this.subjects.push({ id: 'tower', position: lh.point });

    // ---- far mountains (∞) ----
    this.subjects.push({ id: 'peaks', position: this.summit(MAIN_PEAK.x, MAIN_PEAK.z, 0.4) });

    // ---- sky light-box at "infinity": all of it lies beyond the ladder's ∞ (radius·cos(half) ≥ xInf)
    const skyHalfAngle = THREE.MathUtils.degToRad(22.5);
    const skyRadius = (LAYOUT.xInfRel + 0.06) / Math.cos(skyHalfAngle);
    const sky = buildSkyPanel(OPTICAL_CENTER_X, skyRadius, PLINTH_TOP, LAYOUT.axisY + 2.45, skyHalfAngle);
    this.group.add(sky.group);
    sensorVisible.push(sky.panel);

    for (const o of sensorVisible) o.traverse((c) => c.layers.enable(LAYER_SENSOR));

    // ---- what only the sensor camera sees ----
    this.sensorWorld.add(buildWideWorld());
    this.sensorWorld.add(buildSkyDome(OPTICAL_CENTER_X, LAYOUT.axisY, 90));
  }

  /** Highest terrain point near (X, Z), searched in a small square (world coordinates). */
  private summit(X: number, Z: number, radius: number): THREE.Vector3 {
    let best = { X, Z, h: -1 };
    for (let dx = -radius; dx <= radius; dx += 0.02) {
      for (let dz = -radius; dz <= radius; dz += 0.02) {
        const h = terrainHeight(X + dx, Z + dz);
        if (h > best.h) best = { X: X + dx, Z: Z + dz, h };
      }
    }
    return new THREE.Vector3(OPTICAL_CENTER_X + best.X, GROUND_Y + best.h, best.Z);
  }
}
