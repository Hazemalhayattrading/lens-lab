import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../util/noise';
import { LAYOUT, OPTICAL_CENTER_X } from '../layout';
import { skyChunk, skyUniforms } from './skyShader';
import { GROUND_Y, LAKE, SNAG, SUBJECT_X, terrainHeight, TOWER } from './terrain';

/**
 * Hero subjects of the depth ladder, built procedurally. Every builder returns its group (world
 * coordinates) and the point whose light the ray bundles trace.
 */
export interface BuiltSubject {
  group: THREE.Group;
  point: THREE.Vector3;
}

const std = (color: THREE.ColorRepresentation, roughness = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

function meshOf(geos: THREE.BufferGeometry[], mat: THREE.Material, shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!, mat);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

/** Tube along a CatmullRom curve with a radius that tapers from r0 to r1. */
function taperedTube(points: THREE.Vector3[], r0: number, r1: number, radial = 8, seg = 24): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  // TubeGeometry lays vertices out ring by ring: (seg + 1) rings × (radial + 1)
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------------------------------ flower
/**
 * A cosmos-like flower on a tall stalk at 0.3 m — the macro subject. Its bloom faces the lens and
 * carries a ladybird, so a life-size macro frame has real detail to resolve.
 */
export function buildFlower(): BuiltSubject {
  const group = new THREE.Group();
  group.name = 'flower';
  const X = OPTICAL_CENTER_X + SUBJECT_X.flower;
  // just below and right of the centre: inside a life-size macro frame, clear of the bird and the cabin
  const Z = -0.24;
  const bloom = new THREE.Vector3(X, LAYOUT.axisY - 0.125, Z);
  const S = 0.72; // bloom scale
  const groundY = GROUND_Y + terrainHeight(SUBJECT_X.flower, Z) - 0.01;
  const random = rng(77);

  // stalk + two leaves
  const stalk = taperedTube(
    [new THREE.Vector3(X + 0.03, groundY, Z + 0.03), new THREE.Vector3(X + 0.035, groundY + 0.3, Z + 0.01), new THREE.Vector3(X + 0.015, bloom.y - 0.2, Z - 0.005), new THREE.Vector3(X + 0.004, bloom.y - 0.012, Z)],
    0.0075,
    0.0048,
  );
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.03, 0.03, 0, 0.13);
  leafShape.quadraticCurveTo(-0.03, 0.03, 0, 0);
  const leaves: THREE.BufferGeometry[] = [];
  for (const [h, a] of [[0.22, 0.9], [0.38, -1.1]] as const) {
    const g = new THREE.ShapeGeometry(leafShape, 6);
    g.rotateZ(-0.9 * Math.sign(a));
    g.rotateY(a);
    g.translate(X + 0.03, groundY + h, Z + 0.02);
    leaves.push(g);
  }
  const green = std('#4f7d33', 0.7, { side: THREE.DoubleSide });
  group.add(meshOf([stalk, ...leaves], green));

  // petals: 8 slightly cupped ovals around the disc, facing −X (the lens)
  const petals: THREE.BufferGeometry[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + random() * 0.08;
    const g = new THREE.SphereGeometry(1, 14, 8);
    g.scale(0.052 * S, 0.024 * S, 0.006 * S); // along the petal, across it, thickness
    g.translate(0.062 * S, 0, 0);
    // cup the petal slightly towards the lens
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      pos.setZ(k, pos.getZ(k) - Math.pow(x / (0.11 * S), 2) * 0.018 * S);
    }
    g.rotateZ(a);
    // petal plane (xy) → the plane facing −X: map local z to −X
    g.rotateY(Math.PI / 2);
    g.translate(bloom.x, bloom.y, bloom.z);
    petals.push(g);
  }
  group.add(meshOf(petals, std('#ea5fb6', 0.55, { emissive: '#3a0a26', emissiveIntensity: 0.25 })));

  // golden disc florets (bumpy dome)
  const disc = new THREE.SphereGeometry(0.027 * S, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const dp = disc.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 0; k < dp.count; k++) {
    const v = new THREE.Vector3().fromBufferAttribute(dp, k);
    v.multiplyScalar(1 + (random() - 0.5) * 0.12);
    v.y *= 0.55;
    dp.setXYZ(k, v.x, v.y, v.z);
  }
  disc.computeVertexNormals();
  disc.rotateZ(Math.PI / 2); // dome faces −X
  disc.translate(bloom.x - 0.004, bloom.y, bloom.z);
  group.add(meshOf([disc], std('#e7b428', 0.8)));

  // ladybird on the upper-left petal
  const lb = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), std('#d8231b', 0.25, { metalness: 0.1 }));
  shell.scale.set(1, 0.72, 1.18);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 10, 8), std('#111111', 0.35));
  head.position.set(0, 0.0005, 0.0115);
  lb.add(shell, head);
  const spotMat = std('#0d0d0d', 0.4);
  for (const [sx, sz] of [[0.005, 0.003], [-0.005, 0.003], [0.004, -0.005], [-0.004, -0.005], [0, 0.0]] as const) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), spotMat);
    s.position.set(sx, 0.0068, sz);
    s.scale.y = 0.4;
    lb.add(s);
  }
  // lie on the petal (petal plane faces −X): shell up = −X
  lb.rotation.set(0, 0, Math.PI / 2);
  lb.rotateX(-0.6);
  lb.position.set(bloom.x - 0.008, bloom.y + 0.05 * S, bloom.z + 0.03 * S);
  group.add(lb);

  return { group, point: bloom.clone().add(new THREE.Vector3(-0.02, 0, 0)) };
}

// ------------------------------------------------------------------------------------ bird on a snag
/**
 * A dead tree on the near lake shore with a kingfisher perched exactly on the optical axis at
 * 30 m: tiny at 16 mm, frame-filling at 600 mm.
 */
export function buildSnagAndBird(): BuiltSubject {
  const group = new THREE.Group();
  group.name = 'snag';
  const bx = OPTICAL_CENTER_X + SUBJECT_X.bird;
  const baseX = OPTICAL_CENTER_X + SNAG.x;
  const groundY = GROUND_Y + terrainHeight(SNAG.x, SNAG.z) - 0.02;
  const perchY = LAYOUT.axisY - 0.034; // top of the perch branch
  const perchZ = 0;

  // trunk: weathered, slightly leaning, broken top
  const trunk = taperedTube(
    [
      new THREE.Vector3(baseX + 0.02, groundY - 0.02, SNAG.z + 0.12),
      new THREE.Vector3(baseX + 0.015, groundY + 0.3, SNAG.z + 0.1),
      new THREE.Vector3(baseX + 0.0, perchY - 0.05, SNAG.z + 0.085),
      new THREE.Vector3(baseX - 0.01, perchY + 0.26, SNAG.z + 0.075),
    ],
    0.026,
    0.009,
    9,
    30,
  );
  // the perch: a side branch reaching out to the axis, plus two bare twigs
  const perch = taperedTube(
    [new THREE.Vector3(baseX, perchY - 0.045, SNAG.z + 0.09), new THREE.Vector3(bx + 0.008, perchY - 0.02, perchZ + 0.04), new THREE.Vector3(bx - 0.004, perchY - 0.006, perchZ - 0.05), new THREE.Vector3(bx - 0.012, perchY + 0.02, perchZ - 0.12)],
    0.0072,
    0.0022,
    7,
    24,
  );
  const twig1 = taperedTube([new THREE.Vector3(baseX - 0.004, perchY + 0.13, SNAG.z + 0.08), new THREE.Vector3(baseX - 0.02, perchY + 0.2, SNAG.z + 0.17), new THREE.Vector3(baseX - 0.03, perchY + 0.27, SNAG.z + 0.21)], 0.0055, 0.0015, 6, 12);
  const twig2 = taperedTube([new THREE.Vector3(baseX + 0.01, perchY + 0.05, SNAG.z + 0.085), new THREE.Vector3(baseX + 0.03, perchY + 0.1, SNAG.z + 0.0), new THREE.Vector3(baseX + 0.035, perchY + 0.16, SNAG.z - 0.05)], 0.005, 0.0014, 6, 12);
  group.add(meshOf([trunk, perch, twig1, twig2], std('#7c7166', 0.9)));

  // ---- kingfisher (local frame: +Z = where the bird faces, +Y up; turned towards the lens)
  const bird = new THREE.Group();
  const blue = std('#1596d6', 0.42, { emissive: '#04273a', emissiveIntensity: 0.4 });
  const cyan = std('#3fd0ff', 0.35, { emissive: '#073a4a', emissiveIntensity: 0.5 });
  const orange = std('#e4742b', 0.55);
  const white = std('#f1ebe0', 0.6);
  const black = std('#0b0b0c', 0.3);
  const red = std('#c9412e', 0.6);

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), orange);
  body.scale.set(0.024, 0.027, 0.04);
  body.position.set(0, 0.03, 0);
  body.rotation.x = 0.45;
  const back = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), blue);
  back.scale.set(0.0255, 0.028, 0.042);
  back.position.set(0, 0.032, -0.002);
  back.rotation.x = 0.45 - Math.PI / 2 + 0.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.02, 22, 16), blue);
  head.position.set(0, 0.066, 0.02);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.0195, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.45), cyan);
  crown.position.copy(head.position).add(new THREE.Vector3(0, 0.002, -0.001));
  const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 12, 10), orange);
  cheek.position.set(0.013, 0.063, 0.028);
  const cheekL = cheek.clone();
  cheekL.position.x = -0.013;
  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 10), white);
  throat.position.set(0, 0.052, 0.034);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.0055, 0.046, 10), black);
  beak.rotation.x = Math.PI / 2 + 0.12;
  beak.position.set(0, 0.063, 0.058);
  const eyeGeo = new THREE.SphereGeometry(0.0034, 10, 8);
  const eyeR = new THREE.Mesh(eyeGeo, black);
  eyeR.position.set(0.0138, 0.07, 0.03);
  const eyeL = eyeR.clone();
  eyeL.position.x = -0.0138;
  const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0009, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  glint.position.set(0.0158, 0.0712, 0.0312);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.005, 0.036), blue);
  tail.position.set(0, 0.005, -0.045);
  tail.rotation.x = -0.75;
  const wingGeo = new THREE.SphereGeometry(1, 16, 10);
  const wingR = new THREE.Mesh(wingGeo, blue);
  wingR.scale.set(0.006, 0.02, 0.036);
  wingR.position.set(0.021, 0.034, -0.006);
  wingR.rotation.x = 0.55;
  const wingL = wingR.clone();
  wingL.position.x = -0.021;
  const footGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 0.012, 6);
  const footR = new THREE.Mesh(footGeo, red);
  footR.position.set(0.006, 0.0, 0.004);
  const footL = footR.clone();
  footL.position.x = -0.006;
  bird.add(body, back, head, crown, cheek, cheekL, throat, beak, eyeR, eyeL, glint, tail, wingR, wingL, footR, footL);
  // perched on the axis, three-quarter view: facing left-and-towards the lens
  bird.position.set(bx, perchY, perchZ);
  bird.rotation.y = Math.PI + 0.42;
  bird.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  group.add(bird);

  // the traced point: the bird's eye region, on the optical axis
  bird.updateMatrixWorld(true);
  const eye = eyeR.getWorldPosition(new THREE.Vector3());
  return { group, point: new THREE.Vector3(bx, eye.y, 0) };
}

// ------------------------------------------------------------------------------------ lighthouse
/** Striped lighthouse on a rock islet in the lake at 200 m; its lamp is the traced point. */
export function buildLighthouse(): { group: THREE.Group; point: THREE.Vector3; lamp: THREE.PointLight } {
  const group = new THREE.Group();
  group.name = 'lighthouse';
  const cx = OPTICAL_CENTER_X + TOWER.x;
  const cz = TOWER.z;
  const water = GROUND_Y + LAKE.level;
  const random = rng(314);

  // rock islet: a cluster of jittered boulders
  const rocks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const r = 0.05 + random() * 0.07;
    const g = new THREE.DodecahedronGeometry(r, 1);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) * (1 + (random() - 0.5) * 0.3), pos.getY(k) * (0.7 + random() * 0.2), pos.getZ(k) * (1 + (random() - 0.5) * 0.3));
    const a = random() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.05 + random() * 0.1;
    g.translate(cx + Math.cos(a) * d, water + r * 0.35 + (i === 0 ? 0.03 : 0), cz + Math.sin(a) * d);
    rocks.push(g);
  }
  const rockMesh = meshOf(rocks, std('#5d5955', 0.95, { flatShading: true }));
  group.add(rockMesh);

  const base = water + 0.1;
  const H = 0.46;
  const r0 = 0.042;
  const r1 = 0.029;
  const bands = 5;
  const red = std('#b8322c', 0.55);
  const white = std('#ece8e1', 0.55);
  for (let i = 0; i < bands; i++) {
    const y0 = base + (i / bands) * H;
    const y1 = base + ((i + 1) / bands) * H;
    const ra = r0 + (r1 - r0) * (i / bands);
    const rb = r0 + (r1 - r0) * ((i + 1) / bands);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, y1 - y0, 24), i % 2 === 0 ? white : red);
    seg.position.set(cx, (y0 + y1) / 2, cz);
    seg.castShadow = true;
    group.add(seg);
  }
  const top = base + H;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(r1 + 0.012, r1 + 0.012, 0.008, 24), std('#2b2b2e', 0.5, { metalness: 0.6 }));
  gallery.position.set(cx, top + 0.004, cz);
  const lanternGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(r1 * 0.8, r1 * 0.8, 0.034, 20),
    new THREE.MeshStandardMaterial({ color: '#ffe7b0', emissive: '#ffcf6a', emissiveIntensity: 4.2, roughness: 0.2 }),
  );
  lanternGlass.position.set(cx, top + 0.026, cz);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(r1 * 0.95, 0.03, 20), red);
  cap.position.set(cx, top + 0.058, cz);
  const vane = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.02, 6), std('#222', 0.4));
  vane.position.set(cx, top + 0.082, cz);
  group.add(gallery, lanternGlass, cap, vane);
  // keeper's cottage on the islet
  const cottage = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.05), white);
  cottage.position.set(cx + 0.06, water + 0.1, cz - 0.07);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.035, 4), red);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(cx + 0.06, water + 0.14, cz - 0.07);
  group.add(cottage, roof);

  const point = new THREE.Vector3(cx, top + 0.026, cz);
  const lamp = new THREE.PointLight('#ffc873', 0.35, 1.4, 2);
  lamp.position.copy(point);
  group.add(lamp);
  return { group, point, lamp };
}

// ------------------------------------------------------------------------------------ water
const waterVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const waterFragment = /* glsl */ `
uniform vec3 uDeep;
varying vec3 vWorld;
${skyChunk}
void main() {
  vec3 v = normalize(vWorld - cameraPosition);
  // gentle ripples
  vec2 p = vWorld.xz * 38.0;
  float t = uSkyTime * 0.6;
  vec3 n = normalize(vec3(sin(p.x + t) * 0.03 + sin(p.y * 1.3 - t * 0.7) * 0.02, 1.0, cos(p.y + t * 0.8) * 0.03));
  vec3 r = reflect(v, n);
  r.y = abs(r.y);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
  vec3 sky = skyColor(normalize(r), 0.002) * 1.2;
  vec3 c = mix(uDeep, sky, clamp(fres, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Lake surface: dark water reflecting the procedural sky with a Fresnel term. */
export function buildWater(): THREE.Mesh {
  const shape = new THREE.Shape();
  const N = 72;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = LAKE.x + Math.cos(a) * LAKE.rx * 0.97;
    const z = LAKE.z + Math.sin(a) * LAKE.rz * 0.97;
    if (i === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(Math.PI / 2); // shape (x, y) → (x, 0, y)
  geo.translate(OPTICAL_CENTER_X, GROUND_Y + LAKE.level, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    uniforms: { ...skyUniforms, uDeep: { value: new THREE.Color('#0a1a22') } },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'lake';
  mesh.receiveShadow = false;
  return mesh;
}
