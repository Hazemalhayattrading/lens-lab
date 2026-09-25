import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { canvasTexture, makeCanvas } from '../util/textures';
import { createPostOnCarrier, type HardwareMaterials } from './bench';
import { LAYOUT, SENSOR_H, SENSOR_W } from './layout';

/** PCB artwork: black solder mask, gold traces and silkscreen. */
function pcbTexture(): THREE.Texture {
  const W = 1024;
  const H = 820;
  const [c, x] = makeCanvas(W, H);
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#101318');
  g.addColorStop(1, '#0a0c10');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  // traces
  x.strokeStyle = 'rgba(201,160,82,0.55)';
  x.lineWidth = 3;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const side = i % 4;
    let px = side === 0 ? 0 : side === 1 ? W : rnd() * W;
    let py = side === 2 ? 0 : side === 3 ? H : rnd() * H;
    x.beginPath();
    x.moveTo(px, py);
    for (let k = 0; k < 3; k++) {
      if (k % 2 === 0) px += (W / 2 - px) * (0.3 + rnd() * 0.4);
      else py += (H / 2 - py) * (0.3 + rnd() * 0.4);
      x.lineTo(px, py);
    }
    x.stroke();
    x.fillStyle = 'rgba(214,176,96,0.8)';
    x.beginPath();
    x.arc(px, py, 5, 0, Math.PI * 2);
    x.fill();
  }
  // silkscreen
  x.fillStyle = 'rgba(235,235,235,0.85)';
  x.font = '600 26px "JetBrains Mono Variable", ui-monospace, monospace';
  x.fillText('LENS·LAB  FF-CMOS  36 × 24 mm', 40, H - 40);
  x.font = '500 20px "JetBrains Mono Variable", ui-monospace, monospace';
  x.fillText('REV C · 24.6 MP · 5.9 µm', 40, H - 70);
  x.strokeStyle = 'rgba(235,235,235,0.6)';
  x.lineWidth = 2;
  x.strokeRect(24, 24, W - 48, H - 48);
  return canvasTexture(c, { srgb: true });
}

export interface SensorStand {
  group: THREE.Group;
  /** The active area: shows the live (inverted) sensor image. */
  activeArea: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  setImage(texture: THREE.Texture | null, intensity: number): void;
}

export function createSensorStand(hw: HardwareMaterials): SensorStand {
  const group = new THREE.Group();
  group.name = 'sensor-stand';
  const x0 = LAYOUT.sensorX;
  const cy = LAYOUT.axisY;

  const boardW = SENSOR_W + 1.1;
  const boardH = SENSOR_H + 1.0;

  // post + carrier
  const postTop = cy - boardH / 2 - 0.02;
  group.add(createPostOnCarrier(hw, x0 - 0.2, postTop));

  // mounting bracket (L-shaped) holding the PCB
  const bracket = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.12, 0.9, 2, 0.02), hw.anodizedBlack);
  bracket.position.set(x0 - 0.2, postTop + 0.04, 0);
  bracket.castShadow = true;
  group.add(bracket);
  const back = new THREE.Mesh(new RoundedBoxGeometry(0.08, boardH * 0.8, boardW * 0.7, 2, 0.02), hw.anodizedBlack);
  back.position.set(x0 - 0.25, cy, 0);
  back.castShadow = true;
  group.add(back);

  // PCB
  const pcbMat = new THREE.MeshPhysicalMaterial({ map: pcbTexture(), roughness: 0.45, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.3 });
  const pcbEdge = new THREE.MeshStandardMaterial({ color: '#1c1a14', roughness: 0.7 });
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(0.05, boardH, boardW), [pcbMat, pcbEdge, pcbEdge, pcbEdge, pcbEdge, pcbEdge]);
  pcb.position.set(x0 - 0.16, cy, 0);
  pcb.castShadow = true;
  pcb.receiveShadow = true;
  group.add(pcb);

  // ceramic package with gold seal ring
  const ceramic = new THREE.Mesh(
    new RoundedBoxGeometry(0.1, SENSOR_H + 0.42, SENSOR_W + 0.42, 3, 0.03),
    new THREE.MeshPhysicalMaterial({ color: '#2b2622', roughness: 0.55, metalness: 0.05, clearcoat: 0.3 }),
  );
  ceramic.position.set(x0 - 0.085, cy, 0);
  ceramic.castShadow = true;
  group.add(ceramic);

  const gold = new THREE.MeshPhysicalMaterial({ color: '#e0b25c', metalness: 1, roughness: 0.22 });
  const frameGeo = new THREE.BoxGeometry(0.02, SENSOR_H + 0.22, SENSOR_W + 0.22);
  const frame = new THREE.Mesh(frameGeo, gold);
  frame.position.set(x0 - 0.03, cy, 0);
  group.add(frame);

  // bond-wire pads along the long edges
  const padGeo = new THREE.BoxGeometry(0.012, 0.035, 0.02);
  const pads = new THREE.InstancedMesh(padGeo, gold, 2 * 40);
  const m = new THREE.Matrix4();
  let k = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 40; i++) {
      const z = -SENSOR_W / 2 + (i + 0.5) * (SENSOR_W / 40);
      m.makeTranslation(x0 - 0.015, cy + side * (SENSOR_H / 2 + 0.07), z);
      pads.setMatrixAt(k++, m);
    }
  }
  group.add(pads);

  // silicon die: dark, iridescent (microlens array + colour filter array) with the live image as emission
  const dieMat = new THREE.MeshPhysicalMaterial({
    color: '#0d0b12',
    metalness: 0.35,
    roughness: 0.18,
    iridescence: 1,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [250, 700],
    emissive: '#ffffff',
    emissiveIntensity: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  const activeGeo = new THREE.PlaneGeometry(SENSOR_W, SENSOR_H);
  // the lens rotates the image by 180°: flip v so the upright render appears inverted on the die
  const uv = activeGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  activeGeo.rotateY(Math.PI / 2);
  const activeArea = new THREE.Mesh(activeGeo, dieMat);
  activeArea.position.set(x0 - 0.001, cy, 0);
  group.add(activeArea);

  // thin cover glass (IR-cut filter) with a faint cyan/magenta coating reflection
  const cover = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, SENSOR_H + 0.16, SENSOR_W + 0.16),
    new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      transmission: 1,
      roughness: 0.02,
      thickness: 0.012,
      ior: 1.5,
      iridescence: 0.6,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [300, 600],
      specularIntensity: 0.6,
      depthWrite: false,
    }),
  );
  cover.position.set(x0 - 0.012, cy, 0);
  cover.visible = false; // enabled later if it reads well
  group.add(cover);

  // a few SMD parts on the PCB
  const smdMat = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.5 });
  const capMat = new THREE.MeshStandardMaterial({ color: '#8a7250', roughness: 0.5 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const rz = (boardW / 2 - 0.22) * Math.cos(a);
    const ry = (boardH / 2 - 0.2) * Math.sin(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05 + (i % 3) * 0.02, 0.09), i % 2 ? smdMat : capMat);
    b.position.set(x0 - 0.12, cy + ry, rz);
    group.add(b);
  }

  // ---- back side: finned heatsink, status LED and a ribbon cable down to the bench ----
  const sinkMat = new THREE.MeshPhysicalMaterial({ color: '#2a2e35', metalness: 0.85, roughness: 0.38, clearcoat: 0.3 });
  const sinkBase = new THREE.Mesh(new RoundedBoxGeometry(0.06, boardH * 0.62, boardW * 0.5, 2, 0.015), sinkMat);
  sinkBase.position.set(x0 - 0.32, cy + 0.02, 0);
  sinkBase.castShadow = true;
  group.add(sinkBase);
  const fins = 9;
  const finGeo = new THREE.BoxGeometry(0.16, boardH * 0.58, 0.018);
  const finMesh = new THREE.InstancedMesh(finGeo, sinkMat, fins);
  const fm = new THREE.Matrix4();
  for (let i = 0; i < fins; i++) {
    const z = (i / (fins - 1) - 0.5) * boardW * 0.44;
    fm.makeTranslation(x0 - 0.43, cy + 0.02, z);
    finMesh.setMatrixAt(i, fm);
  }
  finMesh.castShadow = true;
  group.add(finMesh);
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 12, 8),
    new THREE.MeshStandardMaterial({ color: '#0a2a12', emissive: '#39ff88', emissiveIntensity: 3.5 }),
  );
  led.position.set(x0 - 0.2, cy + boardH / 2 - 0.12, boardW / 2 - 0.16);
  group.add(led);
  // flat ribbon cable: leaves the board's lower edge, drops to the bench, runs away along it
  const cableCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x0 - 0.2, cy - boardH / 2 + 0.05, -boardW * 0.25),
    new THREE.Vector3(x0 - 0.42, cy - boardH / 2 - 0.25, -boardW * 0.3),
    new THREE.Vector3(x0 - 0.7, 0.35, -boardW * 0.35),
    new THREE.Vector3(x0 - 1.05, 0.04, -boardW * 0.45),
    new THREE.Vector3(x0 - 1.9, 0.02, -boardW * 0.6),
  ]);
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(cableCurve, 64, 0.022, 6, false),
    new THREE.MeshStandardMaterial({ color: '#6a5a3c', roughness: 0.6, metalness: 0.2 }),
  );
  cable.scale.set(1, 1, 1);
  cable.castShadow = true;
  group.add(cable);

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = true;
  });

  return {
    group,
    activeArea,
    setImage(texture, intensity) {
      dieMat.emissiveMap = texture;
      dieMat.emissiveIntensity = texture ? intensity : 0;
      dieMat.needsUpdate = true;
    },
  };
}
