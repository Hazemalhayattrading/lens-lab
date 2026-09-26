import { describe, expect, it } from 'vitest';
import type { LensData } from '../src/data/types';
import { labLensFromData, TEACHING_LENS, type LabLens } from '../src/lab/labLens';
import { computeFrame } from '../src/lab/optics';
import { maxApertureAtZoom } from '../src/optics/lensModel';
import { depthMap } from '../src/scene/layout';
import { LabState } from '../src/state/LabState';

const lensFiles = import.meta.glob<LensData[]>('../data/lenses/*.json', { eager: true, import: 'default' });
const library = Object.values(lensFiles).flat().map(labLensFromData);
const byId = (id: string) => library.find((l) => l.id === id)!;

function run(s: LabState, seconds: number, dt = 0.02): void {
  for (let t = 0; t < seconds - 1e-9; t += dt) s.update(dt);
}
function mounted(lens: LabLens, z = 0): LabState {
  const s = new LabState();
  s.setLens(lens);
  if (z > 0) {
    s.zoomTo(z, 0.01);
    run(s, 0.1);
  }
  return s;
}
const frame = (s: LabState) => computeFrame(s.lens, s.zoom, s.focusDistance, s.fNumber);
/** Left end of the focus slider (UI.setLens): 0.2 m, or the closest focus of a lens that focuses nearer. */
const sliderStart = (lens: LabLens) => Math.min(0, depthMap.toU(Math.min(lens.physics.mfd.wide, lens.physics.mfd.tele)));

describe('closest focus is reachable for every lens (review F5)', () => {
  for (const lens of [TEACHING_LENS, ...library]) {
    it(`${lens.id} reaches its MFD with the ring, the slider and a focus animation`, () => {
      for (const z of lens.isZoom ? [0, 0.5, 1] : [0]) {
        // focus ring / direct manipulation
        const ring = mounted(lens, z);
        ring.setFocusDistance(0, 'ring');
        const o = frame(ring);
        expect(o.focusDistance).toBeLessThanOrEqual(o.curve.mfd * 1.001); // the UI's "· closest"
        expect(o.magnification).toBeCloseTo(o.curve.mMax, 6); // T(m) is flat at 1:1 (T = 4f), so m only to √ε
        expect(o.ringFraction).toBeCloseTo(1, 6);
        // slider pulled to its left end
        const slider = mounted(lens, z);
        slider.followFocusU(sliderStart(lens), 'slider');
        run(slider, 2);
        expect(frame(slider).focusDistance).toBeLessThanOrEqual(o.curve.mfd * 1.001);
        // animated focus
        const anim = mounted(lens, z);
        anim.focusTo(0, 'button');
        run(anim, 3);
        expect(frame(anim).focusDistance).toBeLessThanOrEqual(o.curve.mfd * 1.001);
      }
    });
  }

  it('Fujifilm XF 23 f/1.4 (0.19 m, 0.2×) focuses below the 0.2 m ladder start', () => {
    const s = mounted(byId('fujifilm-xf-23mm-f14-r-lm-wr'));
    expect(s.uMin).toBeLessThan(0);
    s.setFocusDistance(0, 'ring');
    expect(s.focusDistance).toBeCloseTo(190, 6);
    expect(frame(s).magnification).toBeCloseTo(0.2, 9);
    // the ladder extends smoothly below its start: 190 mm → u = 1 − (200/190)^0.3
    expect(s.u).toBeCloseTo(1 - (200 / 190) ** 0.3, 12);
  });
});

describe('aperture animation (review F9 / F31 / F32)', () => {
  it('opening up to wide open animates in stops instead of snapping', () => {
    const s = mounted(TEACHING_LENS);
    s.setAperture(16);
    run(s, 2);
    expect(s.fNumber).toBe(16);
    s.setAperture(2);
    expect(s.wideOpen).toBe(true);
    const seq: number[] = [];
    for (let i = 0; i < 200 && s.animating; i++) {
      s.update(0.02);
      seq.push(s.fNumber);
    }
    expect(seq[0]).toBeGreaterThan(15); // was 2 on the very first frame
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]);
    expect(seq.length).toBeGreaterThan(20); // 0.5 s + 0.09 s per stop (6 stops) ≈ 1.04 s
    expect(s.fNumber).toBe(2);
  });

  it('wide open follows the zoom once the animation has finished', () => {
    const s = mounted(byId('canon-rf-100-500-f45-71-l-is-usm'));
    s.setAperture(8);
    run(s, 2);
    s.setAperture(4.5);
    run(s, 2);
    s.zoomTo(1, 0.01);
    run(s, 0.1);
    expect(s.fNumber).toBe(7.1);
    expect(s.fNumber).toBe(maxApertureAtZoom(s.lens.physics, s.zoom));
  });

  it('leaving wide open on a variable-aperture zoom starts from the f-number on screen', () => {
    // RF 100-500 f/4.5-7.1 loaded at 500 mm (wide open f/7.1), zoomed to 100 mm (wide open f/4.5), then f/5.6
    const lens = byId('canon-rf-100-500-f45-71-l-is-usm');
    const s = new LabState();
    s.setLens(lens, 500);
    expect(s.fNumber).toBe(7.1);
    s.zoomTo(0, 0.01);
    run(s, 0.1);
    expect(s.fNumber).toBe(4.5);
    s.setAperture(5.6);
    const seq: number[] = [s.fNumber];
    while (s.animating) {
      s.update(0.02);
      seq.push(s.fNumber);
    }
    expect(seq[0]).toBe(4.5); // was 7.1: the iris closed to the stale f-number first
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
    expect(s.fNumber).toBeCloseTo(5.6, 9);
  });
});

describe('focus animations after a zoom to a longer closest focus (review F10)', () => {
  it('RF 24-70: 0.21 m at 24 mm, zoom to 70 mm (0.38 m), then "Trees" moves the focus from the first frame', () => {
    const s = new LabState();
    s.setLens(byId('canon-rf-24-70-f28-l-is-usm'), 24);
    s.setFocusDistance(210, 'ring');
    s.zoomTo(1, 0.01);
    run(s, 0.1);
    expect(s.focusDistance).toBeCloseTo(380, 6);
    s.focusTo(2000, 'button');
    let prev = s.focusDistance;
    for (let i = 0; i < 10; i++) {
      s.update(0.02);
      expect(s.focusDistance).toBeGreaterThan(prev); // was frozen at 0.38 m for 0.46 s
      prev = s.focusDistance;
    }
    // the duration follows the distance actually travelled: 0.55 + |Δu|·1.1 from the clamped start
    const d = 0.55 + (depthMap.toU(2000) - depthMap.toU(380)) * 1.1;
    run(s, d - 0.2 - 0.02);
    expect(s.animating).toBe(true);
    run(s, 0.06);
    expect(s.animating).toBe(false);
    expect(s.focusDistance).toBeCloseTo(2000, 6);
  });

  it('the slider follower also starts from the clamped focus', () => {
    const s = new LabState();
    s.setLens(byId('canon-rf-24-70-f28-l-is-usm'), 24);
    s.setFocusDistance(210, 'ring');
    s.zoomTo(1, 0.01);
    run(s, 0.1);
    s.followFocusU(depthMap.toU(2000), 'slider');
    s.update(0.02);
    expect(s.focusDistance).toBeGreaterThan(400);
  });

  it('zooming back without refocusing still restores the closer focus', () => {
    const s = new LabState();
    s.setLens(byId('canon-rf-24-70-f28-l-is-usm'), 24);
    s.setFocusDistance(210, 'ring');
    s.zoomTo(1, 0.01);
    run(s, 0.1);
    s.zoomTo(0, 0.01);
    run(s, 0.1);
    expect(s.focusDistance).toBeCloseTo(210, 6);
  });
});
