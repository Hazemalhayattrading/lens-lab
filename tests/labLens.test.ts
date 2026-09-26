import { describe, expect, it } from 'vitest';
import type { LensData, SpecialElementKind } from '../src/data/types';
import { labLensFromData } from '../src/lab/labLens';
import { buildOpticalLayout } from '../src/lab/opticalLayout';
import { glassLegend } from '../src/lab/specialGlass';

const lensFiles = import.meta.glob<LensData[]>('../data/lenses/*.json', { eager: true, import: 'default' });
const library = Object.values(lensFiles).flat();
const key = (label: string) => label.toLowerCase().replace(/\s+/g, ' ').trim();

/** A library record with some fields replaced (never written back to data/). */
const variant = (id: string, patch: Partial<LensData>): LensData => ({ ...library.find((d) => d.id === id)!, ...patch });

describe('special glass listed under two kinds (review F13)', () => {
  it('Nikon Z 35 f/1.2: "Aspherical ED" is one element that is both ED and aspherical', () => {
    const lens = labLensFromData(library.find((d) => d.id === 'nikon-z-35mm-f12-s')!);
    const lay = buildOpticalLayout(lens);
    const ased = lay.specials.find((s) => s.label === 'Aspherical ED')!;
    expect(ased.kinds.slice().sort()).toEqual(['aspherical', 'low-dispersion']);
    expect(ased.elements.length).toBe(1);
    const el = lay.elements[ased.elements[0]];
    expect(el.special?.kinds.slice().sort()).toEqual(['aspherical', 'low-dispersion']);
    const legend = glassLegend(lens.special).find((g) => g.label === 'Aspherical ED')!;
    expect(legend.kinds.slice().sort()).toEqual(['aspherical', 'low-dispersion']);
    expect(legend.count).toBe(1);
  });

  for (const d of library.filter((x) => x.specialElements?.length)) {
    it(`${d.id}: every published kind reaches the cutaway and the legend`, () => {
      // expectation from the published list itself, not from the lab lens
      const want = new Map<string, Set<SpecialElementKind>>();
      for (const s of d.specialElements!) {
        if (!want.has(key(s.label))) want.set(key(s.label), new Set());
        want.get(key(s.label))!.add(s.kind);
      }
      const lens = labLensFromData(d);
      const lay = buildOpticalLayout(lens);
      for (const s of lay.specials) expect(new Set(s.kinds)).toEqual(want.get(key(s.label)));
      const legend = glassLegend(lens.special);
      expect(legend.length).toBe(want.size);
      for (const g of legend) expect(new Set(g.kinds)).toEqual(want.get(key(g.label)));
    });
  }
});

describe('unverified element / group counts (review F20)', () => {
  const base = 'nikon-z-35mm-f12-s'; // 17 elements in 15 groups, wide prime (retrofocus family 13/10)

  it('keeps the published element count when only the group count is unknown', () => {
    const lens = labLensFromData(variant(base, { groups: null }));
    expect(lens.elements).toBe(17);
    expect(lens.groups).toBe(Math.round((17 * 10) / 13)); // the family's cementing ratio: 13
    expect(lens.assumed).toContain('groups');
    expect(lens.assumed).not.toContain('elements');
    expect(buildOpticalLayout(lens).elements.length).toBe(17);
  });

  it('keeps the published group count when only the element count is unknown', () => {
    const lens = labLensFromData(variant(base, { elements: null }));
    expect(lens.groups).toBe(15);
    expect(lens.elements).toBe(Math.round((15 * 13) / 10)); // 20
    expect(lens.assumed).toContain('elements');
    expect(lens.assumed).not.toContain('groups');
    expect(buildOpticalLayout(lens).groupCount).toBe(15);
  });

  it('uses the family counts when neither is published', () => {
    const lens = labLensFromData(variant(base, { elements: null, groups: null }));
    expect([lens.elements, lens.groups]).toEqual([13, 10]);
    expect(lens.assumed).toContain('elements');
  });
});

describe('zoom magnification end (review F1)', () => {
  it('every zoom refers its published magnification to the tele end', () => {
    for (const d of library.filter((x) => x.focalLength.max > x.focalLength.min)) expect(labLensFromData(d).physics.maxMagAt).toBe('tele');
  });
});
