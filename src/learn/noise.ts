/**
 * Shot noise and multi-frame merging for the computational-photography explainer.
 *
 * Light arrives as photons. A pixel that expects λ photons during one exposure counts a Poisson
 * random number with mean λ and standard deviation √λ, so a single frame has SNR = λ/√λ = √λ.
 * Averaging N independent frames keeps the mean at λ and shrinks the standard deviation to √(λ/N):
 *
 *     SNR_N = √(λ·N) = SNR_1 · √N          (noise falls as 1/√N)
 *
 * Everything is seeded, so the pictures and the measured numbers are reproducible.
 */

/** Small, fast, seedable PRNG (mulberry32) returning uniform numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box–Muller). */
export function gaussian(rng: () => number): number {
  const u = 1 - rng(); // (0, 1]
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Poisson sample with mean λ: exact (Knuth) below 30, normal approximation above. */
export function poisson(rng: () => number, lambda: number): number {
  if (!(lambda > 0)) return 0;
  if (lambda < 30) {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = rng();
    while (p > limit) {
      k++;
      p *= rng();
    }
    return k;
  }
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gaussian(rng)));
}

/** N independent shot-noise exposures of the same (static, aligned) scene. */
export class FrameStack {
  readonly frames: Uint16Array[] = [];

  /**
   * @param expected expected photon count λ of every sample (pixel × channel) in one exposure
   * @param count    number of exposures to simulate
   */
  constructor(
    readonly expected: Float32Array,
    count: number,
    seed: number,
  ) {
    const rng = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      const f = new Uint16Array(expected.length);
      for (let j = 0; j < expected.length; j++) f[j] = poisson(rng, expected[j]);
      this.frames.push(f);
    }
  }

  get count(): number {
    return this.frames.length;
  }

  /** Average of the first n frames, in photons per sample. */
  merge(n: number, out = new Float32Array(this.expected.length)): Float32Array {
    const k = Math.max(1, Math.min(this.frames.length, Math.round(n)));
    out.fill(0);
    for (let i = 0; i < k; i++) {
      const f = this.frames[i];
      for (let j = 0; j < f.length; j++) out[j] += f[j];
    }
    for (let j = 0; j < out.length; j++) out[j] /= k;
    return out;
  }

  /** Measured SNR (mean / standard deviation) of the merge of the first n frames over the given samples. */
  snr(n: number, samples: ArrayLike<number>): number {
    const k = Math.max(1, Math.min(this.frames.length, Math.round(n)));
    const vals = new Float64Array(samples.length);
    for (let i = 0; i < k; i++) {
      const f = this.frames[i];
      for (let s = 0; s < samples.length; s++) vals[s] += f[samples[s]];
    }
    for (let s = 0; s < vals.length; s++) vals[s] /= k;
    return stats(vals).snr;
  }
}

export interface Stats {
  mean: number;
  std: number;
  snr: number;
}

/** Mean, (population) standard deviation and SNR = mean / std. */
export function stats(values: ArrayLike<number>): Stats {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const mean = sum / values.length;
  let sq = 0;
  for (let i = 0; i < values.length; i++) sq += (values[i] - mean) ** 2;
  const std = Math.sqrt(sq / values.length);
  return { mean, std, snr: std > 0 ? mean / std : Number.POSITIVE_INFINITY };
}

/** Theoretical SNR after merging n frames of a region that expects λ photons per exposure. */
export function theoreticalSnr(lambda: number, n: number): number {
  return Math.sqrt(lambda * n);
}
