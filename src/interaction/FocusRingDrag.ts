import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** What the drag needs from the mounted lens. */
export interface RingTarget {
  readonly focusRingMeshes: THREE.Object3D[];
  readonly focusRing: THREE.Object3D;
  /** Rotation from ∞ to the closest focus (radians). */
  readonly ringThrow: number;
  setRingHover(amount: number): void;
}

/**
 * Lets the user grab the knurled focus ring and turn it. The grabbed point on the ring stays
 * under the pointer: the pointer ray is intersected with the ring's cylinder and the change of
 * angle around the optical axis turns the ring. The ring position is reported as a fraction of
 * its throw (0 = ∞, 1 = closest focus); the app maps it onto the lens' focus curve.
 */
export class FocusRingDrag {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private dragging = false;
  private pointerId = -1;
  private radius = 1.2;
  private lastPhi = 0;
  private ringAngle = 0;
  private hover = false;
  /** Other rings on the same canvas: a pointer belongs to the ring nearest to the eye. */
  private peers: FocusRingDrag[] = [];
  onFraction: (fraction: number) => void = () => {};
  onDragStart: () => void = () => {};
  onDragEnd: () => void = () => {};
  /** 0..1 hover/drag glow, eased by the app. */
  glow = 0;

  constructor(
    private readonly dom: HTMLElement,
    private readonly camera: THREE.Camera,
    private readonly controls: OrbitControls,
    private lens: RingTarget,
    private readonly getFraction: () => number,
  ) {
    dom.addEventListener('pointerdown', this.onDown, { capture: true });
    dom.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  /** Rings that share a canvas (focus and zoom): only the nearest one under the pointer reacts. */
  static link(...drags: FocusRingDrag[]): void {
    for (const d of drags) d.peers = drags.filter((p) => p !== d);
  }

  /** Point the drag at another lens. */
  setLens(lens: RingTarget): void {
    this.lens = lens;
    this.hover = false;
  }

  get isDragging(): boolean {
    return this.dragging;
  }
  get isHovering(): boolean {
    return this.hover;
  }

  private setRay(e: PointerEvent): void {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  private ownHit(ray: THREE.Ray): THREE.Intersection | null {
    if (!this.lens.focusRingMeshes.length) return null;
    this.raycaster.ray.copy(ray);
    return this.raycaster.intersectObjects(this.lens.focusRingMeshes, false)[0] ?? null;
  }

  /** The hit on this ring, unless another ring is in front of it along the same ray. */
  private hitRing(): THREE.Intersection | null {
    const ray = this.raycaster.ray.clone();
    const hit = this.ownHit(ray);
    if (!hit) return null;
    for (const p of this.peers) {
      const other = p.ownHit(ray);
      if (other && other.distance < hit.distance) return null;
    }
    return hit;
  }

  private updateCursor(): void {
    if (this.dragging || this.peers.some((p) => p.dragging)) return;
    this.dom.style.cursor = this.hover || this.peers.some((p) => p.hover) ? 'grab' : '';
  }

  private axisCenter(): THREE.Vector3 {
    return this.lens.focusRing.getWorldPosition(new THREE.Vector3());
  }

  /** Angle around the X axis in the lathe convention (y = −r sin φ, z = r cos φ). */
  private phiOf(p: THREE.Vector3, c: THREE.Vector3): number {
    return Math.atan2(-(p.y - c.y), p.z - c.z);
  }

  /** Pointer ray ∩ ring cylinder (falls back to the closest approach when it misses). */
  private pointerPhi(): number | null {
    const c = this.axisCenter();
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    const oy = o.y - c.y;
    const oz = o.z - c.z;
    const a = d.y * d.y + d.z * d.z;
    if (a < 1e-8) return null; // looking straight down the axis
    const b = 2 * (oy * d.y + oz * d.z);
    const cc = oy * oy + oz * oz - this.radius * this.radius;
    const disc = b * b - 4 * a * cc;
    let t: number;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t0 = (-b - sq) / (2 * a);
      const t1 = (-b + sq) / (2 * a);
      t = t0 > 0 ? t0 : t1;
    } else {
      t = -b / (2 * a); // closest approach to the axis
    }
    const p = o.clone().addScaledVector(d, t);
    return this.phiOf(p, c);
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.setRay(e);
    const hit = this.hitRing();
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const c = this.axisCenter();
    this.radius = Math.hypot(hit.point.y - c.y, hit.point.z - c.z);
    this.lastPhi = this.phiOf(hit.point, c);
    this.ringAngle = this.getFraction() * this.lens.ringThrow;
    this.dragging = true;
    this.pointerId = e.pointerId;
    this.controls.enabled = false;
    this.dom.setPointerCapture?.(e.pointerId);
    this.dom.style.cursor = 'grabbing';
    this.onDragStart();
  };

  private onMove = (e: PointerEvent) => {
    this.setRay(e);
    if (this.dragging && e.pointerId === this.pointerId) {
      const phi = this.pointerPhi();
      if (phi === null) return;
      let dPhi = phi - this.lastPhi;
      if (dPhi > Math.PI) dPhi -= Math.PI * 2;
      if (dPhi < -Math.PI) dPhi += Math.PI * 2;
      this.lastPhi = phi;
      // the knurl follows the finger: a material point moving by +Δφ means the ring turned −Δφ
      const throwRad = this.lens.ringThrow;
      this.ringAngle = THREE.MathUtils.clamp(this.ringAngle - dPhi, 0, throwRad);
      this.onFraction(this.ringAngle / throwRad);
      return;
    }
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      const over = this.hitRing() !== null;
      if (over !== this.hover) {
        this.hover = over;
        this.updateCursor();
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.controls.enabled = true;
    this.dom.releasePointerCapture?.(e.pointerId);
    this.updateCursor();
    this.onDragEnd();
  };

  update(dt: number): void {
    const target = this.dragging ? 1 : this.hover ? 0.6 : 0;
    this.glow += (target - this.glow) * (1 - Math.exp(-dt * 10));
    this.lens.setRingHover(this.glow);
  }
}
