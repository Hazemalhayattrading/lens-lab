import { fmtDofCm } from '../../ui/format';
import { dist, esc, fNum, logScale, micro, mm, onWidth, pct, phoneName, rafThrottle, sliderMarkup, syncFill, tag, type Topic, type TopicContext } from '../dom';
import { compareWithFullFrame, mainCameras, type CameraExample, type DofComparison, type DofResult } from '../physics';

/** Series colours (validated as a set on the dark surface: lightness band, CVD separation, contrast). */
export const SERIES = { phone: '#16a3cc', same: '#dc4f98', chosen: '#c97c12' } as const;

/** Default example: its main-camera sensor size is confirmed on the maker's own spec page (see the data notes). */
export const DEFAULT_MAIN = 'google-pixel-11-pro-pro-xl';

const SUBJECT = logScale(500, 10000);
const FF_N = logScale(1.4, 22);
const SUBJECT_TICKS: [number, string][] = [
  [SUBJECT.toPos(500), '0.5 m'],
  [SUBJECT.toPos(1000), '1'],
  [SUBJECT.toPos(2000), '2'],
  [SUBJECT.toPos(5000), '5'],
  [SUBJECT.toPos(10000), '10 m'],
];
const N_TICKS: [number, string][] = [1.4, 2.8, 5.6, 11, 22].map((n) => [FF_N.toPos(n), `f/${n}`]);

/** Short product name for chips: "iPhone 18 Pro / Pro Max" → "iPhone 18 Pro". */
export const shortPhone = (name: string): string => name.split(' / ')[0];

/** Distance axis: w = d / (d + 2 m) puts 2 m in the middle and ∞ at the right end. */
const D0 = 2000;
const axisW = (d: number) => (Number.isFinite(d) ? d / (d + D0) : 1);

interface Row {
  key: keyof typeof SERIES;
  r: DofResult;
  label: string;
  short: string;
}

function cameraGlyph(x: number, y: number): string {
  return `<g class="z-cam" transform="translate(${x} ${y})"><rect x="-11" y="-7" width="18" height="14" rx="3"/><path d="M7 -4 L13 -7 L13 7 L7 4 Z"/><circle cx="-2" cy="0" r="3.2"/></g>`;
}

function zonesSvg(W: number, rows: Row[], subject: number): string {
  const narrow = W < 560;
  const x0 = narrow ? 36 : 54;
  const x1 = W - (narrow ? 12 : 20);
  const X = (d: number) => x0 + axisW(d) * (x1 - x0);
  const top = 30;
  const laneH = narrow ? 48 : 52;
  const bandH = 12;
  const axisY = top + rows.length * laneH + 4;
  const H = axisY + 32;
  const f1 = (v: number) => v.toFixed(1);
  let s = `<svg class="lt-zones" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Depth of field of each camera on a distance axis">`;
  // subject line (behind the lanes)
  const xs = X(subject);
  s += `<line class="z-subj" x1="${f1(xs)}" x2="${f1(xs)}" y1="${top - 8}" y2="${axisY}"/>`;
  const subjLabel = `Subject · ${dist(subject)}`;
  const lw = subjLabel.length * 6.4 + 16;
  const lx = Math.min(Math.max(xs, x0 + lw / 2), x1 - lw / 2);
  s += `<g class="z-subj-tag"><rect x="${f1(lx - lw / 2)}" y="${top - 26}" width="${f1(lw)}" height="19" rx="9.5"/><text x="${f1(lx)}" y="${top - 12.5}" text-anchor="middle">${esc(subjLabel)}</text></g>`;
  rows.forEach((row, i) => {
    const y = top + i * laneH;
    const c = SERIES[row.key];
    const range = `${dist(row.r.near)} – ${dist(row.r.far)}`;
    s += `<circle cx="${x0 + 4}" cy="${y + 8}" r="4" fill="${c}"/>`;
    s += `<text class="z-l" x="${x0 + 14}" y="${y + 12}">${esc(narrow ? row.short : row.label)}</text>`;
    s += `<text class="z-v" x="${x1}" y="${y + 12}" text-anchor="end">${esc(range)}</text>`;
    const by = y + 22;
    s += `<rect class="z-track" x="${x0}" y="${by}" width="${x1 - x0}" height="${bandH}" rx="${bandH / 2}"/>`;
    const a = X(row.r.near);
    const b = Number.isFinite(row.r.far) ? X(row.r.far) : x1;
    s += `<rect x="${f1(a)}" y="${by}" width="${f1(Math.max(3, b - a))}" height="${bandH}" rx="${bandH / 2}" fill="${c}" fill-opacity="0.3" stroke="${c}" stroke-width="1.5"/>`;
    if (!Number.isFinite(row.r.far)) s += `<path class="z-inf" d="M${f1(x1 - 12)} ${by + 2.5} L${f1(x1 - 6)} ${by + 6} L${f1(x1 - 12)} ${by + 9.5}" stroke="${c}"/>`;
  });
  s += cameraGlyph(narrow ? 16 : 24, top + (rows.length * laneH) / 2 - 2);
  // axis
  s += `<line class="z-axis" x1="${x0}" x2="${x1}" y1="${axisY}" y2="${axisY}"/>`;
  const ticks: [number, string][] = narrow
    ? [
        [500, '0.5'],
        [1000, '1'],
        [2000, '2'],
        [5000, '5'],
        [10000, '10'],
        [Infinity, '∞'],
      ]
    : [
        [0, '0'],
        [500, '0.5'],
        [1000, '1'],
        [2000, '2'],
        [3000, '3'],
        [5000, '5'],
        [10000, '10'],
        [20000, '20'],
        [Infinity, '∞'],
      ];
  for (const [d, l] of ticks) {
    const x = X(d);
    s += `<line class="z-tick" x1="${f1(x)}" x2="${f1(x)}" y1="${axisY}" y2="${axisY + 4}"/><text class="z-t" x="${f1(x)}" y="${axisY + 16}" text-anchor="middle">${l}</text>`;
  }
  s += `<text class="z-cap" x="${x1}" y="${axisY + 29}" text-anchor="end">metres from the sensor (focal plane)</text>`;
  s += '</svg>';
  return s;
}

/** Point lights far behind the subject (unit coordinates in a square tile). */
const LIGHTS: [number, number, string][] = [
  [0.2, 0.28, '#ffd49a'],
  [0.46, 0.18, '#ffe8c4'],
  [0.74, 0.3, '#ffb35c'],
  [0.3, 0.58, '#9fdcff'],
  [0.6, 0.52, '#ffd49a'],
  [0.84, 0.66, '#ffe8c4'],
  [0.16, 0.82, '#ffb35c'],
  [0.5, 0.8, '#ffe8c4'],
];
/** Each bokeh tile shows 1/ZOOM of the frame width, enlarged ZOOM×. */
const ZOOM = 20;

function drawBokeh(canvas: HTMLCanvasElement, frac: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(40, Math.round(canvas.clientWidth * dpr));
  if (canvas.width !== w) {
    canvas.width = w;
    canvas.height = w;
  }
  const g = canvas.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, w);
  bg.addColorStop(0, '#0b1426');
  bg.addColorStop(1, '#141b2c');
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = bg;
  g.fillRect(0, 0, w, w);
  const D = frac * ZOOM * w; // disc diameter in canvas px
  g.globalCompositeOperation = 'lighter';
  for (const [ux, uy, col] of LIGHTS) {
    const x = ux * w;
    const y = uy * w;
    if (D < 2.5 * dpr) {
      // effectively a point: small sharp dot with a faint glow
      const glow = g.createRadialGradient(x, y, 0, x, y, 7 * dpr);
      glow.addColorStop(0, col);
      glow.addColorStop(0.18, `${col}88`);
      glow.addColorStop(1, `${col}00`);
      g.fillStyle = glow;
      g.fillRect(x - 7 * dpr, y - 7 * dpr, 14 * dpr, 14 * dpr);
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x, y, Math.max(0.8 * dpr, D / 2), 0, Math.PI * 2);
      g.fill();
      continue;
    }
    // a blur disc: the same light spread over a larger area gets dimmer (∝ 1/D²), kept visible here
    const alpha = Math.max(0.2, Math.min(0.95, Math.pow((9 * dpr) / D, 2)));
    g.globalAlpha = alpha;
    const disc = g.createRadialGradient(x, y, 0, x, y, D / 2);
    disc.addColorStop(0, col);
    disc.addColorStop(0.82, col);
    disc.addColorStop(0.95, '#ffffff');
    disc.addColorStop(1, `${col}00`);
    g.fillStyle = disc;
    g.beginPath();
    g.arc(x, y, D / 2, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }
  g.globalCompositeOperation = 'source-over';
}

export function createSmallSensorsTopic(): Topic {
  let cams: CameraExample[] = [];
  let cam: CameraExample;
  let subject = 2000;
  let ffN = 5.9;
  let root: HTMLElement;
  let width = 0;
  const ref = (n: string) => root.querySelector<HTMLElement>(`[data-ref="${n}"]`)!;

  const rows = (cmp: DofComparison): Row[] => [
    { key: 'phone', r: cmp.phone, label: `Phone · ${mm(cam.realFocal, 2)} ${fNum(cam.aperture)}`, short: `Phone ${mm(cam.realFocal)} ${fNum(cam.aperture)}` },
    { key: 'same', r: cmp.sameN, label: `Full frame · ${mm(cam.eqFocal, 0)} ${fNum(cam.aperture)} — same f-number`, short: `Full frame ${mm(cam.eqFocal, 0)} ${fNum(cam.aperture)}` },
    { key: 'chosen', r: cmp.chosen, label: `Full frame · ${mm(cam.eqFocal, 0)} ${fNum(ffN)} — your f-number`, short: `Full frame ${mm(cam.eqFocal, 0)} ${fNum(ffN)}` },
  ];

  const table = (cmp: DofComparison): string => {
    const cols = [cmp.phone, cmp.sameN, cmp.chosen];
    const line = (label: string, f: (r: DofResult) => string, note = '') =>
      `<tr><th scope="row">${label}${note}</th>${cols.map((r) => `<td>${f(r)}</td>`).join('')}</tr>`;
    return `<table class="lt-table">
  <thead><tr><th></th>
    <th scope="col"><i style="background:${SERIES.phone}"></i>Phone</th>
    <th scope="col"><i style="background:${SERIES.same}"></i>Full frame<small>same f-number</small></th>
    <th scope="col"><i style="background:${SERIES.chosen}"></i>Full frame<small>your f-number</small></th></tr></thead>
  <tbody>
    ${line('Real focal length', (r) => mm(r.focal, r.focal < 10 ? 2 : 0))}
    ${line('f-number', (r) => fNum(r.fNumber))}
    ${line('Sensor', (r) => `${r.sensor.width.toFixed(1)} × ${r.sensor.height.toFixed(1)}`)}
    ${line('Sharp from', (r) => dist(r.near))}
    ${line('Sharp to', (r) => dist(r.far))}
    ${line('Depth of field', (r) => fmtDofCm(r.depth))}
    ${line('Background blur', (r) => pct(r.backgroundBlurFrac), '<small>of the frame width</small>')}
    ${line('Blur disc on sensor', (r) => micro(r.backgroundBlur))}
  </tbody>
</table>`;
  };

  const bokehTiles = (): string =>
    (['phone', 'same', 'chosen'] as const)
      .map(
        (k) => `<figure class="lt-tile"><canvas data-tile="${k}" aria-hidden="true"></canvas><figcaption><i style="background:${SERIES[k]}"></i><span data-tile-label="${k}"></span><b data-tile-val="${k}"></b></figcaption></figure>`,
      )
      .join('');

  const dataCard = (): string => {
    const pub = tag('pub');
    const calc = tag('calc');
    const hf = compareWithFullFrame(cam, subject, ffN).phone.hyperfocal;
    return `<h4>The example</h4>
<div class="lt-data-name">${esc(phoneName(cam.brand, cam.phone))}</div>
<div class="lt-data-sub">${esc(cam.camera)} · main camera</div>
<dl class="lt-dl">
  <dt>Sensor format</dt><dd>${esc(cam.formatUsed)} ${pub}</dd>
  <dt>Equivalent focal length</dt><dd>${cam.eqFocal} mm ${pub}</dd>
  <dt>Aperture</dt><dd>${fNum(cam.aperture)} ${pub}</dd>
  <dt>Sensor size</dt><dd>≈ ${cam.sensor.width.toFixed(2)} × ${cam.sensor.height.toFixed(2)} mm ${calc}</dd>
  <dt>Crop factor</dt><dd>${cam.crop.toFixed(2)} ${calc}</dd>
  <dt>Real focal length</dt><dd>${mm(cam.realFocal, 2)} ${cam.realFocalFrom === 'published' ? pub : calc}</dd>
  <dt>Equivalent aperture</dt><dd>${fNum(cam.eqAperture)} ${calc}</dd>
  <dt>Sharpness limit</dt><dd>${micro(cam.coc)} ${calc}</dd>
  <dt>Hyperfocal distance</dt><dd>${dist(hf)} ${calc}</dd>
</dl>
<p class="lt-note">Sensor size from the optical format: a 1/x-inch type has a diagonal of about 16/x mm (4:3). The circle of confusion is diagonal / 1442, the lab’s rule for every format.</p>
${cam.notes ? `<details class="lt-details"><summary>Notes on this data</summary><p>${esc(cam.notes)}</p></details>` : ''}`;
  };

  const prose = (): string => {
    const k = cam.crop.toFixed(2);
    const hf = compareWithFullFrame(cam, subject, ffN).phone.hyperfocal;
    const name = shortPhone(cam.phone);
    return `<h4>Same view, very different lenses</h4>
<p>“${cam.eqFocal} mm equivalent” means the ${esc(name)}’s main camera sees the same angle of view as a ${cam.eqFocal} mm lens on a full-frame (36 × 24 mm) camera. Its sensor is only about ${cam.sensor.width.toFixed(1)} × ${cam.sensor.height.toFixed(1)} mm — ${k}× smaller across the diagonal — so the lens that produces that view has a real focal length of just <strong>${mm(cam.realFocal, 2)}</strong> (${cam.eqFocal} ÷ ${k}).</p>
<h4>Short focal length, deep focus</h4>
<p>Depth of field follows the <em>real</em> focal length. At ${fNum(cam.aperture)} the phone’s aperture is ${mm(cam.realFocal / cam.aperture, 1)} wide; the full-frame ${cam.eqFocal} mm lens at the same ${fNum(cam.aperture)} opens to ${mm(cam.eqFocal / cam.aperture, 1)}. The narrow cone of light makes small blur discs, so much more of the scene stays within the sharpness limit — roughly ${k}× the depth of field up close, and far more as the subject nears the phone’s hyperfocal distance.</p>
<h4>Equivalent aperture predicts it</h4>
<p>Multiply the f-number by the crop factor: ${fNum(cam.aperture)} × ${k} ≈ <strong>${fNum(cam.eqAperture)}</strong>. A full-frame camera with a ${cam.eqFocal} mm lens at ${fNum(cam.eqAperture)} gives almost the same depth of field and the same background blur as a share of the frame — press “Equivalent” and the third row lines up with the phone. The match is not perfect: equivalence is exact only when the subject is much farther away than the focal length, and the far limit becomes very sensitive near the hyperfocal distance.</p>
<h4>What it means in practice</h4>
<p>Focus is forgiving: focused at ${dist(hf)} or beyond (the phone’s hyperfocal distance at ${fNum(cam.aperture)}), everything from about half that distance to infinity looks sharp. The price is that a strongly blurred background is optically out of reach — so phones simulate it in software (portrait mode, in <a href="#learn/computational">Computational photography</a>).</p>`;
  };

  let bokehCanvases: Record<string, HTMLCanvasElement> = {};

  const update = () => {
    const cmp = compareWithFullFrame(cam, subject, ffN);
    if (width > 0) ref('zones').innerHTML = zonesSvg(width, rows(cmp), subject);
    ref('table').innerHTML = table(cmp);
    const vals: Record<string, DofResult> = { phone: cmp.phone, same: cmp.sameN, chosen: cmp.chosen };
    const labels: Record<string, string> = { phone: 'Phone', same: `Full frame ${fNum(cam.aperture)}`, chosen: `Full frame ${fNum(ffN)}` };
    for (const k of Object.keys(vals)) {
      drawBokeh(bokehCanvases[k], vals[k].backgroundBlurFrac);
      root.querySelector(`[data-tile-label="${k}"]`)!.textContent = labels[k];
      root.querySelector(`[data-tile-val="${k}"]`)!.textContent = `${pct(vals[k].backgroundBlurFrac)} · ≈ ${Math.max(1, Math.round(vals[k].backgroundBlurFrac * 4000))} px`;
    }
    const sIn = root.querySelector<HTMLInputElement>('#ls-subject')!;
    const nIn = root.querySelector<HTMLInputElement>('#ls-ffn')!;
    root.querySelector('[data-out="ls-subject"]')!.textContent = dist(subject);
    root.querySelector('[data-out="ls-ffn"]')!.textContent = fNum(ffN);
    syncFill(sIn);
    syncFill(nIn);
    const near = (a: number, b: number) => Math.abs(a / b - 1) < 0.015;
    ref('q-same').setAttribute('aria-pressed', String(near(ffN, cam.aperture)));
    ref('q-eq').setAttribute('aria-pressed', String(near(ffN, cam.eqAperture)));
    ref('q-same').querySelector('b')!.textContent = fNum(cam.aperture);
    ref('q-eq').querySelector('b')!.textContent = fNum(cam.eqAperture);
    const ratio = cmp.phone.depth / cmp.sameN.depth;
    ref('insight').innerHTML = Number.isFinite(cmp.phone.far)
      ? `At ${dist(subject)} the phone keeps <strong>${fmtDofCm(cmp.phone.depth)}</strong> sharp — <strong>${ratio.toFixed(1)}×</strong> the depth of field of the full-frame camera at the same ${fNum(cam.aperture)}.`
      : `At ${dist(subject)} the phone is past its hyperfocal distance: everything from <strong>${dist(cmp.phone.near)}</strong> to infinity is sharp. The full-frame camera at ${fNum(cam.aperture)} holds only ${fmtDofCm(cmp.sameN.depth)}.`;
  };
  const schedule = rafThrottle(update);

  const setCamera = (id: string) => {
    cam = cams.find((c) => c.phoneId === id) ?? cams[0];
    ffN = cam.eqAperture;
    root.querySelector<HTMLInputElement>('#ls-ffn')!.value = String(FF_N.toPos(ffN));
    root.querySelectorAll<HTMLElement>('[data-phone]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.phone === cam.phoneId)));
    ref('prose').innerHTML = prose();
    ref('data').innerHTML = dataCard();
    update();
  };

  return {
    id: 'small-sensors',
    title: 'Why phones keep everything sharp',
    short: 'Small sensors',
    blurb: 'Small sensors and depth of field',
    mount(el: HTMLElement, ctx: TopicContext) {
      root = el;
      cams = mainCameras(ctx.phones);
      if (!cams.length) {
        el.innerHTML = `<p class="lt-empty">No phone with a published main-camera sensor size, equivalent focal length and f-number in the data yet.</p>`;
        return;
      }
      const chips = cams
        .map((c) => `<button class="lt-chip" data-phone="${c.phoneId}" aria-pressed="false"><strong>${esc(shortPhone(c.phone))}</strong><small>${esc(c.formatUsed)} · ${fNum(c.aperture)}</small></button>`)
        .join('');
      el.innerHTML = `
<header class="lt-head">
  <div class="eyebrow">Explainer 01 · Depth of field</div>
  <h3>Why phones keep everything sharp</h3>
  <p class="lt-lead">A phone and a full-frame camera can frame exactly the same picture, yet the phone keeps far more of it in focus. The reason is the size of the sensor — and with it, the real focal length of the lens.</p>
</header>
<div class="lt-card">
  <div class="lt-field"><span class="lt-label">Example phone · main camera</span><div class="lt-chips" role="group" aria-label="Example phone">${chips}</div></div>
  <div class="lt-ctrls">
    ${sliderMarkup({ id: 'ls-subject', label: 'Subject distance', value: SUBJECT.toPos(subject), ticks: SUBJECT_TICKS })}
    <div>
      ${sliderMarkup({ id: 'ls-ffn', label: 'Full-frame f-number', value: FF_N.toPos(ffN), ticks: N_TICKS })}
      <div class="lt-quick">
        <button class="btn" data-ref="q-same" aria-pressed="false">Same as phone <b></b></button>
        <button class="btn" data-ref="q-eq" aria-pressed="false">Equivalent <b></b></button>
      </div>
    </div>
  </div>
  <p class="lt-insight" data-ref="insight" aria-live="polite"></p>
  <figure class="lt-fig lt-zones-fig" data-ref="zones"></figure>
  <div class="lt-split">
    <div class="lt-table-wrap" data-ref="table"></div>
    <div class="lt-bokeh">
      <div class="lt-bokeh-head"><strong>Distant lights, magnified</strong><span>Each tile shows 5 % of the frame width, enlarged ${ZOOM}×. A light far behind the subject spreads into a disc this size. Pixel counts assume a 4000-px-wide photo.</span></div>
      <div class="lt-tiles">${bokehTiles()}</div>
    </div>
  </div>
</div>
<div class="lt-cols">
  <div class="lt-prose" data-ref="prose"></div>
  <aside class="lt-data" data-ref="data"></aside>
</div>`;
      bokehCanvases = {};
      el.querySelectorAll<HTMLCanvasElement>('[data-tile]').forEach((c) => (bokehCanvases[c.dataset.tile!] = c));
      el.querySelectorAll<HTMLElement>('[data-phone]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.phone!)));
      const sIn = el.querySelector<HTMLInputElement>('#ls-subject')!;
      const nIn = el.querySelector<HTMLInputElement>('#ls-ffn')!;
      sIn.addEventListener('input', () => {
        subject = SUBJECT.toValue(Number(sIn.value));
        schedule();
      });
      nIn.addEventListener('input', () => {
        ffN = FF_N.toValue(Number(nIn.value));
        schedule();
      });
      ref('q-same').addEventListener('click', () => {
        ffN = cam.aperture;
        nIn.value = String(FF_N.toPos(ffN));
        update();
      });
      ref('q-eq').addEventListener('click', () => {
        ffN = cam.eqAperture;
        nIn.value = String(FF_N.toPos(ffN));
        update();
      });
      const zones = ref('zones');
      width = Math.round(zones.clientWidth);
      onWidth(zones, (w) => {
        width = w;
        update();
      });
      setCamera(cams.some((c) => c.phoneId === DEFAULT_MAIN) ? DEFAULT_MAIN : cams[0].phoneId);
    },
    setActive() {
      /* static visuals: nothing to start or stop */
    },
  };
}
