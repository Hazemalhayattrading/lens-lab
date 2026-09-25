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
