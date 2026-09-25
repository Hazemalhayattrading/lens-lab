import { describe, expect, it } from 'vitest';
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
