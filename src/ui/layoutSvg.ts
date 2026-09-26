import type { LensData } from '../data/types';
import { labLensFromData, type LabLens } from '../lab/labLens';
import { buildOpticalLayout, frontAt, rearAt, wallFor, type OpticalLayout } from '../lab/opticalLayout';
import { SPECIAL_COLORS } from '../lab/specialGlass';

/**
 * SVG drawings of a lens for the library: a small barrel silhouette for the cards and the
 * illustrative cross-section (the same layout the 3D cutaway uses) for the detail sheet.
 * Procedural only — no product imagery.
 */

const cache = new Map<string, { lens: LabLens; layout: OpticalLayout }>();

export function layoutFor(d: LensData): { lens: LabLens; layout: OpticalLayout } {
  let v = cache.get(d.id);
  if (!v) {
    const lens = labLensFromData(d);
    v = { lens, layout: buildOpticalLayout(lens) };
    cache.set(d.id, v);
  }
  return v;
}

const f1 = (n: number) => n.toFixed(1);

/** Barrel outline (side view, mount on the left) sampled from the layout's radius profile. */
function outlinePath(lay: OpticalLayout, X: (h: number) => number, Y: (r: number) => number, ext = 0): string {
  const n = 48;
  const top: string[] = [];
  const bottom: string[] = [];
  const L = lay.length + ext;
  for (let i = 0; i <= n; i++) {
    const h = (L * i) / n;
    const r = lay.outerRadius(Math.min(h, lay.length));
    top.push(`${f1(X(h))},${f1(Y(r))}`);
    bottom.push(`${f1(X(h))},${f1(Y(-r))}`);
  }
  return `M${top.join('L')}L${bottom.reverse().join('L')}Z`;
}

/**
 * Card glyph: side silhouette. The longest lens in the library sets a common scale; smaller lenses
 * may be drawn up to 2.2× larger than that (so a pancake stays visible) but keep their proportions.
 */
export function glyphSvg(d: LensData, longestMm: number): string {
  const lay = layoutFor(d).layout;
  const W = 132;
  const H = 56;
  const common = (W - 8) / longestMm;
  const k = Math.min((W - 8) / lay.length, (H - 6) / lay.diameter, common * 2.2);
  const x0 = (W - lay.length * k) / 2;
  const X = (h: number) => x0 + h * k;
  const Y = (r: number) => H / 2 - r * k;
  const mountR = lay.throat / 2 + 3;
  const path = outlinePath(lay, X, Y);
  const front = X(lay.length);
  const frontR = lay.outerRadius(lay.length) - wallFor(lay.diameter) * 0.5;
  const glassR = Math.min(frontR - 1, lay.elements[0].a);
  return `<svg class="lib-glyph" viewBox="0 0 ${W} ${H}" aria-hidden="true">
  <rect x="${f1(X(0) - 1.5)}" y="${f1(Y(mountR))}" width="2.4" height="${f1(mountR * 2 * k)}" rx="0.6" class="g-mount"/>
  <path d="${path}" class="g-body"/>
  <ellipse cx="${f1(front)}" cy="${H / 2}" rx="${f1(Math.max(1.2, glassR * k * 0.16))}" ry="${f1(glassR * k)}" class="g-glass"/>
</svg>`;
}

/** Illustrative cross-section: barrel, elements (special glass colour-coded), iris. */
export function crossSectionSvg(d: LensData, zoom = 0): string {
  const { layout: lay } = layoutFor(d);
  const W = 560;
  const H = 220;
  const ext = lay.extension(zoom);
  const k = Math.min((W - 40) / (lay.length + ext), (H - 30) / lay.diameter);
  const x0 = (W - (lay.length + ext) * k) / 2;
  const X = (h: number) => x0 + h * k;
  const Y = (r: number) => H / 2 - r * k;
  const parts: string[] = [];
  const wall = wallFor(lay.diameter);
  // barrel shell (outline + inner wall)
  parts.push(`<path d="${outlinePath(lay, X, Y, ext)}" class="x-barrel"/>`);
  const inner: string[] = [];
  const n = 40;
  for (const sgn of [1, -1]) {
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const h = ((lay.length + ext) * i) / n;
      pts.push(`${f1(X(h))},${f1(Y(sgn * (lay.outerRadius(Math.min(h, lay.length)) - wall)))}`);
    }
    inner.push(`M${pts.join('L')}`);
  }
  parts.push(`<path d="${inner.join(' ')}" class="x-inner"/>`);
  // optical axis
  parts.push(`<line x1="${f1(X(-4))}" y1="${H / 2}" x2="${f1(X(lay.length + ext + 6))}" y2="${H / 2}" class="x-axis"/>`);
  // elements
  for (const e of lay.elements) {
    const h0 = e.h + lay.sectionOffset(e.section, zoom, 0);
    const pts: string[] = [];
    const m = 18;
    for (let i = 0; i <= m; i++) {
      const r = -e.a + (2 * e.a * i) / m;
      pts.push(`${f1(X(h0 + frontAt(e, Math.abs(r))))},${f1(Y(r))}`);
    }
    for (let i = m; i >= 0; i--) {
      const r = -e.a + (2 * e.a * i) / m;
      pts.push(`${f1(X(h0 + rearAt(e, Math.abs(r))))},${f1(Y(r))}`);
    }
    const kind = e.special?.kinds[0];
    const style = kind ? ` style="--c:${SPECIAL_COLORS[kind]}"` : '';
    const title = e.special ? `<title>Element ${e.index + 1}: ${escapeXml(e.special.label)}</title>` : `<title>Element ${e.index + 1}</title>`;
    parts.push(`<path d="M${pts.join('L')}Z" class="x-el${kind ? ' special' : ''}"${style}>${title}</path>`);
  }
  // iris
  const sh = lay.stopH + lay.sectionOffset(lay.stopSection, zoom, 0);
  const rs = lay.stopSemi;
  const rOut = lay.outerRadius(sh) - wall;
  for (const s of [1, -1]) parts.push(`<line x1="${f1(X(sh))}" y1="${f1(Y(s * rs))}" x2="${f1(X(sh))}" y2="${f1(Y(s * rOut))}" class="x-iris"/>`);
  // mount
  const mr = lay.throat / 2;
  parts.push(`<line x1="${f1(X(0))}" y1="${f1(Y(mr + 3))}" x2="${f1(X(0))}" y2="${f1(Y(-mr - 3))}" class="x-mount"/>`);
  return `<svg class="lib-xsec" viewBox="0 0 ${W} ${H}" role="img" aria-label="Illustrative cross-section: ${lay.elements.length} elements in ${lay.groupCount} groups">${parts.join('')}</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
