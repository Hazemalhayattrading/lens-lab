import { describe, expect, it } from 'vitest';
import type { LensData, PhoneData } from '../src/data/types';

// the same glob the app uses to lazy-load the data (here eagerly)
const lensFiles = import.meta.glob<LensData[]>('../data/lenses/*.json', { eager: true, import: 'default' });
const phoneFiles = import.meta.glob<PhoneData[]>('../data/phones/*.json', { eager: true, import: 'default' });
const lenses = Object.values(lensFiles).flat();
const phones = Object.values(phoneFiles).flat();
const CATEGORIES = ['ultra-wide', 'wide-prime', 'standard-prime', 'portrait-prime', 'macro', 'standard-zoom', 'telephoto-zoom', 'telephoto-prime', 'super-telephoto'];
const KINDS = ['aspherical', 'low-dispersion', 'super-low-dispersion', 'fluorite', 'high-refractive', 'diffractive', 'anomalous-dispersion', 'other'];
const posOrNull = (v: number | null) => v === null || (typeof v === 'number' && v > 0 && Number.isFinite(v));

describe('lens data', () => {
  it('loads every brand file', () => {
    expect(Object.keys(lensFiles).length).toBeGreaterThan(0);
    expect(lenses.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = lenses.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const l of lenses) {
    it(`${l.id} follows the schema`, () => {
      expect(l.name.length).toBeGreaterThan(3);
      expect(CATEGORIES).toContain(l.category);
      expect(['full-frame', 'aps-c', 'micro-four-thirds', 'medium-format']).toContain(l.format);
      expect(l.focalLength.min).toBeGreaterThan(0);
      expect(l.focalLength.max).toBeGreaterThanOrEqual(l.focalLength.min);
      expect(l.maxAperture.wide).toBeGreaterThan(0.5);
      expect(l.maxAperture.tele).toBeGreaterThanOrEqual(l.maxAperture.wide);
      const prime = l.focalLength.min === l.focalLength.max;
      if (prime) {
        expect(l.maxAperture.tele).toBe(l.maxAperture.wide);
        expect(l.minAperture.tele).toBe(l.minAperture.wide);
        expect(l.minFocusM.tele).toBe(l.minFocusM.wide);
      }
      for (const v of [l.minAperture.wide, l.minAperture.tele]) if (v !== null) expect(v).toBeGreaterThan(l.maxAperture.tele);
      for (const v of [l.minFocusM.wide, l.minFocusM.tele]) {
        expect(posOrNull(v)).toBe(true);
        if (v !== null) expect(v).toBeLessThan(20); // metres
      }
      for (const v of [l.elements, l.groups, l.apertureBlades, l.weightG, l.filterMm, l.maxMagnification]) expect(posOrNull(v)).toBe(true);
      if (l.elements !== null && l.groups !== null) expect(l.groups).toBeLessThanOrEqual(l.elements);
      if (l.specialElements) {
        for (const s of l.specialElements) {
          expect(KINDS).toContain(s.kind);
          expect(s.count).toBeGreaterThan(0);
          if (l.elements !== null) expect(s.count).toBeLessThanOrEqual(l.elements);
        }
      }
      if (l.dimensionsMm) {
        expect(l.dimensionsMm.diameter).toBeGreaterThan(30);
        expect(l.dimensionsMm.length).toBeGreaterThan(10);
      }
      if (l.releaseYear !== null) expect(l.releaseYear).toBeGreaterThanOrEqual(2000);
      expect(l.famousFor.length).toBeGreaterThan(20);
      expect(l.strengths.length).toBeGreaterThan(0);
      expect(l.weaknesses.length).toBeGreaterThan(0);
      expect(l.bestFor.length).toBeGreaterThan(0);
      expect(l.sources.length).toBeGreaterThan(0);
      for (const s of l.sources) expect(s.url).toMatch(/^https?:\/\/[^\s]+$/);
      expect(l.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  }
});

describe('phone data', () => {
  it('has unique ids', () => {
    const ids = phones.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const p of phones) {
    it(`${p.id} follows the schema`, () => {
      expect(p.announced).toMatch(/^\d{4}-\d{2}$/);
      expect(p.cameras.some((c) => c.role === 'main')).toBe(true);
      for (const c of p.cameras) {
        expect(['ultra-wide', 'main', 'telephoto', 'periscope', 'front']).toContain(c.role);
        for (const v of [c.megapixels, c.pixelSizeUm, c.eqFocalMm, c.aperture, c.opticalZoom]) expect(posOrNull(v)).toBe(true);
        if (c.eqFocalMm !== null) expect(c.eqFocalMm).toBeLessThan(400);
      }
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources) expect(s.url).toMatch(/^https?:\/\/[^\s]+$/);
    });
  }
});
