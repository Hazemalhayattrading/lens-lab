import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../util/noise';
import { mergeStaticByMaterial } from '../../util/merge';

/**
 * Miniature log cabin. Local frame: footprint centred on the origin, ground at y = 0,
 * the front (door + window) faces −X, i.e. towards the lens.
 */
export const CABIN_DIM = {
  depth: 0.46, // along X
  width: 0.56, // along Z
  logR: 0.024,
  logs: 7,
  roofRise: 0.27,
  /** Local position of the front window centre (the "cabin" ray source). */
  window: new THREE.Vector3(-0.236, 0.17, 0.13),
};

export function buildCabin(): { group: THREE.Group; light: THREE.PointLight } {
  const group = new THREE.Group();
  group.name = 'cabin';
  const { depth, width, logR, logs, roofRise } = CABIN_DIM;
  const random = rng(4);
  const step = logR * 1.9;
  const wallTop = logs * step + logR;

  // ---- logs (instanced, notched corners: alternate courses) ----
  const logGeo = new THREE.CylinderGeometry(logR, logR, 1, 10, 1);
  const logMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
  const count = logs * 4;
  const logMesh = new THREE.InstancedMesh(logGeo, logMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  let k = 0;
  const overhang = 0.045;
  for (let i = 0; i < logs; i++) {
    const yA = logR + i * step;
    const yB = yA + step / 2;
    // front/back walls (along Z)
    for (const side of [-1, 1]) {
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      s.set(1, width + overhang * 2, 1);
      p.set(side * depth / 2, yA, 0);
      m.compose(p, q, s);
      logMesh.setMatrixAt(k, m);
      c.setHSL(0.075 + random() * 0.02, 0.45 + random() * 0.1, 0.24 + random() * 0.06);
      logMesh.setColorAt(k++, c);
    }
    // side walls (along X)
    for (const side of [-1, 1]) {
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      s.set(1, depth + overhang * 2, 1);
      p.set(0, yB, side * width / 2);
      m.compose(p, q, s);
      logMesh.setMatrixAt(k, m);
      c.setHSL(0.075 + random() * 0.02, 0.45 + random() * 0.1, 0.24 + random() * 0.06);
      logMesh.setColorAt(k++, c);
    }
  }
  logMesh.castShadow = true;
  logMesh.receiveShadow = true;
  group.add(logMesh);

  // inner wall volume so there are no see-through gaps between logs
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(depth - logR * 0.6, wallTop - logR, width - logR * 0.6),
    new THREE.MeshStandardMaterial({ color: '#3a2618', roughness: 0.9 }),
  );
  core.position.y = (wallTop - logR) / 2 + logR * 0.5;
  core.castShadow = true;
  group.add(core);

  // ---- gable ends (vertical boards) ----
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-width / 2 - 0.01, 0);
  gableShape.lineTo(width / 2 + 0.01, 0);
  gableShape.lineTo(0, roofRise);
  gableShape.closePath();
  const gableGeo = new THREE.ShapeGeometry(gableShape);
  const gableMat = new THREE.MeshStandardMaterial({ color: '#5a3b24', roughness: 0.85, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(gableGeo, gableMat);
    g.rotation.y = Math.PI / 2;
    g.position.set(side * (depth / 2 - 0.005), wallTop - 0.01, 0);
    g.castShadow = true;
    group.add(g);
  }

  // ---- roof: two slabs + shingle rows + ridge ----
  const roofMat = new THREE.MeshStandardMaterial({ color: '#3a2c26', roughness: 0.8 });
  const shingleMat = new THREE.MeshStandardMaterial({ color: '#4b3a30', roughness: 0.75 });
  const eave = 0.075;
  const halfSpan = width / 2 + eave;
  const slope = Math.atan2(roofRise + 0.02, width / 2 + eave);
  const slabLen = Math.hypot(halfSpan, roofRise + 0.02);
  const roofLen = depth + 0.16;
  for (const side of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(roofLen, 0.022, slabLen), roofMat);
    slab.position.set(0, wallTop + roofRise / 2 - 0.005, (side * halfSpan) / 2);
    slab.rotation.x = side * slope;
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    // shingle rows as thin strips (merged)
    const rows: THREE.BufferGeometry[] = [];
    const nRows = 7;
    for (let r = 0; r < nRows; r++) {
      const t = (r + 0.5) / nRows;
      const strip = new THREE.BoxGeometry(roofLen + 0.01, 0.012, slabLen / nRows + 0.012);
      strip.translate(0, 0.016, -slabLen / 2 + t * slabLen);
      rows.push(strip);
    }
    const shingles = new THREE.Mesh(mergeGeometries(rows)!, shingleMat);
    shingles.position.copy(slab.position);
    shingles.rotation.copy(slab.rotation);
    shingles.castShadow = true;
    group.add(shingles);
  }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(roofLen + 0.02, 0.03, 0.04), roofMat);
  ridge.position.set(0, wallTop + roofRise + 0.012, 0);
  group.add(ridge);

  // ---- door + windows ----
  const frameMat = new THREE.MeshStandardMaterial({ color: '#2b1a10', roughness: 0.8 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: '#2a1606',
    emissive: '#ffb35a',
    emissiveIntensity: 4.2,
    roughness: 0.4,
  });
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.11), new THREE.MeshStandardMaterial({ color: '#4a2d18', roughness: 0.8 }));
  door.position.set(-depth / 2 - logR - 0.002, 0.1 + 0.005, -0.1);
  group.add(door);

  const addWindow = (pos: THREE.Vector3, normalAxis: 'x' | 'z', w = 0.1, h = 0.085) => {
    const win = new THREE.Group();
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMat);
    win.add(pane);
    const bar = (bw: number, bh: number, x: number, y: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.008), frameMat);
      b.position.set(x, y, 0.004);
      win.add(b);
    };
    bar(w + 0.02, 0.012, 0, h / 2 + 0.006);
    bar(w + 0.02, 0.012, 0, -h / 2 - 0.006);
    bar(0.012, h, -w / 2 - 0.006, 0);
    bar(0.012, h, w / 2 + 0.006, 0);
    bar(0.006, h, 0, 0);
    bar(w, 0.006, 0, 0);
    // flower box under the window
    const box = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.02, 0.025), frameMat);
    box.position.set(0, -h / 2 - 0.022, 0.012);
    win.add(box);
    win.position.copy(pos);
    if (normalAxis === 'x') win.rotation.y = -Math.PI / 2;
    group.add(win);
  };
  const outer = logR + 0.003;
  addWindow(new THREE.Vector3(-depth / 2 - outer, CABIN_DIM.window.y, CABIN_DIM.window.z), 'x');
  addWindow(new THREE.Vector3(0.02, 0.17, width / 2 + outer), 'z', 0.12);

  // ---- stone chimney at the back ----
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#7b7670', roughness: 0.95 });
  const chim = new THREE.Mesh(new THREE.BoxGeometry(0.1, wallTop + roofRise + 0.16, 0.11), stoneMat);
  chim.position.set(depth / 2 + 0.035, (wallTop + roofRise + 0.16) / 2, 0.12);
  chim.castShadow = true;
  group.add(chim);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.14), stoneMat);
  cap.position.set(chim.position.x, wallTop + roofRise + 0.17, 0.12);
  group.add(cap);

  // ---- porch step + firewood ----
  const step1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.16), new THREE.MeshStandardMaterial({ color: '#6b5a48', roughness: 0.9 }));
  step1.position.set(-depth / 2 - 0.06, 0.0125, -0.1);
  step1.receiveShadow = true;
  group.add(step1);
  const woodGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.09, 7);
  const woodMat = new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.9 });
  for (let i = 0; i < 9; i++) {
    const w = new THREE.Mesh(woodGeo, woodMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(0.02 + (i % 3) * 0.0, 0.014 + Math.floor(i / 3) * 0.022, -width / 2 - 0.05 + (i % 3) * 0.024 - 0.02);
    w.rotation.y = Math.PI / 2;
    w.castShadow = true;
    group.add(w);
  }

  mergeStaticByMaterial(group);

  // warm interior light spilling out of the windows
  const light = new THREE.PointLight('#ffae55', 0.9, 1.6, 2);
  light.position.set(0, 0.16, 0);
  group.add(light);

  return { group, light };
}
