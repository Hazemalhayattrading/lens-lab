import { describe, expect, it } from 'vitest';
import realPhones from '../data/phones/phones-apple-samsung-google.json';
import type { PhoneCamera, PhoneData } from '../src/data/types';
import { blurPixels, discBlur, mix, over } from '../src/learn/blur';
import { foldLayout, pointAt, polylineLength, type FoldInput } from '../src/learn/fold';
import { FrameStack, mulberry32, poisson, stats, theoreticalSnr } from '../src/learn/noise';
import {
  EXAMPLE_TELE_FORMAT,
  compareWithFullFrame,
  depthOfField,
  equivalence,
  mainCameras,
  normalizeFormat,
  periscopeCameras,
  periscopeNumbers,
  sensorFormats,
} from '../src/learn/physics';
import { FORMAT_SIZES, FULL_FRAME } from '../src/optics/formats';

/**
 * Hand calculations for the Learn explainers (checked with a pocket-calculator script).
 * FF diagonal d = √(36² + 24²) = 43.2666 mm. An optical format 1/x" has a diagonal of ≈ 16/x mm, 4:3.
 *
 * P — phone main cameras (published: format, 35 mm-equivalent focal length, f-number):
 *     Pixel 11 Pro 1/1.3", 24 mm, f/1.68: d = 16/1.3 = 12.3077 → 9.8462 × 7.3846 mm,
 *       crop = 43.2666/12.3077 = 3.5154, f = 24/3.5154 = 6.8271 mm, N_eq = 1.68·3.5154 = f/5.906,
 *       c = 12.3077/1442 = 0.008535 mm.
 *     iPhone 18 Pro 1/1.28", 24 mm, f/1.48: d = 12.5, crop 3.4613, f = 6.9338 mm, N_eq = f/5.123.
 *     Galaxy S26 Ultra 1/1.3", 23 mm, f/1.4: crop 3.5154, f = 23/3.5154 = 6.5426 mm, N_eq = f/4.922.
 * Q — depth of field, subject T = 2 m from the focal plane (u = (T + √(T² − 4Tf))/2, near/far + v):
 *     phone 6.827 mm f/1.68, c 0.008535: u = 1993.15, H = f²/(Nc) + f = 3257.3 →
 *       near = u(H − f)/(H + u − 2f) + v = 1244.0, far = u(H − f)/(H − u) + v = 5131.7, DoF 3887.7 mm.
 *     FF 24 mm f/1.68, c 0.0300: u = 1975.7, H = 11 450.8 → near 1711.8, far 2407.0, DoF 695.2 mm.
 *     FF 24 mm f/5.906 (equivalent): H = 3274.5 → near 1258.8, far 4968.9, DoF 3710.1 mm
 *       (H − f = f²/(Nc) is identical to the phone's: 576/(5.906·0.0300) = 46.61/(1.68·0.008535) = 3250.5).
 *     background at ∞: b = f²/(N(u − f)): phone 46.61/(1.68·1986.32) = 0.013967 mm = 0.1419 % of 9.846 mm;
 *       FF f/1.68: 576/(1.68·1951.7) = 0.17567 mm = 0.4880 % of 36 mm; FF f/5.906: 0.049972 mm = 0.1388 %.
 *     T = 10 m: the phone is beyond its hyperfocal distance (3.26 m) → far = ∞, near = 2460.8 mm.
 * R — equivalence calculator: APS-C 23.5 × 15.6 (d 28.2066, crop 1.53392), 56 mm f/1.2 → 85.90 mm, f/1.841;
 *     angle of view D = 2·atan(28.2066/112) = 28.27°, H = 2·atan(23.5/112) = 23.70°; light 1/crop² = 0.4250.
 * S — periscopes: Pixel 11 Pro 5× 1/1.95", 105 mm, f/2.8: d 8.2051, crop 5.2731, f = 19.912 mm,
 *       pupil f/N = 7.1115 mm; overhang in an 8 mm phone 11.91 mm.
 *     Galaxy S26 Ultra 5× 1/2.52", f/2.9, no published eq. focal → 5 × 23 = 115 mm (computed),
 *       crop 6.8145, f = 16.876 mm.  iPhone 18 Pro tetraprism 100 mm f/2.8, sensor not published →
 *       example 1/2.5" (d 6.4, crop 6.7604) → f = 14.792 mm.
 */

const cam = (c: Partial<PhoneCamera> & Pick<PhoneCamera, 'role'>): PhoneCamera => ({
  label: c.role,
  megapixels: null,
  sensorFormat: null,
  pixelSizeUm: null,
  eqFocalMm: null,
  aperture: null,
  opticalZoom: null,
  stabilization: null,
  autofocus: null,
  ...c,
});
const phone = (id: string, brand: PhoneData['brand'], name: string, cameras: PhoneCamera[]): PhoneData => ({
  id,
  brand,
  name,
  announced: '2026-09',
  moduleLayout: 'horizontal-bar',
  cameras,
  computational: [],
  summary: '',
  sources: [],
  checked: '2026-09-25',
});

/** The published values the explainers use (same as data/phones, trimmed to what matters here). */
const FIXTURE: PhoneData[] = [
  phone('apple', 'Apple', 'iPhone 18 Pro / Pro Max', [
    cam({ role: 'main', sensorFormat: '1/1.28"', eqFocalMm: 24, aperture: 1.48, opticalZoom: 1 }),
    cam({ role: 'ultra-wide', eqFocalMm: 13, aperture: 2.2, opticalZoom: 0.5 }),
    cam({ role: 'periscope', eqFocalMm: 100, aperture: 2.8, opticalZoom: 4, folded: true, prism: 'tetraprism' }),
  ]),
  phone('samsung', 'Samsung', 'Galaxy S26 Ultra', [
    cam({ role: 'main', sensorFormat: '1/1.3"', eqFocalMm: 23, aperture: 1.4, opticalZoom: 1 }),
    cam({ role: 'ultra-wide', sensorFormat: '1/2.5"', aperture: 1.9 }),
    cam({ role: 'telephoto', sensorFormat: '1/3.94"', aperture: 2.4, opticalZoom: 3 }),
    cam({ role: 'periscope', sensorFormat: '1/2.52"', aperture: 2.9, opticalZoom: 5, folded: true }),
  ]),
  phone('google', 'Google', 'Pixel 11 Pro / Pro XL', [
    cam({ role: 'main', sensorFormat: '1/1.3"', eqFocalMm: 24, aperture: 1.68, opticalZoom: 1 }),
    cam({ role: 'periscope', sensorFormat: '1/1.95"', eqFocalMm: 105, aperture: 2.8, opticalZoom: 5, folded: true }),
  ]),
];

const byPhone = <T extends { phoneId: string }>(list: T[], id: string) => list.find((c) => c.phoneId === id)!;

describe('phone camera examples (P, S)', () => {
  it('derives the real focal length and equivalent aperture of the main cameras', () => {
    const mains = mainCameras(FIXTURE);
    expect(mains.map((c) => c.phoneId)).toEqual(['apple', 'samsung', 'google']);
    const px = byPhone(mains, 'google');
    expect(px.sensor.width).toBeCloseTo(9.8462, 3);
    expect(px.sensor.height).toBeCloseTo(7.3846, 3);
    expect(px.crop).toBeCloseTo(3.5154, 3);
    expect(px.realFocal).toBeCloseTo(6.8271, 3);
    expect(px.realFocalFrom).toBe('computed');
    expect(px.eqAperture).toBeCloseTo(5.906, 3);
    expect(px.coc).toBeCloseTo(0.008535, 5);
    const ip = byPhone(mains, 'apple');
    expect(ip.crop).toBeCloseTo(3.4613, 3);
    expect(ip.realFocal).toBeCloseTo(6.9338, 3);
    expect(ip.eqAperture).toBeCloseTo(5.123, 3);
    const gs = byPhone(mains, 'samsung');
    expect(gs.realFocal).toBeCloseTo(6.5426, 3);
    expect(gs.eqAperture).toBeCloseTo(4.922, 3);
  });

  it('computes periscope focal lengths, flags computed / example values', () => {
    const teles = periscopeCameras(FIXTURE);
    expect(teles.map((c) => c.phoneId)).toEqual(['apple', 'samsung', 'google']);
    const px = byPhone(teles, 'google');
    expect(px.eqFocalFrom).toBe('published');
    expect(px.sensorIsExample).toBe(false);
    expect(px.crop).toBeCloseTo(5.2731, 3);
    expect(px.realFocal).toBeCloseTo(19.912, 2);
    const n = periscopeNumbers(px, 8);
    expect(n.track).toBeCloseTo(19.912, 2); // ≈ f (approximate rule for a simple telephoto)
    expect(n.pupil).toBeCloseTo(7.1115, 3);
    expect(n.overhang).toBeCloseTo(11.912, 2);
    const gs = byPhone(teles, 'samsung');
    expect(gs.eqFocalFrom).toBe('zoom');
    expect(gs.eqFocal).toBe(115);
    expect(gs.crop).toBeCloseTo(6.8145, 3);
    expect(gs.realFocal).toBeCloseTo(16.876, 2);
    const ip = byPhone(teles, 'apple');
    expect(ip.sensorFormat).toBeNull();
    expect(ip.sensorIsExample).toBe(true);
    expect(ip.formatUsed).toBe(EXAMPLE_TELE_FORMAT);
    expect(ip.realFocal).toBeCloseTo(14.792, 2);
    expect(ip.prism).toBe('tetraprism');
  });

  it('reads the same published values from the real phone data', () => {
    const data = realPhones as PhoneData[];
    const mains = mainCameras(data);
    const px = mains.find((c) => c.brand === 'Google')!;
    expect(px.realFocal).toBeCloseTo(6.8271, 3);
    expect(mains.find((c) => c.brand === 'Apple')!.realFocal).toBeCloseTo(6.9338, 3);
    expect(mains.find((c) => c.brand === 'Samsung')!.realFocal).toBeCloseTo(6.5426, 3);
    const teles = periscopeCameras(data);
    expect(teles.find((c) => c.brand === 'Google')!.realFocal).toBeCloseTo(19.912, 2);
    expect(teles.find((c) => c.brand === 'Apple')!.sensorIsExample).toBe(true);
  });
});

describe('depth of field: phone vs full frame (Q)', () => {
  const px = byPhone(mainCameras(FIXTURE), 'google');

  it('matches the hand calculation at 2 m', () => {
    const cmp = compareWithFullFrame(px, 2000, px.eqAperture);
    expect(cmp.phone.near).toBeCloseTo(1244.0, 0);
    expect(cmp.phone.far).toBeCloseTo(5131.7, 0);
    expect(cmp.phone.depth).toBeCloseTo(3887.7, 0);
    expect(cmp.phone.hyperfocal).toBeCloseTo(3264.2, 0); // H + v_H, from the focal plane
    expect(cmp.sameN.near).toBeCloseTo(1711.8, 0);
    expect(cmp.sameN.far).toBeCloseTo(2407.0, 0);
    expect(cmp.sameN.depth).toBeCloseTo(695.2, 0);
    expect(cmp.chosen.near).toBeCloseTo(1258.8, 0);
    expect(cmp.chosen.far).toBeCloseTo(4968.9, 0);
    expect(cmp.equivalentN).toBeCloseTo(5.906, 3);
  });

  it('background blur as a fraction of the frame width', () => {
    const cmp = compareWithFullFrame(px, 2000, px.eqAperture);
    expect(cmp.phone.backgroundBlur).toBeCloseTo(0.013967, 5);
    expect(cmp.phone.backgroundBlurFrac).toBeCloseTo(0.0014186, 6);
    expect(cmp.sameN.backgroundBlur).toBeCloseTo(0.17567, 4);
    expect(cmp.sameN.backgroundBlurFrac).toBeCloseTo(0.0048797, 6);
    expect(cmp.chosen.backgroundBlurFrac).toBeCloseTo(0.0013881, 6);
    // same f-number: ≈ crop × more blur on full frame; equivalent f-number: within a few %
    expect(cmp.sameN.backgroundBlurFrac / cmp.phone.backgroundBlurFrac).toBeGreaterThan(3.3);
    expect(Math.abs(cmp.chosen.backgroundBlurFrac / cmp.phone.backgroundBlurFrac - 1)).toBeLessThan(0.03);
  });

  it('the phone reaches infinity when focused beyond its hyperfocal distance', () => {
    const r = depthOfField(px.realFocal, px.aperture, px.sensor, 10000);
    expect(r.far).toBe(Number.POSITIVE_INFINITY);
    expect(r.depth).toBe(Number.POSITIVE_INFINITY);
    expect(r.near).toBeCloseTo(2460.8, 0);
  });

  it('equivalent f-number gives nearly the same depth of field (exact only for u ≫ f)', () => {
    for (const T of [500, 1000, 2000, 3000]) {
      const cmp = compareWithFullFrame(px, T, px.eqAperture);
      expect(Math.abs(cmp.chosen.near / cmp.phone.near - 1)).toBeLessThan(0.02);
      // the far limit u(H − f)/(H − u) explodes as u → H (3.26 m), so it is only compared well below H
      if (T <= 2000) expect(Math.abs(cmp.chosen.far / cmp.phone.far - 1)).toBeLessThan(0.05);
      // the same f-number on full frame is always much shallower
      expect(cmp.sameN.depth).toBeLessThan(cmp.phone.depth / 3);
    }
  });
});

describe('equivalence calculator and formats (R)', () => {
  it('APS-C 56 mm f/1.2', () => {
    const e = equivalence(FORMAT_SIZES['aps-c'], 56, 1.2);
    expect(e.crop).toBeCloseTo(1.53392, 4);
    expect(e.eqFocal).toBeCloseTo(85.9, 1);
    expect(e.eqAperture).toBeCloseTo(1.8407, 3);
    expect((e.aovDiagonal * 180) / Math.PI).toBeCloseTo(28.27, 2);
    expect((e.aovHorizontal * 180) / Math.PI).toBeCloseTo(23.7, 2);
    expect(e.lightVsFullFrame).toBeCloseTo(0.425, 3);
    expect(equivalence(FULL_FRAME, 50, 2).eqAperture).toBe(2);
  });

  it('lists camera and phone formats, largest first, with the cameras that use them', () => {
    const f = sensorFormats(FIXTURE);
    expect(f.map((e) => e.name)).toEqual(['Full frame', 'APS-C', 'Micro Four Thirds', '1-inch type', '1/1.28"', '1/1.3"', '1/1.95"', '1/2.5"', '1/2.52"', '1/3.94"']);
    const one = f.find((e) => e.id === '1-inch')!;
    expect(one.crop).toBeCloseTo(2.7273, 3); // 43.2666 / √(13.2² + 8.8²) = 43.2666 / 15.8644
    const p13 = f.find((e) => e.name === '1/1.3"')!;
    expect(p13.usedBy).toEqual(['Galaxy S26 Ultra · main', 'Pixel 11 Pro / Pro XL · main']);
    expect(p13.approx).toBe(true);
    expect(f.find((e) => e.name === '1/3.94"')!.usedBy).toEqual(['Galaxy S26 Ultra · 3× telephoto']);
    expect(new Set(f.map((e) => e.id)).size).toBe(f.length);
    expect(normalizeFormat('1/1.3”')).toBe('1/1.3"');
  });
});

describe('periscope fold geometry (S)', () => {
  const input: FoldInput = { track: 19.912, pupil: 7.1115, thickness: 8, sensorSize: 4.923 };

  for (const [mode, reflections] of [
    ['straight', 0],
    ['prism', 1],
    ['tetra', 4],
  ] as const) {
    it(`${mode}: ${reflections} reflections, the chief ray travels one track length and the beam converges on the sensor`, () => {
      const L = foldLayout(mode, input);
      expect(L.mirrors.length).toBe(reflections);
      expect(L.pathLength).toBeCloseTo(19.912, 9);
      const end = L.chief[L.chief.length - 1];
      for (const e of L.edges) {
        const last = e[e.length - 1];
        expect(Math.hypot(last.x - end.x, last.y - end.y)).toBeLessThan(1e-9);
        // marginal rays enter parallel and one pupil apart
        expect(e[0].y).toBe(L.chief[0].y);
      }
      expect(L.edges[1][0].x - L.edges[0][0].x).toBeCloseTo(7.1115, 9);
    });
  }

  it('straight does not fit the phone, the folded layouts do', () => {
    const straight = foldLayout('straight', input);
    expect(straight.sensor.center.y).toBeCloseTo(1.3 + 19.912, 9);
    for (const mode of ['prism', 'tetra'] as const) {
      const L = foldLayout(mode, input);
      expect(L.module.minY).toBeGreaterThanOrEqual(0);
      expect(L.module.maxY).toBeLessThanOrEqual(8);
    }
    // the 45° prism turns the chief ray to run along the phone at mid-thickness
    const p = foldLayout('prism', input);
    expect(p.chief[2].y).toBeCloseTo(4, 9);
    expect(p.chief[3].y).toBeCloseTo(4, 9);
    // four reflections make the module much shorter than the lens and than the one-prism fold
    const t = foldLayout('tetra', input);
    const len = (m: { minX: number; maxX: number }) => m.maxX - m.minX;
    expect(len(t.module)).toBeLessThan(19.912 * 0.7);
    expect(len(t.module)).toBeLessThan(len(p.module) * 0.5);
  });

  it('polyline helpers', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(polylineLength(pts)).toBe(7);
    expect(pointAt(pts, 5)).toEqual({ x: 3, y: 2 });
    expect(pointAt(pts, 99)).toEqual({ x: 3, y: 4 });
  });
});

describe('multi-frame noise reduction', () => {
  it('Poisson sampler has mean ≈ variance ≈ λ (exact branch and normal branch)', () => {
    for (const lambda of [7, 80]) {
      const rng = mulberry32(99);
      const v = new Float64Array(40000);
      for (let i = 0; i < v.length; i++) v[i] = poisson(rng, lambda);
      const s = stats(v);
      expect(s.mean).toBeGreaterThan(lambda * 0.98);
      expect(s.mean).toBeLessThan(lambda * 1.02);
      expect(s.std * s.std).toBeGreaterThan(lambda * 0.94);
      expect(s.std * s.std).toBeLessThan(lambda * 1.06);
    }
  });

  it('merging N frames raises the SNR by ≈ √N (fixed seed)', () => {
    // flat patch expecting λ = 25 photons: SNR₁ = √25 = 5, SNR₄ = √100 = 10, SNR₁₆ = √400 = 20
    const expected = new Float32Array(4096).fill(25);
    const stack = new FrameStack(expected, 16, 1234);
    const all = Array.from({ length: expected.length }, (_, i) => i);
    const s1 = stack.snr(1, all);
    const s4 = stack.snr(4, all);
    const s16 = stack.snr(16, all);
    expect(theoreticalSnr(25, 1)).toBe(5);
    expect(theoreticalSnr(25, 16)).toBe(20);
    expect(s1).toBeGreaterThan(4.75);
    expect(s1).toBeLessThan(5.25);
    expect(s4 / s1).toBeGreaterThan(1.85);
    expect(s4 / s1).toBeLessThan(2.15);
    expect(s16 / s1).toBeGreaterThan(3.7);
    expect(s16 / s1).toBeLessThan(4.3);
    // merge() and snr() agree, and the mean stays at λ
    const m = stats(stack.merge(16));
    expect(m.snr).toBeCloseTo(s16, 6);
    expect(m.mean).toBeGreaterThan(24.8);
    expect(m.mean).toBeLessThan(25.2);
  });

  it('is reproducible for a seed', () => {
    const e = new Float32Array(64).fill(10);
    expect(Array.from(new FrameStack(e, 2, 7).frames[1])).toEqual(Array.from(new FrameStack(e, 2, 7).frames[1]));
  });
});

describe('portrait-mode blur helpers', () => {
  const W = 31;
  const H = 31;
  it('a disc blur spreads a point of light into a uniform disc and keeps its energy', () => {
    // radius 5: rows dy = 0, ±1…±5 hold 11, 9, 9, 9, 7, 1 pixels → 11 + 2·35 = 81 pixels (π·5² = 78.5)
    const img = new Float32Array(W * H * 4);
    img[(15 * W + 15) * 4] = 1;
    img[(15 * W + 15) * 4 + 3] = 1;
    const out = discBlur(img, W, H, 5);
    let lit = 0;
    let sum = 0;
    for (let i = 0; i < W * H; i++) {
      if (out[i * 4] > 1e-9) {
        lit++;
        expect(out[i * 4]).toBeCloseTo(1 / 81, 6); // Float32 output
      }
      sum += out[i * 4];
    }
    expect(lit).toBe(81);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('leaves a uniform image unchanged, also at the edges; radius < 0.5 is a copy', () => {
    const img = new Float32Array(W * H * 4).fill(0.4);
    const out = discBlur(img, W, H, 7.5);
    for (const v of out) expect(v).toBeCloseTo(0.4, 6);
    expect(Array.from(discBlur(img, W, H, 0.3))).toEqual(Array.from(img));
  });

  it('composites premultiplied layers', () => {
    const dst = new Float32Array([0, 0, 1, 1]);
    over(dst, new Float32Array([0.5, 0, 0, 0.5]));
    expect(Array.from(dst)).toEqual([0.5, 0, 0.5, 1]);
    const m = mix(new Float32Array([1, 1, 1, 1]), new Float32Array([0, 0, 0, 1]), new Float32Array([0.25]));
    expect(Array.from(m)).toEqual([0.25, 0.25, 0.25, 1]);
    expect(blurPixels(0.02, 480)).toBeCloseTo(9.6, 9);
  });
});
