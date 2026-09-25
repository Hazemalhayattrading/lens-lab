import { describe, expect, it } from 'vitest';
import { LENS } from '../src/optics/config';
import { DepthMap } from '../src/optics/depthMap';
import {
  focusForRingAngle,
  MAX_EXTENSION,
  RING_THROW,
  ringAngleForFocus,
} from '../src/optics/helicoid';
import { computeOptics, cocToPixels } from '../src/optics/opticsState';
import {
  angleOfView,
  blurDiameter,
  blurDiameterSigned,
  dofLimits,
  extensionForFocus,
  focusForExtension,
  hyperfocal,
  imageDistance,
  INF,
  magnification,
  objectDistance,
} from '../src/optics/thinLens';

const f = 50;
const c = 0.03;
const deg = (r: number) => (r * 180) / Math.PI;

/**
 * Hand-calculated reference cases (worked out on paper, see PLAN.md):
 *
 * Case A — f = 50 mm, f/2, focused on the trees at s = 2000 mm
 *   dᵢ = 50·2000/1950 = 51.282 mm           Δ = 1.282 mm
 *   H  = 50²/(2·0.03) + 50 = 41 716.7 mm
 *   Dₙ = 2000·41 666.7/(41 716.7 + 2000 − 100) = 1910.6 mm
 *   D_f = 2000·41 666.7/(41 716.7 − 2000)     = 2098.2 mm   → DoF 187.6 mm
 *   CoC(cabin 800)    = 2500·1200/(2·1950·800)  = 0.9615 mm
 *   CoC(mountain 8000)= 2500·6000/(2·1950·8000) = 0.4808 mm
 *
 * Case B — f/16, focused on the cabin at s = 800 mm
 *   dᵢ = 53.333 mm, Δ = 3.333 mm, H = 5258.3 mm
 *   Dₙ = 800·5208.3/5958.3 = 699.30 mm,  D_f = 800·5208.3/4458.3 = 934.58 mm → DoF 235.3 mm
 *   CoC(trees 2000) = 2500·1200/(16·750·2000) = 0.1250 mm
 *   CoC(mountain)   = 2500·7200/(16·750·8000) = 0.1875 mm
 *
 * Case C — f/5.6, focused on the mountain at s = 8000 mm
 *   dᵢ = 50.3145 mm, H = 14 931.0 mm
 *   Dₙ = 8000·14 881.0/22 831.0 = 5214.3 mm,  D_f = 8000·14 881.0/6931.0 = 17 176 mm
 *   CoC(trees)  = 2500·6000/(5.6·7950·2000) = 0.1685 mm
 *   CoC(cabin)  = 2500·7200/(5.6·7950·800)  = 0.5054 mm
 */
describe('thin-lens equation', () => {
  it('images infinity at the focal length', () => {
    expect(imageDistance(f, INF)).toBe(50);
    expect(objectDistance(f, 50)).toBe(INF);
  });

  it('satisfies 1/f = 1/do + 1/di', () => {
    for (const d of [300, 800, 2000, 8000, 123456]) {
      const di = imageDistance(f, d);
      expect(1 / d + 1 / di).toBeCloseTo(1 / f, 12);
      expect(objectDistance(f, di)).toBeCloseTo(d, 6);
    }
  });

  it('has no real image inside the focal length', () => {
    expect(imageDistance(f, 40)).toBe(INF);
  });

  it('gives 10 mm of helicoid travel for 0.3 m close focus (1:5)', () => {
    expect(imageDistance(f, 300)).toBeCloseTo(60, 10);
    expect(extensionForFocus(f, 300)).toBeCloseTo(10, 10);
    expect(focusForExtension(f, 10)).toBeCloseTo(300, 10);
    expect(focusForExtension(f, 0)).toBe(INF);
    expect(magnification(f, 300)).toBeCloseTo(0.2, 10);
    expect(MAX_EXTENSION).toBeCloseTo(10, 10);
  });
});

describe('case A: f/2 focused at 2 m', () => {
  const N = 2;
  const s = 2000;
  it('image distance and extension', () => {
    expect(imageDistance(f, s)).toBeCloseTo(51.282, 3);
    expect(extensionForFocus(f, s)).toBeCloseTo(1.282, 3);
  });
  it('hyperfocal and DoF limits', () => {
    expect(hyperfocal(f, N, c)).toBeCloseTo(41716.67, 1);
    const dof = dofLimits(f, N, c, s);
    expect(dof.near).toBeCloseTo(1910.58, 1);
    expect(dof.far).toBeCloseTo(2098.20, 1);
    expect(dof.depth).toBeCloseTo(187.6, 1);
  });
  it('circles of confusion of the other subjects', () => {
    expect(blurDiameter(f, N, s, 800)).toBeCloseTo(0.9615, 4);
    expect(blurDiameter(f, N, s, 8000)).toBeCloseTo(0.4808, 4);
    expect(blurDiameterSigned(f, N, s, 800)).toBeLessThan(0);
    expect(blurDiameterSigned(f, N, s, 8000)).toBeGreaterThan(0);
    expect(blurDiameter(f, N, s, s)).toBe(0);
  });
});

describe('case B: f/16 focused at 0.8 m', () => {
  const N = 16;
  const s = 800;
  it('DoF limits', () => {
    expect(imageDistance(f, s)).toBeCloseTo(53.333, 3);
    expect(hyperfocal(f, N, c)).toBeCloseTo(5258.33, 2);
    const dof = dofLimits(f, N, c, s);
    expect(dof.near).toBeCloseTo(699.30, 1);
    expect(dof.far).toBeCloseTo(934.58, 1);
    expect(dof.depth).toBeCloseTo(235.3, 1);
  });
  it('circles of confusion', () => {
    expect(blurDiameter(f, N, s, 2000)).toBeCloseTo(0.125, 6);
    expect(blurDiameter(f, N, s, 8000)).toBeCloseTo(0.1875, 6);
  });
});

describe('case C: f/5.6 focused at 8 m', () => {
  const N = 5.6;
  const s = 8000;
  it('DoF limits', () => {
    expect(imageDistance(f, s)).toBeCloseTo(50.3145, 4);
    expect(hyperfocal(f, N, c)).toBeCloseTo(14930.95, 1);
    const dof = dofLimits(f, N, c, s);
    expect(dof.near).toBeCloseTo(5214.3, 0);
    expect(dof.far).toBeCloseTo(17176, -1);
  });
  it('circles of confusion', () => {
    expect(blurDiameter(f, N, s, 2000)).toBeCloseTo(0.16846, 4);
    expect(blurDiameter(f, N, s, 800)).toBeCloseTo(0.50539, 4);
  });
});

describe('depth-of-field consistency', () => {
  it('the CoC equals c exactly at the near and far limits', () => {
    for (const N of [2, 5.6, 16]) {
      for (const s of [300, 800, 2000, 4000]) {
        const dof = dofLimits(f, N, c, s);
        expect(blurDiameter(f, N, s, dof.near)).toBeCloseTo(c, 9);
        if (Number.isFinite(dof.far)) expect(blurDiameter(f, N, s, dof.far)).toBeCloseTo(c, 9);
      }
    }
  });

  it('focusing at the hyperfocal distance keeps H/2 … ∞ sharp', () => {
    const H = hyperfocal(f, 16, c);
    const dof = dofLimits(f, 16, c, H);
    expect(dof.near).toBeCloseTo(H / 2, 6);
    expect(dof.far).toBe(INF);
  });

  it('focused at ∞ the near limit is f²/(N·c) and CoC = f²/(N·d)', () => {
    const dof = dofLimits(f, 16, c, INF);
    expect(dof.near).toBeCloseTo(2500 / (16 * 0.03), 6);
    expect(blurDiameter(f, 16, INF, 2000)).toBeCloseTo(0.078125, 9);
    expect(blurDiameter(f, 16, INF, INF)).toBe(0);
  });

  it('matches the geometric blur disc from similar triangles', () => {
    // b = A·|v_s − v_d| / v_d with A = f/N
    const N = 2.8;
    const s = 1500;
    const d = 5000;
    const vs = imageDistance(f, s);
    const vd = imageDistance(f, d);
    const geometric = ((f / N) * Math.abs(vs - vd)) / vd;
    expect(blurDiameter(f, N, s, d)).toBeCloseTo(geometric, 10);
  });

  it('stopping down by 8× shrinks the CoC by exactly 8×', () => {
    expect(blurDiameter(f, 2, 2000, 800) / blurDiameter(f, 16, 2000, 800)).toBeCloseTo(8, 10);
  });
});

describe('angle of view and helicoid', () => {
  it('50 mm on full frame sees 39.6° × 27.0° at ∞ and breathes to 33.4° at 0.3 m', () => {
    expect(deg(angleOfView(36, 50))).toBeCloseTo(39.598, 2);
    expect(deg(angleOfView(24, 50))).toBeCloseTo(26.991, 2);
    expect(deg(angleOfView(36, 60))).toBeCloseTo(33.398, 2);
  });

  it('ring angle is 0 at ∞, full throw at close focus, and invertible', () => {
    expect(ringAngleForFocus(INF)).toBe(0);
    expect(ringAngleForFocus(LENS.minFocus)).toBeCloseTo(RING_THROW, 10);
    for (const s of [350, 800, 2000, 8000]) {
      expect(focusForRingAngle(ringAngleForFocus(s))).toBeCloseTo(s, 6);
    }
    // 2 m needs only Δ = 1.282 mm → 12.8 % of the throw
    expect(ringAngleForFocus(2000) / RING_THROW).toBeCloseTo(0.12821, 4);
  });
});

describe('depth map', () => {
  const map = new DepthMap(1200, 300);
  it('maps close focus to 0 and infinity to 1, monotonically', () => {
    expect(map.toU(300)).toBeCloseTo(0, 12);
    expect(map.toU(INF)).toBe(1);
    let prev = -1;
    for (const d of [300, 500, 800, 1200, 2000, 5000, 8000, 50000]) {
      const u = map.toU(d);
      expect(u).toBeGreaterThan(prev);
      prev = u;
      expect(map.fromU(u)).toBeCloseTo(d, 6);
    }
    expect(map.fromU(1)).toBe(INF);
  });
});

describe('computeOptics', () => {
  it('reports the sharp subject and blur discs in pixels', () => {
    const o = computeOptics(2000, 2);
    const trees = o.subjects.find((s) => s.id === 'trees')!;
    const cabin = o.subjects.find((s) => s.id === 'cabin')!;
    expect(trees.sharpness).toBe('sharp');
    expect(cabin.sharpness).toBe('blurred');
    expect(cabin.focusError).toBeGreaterThan(0); // cabin's image lies behind the sensor
    expect(o.apertureDiameter).toBe(25);
    // 0.9615 mm on a 36 mm wide sensor rendered 1440 px wide = 38.5 px
    expect(cocToPixels(cabin.coc, 1440)).toBeCloseTo(38.46, 2);
  });
});
