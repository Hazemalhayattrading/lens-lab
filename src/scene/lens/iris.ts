import * as THREE from 'three';

/**
 * Nine-blade iris diaphragm. Blades are thin curved plates; each blade's working edge is a
 * straight line tangent to the aperture circle. As the iris closes, the tangent points rotate
 * slightly (as the blades pivot) and the opening becomes a nonagon — wide open it is circular
 * because the edges retreat behind the housing lip.
 */
export class Iris {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly cols = 18;
  private readonly rows = 3;
  private readonly perBlade: number;
  private lastRadius = -1;

  constructor(
    private readonly bladeCount: number,
    /** Housing (outer) radius the blades tuck under. */
    private readonly housingRadius: number,
    /** Radius of the fully-open aperture (circular lip). */
    readonly maxRadius: number,
    material: THREE.Material,
  ) {
    // all blades share one geometry (one draw call); each blade = front + back sheet
    const W = this.cols + 1;
    const layer = (this.cols + 1) * (this.rows + 1);
    this.perBlade = layer * 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.perBlade * bladeCount * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < bladeCount; i++) {
      const o = i * this.perBlade;
      for (let c = 0; c < this.cols; c++) {
        for (let r = 0; r < this.rows; r++) {
          const a = o + r * W + c;
          const b = a + 1;
          const d = a + W;
          const e = d + 1;
          idx.push(a, d, b, b, d, e);
          idx.push(layer + a, layer + b, layer + d, layer + b, layer + e, layer + d);
        }
      }
      for (let c = 0; c < this.cols; c++) {
        const a = o + c;
        const b = a + 1;
        idx.push(a, b, layer + a, b, layer + b, layer + a);
      }
    }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  /** Set the aperture radius (world units). */
  setRadius(radius: number): void {
    const r = Math.min(radius, this.maxRadius * 1.02);
    if (Math.abs(r - this.lastRadius) < 1e-5) return;
    this.lastRadius = r;
    const n = this.bladeCount;
    const Rh = this.housingRadius;
    const span = ((Math.PI * 2) / n) * 1.95;
    // pivot geometry: tangent point angle advances as the blade swings in
    const Rp = Rh * 0.98;
    const e = Rh * 0.12;
    const openness = THREE.MathUtils.clamp((e + r) / Rp, -1, 1);
    const swing = Math.acos(openness);
    const W = this.cols + 1;
    const layer = (this.cols + 1) * (this.rows + 1);
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const gamma = (i / n) * Math.PI * 2 + swing;
      const o = i * this.perBlade;
      for (let c = 0; c <= this.cols; c++) {
        const t = c / this.cols;
        const psi = gamma - span / 2 + t * span;
        const cosd = Math.cos(psi - gamma);
        // working edge: line at distance r from the centre with normal direction gamma
        const rhoEdge = cosd > 1e-3 ? Math.min(r / cosd, Rh) : Rh;
        // blades are gently tilted: one end rides over the next blade (fish-scale stacking)
        const tilt = (t - 0.5) * 0.028;
        for (let row = 0; row <= this.rows; row++) {
          const k = row / this.rows;
          const rho = rhoEdge + (Rh - rhoEdge) * k;
          const yy = rho * Math.cos(psi);
          const zz = rho * Math.sin(psi);
          const base = i * 0.0009;
          const a = o + row * W + c;
          pos.setXYZ(a, base + tilt + 0.004, yy, zz);
          pos.setXYZ(layer + a, base + tilt - 0.004, yy, zz);
        }
      }
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}
