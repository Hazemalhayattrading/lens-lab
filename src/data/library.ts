import type { LensData, PhoneData } from './types';

/**
 * Lazy access to the researched product data. Vite turns every JSON file into its own chunk,
 * so nothing is downloaded until the library (or a lens) is actually needed.
 */
const lensFiles = import.meta.glob<LensData[]>('../../data/lenses/*.json', { import: 'default' });
const phoneFiles = import.meta.glob<PhoneData[]>('../../data/phones/*.json', { import: 'default' });

let lensCache: Promise<LensData[]> | null = null;
let phoneCache: Promise<PhoneData[]> | null = null;

/** Brand order in the library (as listed in the brief), then anything else alphabetically. */
const BRAND_ORDER = ['Canon', 'Nikon', 'Sony', 'Fujifilm', 'Panasonic', 'Leica', 'Sigma', 'Tamron'];

export function loadLenses(): Promise<LensData[]> {
  lensCache ??= Promise.all(Object.values(lensFiles).map((load) => load())).then((all) =>
    all.flat().sort((a, b) => {
      const ia = BRAND_ORDER.indexOf(a.brand);
      const ib = BRAND_ORDER.indexOf(b.brand);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return 0;
    }),
  );
  return lensCache;
}

export async function findLens(id: string): Promise<LensData | undefined> {
  return (await loadLenses()).find((l) => l.id === id);
}

export function loadPhones(): Promise<PhoneData[]> {
  phoneCache ??= Promise.all(Object.values(phoneFiles).map((load) => load())).then((all) => all.flat());
  return phoneCache;
}
