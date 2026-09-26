import { describe, expect, it } from 'vitest';
import type { LensCategory, LensData } from '../src/data/types';
import { labLensFromData, type LabLens } from '../src/lab/labLens';
import { buildOpticalLayout, clearance, distribute, frontAt, rearAt, wallFor, type OpticalLayout } from '../src/lab/opticalLayout';

const lensFiles = import.meta.glob<LensData[]>('../data/lenses/*.json', { eager: true, import: 'default' });
const library = Object.values(lensFiles).flat();

/** Synthetic lenses of every design family with fallback values (unverified specs). */
function synthetic(category: LensCategory, fMin: number, fMax: number, N: number, extending = false): LensData {
  return {
    id: `test-${category}-${fMin}-${fMax}`,
    brand: 'Sigma',
    name: `Test ${fMin}-${fMax}`,
    mount: 'L-Mount',
    format: 'full-frame',
    category,
    focalLength: { min: fMin, max: fMax },
    maxAperture: { wide: N, tele: N },
    minAperture: { wide: null, tele: null },
    elements: null,
    groups: null,
    specialElements: [
      { kind: 'aspherical', label: 'Aspherical', count: 2 },
      { kind: 'low-dispersion', label: 'ED', count: 2 },
    ],
    apertureBlades: null,
    minFocusM: { wide: null, tele: null },
    maxMagnification: null,
    stabilization: null,
    autofocus: null,
    weightG: null,
    dimensionsMm: null,
    filterMm: null,
    releaseYear: null,
    launchPrice: null,
    zoomMechanism: extending ? 'extending' : 'internal',
    famousFor: '',
    strengths: [],
    weaknesses: [],
    bestFor: [],
    sources: [],
    checked: '2026-01-01',
  };
}

const SYNTHETIC: LensData[] = [
  synthetic('ultra-wide', 14, 14, 1.8),
  synthetic('wide-prime', 35, 35, 1.4),
  synthetic('standard-prime', 50, 50, 1.4),
  synthetic('portrait-prime', 135, 135, 1.8),
  synthetic('macro', 90, 90, 2.8),
  synthetic('telephoto-prime', 300, 300, 2.8),
  synthetic('super-telephoto', 800, 800, 5.6),
  synthetic('ultra-wide', 12, 24, 4, true),
  synthetic('standard-zoom', 24, 105, 4, true),
  synthetic('telephoto-zoom', 70, 200, 4, true),
  synthetic('super-telephoto', 150, 600, 5.6, true),
];

const SAMPLES_Z = [0, 0.25, 0.5, 0.75, 1];
const SAMPLES_F = [0, 0.5, 1];

/** All vertex positions at zoom z / focus f. */
function positions(lay: OpticalLayout, z: number, f: number): number[] {
  return lay.elements.map((e) => e.h + lay.sectionOffset(e.section, z, f));
}

function check(lens: LabLens) {
  const lay = buildOpticalLayout(lens);
  const els = lay.elements;

  it('has the published element and group counts', () => {
    expect(els.length).toBe(lens.elements);
    expect(lay.groupCount).toBe(lens.groups);
    const cemented = els.filter((e) => e.cementedToNext).length;
    expect(els.length - cemented).toBe(lay.groupCount);
  });

  it('assigns every published special element (one piece of glass per label)', () => {
    const byLabel = new Map<string, number>();
    for (const s of lens.special) {
      const key = s.label.toLowerCase().replace(/\s+/g, ' ').trim();
      byLabel.set(key, Math.max(byLabel.get(key) ?? 0, s.count));
    }
    const wanted = Math.min(els.length, [...byLabel.values()].reduce((a, b) => a + b, 0));
    expect(els.filter((e) => e.special).length).toBe(wanted);
    for (const s of lay.specials) for (const i of s.elements) expect(els[i].special?.label).toBe(s.label);
  });

  it('builds valid elements inside the barrel', () => {
    const wall = wallFor(lens.dims.diameter);
    for (const e of els) {
      expect(e.a).toBeGreaterThan(0);
      expect(Math.abs(e.r1)).toBeGreaterThan(e.a);
      expect(Math.abs(e.r2)).toBeGreaterThan(e.a);
      expect(e.thickness).toBeGreaterThan(0);
      // positive edge thickness
      expect(frontAt(e, e.a) - rearAt(e, e.a)).toBeGreaterThan(0.5);
      // clear aperture fits inside the barrel wall where the element sits
      expect(e.a).toBeLessThan(lay.outerRadius(e.h) - wall + 1e-6);
    }
    // cemented partners share their contact surface
    for (let i = 0; i < els.length - 1; i++) {
      if (!els[i].cementedToNext) continue;
      expect(els[i + 1].r1).toBeCloseTo(-els[i].r2, 9);
      expect(els[i + 1].h).toBeCloseTo(els[i].h - els[i].thickness, 9);
    }
    // the rear element fits through the mount throat
    expect(els[els.length - 1].a).toBeLessThan(lay.throat / 2);
    expect(lay.stopSemi).toBeGreaterThan(0);
  });

  it('never collides at any zoom / focus position', () => {
    for (const z of lens.isZoom ? SAMPLES_Z : [0]) {
      for (const f of SAMPLES_F) {
        const h = positions(lay, z, f);
        for (let i = 0; i < els.length - 1; i++) {
          if (els[i].cementedToNext) continue;
          expect(clearance({ kind: 'glass', ...els[i] }, h[i], { kind: 'glass', ...els[i + 1] }, h[i + 1]), `${i}/${i + 1} at z=${z} f=${f}`).toBeGreaterThan(0.2);
        }
        // front element behind the front rim, rear element ahead of the flange
        expect(h[0]).toBeLessThan(lay.length + lay.extension(z));
        const last = els[els.length - 1];
        expect(h[els.length - 1] - last.thickness).toBeGreaterThan(0);
        // the iris sits between its neighbours
        const stopH = lay.stopH + lay.sectionOffset(lay.stopSection, z, f);
        const firstStop = lay.sections[lay.stopSection].elements[0];
        if (firstStop !== undefined) expect(stopH).toBeGreaterThan(h[firstStop]);
        if (firstStop > 0) expect(stopH).toBeLessThan(h[firstStop - 1] - els[firstStop - 1].thickness);
      }
    }
  });

  it('keeps the entrance pupil within the front element', () => {
    for (const z of [0, 1]) {
      expect(lay.pupilRatio(z)).toBeGreaterThan(0.3);
      expect(lay.pupilRatio(z) * lay.stopSemi).toBeLessThanOrEqual(els[0].a + 1e-6);
    }
  });

  if (lens.isZoom) {
    it('moves zoom groups when zooming', () => {
      const a = positions(lay, 0, 0);
      const b = positions(lay, 1, 0);
      expect(Math.max(...a.map((h, i) => Math.abs(h - b[i])))).toBeGreaterThan(0.5);
      if (lens.zoomExtends) expect(Math.max(lay.extension(0), lay.extension(1))).toBeGreaterThan(1);
      else expect(lay.extension(1)).toBe(0);
    });
  }

  it('moves a focus group when focusing', () => {
    const a = positions(lay, 0, 0);
    const b = positions(lay, 0, 1);
    expect(Math.max(...a.map((h, i) => Math.abs(h - b[i])))).toBeGreaterThan(0.3);
  });
}

describe('distribute', () => {
  it('splits by weight and gives every bucket at least one', () => {
    expect(distribute(10, [0.5, 0.3, 0.2])).toEqual([5, 3, 2]);
    expect(distribute(6, [0.42, 0.4, 0.18])).toEqual([3, 2, 1]);
    expect(distribute(2, [0.2, 0.5, 0.3]).reduce((a, b) => a + b, 0)).toBe(2);
    for (const n of [5, 7, 13, 26]) expect(distribute(n, [0.3, 0.2, 0.3, 0.2]).reduce((a, b) => a + b, 0)).toBe(n);
  });
});

for (const d of library) describe(`layout · ${d.id}`, () => check(labLensFromData(d)));
for (const d of SYNTHETIC) describe(`layout · synthetic ${d.id}`, () => check(labLensFromData(d)));
