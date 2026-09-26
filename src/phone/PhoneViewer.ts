import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PhoneCamera, PhoneData } from '../data/types';
import { createStudioEnvironment } from '../scene/environment';
import { CUT_PHI_LENGTH, revolve, ringProfile } from '../scene/lens/revolve';
import { GlowLines } from '../scene/rays/GlowLines';
import { LabelLayer } from '../ui/labels';
import { cameraOptics, moduleKind, ROLE_LABEL, type CameraOptics, type ModuleKind } from './phoneOptics';

/**
 * Procedural 3D teardown of a phone's camera modules (all dimensions in mm).
 * The phone is generic (no maker's design, logo or trade dress); the island only follows the published
 * arrangement type. Each camera is a cut-away module: flex PCB, image sensor sized from its published
 * optical format (or pixel count × pitch), sensor-shift stage or lens-shift OIS, IR-cut filter, a
 * plastic aspheric lens stack (published element count, else an illustrative stack), voice-coil motor and
 * cover glass. Folded telephotos are drawn as a classic periscope, a tetraprism-style 4-reflection fold or
 * lenses-on-prism, following the maker's description. Shapes and spacings are schematic.
 */

const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const PHONE = { w: 76, h: 162, t: 8.2, r: 11 };
/** How far the selected module lifts out of the phone when exploded (mm). */
const LIFT = 16;
/** Back surface of the phone (z = 0); the screen is at z = −PHONE.t. */
const BACK_Z = 0;

interface Part {
  object: THREE.Object3D;
  base: THREE.Vector3;
  exploded: THREE.Vector3;
  label?: { id: string; html: string; anchor: THREE.Vector3; below?: boolean };
}

interface Module {
  camera: PhoneCamera;
  optics: CameraOptics;
  kind: ModuleKind;
  group: THREE.Group;
  parts: Part[];
  /** Light path polylines in module-local coordinates (drawn with glow when selected). */
  rays: THREE.Vector3[][];
  /** Folded modules: the path at explode amount e (parts separate along the light path). */
  rayFn?: (e: number) => THREE.Vector3[][];
  /** Where the orbit camera looks at when this module is selected (module-local). */
  focus: THREE.Vector3;
  front: boolean;
  illustrative: string[];
  /** Moving part for the stabilisation / focus demo. */
  wobble: { object: THREE.Object3D; axis: THREE.Vector3; amount: number } | null;
  /** Radius of the window the camera looks out of (mm). */
  aperture: number;
  /** Resting z of the module group (the exploded module lifts out of the phone). */
  baseZ: number;
  /** Height of the exploded stack (module-local z range) for framing. */
  span: [number, number];
}

/** Positions of the cameras in the island per published arrangement (mm from the island centre). */
function islandSlots(layout: PhoneData['moduleLayout'], roles: PhoneCamera['role'][]): { island: { x: number; y: number; w: number; h: number; round: number }; slot: (role: PhoneCamera['role'], i: number) => THREE.Vector2 } {
  const top = PHONE.h / 2;
  switch (layout) {
    case 'triangle-square':
      return {
        island: { x: -PHONE.w / 2 + 24, y: top - 24, w: 40, h: 40, round: 10 },
        slot: (r) => (r === 'main' ? V2(-8.5, 8.5) : r === 'ultra-wide' ? V2(-8.5, -8.5) : V2(9, 0)),
      };
    case 'vertical-rings': {
      // individual rings in one column (no raised plate)
      const order: PhoneCamera['role'][] = ['ultra-wide', 'main', 'telephoto', 'periscope'];
      return {
        island: { x: -PHONE.w / 2 + 16, y: top - 42, w: 0, h: 0, round: 0 },
        slot: (r) => V2(0, 27 - 18 * Math.max(0, order.indexOf(r))),
      };
    }
    case 'horizontal-bar': {
      const back: PhoneCamera['role'][] = roles.filter((r) => r !== 'front');
      return {
        island: { x: 0, y: top - 26, w: PHONE.w - 6, h: 22, round: 11 },
        slot: (r) => V2(-22 + 17 * Math.max(0, back.indexOf(r)), 0),
      };
    }
    case 'round-island':
      return {
        island: { x: 0, y: top - 34, w: 50, h: 50, round: 25 },
        slot: (r) => (r === 'main' ? V2(-10, 9) : r === 'ultra-wide' ? V2(10, 9) : r === 'periscope' ? V2(0, -11) : V2(-10, -9)),
      };
    case 'square-island-2x2':
    default:
      return {
        island: { x: -PHONE.w / 2 + 25, y: top - 25, w: 40, h: 40, round: 9 },
        slot: (r) => (r === 'main' ? V2(-9, 9) : r === 'ultra-wide' ? V2(9, 9) : r === 'periscope' ? V2(-9, -9) : V2(9, -9)),
      };
  }
}

export interface PhoneViewerState {
  exploded: number;
  light: boolean;
}

export class PhoneViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
  readonly controls: OrbitControls;
  private readonly labels: LabelLayer;
  private readonly lines = new GlowLines(400, { width: 2.4, intensity: 1.5, pulse: 1.4, depthTest: false, doubleSided: true });
  private phone: THREE.Group | null = null;
  private phoneMats: THREE.Material[] = [];
  private modules: Module[] = [];
  private selected = 0;
  private explodeTarget = 0;
  private explode = 0;
  private light = true;
  private running = false;
  private raf = 0;
  private last = 0;
  private t = 0;
  private fly: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; k: number } | null = null;
  private readonly mats = createMaterials();
  onSelect: (index: number) => void = () => {};

  constructor(
    private readonly host: HTMLElement,
    labelHost: HTMLElement,
  ) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.classList.add('ph-canvas');
    renderer.domElement.setAttribute('aria-label', '3D teardown of the phone camera module');
    host.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.scene.environment = createStudioEnvironment(renderer);
    this.scene.environmentIntensity = 0.85;
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(60, 90, 140);
    const rim = new THREE.DirectionalLight('#8fd8ff', 1.1);
    rim.position.set(-120, 40, -60);
    this.scene.add(key, rim, new THREE.AmbientLight('#aab6c8', 0.25));
    this.scene.add(this.lines.mesh);
    this.lines.mesh.renderOrder = 20;
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 420;
    this.controls.enablePan = false;
    this.labels = new LabelLayer(labelHost);
    this.resize();
  }

  // ------------------------------------------------------------------ content

  setPhone(p: PhoneData): void {
    if (this.phone) {
      this.scene.remove(this.phone);
      disposeTree(this.phone);
    }
    for (const m of this.modules) for (const part of m.parts) if (part.label) this.labels.remove(part.label.id);
    this.modules = [];
    this.phoneMats = [];
    const root = new THREE.Group();
    this.phone = root;
    this.scene.add(root);

    const roles = p.cameras.map((c) => c.role);
    const { island, slot } = islandSlots(p.moduleLayout, roles);

    // phone body: back glass, frame, screen
    const body = new THREE.Group();
    root.add(body);
    const own = <T extends THREE.Material>(m: T) => ((m.userData.owned = true), m);
    const back = new THREE.Mesh(new RoundedBoxGeometry(PHONE.w, PHONE.h, PHONE.t, 6, PHONE.r * 0.55), own(this.mats.backGlass.clone()));
    back.position.z = BACK_Z - PHONE.t / 2;
    const frame = new THREE.Mesh(new RoundedBoxGeometry(PHONE.w + 1.2, PHONE.h + 1.2, PHONE.t - 2.2, 6, PHONE.r * 0.5), own(this.mats.frame.clone()));
    frame.position.z = BACK_Z - PHONE.t / 2;
    const screen = new THREE.Mesh(new RoundedBoxGeometry(PHONE.w - 1.4, PHONE.h - 1.4, 0.6, 4, PHONE.r * 0.45), own(this.mats.screen.clone()));
    screen.position.z = -PHONE.t + 0.2;
    // island plateau
    const iw = Math.max(1, island.w);
    const ih = Math.max(1, island.h);
    const islandMesh = new THREE.Mesh(new RoundedBoxGeometry(iw, ih, 1.6, 6, Math.max(0.1, Math.min(island.round, iw / 2, ih / 2) * 0.98)), own(this.mats.island.clone()));
    islandMesh.position.set(island.x, island.y, BACK_Z + 0.6);
    islandMesh.visible = island.w > 0;
    body.add(back, frame, screen, islandMesh);
    for (const m of [back.material, frame.material, screen.material, islandMesh.material] as THREE.MeshPhysicalMaterial[]) {
      m.transparent = true;
      this.phoneMats.push(m);
    }

    // camera modules
    p.cameras.forEach((c, i) => {
      const optics = cameraOptics(p, c);
      const front = c.role === 'front';
      const pos = front ? V2(0, PHONE.h / 2 - 8) : slot(c.role, i).add(V2(island.x, island.y));
      const mod = buildModule(c, i, optics, this.mats, front);
      mod.group.position.set(pos.x, pos.y, front ? -PHONE.t : 0);
      mod.baseZ = mod.group.position.z;
      if (front) mod.group.rotation.y = Math.PI;
      // periscopes run along the phone towards its centre line
      if (mod.kind !== 'straight' && pos.x > 0) mod.group.rotation.z = Math.PI;
      root.add(mod.group);
      // lens rings / windows in the back glass
      if (!front) body.add(windowRing(mod, pos, this.mats));
      this.modules.push(mod);
    });
    this.selected = Math.max(0, p.cameras.findIndex((c) => c.role === 'main'));
    this.frameSelected(false);
  }

  get cameraCount(): number {
    return this.modules.length;
  }

  select(index: number): void {
    if (index < 0 || index >= this.modules.length) return;
    this.selected = index;
    this.frameSelected(true);
    this.onSelect(index);
  }

  setExploded(on: boolean): void {
    this.explodeTarget = on ? 1 : 0;
    this.frameSelected(true);
  }

  setLight(on: boolean): void {
    this.light = on;
  }

  /** Notes on what is illustrative for the selected camera. */
  illustrative(): string[] {
    return this.modules[this.selected]?.illustrative ?? [];
  }

  private frameSelected(animate: boolean): void {
    const m = this.modules[this.selected];
    if (!m) return;
    const exploded = this.explodeTarget > 0.5;
    m.group.updateMatrixWorld(true);
    let target: THREE.Vector3;
    let dir: THREE.Vector3;
    let dist: number;
    if (exploded) {
      // side view of the module lifted out of the phone: the layers separate on screen
      // centre of the exploded stack, with the module lifted out of the phone
      const z0 = m.group.position.z;
      m.group.position.z = m.baseZ + (m.front ? -LIFT : LIFT);
      m.group.updateMatrixWorld(true);
      target = m.group.localToWorld(new THREE.Vector3(m.focus.x, m.focus.y, (m.span[0] + m.span[1]) / 2));
      m.group.position.z = z0;
      m.group.updateMatrixWorld(true);
      dir = m.kind !== 'straight' ? new THREE.Vector3(0.22, -1, 0.3) : m.front ? new THREE.Vector3(0.9, -0.55, -0.35) : new THREE.Vector3(0.9, -0.55, 0.35);
      dist = Math.max(70, (m.span[1] - m.span[0]) * 3.4);
    } else {
      target = m.group.localToWorld(new THREE.Vector3(m.focus.x, m.focus.y, 0));
      dir = m.front ? new THREE.Vector3(0.3, -0.25, -1) : new THREE.Vector3(0.42, -0.6, 1);
      dist = 150;
    }
    const pos = target.clone().add(dir.normalize().multiplyScalar(dist));
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.fly = { from: this.camera.position.clone(), to: pos, fromT: this.controls.target.clone(), toT: target, k: 0 };
  }

  // ------------------------------------------------------------------ loop

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame(Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Renders one frame with a fixed step (screenshots). */
  renderOnce(dt = 1 / 60, settle = false): void {
    if (settle) {
      this.explode = this.explodeTarget;
      if (this.fly) {
        this.camera.position.copy(this.fly.to);
        this.controls.target.copy(this.fly.toT);
        this.fly = null;
      }
    }
    this.frame(dt);
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.lines.setResolution(v.x, v.y);
  }

  private frame(dt: number): void {
    this.t += dt;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.explode += (this.explodeTarget - this.explode) * (1 - Math.exp(-dt * 4.5));
    if (Math.abs(this.explode - this.explodeTarget) < 1e-3) this.explode = this.explodeTarget;
    if (this.fly) {
      this.fly.k = Math.min(1, this.fly.k + dt / 0.9);
      const k = ease(this.fly.k);
      this.camera.position.lerpVectors(this.fly.from, this.fly.to, k);
      this.controls.target.lerpVectors(this.fly.fromT, this.fly.toT, k);
      if (this.fly.k >= 1) this.fly = null;
    }
    this.controls.update();

    const e = ease(this.explode);
    // the phone steps back and turns to glass so the selected module can come apart
    const sel = this.modules[this.selected];
    if (this.phone) {
      for (const m of this.modules) {
        const isSel = m === sel;
        for (const p of m.parts) p.object.position.lerpVectors(p.base, p.exploded, isSel ? e : 0);
        m.group.visible = isSel || e < 0.98;
        m.group.position.z = m.baseZ + (isSel ? e * LIFT * (m.front ? -1 : 1) : 0);
      }
      for (const mat of this.phoneMats) (mat as THREE.MeshPhysicalMaterial).opacity = 1 - 0.9 * e;
      for (const mat of this.phoneMats) mat.depthWrite = e < 0.5;
    }
    // stabilisation / focus demo: the moving element drifts gently while the view is idle
    if (sel?.wobble && !reduce) {
      // added on top of this frame's (re-computed) part position, so it never accumulates
      const k = Math.sin(this.t * 1.7) * 0.6 + Math.sin(this.t * 3.1) * 0.4;
      sel.wobble.object.position.addScaledVector(sel.wobble.axis, k * sel.wobble.amount);
    }

    // light
    this.lines.begin();
    this.lines.setTime(reduce ? 0 : this.t);
    if (this.light && sel) {
      sel.group.updateMatrixWorld(true);
      const col = new THREE.Color('#ffe7a8');
      for (const ray of sel.rayFn ? sel.rayFn(e) : sel.rays) {
        const pts = ray.map((p) => sel.group.localToWorld(p.clone()));
        this.lines.addPolyline(pts, col, 0.9 * (1 - 0.6 * e), 0, 1);
      }
    }
    this.lines.end();

    // labels (selected module, exploded)
    for (const m of this.modules) {
      for (const p of m.parts) {
        if (!p.label) continue;
        this.labels.ensure(p.label.id, { className: 'part', html: p.label.html, priority: 3 });
        const world = m.group.localToWorld(p.object.position.clone().add(p.label.anchor));
        this.labels.place(p.label.id, world, this.camera, m === sel && e > 0.6, [0, p.label.below ? 16 : -14]);
      }
    }
    this.labels.resolve();
    this.labels.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.stop();
    if (this.phone) disposeTree(this.phone);
    this.lines.mesh.geometry.dispose();
    this.lines.material.dispose();
    this.renderer.dispose();
    this.controls.dispose();
    this.renderer.domElement.remove();
  }
}

// ---------------------------------------------------------------- materials

function createMaterials() {
  return {
    backGlass: new THREE.MeshPhysicalMaterial({ color: '#1b1f26', metalness: 0.1, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18 }),
    frame: new THREE.MeshPhysicalMaterial({ color: '#8d939b', metalness: 1, roughness: 0.38 }),
    screen: new THREE.MeshPhysicalMaterial({ color: '#05060a', metalness: 0.2, roughness: 0.1, clearcoat: 1 }),
    island: new THREE.MeshPhysicalMaterial({ color: '#23272e', metalness: 0.2, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 }),
    ring: new THREE.MeshPhysicalMaterial({ color: '#b6bcc4', metalness: 1, roughness: 0.26 }),
    cover: new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.5, ior: 1.77, iridescence: 0.6, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 420], transparent: true, opacity: 0.55, depthWrite: false }),
    lens: new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.8, ior: 1.6, attenuationColor: new THREE.Color('#e9fbff'), attenuationDistance: 6, iridescence: 0.5, iridescenceIOR: 1.33, iridescenceThicknessRange: [200, 450], side: THREE.DoubleSide, transparent: true, opacity: 0.75, depthWrite: false }),
    barrel: new THREE.MeshPhysicalMaterial({ color: '#0e0f12', metalness: 0.2, roughness: 0.55, clearcoat: 0.3 }),
    cut: new THREE.MeshStandardMaterial({ color: '#8f96a0', metalness: 0.85, roughness: 0.35 }),
    vcm: new THREE.MeshPhysicalMaterial({ color: '#2a2e35', metalness: 0.9, roughness: 0.32 }),
    coil: new THREE.MeshPhysicalMaterial({ color: '#c8773a', metalness: 1, roughness: 0.3, clearcoat: 0.6 }),
    magnet: new THREE.MeshPhysicalMaterial({ color: '#6c737c', metalness: 1, roughness: 0.45 }),
    ir: new THREE.MeshPhysicalMaterial({ color: '#bfe6ff', metalness: 0, roughness: 0.05, transmission: 0.9, thickness: 0.3, iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [300, 700], transparent: true, opacity: 0.7, depthWrite: false }),
    die: new THREE.MeshPhysicalMaterial({ color: '#1a1030', metalness: 0.6, roughness: 0.2, iridescence: 1, iridescenceIOR: 2.0, iridescenceThicknessRange: [250, 800], clearcoat: 1 }),
    ceramic: new THREE.MeshPhysicalMaterial({ color: '#d9d2c3', metalness: 0, roughness: 0.6 }),
    pcb: new THREE.MeshPhysicalMaterial({ color: '#16361f', metalness: 0.2, roughness: 0.5, clearcoat: 0.6 }),
    gold: new THREE.MeshPhysicalMaterial({ color: '#d8b25a', metalness: 1, roughness: 0.3 }),
    stage: new THREE.MeshPhysicalMaterial({ color: '#9aa1ab', metalness: 1, roughness: 0.3 }),
    prism: new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.03, transmission: 1, thickness: 3, ior: 1.75, attenuationColor: new THREE.Color('#dff6ff'), attenuationDistance: 12, iridescence: 0.3, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    mirror: new THREE.MeshStandardMaterial({ color: '#dfe9f5', metalness: 1, roughness: 0.08, side: THREE.DoubleSide }),
  };
}
type Materials = ReturnType<typeof createMaterials>;

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) if (mat.userData.owned) mat.dispose();
  });
}

// ---------------------------------------------------------------- geometry helpers

/**
 * Revolve a (r, h) profile around the module's optical axis (+Z). With `cut`, the quarter at +x / −y
 * (towards the default viewpoint) is removed so the inside shows.
 */
function revolveZ(profile: THREE.Vector2[], cut = true, segments = 72): THREE.BufferGeometry {
  const g = revolve(profile, { segments, phiLength: cut ? CUT_PHI_LENGTH : Math.PI * 2, caps: cut, groups: cut });
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI));
  return g;
}
/** Same around the X axis (lens groups of periscopes). */
function revolveX(profile: THREE.Vector2[], cut = true, segments = 64): THREE.BufferGeometry {
  return revolve(profile, { segments, phiLength: cut ? CUT_PHI_LENGTH : Math.PI * 2, caps: cut, groups: cut });
}

interface PhoneElement {
  a: number;
  t: number;
  front: [number, number];
  rear: [number, number];
}
const sagOf = (a: number, [c2, c4]: [number, number], r: number) => {
  const rho = r / a;
  return a * (c2 * rho * rho + c4 * rho ** 4);
};
/** Closed profile of a phone lens element (front vertex at h = 0, rear below). */
function elementProfile(e: PhoneElement): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const r = (i / n) * e.a;
    pts.push(V2(r, -e.t + sagOf(e.a, e.rear, r)));
  }
  for (let i = n; i >= 0; i--) {
    const r = (i / n) * e.a;
    pts.push(V2(r, -sagOf(e.a, e.front, r)));
  }
  return pts;
}

/**
 * Plastic aspheric stack of a phone camera: small positive front element, growing clear apertures
 * towards the sensor and a wide "gull-wing" last element (inflected rear surface) — the typical
 * shape of phone lens designs. Returns element vertex positions (front → rear, h from the stack top).
 */
function phoneStack(n: number, aFront: number, aRear: number, length: number): { els: PhoneElement[]; h: number[] } {
  const els: PhoneElement[] = [];
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 1 : i / (n - 1);
    const a = aFront + (aRear - aFront) * Math.pow(k, 1.6);
    let front: [number, number];
    let rear: [number, number];
    if (i === 0) {
      front = [0.32, 0.02];
      rear = [0.06, 0];
    } else if (i === n - 1) {
      // gull wing: concave centre, convex edge
      front = [0.12, -0.2];
      rear = [-0.18, 0.34];
    } else if (i === n - 2) {
      front = [-0.1, 0.18];
      rear = [-0.2, 0.12];
    } else if (i % 2 === 1) {
      front = [-0.1, 0.02];
      rear = [-0.22, 0.04];
    } else {
      front = [0.14, -0.04];
      rear = [0.12, -0.06];
    }
    const edgeMin = Math.max(0.12, 0.06 * a);
    const sagSum = sagOf(a, front, a) + sagOf(a, rear, a);
    const t = Math.max(i === n - 1 ? 0.35 : 0.25, 0.1 * a, edgeMin + sagSum, edgeMin + sagOf(a, front, a * 0.6) + sagOf(a, rear, a * 0.6));
    els.push({ a, t, front, rear });
  }
  // pack against the real profiles, then stretch the air to the requested length
  const h = [0];
  for (let i = 1; i < n; i++) {
    const p = els[i - 1];
    const c = els[i];
    let min = Infinity;
    const rMax = Math.max(p.a, c.a);
    for (let k = 0; k <= 24; k++) {
      const r = (k / 24) * rMax;
      const rearP = r <= p.a ? -p.t + sagOf(p.a, p.rear, r) : -p.t + sagOf(p.a, p.rear, p.a) - 0.08;
      const frontC = r <= c.a ? -sagOf(c.a, c.front, r) : -sagOf(c.a, c.front, c.a) + 0.08;
      min = Math.min(min, rearP - frontC);
    }
    h.push(h[i - 1] + min - 0.08);
  }
  const used = -(h[n - 1] - els[n - 1].t);
  const extra = Math.max(0, length - used) / Math.max(1, n - 1);
  for (let i = 1; i < n; i++) h[i] -= extra * i;
  return { els, h };
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  parent.add(m);
  return m;
}

function labelHtml(title: string, value?: string): string {
  return value ? `${title} <span class="v">${value}</span>` : title;
}

// ---------------------------------------------------------------- modules

function buildModule(c: PhoneCamera, index: number, optics: CameraOptics, M: Materials, front: boolean): Module {
  const kind = moduleKind(c);
  const group = new THREE.Group();
  group.name = `camera:${c.role}`;
  const illustrative: string[] = [];
  const sensor = optics.sensor?.value ?? null;
  if (!sensor) illustrative.push('sensor size not published — drawn at an illustrative size');
  const s = sensor ?? (c.role === 'front' ? { width: 4.6, height: 3.4 } : { width: 5.8, height: 4.3 });
  const diag = Math.hypot(s.width, s.height);
  const f = optics.realFocal?.value ?? null;
  const nEl = c.lensElements ?? (c.role === 'main' ? 7 : c.role === 'front' ? 5 : 6);
  if (!c.lensElements) illustrative.push(`element count not published — ${nEl} elements drawn`);
  const af = !!c.autofocus && !/fixed/i.test(c.autofocus);
  const ois = (c.stabilization ?? '').toLowerCase();
  const sensorShift = ois.includes('sensor');
  const lensShift = !sensorShift && ois.includes('ois');
  const parts: Part[] = [];
  const add = (o: THREE.Object3D, explodedOffset: THREE.Vector3, label?: Part['label']) => {
    group.add(o);
    parts.push({ object: o, base: o.position.clone(), exploded: o.position.clone().add(explodedOffset), label });
    return o;
  };
  const id = (p: string) => `ph-${index}-${p}`;
  const sensorLabel = labelHtml('Image sensor', `${sensor ? `${s.width.toFixed(1)} × ${s.height.toFixed(1)} mm` : 'size unpublished'}${c.megapixels ? ` · ${c.megapixels} MP` : ''}`);
  let wobble: Module['wobble'] = null;

  // ---- sensor board: flex PCB, ceramic package, die (+ sensor-shift stage)
  const sensorGroup = (normal: 'z' | 'x') => {
    const g = new THREE.Group();
    // an upright sensor (end of a periscope) keeps its long side in the phone's plane: swap so that,
    // after turning the board to face −x, the short side is the vertical one
    const w = normal === 'x' ? s.height : s.width;
    const hgt = normal === 'x' ? s.width : s.height;
    const pkgW = w + 2.2;
    const pkgH = hgt + 2.2;
    const pcb = new THREE.Mesh(new RoundedBoxGeometry(pkgW + (normal === 'x' ? 0.8 : 3), pkgH + (normal === 'x' ? 1.5 : 3), 0.45, 2, 0.2), M.pcb);
    pcb.position.z = -1.35;
    const pkg = new THREE.Mesh(new RoundedBoxGeometry(pkgW, pkgH, 0.9, 2, 0.15), M.ceramic);
    pkg.position.z = -0.6;
    const die = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 0.14), M.die);
    die.position.z = -0.08;
    const pads = new THREE.Mesh(new THREE.BoxGeometry(pkgW - 0.5, 0.35, 0.06), M.gold);
    pads.position.set(0, -pkgH / 2 + 0.3, -0.13);
    g.add(pcb, pkg, die, pads);
    if (normal === 'x') g.rotation.y = -Math.PI / 2;
    return g;
  };

  if (kind === 'straight') {
    // heights (module-local z, sensor surface at 0)
    const aRear = Math.min(diag / 2 * 0.92, diag / 2);
    const epSemi = f && c.aperture ? f / c.aperture / 2 : aRear * 0.32;
    const aFront = Math.min(aRear * 0.7, Math.max(epSemi * 1.08, 0.9));
    const stackLen = f ? THREE.MathUtils.clamp(f * 0.72, 2.6, 7.2) : THREE.MathUtils.clamp(diag * 0.55, 2.6, 6);
    if (!f) illustrative.push('focal length not published — lens height illustrative');
    const bfl = 1.15;
    const zStackBottom = bfl;
    const { els, h } = phoneStack(nEl, aFront, aRear, stackLen);
    const stackTop = zStackBottom + stackLen;
    const Rb = Math.max(...els.map((e) => e.a)) + 0.35;

    // sensor + optional sensor-shift stage
    const sg = sensorGroup('z');
    if (sensorShift) {
      const stage = new THREE.Mesh(revolveZ(ringProfile(Math.hypot(s.width, s.height) / 2 + 1.4, Math.hypot(s.width, s.height) / 2 + 1.9, -1.6, -1.1), false, 4), M.stage);
      stage.rotation.z = Math.PI / 4;
      sg.add(stage);
      wobble = { object: sg, axis: new THREE.Vector3(1, 0.4, 0).normalize(), amount: 0.12 };
    }
    add(sg, new THREE.Vector3(0, 0, 0.6), { id: id('sensor'), html: sensorShift ? `${sensorLabel}<br><span class="v">on a sensor-shift OIS stage</span>` : sensorLabel, anchor: new THREE.Vector3(0, s.height / 2 + 1.6, 0) });

    // IR-cut filter
    const ir = new THREE.Mesh(new RoundedBoxGeometry(s.width + 1.2, s.height + 1.2, 0.28, 2, 0.1), M.ir);
    ir.position.z = 0.55;
    add(ir, new THREE.Vector3(0, 0, 2.2), { id: id('ir'), html: labelHtml('IR-cut filter', 'blocks infrared'), anchor: new THREE.Vector3(0, -(s.height + 1.2) / 2 - 0.3, 0.2), below: true });

    // lens barrel + elements (cut away)
    const barrel = new THREE.Group();
    barrel.position.z = stackTop;
    const bodyProfile = [V2(Rb, -stackLen - 0.35), V2(Rb + 0.55, -stackLen - 0.35), V2(Rb + 0.55, 0.45), V2(aFront * 1.05, 0.45), V2(aFront * 1.05, 0.2), V2(Rb, 0.2)];
    mesh(revolveZ(bodyProfile), [M.barrel, M.cut], barrel);
    const elGroups: THREE.Object3D[] = [];
    els.forEach((e, i) => {
      const g = new THREE.Group();
      g.position.z = h[i];
      mesh(revolveZ(elementProfile(e), false, 64), M.lens, g).renderOrder = 3;
      barrel.add(g);
      elGroups.push(g);
    });
    add(barrel, new THREE.Vector3(0, 0, 7 + diag * 0.25), { id: id('lens'), html: labelHtml('Lens stack', `${nEl} plastic aspheric elements${c.lensElements ? '' : ' (illustrative)'}${c.aperture ? ` · f/${c.aperture}` : ''}`), anchor: new THREE.Vector3(0, -Rb - 0.7, -stackLen / 2), below: true });
    // exploded: the elements also fan out inside the barrel
    elGroups.forEach((g, i) => {
      parts.push({ object: g, base: g.position.clone(), exploded: g.position.clone().add(new THREE.Vector3(0, 0, (els.length - 1 - i) * 1.1)) });
    });

    // voice-coil motor (AF) — lens-shift OIS adds side coils
    if (af) {
      const vcm = new THREE.Group();
      const side = Rb * 2 + 3.2;
      const vh = stackLen * 0.8;
      // 3 segments over 270° = three sides of a square (the fourth is the cut-away)
      const housing = new THREE.Mesh(revolveZ([V2(Rb + 0.7, 0), V2((side / 2) * Math.SQRT2, 0), V2((side / 2) * Math.SQRT2, vh), V2(Rb + 0.7, vh)], true, 3), [M.vcm, M.cut]);
      housing.rotation.z = Math.PI / 4;
      vcm.add(housing);
      const coil = new THREE.Mesh(revolveZ(ringProfile(Rb + 0.62, Rb + 0.95, vh * 0.25, vh * 0.75), true, 48), [M.coil, M.coil]);
      vcm.add(coil);
      for (let i = 0; i < 4; i++) {
        const mag = new THREE.Mesh(new THREE.BoxGeometry(side * 0.42, 0.7, vh * 0.55), M.magnet);
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        mag.position.set(Math.cos(a) * (Rb + 1.45), Math.sin(a) * (Rb + 1.45), vh / 2);
        mag.rotation.z = a + Math.PI / 2;
        if (a > Math.PI * 1.5 && a < Math.PI * 2) continue; // inside the cut-away quarter
        vcm.add(mag);
      }
      vcm.position.z = zStackBottom + 0.05;
      add(vcm, new THREE.Vector3(0, 0, 4 + diag * 0.12), { id: id('vcm'), html: labelHtml('Voice-coil motor', lensShift ? 'autofocus + lens-shift OIS' : 'moves the lens to focus'), anchor: new THREE.Vector3(0, side / 2 + 0.2, vh / 2) });
      if (lensShift) wobble = { object: barrel, axis: new THREE.Vector3(1, 0.3, 0).normalize(), amount: 0.1 };
    }

    // cover glass + ring
    const coverZ = stackTop + 1.1;
    const cover = new THREE.Group();
    cover.position.z = coverZ;
    mesh(revolveZ([V2(0, 0), V2(Rb + 0.9, 0), V2(Rb + 0.9, 0.35), V2(0, 0.35)], false, 64), M.cover, cover).renderOrder = 4;
    add(cover, new THREE.Vector3(0, 0, 11 + diag * 0.35), { id: id('cover'), html: labelHtml('Cover glass', 'protective window'), anchor: new THREE.Vector3(0, Rb + 1.1, 0.3) });

    // light: parallel beam through the window converging on the sensor centre
    const rays: THREE.Vector3[][] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const r = aFront * 0.85;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      rays.push([new THREE.Vector3(x, y, coverZ + 16), new THREE.Vector3(x, y, stackTop + 0.3), new THREE.Vector3(x * 1.5, y * 1.5, zStackBottom + stackLen * 0.4), new THREE.Vector3(0, 0, 0.02)]);
    }
    rays.push([new THREE.Vector3(0, 0, coverZ + 16), new THREE.Vector3(0, 0, 0.02)]);

    // module height: sensor surface sits this far below the back glass
    const drop = coverZ + 0.35 - (front ? 0.2 : 1.9);
    for (const p of parts) {
      p.base.z -= drop;
      p.exploded.z -= drop;
      p.object.position.z -= drop;
    }
    for (const r of rays) for (const p of r) p.z -= drop;
    const zTop = coverZ + 11 + diag * 0.35 - drop;
    return { camera: c, optics, kind, group, parts, rays, focus: new THREE.Vector3(0, 0, stackTop / 2 - drop + 2), front, illustrative, wobble, aperture: Rb + 0.9, span: [-1.4 - drop, zTop], baseZ: 0 };
  }

  // ---------------- folded telephotos (module-local: x along the phone, z out of the back)
  // exploded parts move only along the light path, so the drawn path stays connected
  const rays: THREE.Vector3[][] = [];
  let rayFn: Module['rayFn'];
  const SENSOR_DX = 8;
  const fPath = f ?? 16;
  if (!f) illustrative.push('real focal length not published — folded path length illustrative');
  const topZ = 1.7;
  const aLens = THREE.MathUtils.clamp(diag * 0.28, 1.6, 2.8);
  const prismS = 5.2;
  const prismCz = -2.9;
  const lensLen = THREE.MathUtils.clamp(fPath * 0.34, 4, 9);
  const addPrism = (x: number, z: number, size: number, rot: number) => {
    // right angle at (+x, +z): light enters the top face, reflects (TIR) off the 45° face, leaves towards +x
    const shape = new THREE.Shape([V2(size / 2, -size / 2), V2(size / 2, size / 2), V2(-size / 2, size / 2)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: size, bevelEnabled: false });
    geo.translate(0, 0, -size / 2);
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, M.prism);
    m.renderOrder = 3;
    m.rotation.y = rot;
    m.position.set(x, 0, z);
    return m;
  };
  const lensGroupX = (x0: number, len: number, n: number, a: number) => {
    const g = new THREE.Group();
    const els: PhoneElement[] = [];
    for (let i = 0; i < n; i++) els.push({ a: a * (1 - 0.12 * (i % 2)), t: 0.7, front: i % 2 ? [-0.12, 0] : [0.18, 0], rear: i % 2 ? [-0.1, 0] : [0.14, 0] });
    const step = len / Math.max(1, n);
    els.forEach((e, i) => {
      const eg = new THREE.Group();
      eg.position.x = x0 + step * (i + 0.5);
      // lens profile is along h: rotate so the optical axis is +X (towards the prism is front)
      const geo = revolveX(elementProfile(e), false, 48);
      geo.rotateY(Math.PI);
      mesh(geo, M.lens, eg).renderOrder = 3;
      g.add(eg);
    });
    const barrel = revolveX([V2(a + 0.2, -len), V2(a + 0.55, -len), V2(a + 0.55, 0), V2(a + 0.2, 0)]);
    barrel.rotateY(Math.PI);
    const b = new THREE.Mesh(barrel, [M.barrel, M.cut]);
    b.position.x = x0;
    g.add(b);
    return g;
  };

  const win = new THREE.Group();
  mesh(revolveZ([V2(0, 0), V2(3.1, 0), V2(3.1, 0.35), V2(0, 0.35)], false, 48), M.cover, win).renderOrder = 4;
  win.position.z = topZ;
  add(win, new THREE.Vector3(0, 0, 10), { id: id('cover'), html: labelHtml('Cover glass'), anchor: new THREE.Vector3(0, 0, 0.6) });

  let sensorX = 0;
  if (kind === 'periscope' || kind === 'lenses-on-prism') {
    // prism under the window turns the light 90° into the phone
    const prism = addPrism(0, prismCz, prismS, 0);
    add(prism, new THREE.Vector3(0, 0, 0), { id: id('prism'), html: labelHtml('Prism', 'folds the light 90°'), anchor: new THREE.Vector3(0, 0, -prismS / 2 - 0.3), below: true });
    let lensGroup: THREE.Object3D;
    if (kind === 'lenses-on-prism') {
      // lenses sit on the prism, looking out of the phone
      lensGroup = new THREE.Group();
      const { els, h } = phoneStack(4, aLens * 0.8, aLens, 2.0);
      els.forEach((e, i) => {
        const g = new THREE.Group();
        g.position.z = h[i];
        mesh(revolveZ(elementProfile(e), false, 48), M.lens, g).renderOrder = 3;
        lensGroup.add(g);
      });
      lensGroup.position.z = prismCz + prismS / 2 + 2.3;
      add(lensGroup, new THREE.Vector3(0, 0, 7.5), { id: id('lens'), html: labelHtml('Lenses on the prism', c.lensElements ? `${c.lensElements} elements` : 'illustrative'), anchor: new THREE.Vector3(aLens + 1, 0, 0.8) });
      sensorX = prismS / 2 + fPath * 0.35;
    } else {
      lensGroup = lensGroupX(prismS / 2 + 0.8, lensLen, c.lensElements ? Math.min(c.lensElements, 6) : 5, aLens);
      lensGroup.position.z = prismCz;
      add(lensGroup, new THREE.Vector3(4, 0, 0), { id: id('lens'), html: labelHtml('Periscope lens group', c.lensElements ? `${c.lensElements} elements` : 'illustrative'), anchor: new THREE.Vector3(prismS / 2 + 0.8 + lensLen / 2, 0, aLens + 0.7) });
      if (af) wobble = { object: lensGroup, axis: new THREE.Vector3(1, 0, 0), amount: 0.25 };
      sensorX = prismS / 2 + 0.8 + lensLen + THREE.MathUtils.clamp(fPath * 0.28, 2.5, 7);
    }
    const sg = sensorGroup('x');
    sg.position.set(sensorX, 0, prismCz);
    add(sg, new THREE.Vector3(SENSOR_DX, 0, 0), { id: id('sensor'), html: `${sensorLabel}<br><span class="v">stands upright at the end of the fold</span>`, anchor: new THREE.Vector3(0, 0, -s.height / 2 - 1.2), below: true });
    const sx = sensorX;
    const lensStart = prismS / 2 + 0.8;
    rayFn = (e) => {
      const out: THREE.Vector3[][] = [];
      for (let i = -2; i <= 2; i++) {
        const y = i * aLens * 0.3;
        out.push([new THREE.Vector3(i * 0.5, y, topZ + 16), new THREE.Vector3(i * 0.5, y, prismCz - i * 0.5), new THREE.Vector3(lensStart + (kind === 'periscope' ? 4 * e : 0), y * 0.9, prismCz - i * 0.4), new THREE.Vector3(sx - 0.1 + SENSOR_DX * e, 0, prismCz)]);
      }
      return out;
    };
    rays.push(...rayFn(0));
  } else {
    // tetraprism-style: lens group under the window, then a glass block that reflects the light four times
    const { els, h } = phoneStack(c.lensElements ? Math.min(c.lensElements, 5) : 4, aLens * 0.85, aLens, 2.2);
    const lg = new THREE.Group();
    els.forEach((e, i) => {
      const g = new THREE.Group();
      g.position.z = h[i];
      mesh(revolveZ(elementProfile(e), false, 48), M.lens, g).renderOrder = 3;
      lg.add(g);
    });
    lg.position.z = topZ - 0.6;
    add(lg, new THREE.Vector3(0, 0, 7), { id: id('lens'), html: labelHtml('Lens group', c.lensElements ? `${c.lensElements} elements` : 'illustrative'), anchor: new THREE.Vector3(-aLens - 0.6, 0, -1.2), below: true });
    const P = [
      new THREE.Vector3(0, 0, topZ + 16),
      new THREE.Vector3(0, 0, -2.2), // reflection 1
      new THREE.Vector3(3.6, 0, -2.2), // reflection 2
      new THREE.Vector3(3.6, 0, -0.5), // reflection 3
      new THREE.Vector3(7.2, 0, -0.5), // reflection 4
      new THREE.Vector3(7.2, 0, -4.9), // sensor
    ];
    const block = new THREE.Group();
    const shape = new THREE.Shape([V2(-2.0, -1.2), V2(-2.0, -2.4), V2(-0.8, -3.4), V2(8.4, -3.4), V2(8.4, 0.6), V2(7.2, 0.6), V2(6.2, 0.6), V2(1.9, 0.6), V2(1.9, -1.2)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
    geo.translate(0, 0, -2.5);
    geo.rotateX(Math.PI / 2);
    mesh(geo, M.prism, block).renderOrder = 3;
    // reflecting surfaces (45° mirrors at the four bounce points)
    // normals: down→+x (1,0,1), +x→up (−1,0,1), up→+x (−1,0,1), +x→down (1,0,1)
    const tilt = [Math.PI / 4, -Math.PI / 4, -Math.PI / 4, Math.PI / 4];
    for (let i = 1; i <= 4; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 4.2), M.mirror);
      m.position.copy(P[i]);
      m.rotation.set(0, tilt[i - 1], 0);
      block.add(m);
    }
    add(block, new THREE.Vector3(0, 0, 0), { id: id('prism'), html: labelHtml('Tetraprism', 'light reflects 4 times (illustrative path)'), anchor: new THREE.Vector3(6, 0, 0.8) });
    const sg = sensorGroup('z');
    sg.position.set(7.2, 0, -4.9);
    add(sg, new THREE.Vector3(0, 0, -4), { id: id('sensor'), html: `${sensorLabel}<br><span class="v">lies flat under the fold</span>`, anchor: new THREE.Vector3(0, 0, -1), below: true });
    if (sensorShift) wobble = { object: sg, axis: new THREE.Vector3(1, 0.4, 0).normalize(), amount: 0.12 };
    rayFn = (e) =>
      [-0.9, -0.3, 0.3, 0.9].map((dy) =>
        P.map((p, k) => p.clone().add(new THREE.Vector3(0, dy, k === P.length - 1 ? -4 * e : 0))),
      );
    rays.push(...rayFn(0));
    sensorX = 7.2;
  }
  return { camera: c, optics, kind, group, parts, rays, rayFn, focus: new THREE.Vector3(sensorX / 2 + 3, 0, -1.5), front, illustrative, wobble, aperture: 3.1, span: [-6, 12], baseZ: 0 };
}

/** Metal ring + dark window where a camera looks out through the back glass / island. */
function windowRing(mod: Module, pos: THREE.Vector2, M: Materials): THREE.Object3D {
  const r = mod.kind === 'straight' ? THREE.MathUtils.clamp(mod.aperture + 1.4, 3.6, 8.2) : 3.8;
  const g = new THREE.Group();
  const ring = new THREE.Mesh(revolveZ([V2(r - 0.9, 1.35), V2(r, 1.35), V2(r, 2.3), V2(r - 0.9, 2.3)], false, 64), M.ring);
  g.add(ring);
  if (mod.kind !== 'straight') {
    // folded cameras look out through a square-ish window
    ring.scale.set(1, 1, 1);
  }
  g.position.set(pos.x, pos.y, BACK_Z - 0.6);
  g.userData.role = ROLE_LABEL[mod.camera.role];
  return g;
}

