// Generates data/SOURCES.md from the product JSON files (run: npm run sources).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (dir) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(root, dir, f), 'utf8')));

const lensFields = [
  ['minAperture', (l) => l.minAperture.wide ?? l.minAperture.tele],
  ['elements', (l) => l.elements],
  ['groups', (l) => l.groups],
  ['special elements', (l) => l.specialElements],
  ['aperture blades', (l) => l.apertureBlades],
  ['min. focus', (l) => l.minFocusM.wide ?? l.minFocusM.tele],
  ['max. magnification', (l) => l.maxMagnification],
  ['stabilisation', (l) => l.stabilization],
  ['weight', (l) => l.weightG],
  ['dimensions', (l) => l.dimensionsMm],
  ['filter', (l) => (l.filterMm === null && /filter/i.test(l.notes ?? '') ? 'n/a' : l.filterMm)],
  ['release year', (l) => l.releaseYear],
  ['launch price', (l) => l.launchPrice],
];
const cameraFields = ['megapixels', 'sensorFormat', 'pixelSizeUm', 'eqFocalMm', 'aperture', 'opticalZoom', 'stabilization', 'autofocus'];

const links = (sources) => sources.map((s, i) => `[${i + 1}${s.kind === 'official' ? '·official' : s.kind === 'press' ? '·press' : ''}](${s.url})`).join(' ');
const esc = (s) => String(s).replace(/\|/g, '\\|');

const lenses = read('data/lenses');
const phones = read('data/phones');
const out = [];
out.push('# Sources');
out.push('');
out.push('Generated from the product data in `data/` by `npm run sources` — do not edit by hand.');
out.push('Every value in the app comes from the sources listed for its product; values that could not be');
out.push('verified are empty in the data and shown as **unverified** in the app. Research method: [RESEARCH.md](RESEARCH.md).');
out.push('');
out.push(`**${lenses.length} lenses, ${phones.length} phones.** Links marked *official* are the maker's own pages; the others are reviews or databases used to fill gaps (see each product's notes in the app).`);
out.push('');

const brands = [...new Set(lenses.map((l) => l.brand))];
out.push('## Lenses');
for (const b of brands) {
  out.push('');
  out.push(`### ${b}`);
  out.push('');
  out.push('| Lens | Sources | Checked | Unverified |');
  out.push('|---|---|---|---|');
  for (const l of lenses.filter((x) => x.brand === b)) {
    const missing = lensFields.filter(([, get]) => get(l) === null).map(([name]) => name);
    out.push(`| ${esc(l.name)} | ${links(l.sources)} | ${l.checked} | ${missing.length ? missing.join(', ') : '—'} |`);
  }
}
out.push('');
out.push('## Phones');
for (const p of phones) {
  out.push('');
  out.push(`### ${p.brand} ${p.name} (announced ${p.announced})`);
  out.push('');
  out.push(`Sources: ${links(p.sources)} · checked ${p.checked}`);
  out.push('');
  out.push('| Camera | Unverified |');
  out.push('|---|---|');
  for (const c of p.cameras) {
    const missing = cameraFields.filter((k) => c[k] === null || c[k] === undefined);
    out.push(`| ${esc(c.label)} (${c.role}) | ${missing.length ? missing.join(', ') : '—'} |`);
  }
}
out.push('');
writeFileSync(join(root, 'data/SOURCES.md'), out.join('\n'));
console.log(`data/SOURCES.md: ${lenses.length} lenses, ${phones.length} phones`);
