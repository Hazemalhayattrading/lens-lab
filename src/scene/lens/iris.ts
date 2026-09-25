import * as THREE from 'three';

/**
 * Nine-blade iris diaphragm. Blades are thin curved plates; each blade's working edge is a
 * straight line tangent to the aperture circle. As the iris closes, the tangent points rotate
 * slightly (as the blades pivot) and the opening becomes a nonagon — wide open it is circular
 * because the edges retreat behind the housing lip.
 */
export class Iris {
  readonly group = new THREE.Group();
  private readonly blades: THREE.Mesh[] = [];
  private readonly cols = 18;
  private readonly rows = 3;
  private lastRadius = -1;

  constructor(
    private readonly bladeCount: number,
    /** Housing (outer) radius the blades tuck under. */
    private readonly housingRadius: number,
    /** Radius of the fully-open aperture (circular lip). */
    readonly maxRadius: number,
    material: THREE.Material,
  ) {
    for (let i = 0; i < bladeCount; i++) {
      const geo = new THREE.BufferGeometry();
      const verts = (this.cols + 1) * (this.rows + 1);
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3 * 2), 3));
      const idx: number[] = [];
      const W = this.cols + 1;
      const layer = verts;
      for (let c = 0; c < this.cols; c++) {
        for (let r = 0; r < this.rows; r++) {
          const a = r * W + c;
          const b = a + 1;
          const d = a + W;
          const e = d + 1;
          // front (+x) face and back (−x) face
          idx.push(a, d, b, b, d, e);
          idx.push(layer + a, layer + b, layer + d, layer + b, layer + e, layer + d);
        }
      }
      // closing strip along the working edge (row 0) for a visible blade thickness
      for (let c = 0; c < this.cols; c++) {
        const a = c;
        const b = c + 1;
        idx.push(a, b, layer + a, b, layer + b, layer + a);
      }
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      this.blades.push(mesh);
      this.group.add(mesh);
    }
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
    for (let i = 0; i < n; i++) {
      const gamma = (i / n) * Math.PI * 2 + swing;
      const pos = this.blades[i].geometry.getAttribute('position') as THREE.BufferAttribute;
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
          const a = row * W + c;
          pos.setXYZ(a, base + tilt + 0.004, yy, zz);
          pos.setXYZ(layer + a, base + tilt - 0.004, yy, zz);
        }
      }
      pos.needsUpdate = true;
      this.blades[i].geometry.computeVertexNormals();
      this.blades[i].geometry.computeBoundingSphere();
    }
  }
}
