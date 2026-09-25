import * as THREE from 'three';
import { createNoise2D, rng } from './noise';

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return [canvas, ctx];
}

export function canvasTexture(
  canvas: HTMLCanvasElement,
  opts: { srgb?: boolean; repeat?: [number, number]; anisotropy?: number } = {},
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  tex.anisotropy = opts.anisotropy ?? 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Converts a height field (0..1, row-major) into a tangent-space normal map canvas. */
export function heightToNormal(
  height: Float32Array,
  w: number,
  h: number,
  strength: number,
  wrap = true,
): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const at = (x: number, y: number) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else {
      x = Math.min(w - 1, Math.max(0, x));
      y = Math.min(h - 1, Math.max(0, y));
    }
    return height[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      // canvas y grows downwards, texture v grows upwards → flip dy
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** roughness in G, metalness in B (glTF convention). */
  ormMap: THREE.Texture;
}

/**
 * One tile of an optical breadboard: black-anodised aluminium with a single tapped hole and a
 * bright machined chamfer. Repeated across the bench.
 */
export function breadboardTile(repeat: [number, number]): PbrSet {
  const S = 256;
  const noise = createNoise2D(11);
  const height = new Float32Array(S * S);
  const [colC, colX] = makeCanvas(S, S);
  const [ormC, ormX] = makeCanvas(S, S);
  const col = colX.createImageData(S, S);
  const orm = ormX.createImageData(S, S);
  const rHole = S * 0.118;
  const rChamfer = S * 0.152;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - S / 2;
      const dy = y + 0.5 - S / 2;
      const r = Math.hypot(dx, dy);
      const grain = noise(x / 9, y / 9) * 0.5 + noise(x / 2.5, y / 2.5) * 0.5;
      // height: flat top 1, chamfer slope, deep hole
      const hChamfer = smooth(rHole, rChamfer, r);
      const inHole = r < rHole;
      height[y * S + x] = inHole ? 0 : 0.35 + 0.65 * hChamfer;
      const i = (y * S + x) * 4;
      let c: number;
      let rough: number;
      let metal: number;
      if (inHole) {
        // thread rings inside the hole
        const ring = 0.5 + 0.5 * Math.sin(r * 2.2);
        c = 6 + ring * 6;
        rough = 0.8;
        metal = 0.6;
      } else if (r < rChamfer) {
        const k = 1 - hChamfer;
        c = 40 + 110 * k + grain * 6;
        rough = 0.5 - 0.28 * k;
        metal = 0.75 + 0.25 * k;
      } else {
        c = 27 + grain * 3;
        rough = 0.56 + grain * 0.06;
        metal = 0.45;
      }
      col.data[i] = c * 0.94;
      col.data[i + 1] = c * 0.97;
      col.data[i + 2] = c;
      col.data[i + 3] = 255;
      orm.data[i] = 255;
      orm.data[i + 1] = rough * 255;
      orm.data[i + 2] = metal * 255;
      orm.data[i + 3] = 255;
    }
  }
  colX.putImageData(col, 0, 0);
  ormX.putImageData(orm, 0, 0);
  const nrm = heightToNormal(height, S, S, 2.2);
  return {
    map: canvasTexture(colC, { srgb: true, repeat }),
    normalMap: canvasTexture(nrm, { repeat }),
    ormMap: canvasTexture(ormC, { repeat }),
  };
}

/** Fine brushed-metal streaks (normal + roughness) — tileable horizontally. */
export function brushedMetal(repeat: [number, number], seed = 3): { normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  const W = 512;
  const H = 512;
  const random = rng(seed);
  const height = new Float32Array(W * H);
  // streaks along X
  const rows = new Float32Array(H);
  for (let y = 0; y < H; y++) rows[y] = random();
  const noise = createNoise2D(seed + 7);
  const [rC, rX] = makeCanvas(W, H);
  const rImg = rX.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const streak = rows[y] * 0.6 + rows[(y + 1) % H] * 0.4;
      const v = streak * 0.7 + (noise(x / 60, y / 1.5) * 0.5 + 0.5) * 0.3;
      height[y * W + x] = v;
      const i = (y * W + x) * 4;
      const rough = 0.8 + v * 0.2;
      rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = rough * 255;
      rImg.data[i + 3] = 255;
    }
  }
  rX.putImageData(rImg, 0, 0);
  const nrm = heightToNormal(height, W, H, 0.6);
  return {
    normalMap: canvasTexture(nrm, { repeat }),
    roughnessMap: canvasTexture(rC, { repeat }),
  };
}

/**
 * Engraved millimetre-style scale for the optical rail's top face.
 * `length` world units long, ticks every 0.1, labels every unit.
 */
export function railScale(length: number, startValue: number): THREE.Texture {
  const pxPerUnit = 256;
  const W = Math.min(8192, Math.round(length * pxPerUnit));
  const H = 96;
  const [c, x] = makeCanvas(W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a1c20');
  g.addColorStop(0.5, '#23262b');
  g.addColorStop(1, '#1a1c20');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  const scale = W / length;
  x.strokeStyle = 'rgba(235,238,245,0.85)';
  x.fillStyle = 'rgba(235,238,245,0.92)';
  x.font = '600 26px "JetBrains Mono Variable", ui-monospace, monospace';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const n = Math.round(length * 10);
  for (let i = 0; i <= n; i++) {
    const px = i * (scale / 10);
    const major = i % 10 === 0;
    const half = i % 5 === 0;
    x.lineWidth = major ? 3 : 1.6;
    const len = major ? 30 : half ? 20 : 11;
    x.beginPath();
    x.moveTo(px, 0);
    x.lineTo(px, len);
    x.stroke();
    if (major) {
      const v = Math.round((startValue + i / 10) * 100);
      x.fillText(`${v}`, px + (i === 0 ? 18 : i === n ? -22 : 0), 60);
    }
  }
  const tex = canvasTexture(c, { srgb: true });
  return tex;
}
