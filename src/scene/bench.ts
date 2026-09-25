import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { breadboardTile, brushedMetal, railScale } from '../util/textures';
import { LAYOUT } from './layout';

export const BENCH = {
  xMin: -6.6,
  xMax: 9.2,
  zMin: -4.2,
  zMax: 4.6,
  thickness: 0.42,
  holePitch: 0.5,
  railXMin: -5.5,
  railXMax: 1.75,
  railWidth: 0.62,
  railHeight: 0.26,
} as const;

/** Materials shared by the bench hardware (posts, carriers, clamps). */
export function createHardwareMaterials() {
  const brushed = brushedMetal([2, 2], 5);
  return {
    anodizedBlack: new THREE.MeshPhysicalMaterial({
      color: '#15171b',
      metalness: 0.65,
      roughness: 0.38,
      clearcoat: 0.35,
      clearcoatRoughness: 0.4,
    }),
    satinSteel: new THREE.MeshPhysicalMaterial({
      color: '#8d9198',
      metalness: 1,
      roughness: 0.42,
      normalMap: brushed.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughnessMap: brushed.roughnessMap,
      anisotropy: 0.6,
    }),
    polishedSteel: new THREE.MeshPhysicalMaterial({
      color: '#e6e8ec',
      metalness: 1,
      roughness: 0.12,
    }),
    darkSteel: new THREE.MeshPhysicalMaterial({
      color: '#3a3d44',
      metalness: 1,
      roughness: 0.34,
    }),
  };
}

export type HardwareMaterials = ReturnType<typeof createHardwareMaterials>;

/** Optical breadboard (the bench top) + the dovetail optical rail. */
export function createBench(hw: HardwareMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bench';

  const w = BENCH.xMax - BENCH.xMin;
  const d = BENCH.zMax - BENCH.zMin;

  // --- breadboard slab ---
  const tile = breadboardTile([w / BENCH.holePitch, d / BENCH.holePitch]);
  const topMat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    map: tile.map,
    normalMap: tile.normalMap,
    normalScale: new THREE.Vector2(1, 1),
    roughnessMap: tile.ormMap,
    metalnessMap: tile.ormMap,
    roughness: 1,
    metalness: 1,
    clearcoat: 0.08,
    clearcoatRoughness: 0.6,
    envMapIntensity: 0.6,
  });
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d), topMat);
  top.rotation.x = -Math.PI / 2;
  top.position.set((BENCH.xMin + BENCH.xMax) / 2, 0.0005, (BENCH.zMin + BENCH.zMax) / 2);
  top.receiveShadow = true;
  group.add(top);

  const slab = new THREE.Mesh(
    new RoundedBoxGeometry(w + 0.04, BENCH.thickness, d + 0.04, 4, 0.05),
    new THREE.MeshPhysicalMaterial({ color: '#0c0d10', metalness: 0.5, roughness: 0.42, clearcoat: 0.3 }),
  );
  slab.position.set(top.position.x, -BENCH.thickness / 2, top.position.z);
  slab.receiveShadow = true;
  group.add(slab);

  // Thin satin edge band — catches a crisp highlight line along the bench edge.
  const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.035, 0.035), hw.satinSteel);
  edge.position.set(top.position.x, -0.02, BENCH.zMax + 0.035);
  group.add(edge);

  // --- optical rail (dovetail profile, extruded along X) ---
  const railLen = BENCH.railXMax - BENCH.railXMin;
  const rw = BENCH.railWidth / 2;
  const rh = BENCH.railHeight;
  const profile = new THREE.Shape();
  profile.moveTo(-rw * 0.78, 0);
  profile.lineTo(rw * 0.78, 0);
  profile.lineTo(rw * 0.78, rh * 0.35);
  profile.lineTo(rw, rh * 0.62);
  profile.lineTo(rw, rh * 0.9);
  profile.lineTo(rw * 0.94, rh);
  profile.lineTo(-rw * 0.94, rh);
  profile.lineTo(-rw, rh * 0.9);
  profile.lineTo(-rw, rh * 0.62);
  profile.lineTo(-rw * 0.78, rh * 0.35);
  profile.closePath();
  const railGeo = new THREE.ExtrudeGeometry(profile, { depth: railLen, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
  railGeo.rotateY(Math.PI / 2);
  railGeo.translate(BENCH.railXMin, 0, 0);
  const rail = new THREE.Mesh(railGeo, hw.anodizedBlack);
  rail.position.z = LAYOUT.axisZ;
  rail.castShadow = true;
  rail.receiveShadow = true;
  group.add(rail);

  // Engraved scale on the rail's top face
  const scaleTex = railScale(railLen, 0);
  const scaleMat = new THREE.MeshPhysicalMaterial({
    map: scaleTex,
    metalness: 0.5,
    roughness: 0.42,
    clearcoat: 0.4,
    transparent: false,
  });
  const scaleStrip = new THREE.Mesh(new THREE.PlaneGeometry(railLen, BENCH.railWidth * 0.62), scaleMat);
  scaleStrip.rotation.x = -Math.PI / 2;
  scaleStrip.position.set(BENCH.railXMin + railLen / 2, rh + 0.0015, LAYOUT.axisZ + BENCH.railWidth * 0.08);
  scaleStrip.receiveShadow = true;
  group.add(scaleStrip);

  // End stops
  for (const x of [BENCH.railXMin - 0.03, BENCH.railXMax + 0.03]) {
    const stop = new THREE.Mesh(new RoundedBoxGeometry(0.1, rh + 0.08, BENCH.railWidth + 0.1, 2, 0.02), hw.satinSteel);
    stop.position.set(x, (rh + 0.08) / 2, LAYOUT.axisZ);
    stop.castShadow = true;
    group.add(stop);
  }

  return group;
}

/**
 * A rail carrier + optical post rising to `height`, centred at world X `x`.
 * Returns the group; the top of the post is at y = height.
 */
export function createPostOnCarrier(hw: HardwareMaterials, x: number, height: number, postRadius = 0.085): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, LAYOUT.axisZ);
  const rh = BENCH.railHeight;

  const carrier = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.2, BENCH.railWidth + 0.26, 3, 0.03), hw.anodizedBlack);
  carrier.position.y = rh + 0.1;
  carrier.castShadow = true;
  carrier.receiveShadow = true;
  g.add(carrier);

  // locking thumb screw on the side
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 24), hw.satinSteel);
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0, rh + 0.1, (BENCH.railWidth + 0.26) / 2 + 0.04);
  knob.castShadow = true;
  g.add(knob);

  // post holder (slightly wider tube)
  const holderH = 0.55;
  const holder = new THREE.Mesh(new THREE.CylinderGeometry(postRadius * 1.55, postRadius * 1.6, holderH, 40), hw.anodizedBlack);
  holder.position.y = rh + 0.2 + holderH / 2;
  holder.castShadow = true;
  g.add(holder);

  const postLen = height - (rh + 0.2 + holderH * 0.4);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(postRadius, postRadius, postLen, 40), hw.satinSteel);
  post.position.y = rh + 0.2 + holderH * 0.4 + postLen / 2;
  post.castShadow = true;
  g.add(post);

  return g;
}

/**
 * Saddle cradle on a rail carrier: the lens barrel rests in a circular cut-out of radius
 * `barrelRadius` centred on the optical axis.
 */
export function createLensCradle(hw: HardwareMaterials, x: number, axisY: number, barrelRadius: number, length = 0.36): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, LAYOUT.axisZ);
  const rh = BENCH.railHeight;

  const carrier = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.2, BENCH.railWidth + 0.3, 3, 0.03), hw.anodizedBlack);
  carrier.position.y = rh + 0.1;
  carrier.castShadow = carrier.receiveShadow = true;
  g.add(carrier);

  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 24), hw.satinSteel);
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0, rh + 0.1, (BENCH.railWidth + 0.3) / 2 + 0.04);
  g.add(knob);

  const base = rh + 0.2;
  const halfW = barrelRadius * 0.86;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, base);
  shape.lineTo(halfW, base);
  // right side up to the saddle
  const zEdge = halfW;
  const yEdge = axisY - Math.sqrt(Math.max(0, barrelRadius * barrelRadius - zEdge * zEdge));
  shape.lineTo(halfW, yEdge);
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const z = halfW - (2 * halfW * i) / steps;
    const y = axisY - Math.sqrt(Math.max(0, barrelRadius * barrelRadius - z * z));
    shape.lineTo(z, y);
  }
  shape.lineTo(-halfW, base);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 4 });
  // shape is in (z, y); extrude along +Z → rotate so extrusion runs along X
  geo.rotateY(-Math.PI / 2);
  geo.translate(length / 2, 0, 0);
  const saddle = new THREE.Mesh(geo, hw.anodizedBlack);
  saddle.castShadow = saddle.receiveShadow = true;
  g.add(saddle);

  // satin locking screws on the saddle's front face
  for (const y of [base + 0.12, yEdge - 0.08]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 20), hw.satinSteel);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(0, y, halfW + 0.015);
    g.add(screw);
  }
  return g;
}
