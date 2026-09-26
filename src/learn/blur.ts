/**
 * Image helpers for the portrait-mode explainer. Images are premultiplied RGBA in Float32Arrays
 * (4 floats per pixel, 0…1), so blurred layers composite without dark fringes.
 */

let prefix = new Float64Array(0);

/**
 * Uniform disc ("bokeh") blur of the given radius in pixels — the shape an out-of-focus point of light
 * really takes behind a round aperture. Row prefix sums make each output pixel cost O(radius).
 * Pixels outside the image are ignored (the average is taken over the part of the disc that is inside).
 */
export function discBlur(src: Float32Array, w: number, h: number, radius: number, out = new Float32Array(src.length)): Float32Array {
  if (!(radius >= 0.5)) {
    out.set(src);
    return out;
  }
  const W1 = w + 1;
  const need = h * W1 * 4;
  if (prefix.length < need) prefix = new Float64Array(need);
  const P = prefix;
  for (let y = 0; y < h; y++) {
    let o = y * W1 * 4;
    P[o] = P[o + 1] = P[o + 2] = P[o + 3] = 0;
    let s = y * w * 4;
    for (let x = 0; x < w; x++, o += 4, s += 4) {
      P[o + 4] = P[o] + src[s];
      P[o + 5] = P[o + 1] + src[s + 1];
      P[o + 6] = P[o + 2] + src[s + 2];
      P[o + 7] = P[o + 3] + src[s + 3];
    }
  }
  const R = Math.floor(radius);
  const half: number[] = [];
  for (let dy = -R; dy <= R; dy++) half.push(Math.floor(Math.sqrt(Math.max(0, radius * radius - dy * dy))));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let i = 0; i < half.length; i++) {
        const yy = y + i - R;
        if (yy < 0 || yy >= h) continue;
        const hw = half[i];
        const x0 = x - hw < 0 ? 0 : x - hw;
        const x1 = x + hw >= w ? w - 1 : x + hw;
        const lo = (yy * W1 + x0) * 4;
        const hi = (yy * W1 + x1 + 1) * 4;
        r += P[hi] - P[lo];
        g += P[hi + 1] - P[lo + 1];
        b += P[hi + 2] - P[lo + 2];
        a += P[hi + 3] - P[lo + 3];
        n += x1 - x0 + 1;
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return out;
}

/** Porter–Duff "over" for premultiplied RGBA, in place: dst = src + dst·(1 − src.a). */
export function over(dst: Float32Array, src: Float32Array): Float32Array {
  for (let i = 0; i < dst.length; i += 4) {
    const k = 1 - src[i + 3];
    dst[i] = src[i] + dst[i] * k;
    dst[i + 1] = src[i + 1] + dst[i + 1] * k;
    dst[i + 2] = src[i + 2] + dst[i + 2] * k;
    dst[i + 3] = src[i + 3] + dst[i + 3] * k;
  }
  return dst;
}

/** out = a·m + b·(1 − m) per pixel, m ∈ [0, 1] (one value per pixel). */
export function mix(a: Float32Array, b: Float32Array, m: Float32Array, out = new Float32Array(a.length)): Float32Array {
  for (let p = 0, i = 0; p < m.length; p++, i += 4) {
    const t = m[p];
    const u = 1 - t;
    out[i] = a[i] * t + b[i] * u;
    out[i + 1] = a[i + 1] * t + b[i + 1] * u;
    out[i + 2] = a[i + 2] * t + b[i + 2] * u;
    out[i + 3] = a[i + 3] * t + b[i + 3] * u;
  }
  return out;
}

/** Blur-disc diameter in pixels for a disc that is `frac` of the frame width, on an image `width` px wide. */
export function blurPixels(frac: number, width: number): number {
  return Math.max(0, frac * width);
}
