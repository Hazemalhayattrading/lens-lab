import { describe, expect, it } from 'vitest';
import type { LensData } from '../src/data/types';
import { labLensFromData } from '../src/lab/labLens';
import { PowerDepthMap } from '../src/optics/depthMap';
import {
  cocForSensor,
  cropFactor,
  diagonal,
  equivalentAperture,
  equivalentFocalLength,
  focalFromEquivalent,
  FORMAT_SIZES,
  FULL_FRAME,
  sensorFromCrop,
  sensorFromOpticalFormat,
} from '../src/optics/formats';
import {
  apertureButtons,
  cocAt,
  convergenceOffset,
  distanceForMagnification,
  focalAtZoom,
  focusCurve,
  hyperfocalDistance,
  lensState,
  magnificationForDistance,
  maxApertureAtZoom,
  mfdAtZoom,
  thinLensMagnification,
  zoomForFocal,
  type LensPhysicsSpec,
} from '../src/optics/lensModel';
import { angleOfView, blurDiameter, dofLimits } from '../src/optics/thinLens';

const deg = (r: number) => (r * 180) / Math.PI;
// the same glob the app uses to lazy-load the data (here eagerly)
const lensFiles = import.meta.glob<LensData[]>('../data/lenses/*.json', { eager: true, import: 'default' });
const library = Object.values(lensFiles).flat().map(labLensFromData);
const prime = (f: number, N: number, minN: number, mfd: number, mag: number | null, sensor = FULL_FRAME): LensPhysicsSpec => ({
  focal: { min: f, max: f },
  maxAperture: { wide: N, tele: N },
  minAperture: { wide: minN, tele: minN },
  mfd: { wide: mfd, tele: mfd },
  maxMagnification: mag,
  maxMagAt: 'tele',
  sensor,
});

/**
 * Hand-calculated reference cases for the Phase 2 physics (see PLAN.md, "Phase 2 physics verification").
 *
 * F — formats: FF diagonal √(36²+24²) = 43.267 mm, c = 43.267/1442 = 0.0300 mm.
 *     APS-C 23.5×15.6: d = 28.207, crop = 1.534, c = 0.0196.  MFT 17.3×13: d = 21.640, crop = 1.999.
 *     GFX 43.8×32.9: d = 54.780, crop = 0.790.  Phone 1/1.28": d = 16/1.28 = 12.5 → 10.0 × 7.5 mm, crop 3.461.
 * G — field of view (rectilinear, focused at ∞): 16 mm → H 2·atan(18/16) = 96.73°, V 73.74°, D 107.03°;
 *     24 mm → D 84.06°; 600 mm → H 2·atan(18/600) = 3.437°, D 4.130°.
 * H — equivalence: 56 mm f/1.2 on APS-C → 56·1.534 = 85.9 mm, f/1.2·1.534 = f/1.84;
 *     phone 6.9 mm f/1.78 on 1/1.28" → 23.9 mm, f/6.16.
 * I — zoom: 24–70 at z = ½ → √(24·70) = 40.99 mm; 35 mm → z = ln(35/24)/ln(70/24) = 0.3525.
 *     100–500 f/4.5–7.1 at 300 mm: 4.5·3^(ln(7.1/4.5)/ln 5) = 4.5·3^0.2833 = f/6.14 → 1/3-stop scale f/6.3.
 * J — sensor distance: 50 mm focused 2000 mm from the focal plane: u = (T + √(T² − 4Tf))/2 = 1948.68,
 *     v = 51.32, m = 0.02633.
 * K — macro breathing: 100 mm, MFD 260 mm, 1.4×: f_mfd = 260·1.4/2.4² = 63.19 mm; at MFD u = 108.33,
 *     v = 151.67; f/2.8 → working f/6.72; DoF = 0.2057 mm (= 2Nc(1+m)/m²).
 * L — depth ladder γ = 0.3, d_near = 200: u(2 m) = 1 − 0.1^0.3 = 0.4988, d(½) = 200·0.5^(−1/0.3) = 2015.9 mm.
 */
describe('F — sensor formats', () => {
  it('diagonals, crop factors and circles of confusion', () => {
    expect(diagonal(FULL_FRAME)).toBeCloseTo(43.2666, 4);
    expect(cocForSensor(FULL_FRAME)).toBeCloseTo(0.03, 4);
    expect(cropFactor(FORMAT_SIZES['aps-c'])).toBeCloseTo(1.5339, 4);
    expect(cocForSensor(FORMAT_SIZES['aps-c'])).toBeCloseTo(0.01956, 5);
    expect(cropFactor(FORMAT_SIZES['micro-four-thirds'])).toBeCloseTo(1.9994, 4);
    expect(cropFactor(FORMAT_SIZES['medium-format'])).toBeCloseTo(0.7898, 4);
  });

  it('reads phone optical formats (1/x" ≈ 16/x mm diagonal, 4:3)', () => {
    const s = sensorFromOpticalFormat('1/1.28"')!;
    expect(s.width).toBeCloseTo(10, 10);
    expect(s.height).toBeCloseTo(7.5, 10);
    expect(cropFactor(s)).toBeCloseTo(3.4613, 4);
    expect(diagonal(sensorFromOpticalFormat('1-inch')!)).toBeCloseTo(16, 10);
    expect(diagonal(sensorFromOpticalFormat('1/2.55″')!)).toBeCloseTo(16 / 2.55, 10);
    expect(sensorFromOpticalFormat('large')).toBeNull();
    expect(cropFactor(sensorFromCrop(3.5))).toBeCloseTo(3.5, 10);
  });
});

describe('G — field of view', () => {
  it('16 mm and 600 mm on full frame', () => {
    expect(deg(angleOfView(36, 16))).toBeCloseTo(96.733, 3);
    expect(deg(angleOfView(24, 16))).toBeCloseTo(73.74, 2);
    expect(deg(angleOfView(diagonal(FULL_FRAME), 16))).toBeCloseTo(107.027, 3);
    expect(deg(angleOfView(diagonal(FULL_FRAME), 24))).toBeCloseTo(84.062, 3);
    expect(deg(angleOfView(36, 600))).toBeCloseTo(3.437, 3);
    expect(deg(angleOfView(diagonal(FULL_FRAME), 600))).toBeCloseTo(4.13, 3);
  });

  it('lensState reports the angle of view at ∞ and narrows it up close (breathing)', () => {
    const s = lensState(prime(16, 2.8, 22, 280, null), 0, Infinity, 2.8);
    expect(deg(s.fovHorizontal)).toBeCloseTo(96.733, 3);
    const close = lensState(prime(50, 2, 16, 360, 0.2), 0, 360, 2);
    // thin lens at 1:5 → v = 60 mm → 2·atan(18/60) = 33.4°
    expect(close.magnification).toBeCloseTo(0.2, 6);
    expect(deg(close.fovHorizontal)).toBeCloseTo(33.398, 2);
  });
});

describe('H — 35 mm equivalence', () => {
  it('APS-C portrait lens and a phone main camera', () => {
    const k = cropFactor(FORMAT_SIZES['aps-c']);
    expect(equivalentFocalLength(56, k)).toBeCloseTo(85.9, 1);
    expect(equivalentAperture(1.2, k)).toBeCloseTo(1.841, 3);
    const p = cropFactor(sensorFromOpticalFormat('1/1.28"')!);
    expect(equivalentFocalLength(6.9, p)).toBeCloseTo(23.88, 2);
    expect(equivalentAperture(1.78, p)).toBeCloseTo(6.161, 3);
    expect(focalFromEquivalent(24, p)).toBeCloseTo(6.934, 3);
  });

  it('equivalent settings give the same depth of field (same framing, same distance)', () => {
    // phone 6.934 mm f/1.78 on 1/1.28" vs full frame 24 mm f/6.16, both focused at 2 m
    const phoneSensor = sensorFromOpticalFormat('1/1.28"')!;
    const k = cropFactor(phoneSensor);
    const phone = lensState(prime(24 / k, 1.78, 1.78, 100, null, phoneSensor), 0, 2000, 1.78);
    const ff = lensState(prime(24, 1.78 * k, 22, 250, null), 0, 2000, 1.78 * k);
    // Equivalence is exact only in the limit u ≫ f. At 2 m the lenses sit ~17 mm apart and the far
    // limit lies close to the hyperfocal distance (≈3.1 m), where it is most sensitive: hand calc
    // gives far = 5503 mm (phone) vs 5312 mm (full frame) = 3.6 %, near 1224 vs 1239 mm = 1.2 %.
    expect(Math.abs(phone.near / ff.near - 1)).toBeLessThan(0.015);
    expect(Math.abs(phone.far / ff.far - 1)).toBeLessThan(0.04);
    // equivalent focal lengths are defined at ∞ (at 2 m the 24 mm lens already breathes 1.2 %, the phone 0.35 %)
    const phoneInf = lensState(prime(24 / k, 1.78, 1.78, 100, null, phoneSensor), 0, Infinity, 1.78);
    const ffInf = lensState(prime(24, 1.78 * k, 22, 250, null), 0, Infinity, 1.78 * k);
    expect(deg(phoneInf.fovDiagonal)).toBeCloseTo(deg(ffInf.fovDiagonal), 9);
    expect(deg(ffInf.fovDiagonal)).toBeCloseTo(84.062, 3);
    // …and the full-frame lens at the phone's real f-number is ~3.5× shallower
    const ffSameN = lensState(prime(24, 1.78, 22, 250, null), 0, 2000, 1.78);
    expect(ffSameN.depthOfField).toBeLessThan(phone.depthOfField / 3);
  });
});

describe('I — zoom ring and variable aperture', () => {
  const z2470: LensPhysicsSpec = {
    focal: { min: 24, max: 70 },
    maxAperture: { wide: 2.8, tele: 2.8 },
    minAperture: { wide: 22, tele: 22 },
    mfd: { wide: 210, tele: 380 },
    maxMagnification: 0.3,
    maxMagAt: 'tele',
    sensor: FULL_FRAME,
  };
  const z100500: LensPhysicsSpec = {
    focal: { min: 100, max: 500 },
    maxAperture: { wide: 4.5, tele: 7.1 },
    minAperture: { wide: 32, tele: 51 },
    mfd: { wide: 900, tele: 1200 },
    maxMagnification: 0.33,
    maxMagAt: 'tele',
    sensor: FULL_FRAME,
  };

  it('maps the ring logarithmically between the ends', () => {
    expect(focalAtZoom(z2470, 0)).toBe(24);
    expect(focalAtZoom(z2470, 1)).toBeCloseTo(70, 10);
    expect(focalAtZoom(z2470, 0.5)).toBeCloseTo(40.988, 3);
    expect(zoomForFocal(z2470, 35)).toBeCloseTo(0.35247, 5);
    expect(zoomForFocal(z2470, focalAtZoom(z2470, 0.73))).toBeCloseTo(0.73, 10);
    expect(mfdAtZoom(z2470, 0.5)).toBeCloseTo(295, 10);
  });

  it('interpolates a variable maximum aperture and snaps it to 1/3 stops', () => {
    expect(maxApertureAtZoom(z100500, 0)).toBe(4.5);
    expect(maxApertureAtZoom(z100500, 1)).toBe(7.1);
    // 300 mm: geometric model f/6.14 → nearest 1/3 stop is f/6.3
    expect(maxApertureAtZoom(z100500, zoomForFocal(z100500, 300))).toBe(6.3);
    expect(maxApertureAtZoom(z2470, 0.4)).toBe(2.8);
  });
});

describe('J — distances from the focal plane', () => {
  it('recovers u and v from T = u + v', () => {
    const s = lensState(prime(50, 2, 16, 360, 0.2), 0, 2000, 2);
    expect(s.objectDistance).toBeCloseTo(1948.683, 3);
    expect(s.imageDistance).toBeCloseTo(51.3167, 4);
    expect(s.magnification).toBeCloseTo(0.026334, 6);
    expect(s.focusDistance).toBeCloseTo(2000, 6);
    expect(1 / s.objectDistance + 1 / s.imageDistance).toBeCloseTo(1 / 50, 12);
  });

  it('matches the Phase 1 thin-lens DoF once converted back to lens distances', () => {
    const s = lensState(prime(50, 2, 16, 360, 0.2), 0, 2000, 2);
    const d = dofLimits(50, 2, s.coc, s.objectDistance);
    expect(s.near - s.imageDistance).toBeCloseTo(d.near, 6);
    expect(s.far - s.imageDistance).toBeCloseTo(d.far, 6);
    // blur of an object at 0.8 m from the focal plane
    const cabin = 800 - s.imageDistance;
    expect(Math.abs(cocAt(s, 800))).toBeCloseTo(blurDiameter(50, 2, s.objectDistance, cabin), 10);
    expect(cocAt(s, 800)).toBeLessThan(0);
    expect(cocAt(s, 8000)).toBeGreaterThan(0);
    expect(Math.abs(cocAt(s, s.near))).toBeCloseTo(s.coc, 9);
  });

  it('hyperfocal distance is measured from the focal plane', () => {
    // 50 mm f/16, c = 0.0300046: H_u = 2500/(16c) + 50, plus v = f·H/(H − f)
    const s = lensState(prime(50, 16, 16, 360, 0.2), 0, Infinity, 16);
    const Hu = 2500 / (16 * s.coc) + 50;
    expect(s.hyperfocal).toBeCloseTo(Hu + (50 * Hu) / (Hu - 50), 6);
    // focused at ∞ the near limit is H_u − f from the lens = H_u from the focal plane (v = f)
    expect(s.near).toBeCloseTo(Hu, 6);
  });
});

describe('K — close focus and focus breathing', () => {
  const macro = prime(100, 2.8, 32, 260, 1.4);

  it('fits f_mfd so that the published MFD and magnification are reached exactly', () => {
    const c = focusCurve(macro, 0);
    expect(c.fitted).toBe(true);
    expect(c.fMfd).toBeCloseTo(63.1944, 4);
    expect(c.mMax).toBe(1.4);
    expect(distanceForMagnification(c, 1.4)).toBeCloseTo(260, 9);
    expect(magnificationForDistance(c, 260)).toBeCloseTo(1.4, 9);
    // cannot focus closer than the MFD
    expect(magnificationForDistance(c, 100)).toBe(1.4);
  });

  it('gives the textbook macro DoF and working aperture at the closest focus', () => {
    const s = lensState(macro, 0, 260, 2.8);
    expect(s.objectDistance).toBeCloseTo(108.333, 3);
    expect(s.imageDistance).toBeCloseTo(151.667, 3);
    expect(s.workingFNumber).toBeCloseTo(6.72, 10);
    expect(s.depthOfField).toBeCloseTo(0.20575, 4);
    expect(s.depthOfField).toBeCloseTo((2 * 2.8 * s.coc * 2.4) / (1.4 * 1.4), 4);
  });

  it('keeps f fixed without a published magnification', () => {
    const c = focusCurve(prime(50, 1.8, 16, 300, null), 0);
    expect(c.fitted).toBe(false);
    expect(c.fMfd).toBe(50);
    expect(c.mMax).toBeCloseTo(thinLensMagnification(50, 300)!, 12);
    expect(distanceForMagnification(c, c.mMax)).toBeCloseTo(300, 9);
  });

  it('the thin-lens magnification solves T = f(1+m)²/m', () => {
    expect(thinLensMagnification(70, 380)).toBeCloseTo(0.321887, 6);
    expect(thinLensMagnification(50, 199)).toBeNull();
    expect(thinLensMagnification(50, 200)).toBeCloseTo(1, 12);
  });
});

describe('L — depth ladder', () => {
  const map = new PowerDepthMap(200, 0.3);
  it('maps d_near → 0, ∞ → 1, monotonic and invertible', () => {
    expect(map.toU(200)).toBeCloseTo(0, 12);
    expect(map.toU(Infinity)).toBe(1);
    expect(map.toU(2000)).toBeCloseTo(0.498813, 6);
    expect(map.fromU(0.5)).toBeCloseTo(2015.874, 3);
    let prev = -Infinity;
    for (const d of [150, 200, 300, 800, 2000, 8000, 30000, 200000, 5e6]) {
      const u = map.toU(d);
      expect(u).toBeGreaterThan(prev);
      prev = u;
      expect(map.fromU(u)).toBeCloseTo(d, 5);
    }
    expect(map.fromU(1)).toBe(Infinity);
  });
});

describe('aperture buttons and the image-side schematic', () => {
  it('spreads full stops between wide open and the smallest aperture', () => {
    expect(apertureButtons(1.2, 16)).toEqual([1.2, 2, 4, 8, 16]);
    expect(apertureButtons(0.95, 16)).toEqual([0.95, 2, 4, 8, 16]);
    expect(apertureButtons(2.8, 22, 4)).toEqual([2.8, 5.6, 11, 22]);
    expect(apertureButtons(1.78, 1.78)).toEqual([1.78]);
  });

  it('cuts the sensor in a disc of exactly the requested diameter', () => {
    const r = 0.5;
    const D = 3;
    for (const disc of [0.01, 0.2, 0.6]) {
      const aFar = convergenceOffset(disc, r, D, true); // image in front of the sensor
      expect((2 * r * aFar) / (D - aFar)).toBeCloseTo(disc, 12);
      const aNear = convergenceOffset(disc, r, D, false); // image behind the sensor
      expect((2 * r * -aNear) / (D - aNear)).toBeCloseTo(disc, 12);
    }
  });
});

// ---------------------------------------------------------------- review regressions (F1, F4, F2)

const SWEEP = Array.from({ length: 401 }, (_, i) => i / 400);
const zoom = (fMin: number, fMax: number, mfdW: number, mfdT: number, mag: number | null): LensPhysicsSpec => ({
  focal: { min: fMin, max: fMax },
  maxAperture: { wide: 4, tele: 5.6 },
  minAperture: { wide: 32, tele: 32 },
  mfd: { wide: mfdW, tele: mfdT },
  maxMagnification: mag,
  maxMagAt: 'tele',
  sensor: FULL_FRAME,
});
/** T(m) falls strictly from ∞ to the closest focus (the focus ring never turns back). */
function focusesMonotonically(spec: LensPhysicsSpec, z: number, n = 200): boolean {
  const c = focusCurve(spec, z);
  let prev = Infinity;
  for (let i = 1; i <= n; i++) {
    const T = distanceForMagnification(c, (i / n) * c.mMax);
    if (!(T < prev)) return false;
    prev = T;
  }
  return true;
}

describe('published maximum magnification is the lens maximum (review F1)', () => {
  for (const l of library.filter((x) => x.physics.maxMagnification !== null)) {
    const p = l.physics;
    const pub = p.maxMagnification!;
    it(`${l.id}: at most ${pub}× at every zoom position, exactly ${pub}× at the published tele MFD`, () => {
      let worst = 0;
      let mfdError = 0;
      for (const z of l.isZoom ? SWEEP : [0]) {
        const c = focusCurve(p, z);
        const s = lensState(p, z, c.mfd, maxApertureAtZoom(p, z));
        worst = Math.max(worst, c.mMax, s.magnification);
        mfdError = Math.max(mfdError, Math.abs(c.mfd - mfdAtZoom(p, z)));
      }
      expect(worst).toBeLessThanOrEqual(pub * (1 + 1e-9));
      expect(mfdError).toBeLessThan(1e-6); // the published closest focus is reached everywhere
      const tele = lensState(p, 1, mfdAtZoom(p, 1), maxApertureAtZoom(p, 1));
      expect(tele.magnification).toBeCloseTo(pub, 9);
      expect(tele.focusDistance).toBeCloseTo(mfdAtZoom(p, 1), 6);
    });
  }

  it('RF 100-500 at 500 mm, 1.2 m: 0.33× (not 1:1); at 100 mm, 0.9 m: a plain 100 mm thin lens', () => {
    const p = library.find((l) => l.id === 'canon-rf-100-500-f45-71-l-is-usm')!.physics;
    const tele = lensState(p, 1, 1200, 7.1);
    // f_mfd = 1200·0.33/1.33² = 223.87 mm, v = f_mfd·1.33 = 297.74 mm
    expect(tele.magnification).toBeCloseTo(0.33, 9);
    expect(tele.effectiveFocal).toBeCloseTo((1200 * 0.33) / 1.33 ** 2, 6);
    expect(tele.imageDistance).toBeCloseTo(297.74, 1);
    // m = (700 − √450000)/200 = 0.14590, v = 114.59 mm, 2·atan(18/114.59) = 17.85° (not 9.2°)
    const wide = lensState(p, 0, 900, 4.5);
    expect(wide.magnification).toBeCloseTo((700 - Math.sqrt(450000)) / 200, 9);
    expect(wide.effectiveFocal).toBeCloseTo(100, 9);
    expect(deg(wide.fovHorizontal)).toBeCloseTo(17.85, 1);
  });

  it('Z 180-600 at 600 mm, 2.4 m (= 4f): 0.25×, lens → sensor 480 mm (not 1:1 and 1200 mm)', () => {
    const p = library.find((l) => l.id === 'nikon-z-180-600mm-f56-63-vr')!.physics;
    const s = lensState(p, 1, 2400, 6.3);
    expect(s.magnification).toBeCloseTo(0.25, 9);
    expect(s.effectiveFocal).toBeCloseTo((2400 * 0.25) / 1.5625, 6); // 384 mm
    expect(s.imageDistance).toBeCloseTo(480, 6);
  });

  it('uses the published value, not 1:1, where a fixed-f thin lens cannot focus that close', () => {
    // 100–400 mm: 0.35 m at the wide end is < 4f, so the wide end has no fixed-f solution
    const p = zoom(100, 400, 350, 1000, 0.3);
    for (const z of SWEEP) {
      const c = focusCurve(p, z);
      expect(c.mMax).toBeCloseTo(0.3, 12);
      expect(c.mfd).toBeCloseTo(mfdAtZoom(p, z), 6);
    }
  });

  it('any spec gives a monotonic curve that never exceeds the published magnification', () => {
    for (const f of [8, 50, 200, 600]) {
      for (const ratio of [2.2, 3, 4, 6, 10, 30]) {
        for (const mag of [0.05, 0.2, 0.5, 1, 1.5, 3]) {
          const spec = prime(f, 2.8, 22, f * ratio, mag);
          expect(focusCurve(spec, 0).mMax).toBeLessThanOrEqual(mag * (1 + 1e-12));
          expect(focusesMonotonically(spec, 0, 256)).toBe(true);
        }
      }
    }
  });
});

describe('the focus model is continuous over the zoom range (review F4)', () => {
  // 24–70 mm with 0.9× published at 0.38 m: a breathing fit to 0.9× cannot focus monotonically,
  // so the magnification is limited where the fit would fail instead of switching to a fixed-f lens
  const stress = zoom(24, 70, 210, 380, 0.9);
  const cases: [string, LensPhysicsSpec][] = [
    ...library.filter((l) => l.isZoom).map((l): [string, LensPhysicsSpec] => [l.id, l.physics]),
    ['synthetic 24-70 0.9×', stress],
  ];
  /** Largest relative change of m, v and the angle of view at the closest focus between zoom z0 and z1. */
  const change = (p: LensPhysicsSpec, z0: number, z1: number): number => {
    const [a, b] = [z0, z1].map((z) => lensState(p, z, focusCurve(p, z).mfd, maxApertureAtZoom(p, z)));
    return Math.max(
      Math.abs(b.magnification / a.magnification - 1),
      Math.abs(b.imageDistance / a.imageDistance - 1),
      Math.abs(b.fovHorizontal / a.fovHorizontal - 1),
    );
  };
  for (const [id, p] of cases) {
    it(`${id}: m, lens → sensor distance and angle of view at the closest focus have no jumps`, () => {
      let monotonic = focusesMonotonically(p, 0);
      for (let i = 0; i < SWEEP.length - 1; i++) {
        const [z0, z1] = [SWEEP[i], SWEEP[i + 1]];
        monotonic &&= focusesMonotonically(p, z1);
        // 400 steps: smooth curves change < 1 % per step (the old model jumped by up to 49 % in one step)
        const coarse = change(p, z0, z1);
        if (coarse < 0.02) continue;
        // steep but continuous (a fixed-f lens as T → 4f) shrinks with a finer step; a jump does not
        let fine = 0;
        for (let k = 0; k < 100; k++) fine = Math.max(fine, change(p, z0 + (k / 100) * (z1 - z0), z0 + ((k + 1) / 100) * (z1 - z0)));
        expect(fine, `jump at z ≈ ${z0.toFixed(4)}`).toBeLessThan(coarse / 4);
      }
      expect(monotonic).toBe(true);
    });
  }

  it('the synthetic zoom still reaches its published closest focus and stays below 0.9×', () => {
    for (const z of SWEEP) {
      const c = focusCurve(stress, z);
      expect(c.mfd).toBeCloseTo(mfdAtZoom(stress, z), 6);
      expect(c.mMax).toBeLessThan(0.9);
    }
  });
});

describe('hyperfocal distance of a breathing lens (review F2)', () => {
  it('does not change as the lens is focused', () => {
    for (const l of library) {
      const p = l.physics;
      for (const z of l.isZoom ? [0, 0.5, 1] : [0]) {
        const N = maxApertureAtZoom(p, z);
        const c = focusCurve(p, z);
        const atInf = lensState(p, z, Infinity, N).hyperfocal;
        for (const T of [c.mfd, 2000, 30000]) expect(lensState(p, z, T, N).hyperfocal).toBe(atInf);
      }
    }
  });

  it('100 mm macro f/2.8 (1.4× at 0.26 m): 119.2 m at every focus distance (was 47.7 m at the MFD)', () => {
    const macro = prime(100, 2.8, 32, 260, 1.4);
    const c = focusCurve(macro, 0);
    const s = lensState(macro, 0, 260, 2.8);
    // focused at H the far limit just reaches ∞: m·f_e(m) = N·c with f_e = f + k·m, k = (f_mfd − f)/m_max
    const Nc = 2.8 * s.coc;
    const k = (c.fMfd - 100) / 1.4;
    const m = (2 * Nc) / (100 + Math.sqrt(1e4 + 4 * k * Nc)); // 8.403e-4
    const fe = 100 + k * m;
    expect(s.hyperfocal).toBeCloseTo((fe * (1 + m) ** 2) / m, 3);
    expect(s.hyperfocal / 1000).toBeCloseTo(119.2, 1);
    expect(hyperfocalDistance(c, 2.8, s.coc)).toBe(s.hyperfocal);
  });

  it('is exactly where the far limit reaches ∞', () => {
    for (const l of library) {
      const p = l.physics;
      for (const z of l.isZoom ? [0, 0.5, 1] : [0]) {
        const c = focusCurve(p, z);
        for (const N of [maxApertureAtZoom(p, z), 8, 22]) {
          const H = lensState(p, z, Infinity, N).hyperfocal;
          expect(lensState(p, z, H * 1.001, N).far).toBe(Infinity);
          if (H * 0.999 > c.mfd) expect(Number.isFinite(lensState(p, z, H * 0.999, N).far)).toBe(true);
        }
      }
    }
  });
});
