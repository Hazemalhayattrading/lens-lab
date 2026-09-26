/**
 * Smooth, monotonic map between a physical subject distance (mm, from the lens)
 * and a normalised depth u ∈ [0, 1] used both for the diorama layout and the
 * focus slider:  w(d) = d / (d + d₀),  u = (w − w(d_near)) / (1 − w(d_near)).
 * u = 0 at the closest focus distance, u = 1 at infinity.
 */
export class DepthMap {
  private readonly wNear: number;

  constructor(
    /** Shape parameter d₀ (mm): distances around d₀ land mid-way. */
    readonly d0: number,
    /** Physical distance mapped to u = 0 (mm). */
    readonly dNear: number,
  ) {
    this.wNear = dNear / (dNear + d0);
  }

  private w(d: number): number {
    return Number.isFinite(d) ? d / (d + this.d0) : 1;
  }

  /** Physical distance → normalised depth. Values below dNear give u < 0. */
  toU(d: number): number {
    return (this.w(d) - this.wNear) / (1 - this.wNear);
  }

  /** Normalised depth → physical distance (u ≥ 1 → ∞, u at/below the lens → 0). */
  fromU(u: number): number {
    if (u >= 1) return Number.POSITIVE_INFINITY;
    const w = this.wNear + u * (1 - this.wNear);
    if (w <= 0) return 0;
    return (this.d0 * w) / (1 - w);
  }
}

/**
 * Phase 2 depth ladder: u(d) = 1 − (d_near / d)^γ, d(u) = d_near·(1 − u)^(−1/γ).
 * A power law in distance spreads near *and* far subjects (γ = 0.3: 0.3 m → 0.11, 2 m → 0.50,
 * 30 m → 0.78, 200 m → 0.87, ∞ → 1), is smooth, and inverts in closed form (the sensor-view
 * shader does it per pixel). Distances are measured from the focal plane.
 */
export class PowerDepthMap {
  constructor(
    /** Physical distance mapped to u = 0 (mm). */
    readonly dNear: number,
    /** Exponent γ ∈ (0, 1): smaller values give far distances more room. */
    readonly gamma: number,
  ) {}

  /** Physical distance → normalised depth (u < 0 below dNear, 1 at ∞). */
  toU(d: number): number {
    if (!Number.isFinite(d)) return 1;
    if (d <= 0) return Number.NEGATIVE_INFINITY;
    return 1 - Math.pow(this.dNear / d, this.gamma);
  }

  /** Normalised depth → physical distance (u ≥ 1 → ∞). */
  fromU(u: number): number {
    if (u >= 1) return Number.POSITIVE_INFINITY;
    return this.dNear * Math.pow(1 - u, -1 / this.gamma);
  }
}
