import type { SpecialElement, SpecialElementKind } from '../data/types';

/** Colour code of special glass (cutaway rims, legend, labels). */
export const SPECIAL_COLORS: Record<SpecialElementKind, string> = {
  aspherical: '#46d9ff',
  'low-dispersion': '#7dffb0',
  'super-low-dispersion': '#35f2d0',
  fluorite: '#c39bff',
  'anomalous-dispersion': '#a8f0ff',
  'high-refractive': '#ffc46b',
  diffractive: '#ff8ad8',
  other: '#ff9d7a',
};

/** Plain-language names of the special-glass kinds (legend). */
export const SPECIAL_KIND_NAMES: Record<SpecialElementKind, string> = {
  aspherical: 'Aspherical',
  'low-dispersion': 'Low dispersion',
  'super-low-dispersion': 'Extra-low dispersion',
  fluorite: 'Fluorite',
  'anomalous-dispersion': 'Anomalous dispersion',
  'high-refractive': 'High refractive index',
  diffractive: 'Diffractive',
  other: 'Special material',
};

/** One legend entry per piece of special glass (a label listed under several kinds is one element type). */
export function glassLegend(list: SpecialElement[]): { label: string; kinds: SpecialElementKind[]; count: number; color: string }[] {
  const byLabel = new Map<string, { label: string; kinds: SpecialElementKind[]; count: number; color: string }>();
  for (const s of list) {
    const key = s.label.toLowerCase().replace(/\s+/g, ' ').trim();
    const prev = byLabel.get(key);
    if (prev) {
      if (!prev.kinds.includes(s.kind)) prev.kinds.push(s.kind);
      prev.count = Math.max(prev.count, s.count);
    } else byLabel.set(key, { label: s.label, kinds: [s.kind], count: s.count, color: SPECIAL_COLORS[s.kind] });
  }
  return [...byLabel.values()];
}
