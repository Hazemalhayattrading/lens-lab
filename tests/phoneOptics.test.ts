import { describe, expect, it } from 'vitest';
import type { PhoneCamera, PhoneData } from '../src/data/types';
import { lensState } from '../src/optics/lensModel';
import { cocForSensor } from '../src/optics/formats';
import { cameraOptics, cameraSensor, depthOfField, moduleKind } from '../src/phone/phoneOptics';

const cam = (c: Partial<PhoneCamera>): PhoneCamera => ({
  role: 'main',
  label: 'Main',
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
const phone = (cameras: PhoneCamera[]): PhoneData => ({
  id: 'test',
  brand: 'Apple',
  name: 'Test',
  announced: '2026-09',
  moduleLayout: 'triangle-square',
  cameras,
  computational: [],
  summary: '',
  sources: [],
  checked: '2026-09-26',
});

/*
 * Hand calculations
 * 1/1.28" → d = 16/1.28 = 12.5 mm, 4:3 → 10.0 × 7.5 mm; crop = 43.267 / 12.5 = 3.4613.
 * eq 24 mm → real f = 24 / 3.4613 = 6.934 mm; f/1.48 → eq aperture = 1.48 × 3.4613 = 5.12 → 5.1.
 * FOV at 24 mm eq: 2·atan(43.267 / 48) = 84.1°.
 * 48 MP × 1.22 µm: px = √(48e6 · 4/3) = 8000 → 8000 × 1.22 µm = 9.76 mm wide, 7.32 mm tall.
 * 5× periscope with no published eq focal: 5 × 24 = 120 mm (computed).
 */
describe('phone camera optics', () => {
  const main = cam({ sensorFormat: '1/1.28"', eqFocalMm: 24, aperture: 1.48, megapixels: 48, pixelSizeUm: 1.22 });
  const tele = cam({ role: 'periscope', opticalZoom: 5, aperture: 2.8, folded: true, prism: 'tetraprism' });
  const p = phone([main, tele]);

  it('derives the sensor from the optical format (or pixels)', () => {
    const s = cameraSensor(main)!;
    expect(s.value.width).toBeCloseTo(10.0, 2);
    expect(s.value.height).toBeCloseTo(7.5, 2);
    const byPixels = cameraSensor(cam({ megapixels: 48, pixelSizeUm: 1.22 }))!;
    expect(byPixels.value.width).toBeCloseTo(9.76, 2);
    expect(byPixels.value.height).toBeCloseTo(7.32, 2);
    expect(cameraSensor(cam({}))).toBeNull();
  });

  it('computes real focal length, equivalent aperture and angle of view', () => {
    const o = cameraOptics(p, main);
    expect(o.crop).toBeCloseTo(3.461, 3);
    expect(o.eqFocal).toEqual({ value: 24, source: 'published' });
    expect(o.realFocal!.value).toBeCloseTo(6.93, 2);
    expect(o.realFocal!.source).toBe('computed');
    expect(o.eqAperture).toBe(5.1);
    expect(o.fovDiag!.value).toBeCloseTo(84.1, 1);
  });

  it('uses the zoom factor only when no equivalent focal length is published', () => {
    const o = cameraOptics(p, tele);
    expect(o.eqFocal!.value).toBe(120);
    expect(o.eqFocal!.source).toBe('computed');
    // no sensor size published → no real focal length, no DoF
    expect(o.realFocal).toBeNull();
    expect(o.dofAt2m).toBeNull();
  });

  it('matches the lab physics for depth of field', () => {
    // same thin lens in the lab's lens model (no breathing: no magnification published)
    const f = 6.934;
    const N = 1.48;
    const sensor = { width: 10, height: 7.5 };
    const c = cocForSensor(sensor);
    const s = lensState(
      { focal: { min: f, max: f }, maxAperture: { wide: N, tele: N }, minAperture: { wide: 16, tele: 16 }, mfd: { wide: 100, tele: 100 }, maxMagnification: null, maxMagAt: 'tele', sensor },
      0,
      2000,
      N,
    );
    const d = depthOfField(f, N, c, 2000);
    expect(d.near).toBeCloseTo(s.near, 6);
    expect(d.far).toBeCloseTo(s.far, 6);
    // H = f²/(Nc) + f = 48.08/(1.48·0.00867) + 6.93 ≈ 3754 mm; u ≈ 1993 → near = uH′/(H+u−2f) ≈ 1.30 m, far = uH′/(H−u) ≈ 4.24 m
    expect(d.near / 1000).toBeGreaterThan(1.2);
    expect(d.near / 1000).toBeLessThan(1.4);
    expect(d.far / 1000).toBeGreaterThan(3.5);
  });

  it('classifies folded modules', () => {
    expect(moduleKind(main)).toBe('straight');
    expect(moduleKind(tele)).toBe('tetraprism');
    expect(moduleKind(cam({ folded: true, prism: 'All Lenses on Prism (ALoP)' }))).toBe('lenses-on-prism');
    expect(moduleKind(cam({ folded: true, prism: 'periscope' }))).toBe('periscope');
  });
});
