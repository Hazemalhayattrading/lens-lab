import { FULL_FRAME } from '../../optics/formats';
import { esc, fNum, logScale, mm, onWidth, rafThrottle, sliderMarkup, syncFill, tag, type Topic, type TopicContext } from '../dom';
import { equivalence, mainCameras, normalizeFormat, periscopeCameras, sensorFormats, type CameraExample, type FormatEntry } from '../physics';
import { DEFAULT_MAIN, shortPhone } from './smallSensors';

const FOCAL = logScale(1.5, 600);
const APERTURE = logScale(0.95, 22);
const FOCAL_TICKS: [number, string][] = [2, 10, 50, 200, 600].map((f) => [FOCAL.toPos(f), f === 600 ? '600 mm' : String(f)]);
const N_TICKS: [number, string][] = [1, 2, 4, 8, 16].map((n) => [APERTURE.toPos(n), `f/${n}`]);

const deg = (r: number) => (r * 180) / Math.PI;
const fmtDeg = (r: number) => `${deg(r) >= 100 ? deg(r).toFixed(0) : deg(r).toFixed(1)}°`;
const sizeText = (e: FormatEntry) => `${e.approx ? '≈ ' : ''}${e.sensor.width.toFixed(1)} × ${e.sensor.height.toFixed(1)}`;

interface Preset {
  id: string;
  label: string;
  cam: CameraExample;
}

/** Sensor outlines to scale, sharing the bottom-left corner, with a callout column of labels. */
function overlaySvg(W: number, formats: FormatEntry[], sel: string): string {
  const narrow = W < 520;
  const labelW = narrow ? 118 : 150;
  const pad = 10;
  const maxH = narrow ? 170 : 250;
  const k = Math.min((W - labelW - pad * 2 - 18) / FULL_FRAME.width, maxH / FULL_FRAME.height);
  const gap = narrow ? 14.5 : 16.5;
  const rectsH = FULL_FRAME.height * k;
  const top = 14;
  // label slots: natural y = top edge of each outline, pushed apart to `gap`
  const natural = formats.map((f) => top + rectsH - f.sensor.height * k);
  const ys: number[] = [];
  natural.forEach((y, i) => ys.push(i === 0 ? Math.max(y, top + 4) : Math.max(y, ys[i - 1] + gap)));
  const H = Math.max(top + rectsH, ys[ys.length - 1] + 6) + 16;
  const ox = pad;
  const oy = top + rectsH;
  const lx = ox + FULL_FRAME.width * k + 18;
  const f1 = (v: number) => v.toFixed(1);
  let s = `<svg class="lt-sensors" viewBox="0 0 ${W} ${f1(H)}" width="${W}" height="${f1(H)}" role="img" aria-label="Sensor sizes to scale">`;
  // outlines, largest first so the small ones stay on top
  formats.forEach((f) => {
    const w = f.sensor.width * k;
    const h = f.sensor.height * k;
    const on = f.id === sel;
    s += `<rect class="s-r ${f.kind}${on ? ' on' : ''}" x="${f1(ox)}" y="${f1(oy - h)}" width="${f1(w)}" height="${f1(h)}" rx="${Math.min(3, w / 10).toFixed(1)}" data-fmt="${f.id}"/>`;
  });
  formats.forEach((f, i) => {
    const on = f.id === sel;
    const cx = ox + f.sensor.width * k;
    const cy = oy - f.sensor.height * k;
    const y = ys[i];
    s += `<path class="s-lead${on ? ' on' : ''}" d="M${f1(cx)} ${f1(cy)} L${f1(lx - 10)} ${f1(y - 3.5)} L${f1(lx - 4)} ${f1(y - 3.5)}"/>`;
    s += `<circle class="s-dot${on ? ' on' : ''}" cx="${f1(cx)}" cy="${f1(cy)}" r="${on ? 2.6 : 1.8}"/>`;
    s += `<text class="s-l${on ? ' on' : ''}" x="${f1(lx)}" y="${f1(y)}" data-fmt="${f.id}"><tspan>${esc(narrow ? shortName(f) : f.name)}</tspan><tspan class="s-k" dx="6">×${f.crop.toFixed(2)}</tspan></text>`;
  });
  s += `<text class="s-cap" x="${ox}" y="${f1(H - 3)}">to scale · 36 × 24 mm = full frame</text>`;
  s += '</svg>';
  return s;
}

const shortName = (f: FormatEntry) => (f.id === 'micro-four-thirds' ? 'MFT' : f.id === '1-inch' ? '1-inch' : f.name);

/** Horizontal angle of view as a wedge (top view), identical for the real lens and its equivalent. */
function wedgeSvg(aov: number, eqFocal: number): string {
  const W = 220;
  const H = 104;
  const cx = W / 2;
  const cy = H - 12;
  const half = Math.min(aov / 2, (Math.PI / 2) * 0.985);
  const r = 82;
  const x1 = cx - Math.sin(half) * r;
  const y1 = cy - Math.cos(half) * r;
  const x2 = cx + Math.sin(half) * r;
  const large = half > Math.PI / 2 ? 1 : 0;
  return `<svg class="lt-wedge" viewBox="0 0 ${W} ${H}" role="img" aria-label="Horizontal angle of view ${fmtDeg(aov)}">
  <path class="w-fill" d="M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y1.toFixed(1)} Z"/>
  <rect class="w-cam" x="${cx - 9}" y="${cy - 1}" width="18" height="10" rx="2.5"/>
  <text class="w-t" x="${cx}" y="${cy - 24}" text-anchor="middle">${fmtDeg(aov)}</text>
  <text class="w-s" x="${cx}" y="${cy - 10}" text-anchor="middle">= ${Math.round(eqFocal)} mm on full frame</text>
</svg>`;
}

export function createEquivalenceTopic(): Topic {
  let root: HTMLElement;
  let formats: FormatEntry[] = [];
  let presets: Preset[] = [];
  let sel = 'aps-c';
  let focal = 35;
  let N = 2;
  let preset: string | null = null;
  let width = 0;
  const ref = (n: string) => root.querySelector<HTMLElement>(`[data-ref="${n}"]`)!;
  const fmt = () => formats.find((f) => f.id === sel)!;

  const formatTable = (): string =>
    `<table class="lt-table lt-formats">
  <thead><tr><th scope="col">Format</th><th scope="col">Size, mm</th><th scope="col">Crop</th></tr></thead>
  <tbody>${formats
    .map(
      (f) => `<tr class="${f.id === sel ? 'on' : ''}"><th scope="row"><button class="lt-link" data-pick="${f.id}" aria-pressed="${f.id === sel}">${esc(f.name)}</button>${
        f.usedBy.length ? `<small>${f.usedBy.map(esc).join('<br>')}</small>` : ''
      }</th><td>${sizeText(f)}</td><td>×${f.crop.toFixed(2)}</td></tr>`,
    )
    .join('')}</tbody>
</table>`;

  const render = () => {
    const f = fmt();
    const e = equivalence(f.sensor, focal, N);
    if (width > 0) ref('overlay').innerHTML = overlaySvg(width, formats, sel);
    ref('fmt-name').textContent = f.name;
    ref('fmt-size').textContent = `${sizeText(f)} mm · crop ×${e.crop.toFixed(2)}`;
    const sel$ = root.querySelector<HTMLSelectElement>('#le-format')!;
    sel$.value = sel;
    const fIn = root.querySelector<HTMLInputElement>('#le-focal')!;
    const nIn = root.querySelector<HTMLInputElement>('#le-n')!;
    root.querySelector('[data-out="le-focal"]')!.textContent = mm(focal, focal < 10 ? 2 : 1);
    root.querySelector('[data-out="le-n"]')!.textContent = fNum(N);
    syncFill(fIn);
    syncFill(nIn);
    const stops = Math.log2(1 / e.lightVsFullFrame);
    ref('r-eqf').textContent = `${e.eqFocal >= 100 ? e.eqFocal.toFixed(0) : e.eqFocal.toFixed(1)} mm`;
    ref('r-eqn').textContent = fNum(e.eqAperture);
    ref('r-exp').textContent = fNum(N);
    ref('r-aov').textContent = fmtDeg(e.aovDiagonal);
    ref('r-aov-hv').textContent = `${fmtDeg(e.aovHorizontal)} × ${fmtDeg(e.aovVertical)}`;
    ref('r-light').innerHTML =
      f.id === 'full-frame'
        ? `Full frame is the reference: crop ×1, so the equivalent values equal the real ones.`
        : e.crop < 1
          ? `This sensor is larger than full frame.`
          : `At the same ${fNum(N)}, shutter speed and framing, this ${esc(f.name)} sensor collects <strong>1/${(1 / e.lightVsFullFrame).toFixed(1)}</strong> of the light a full-frame sensor does (${stops.toFixed(1)} stops less) ${tag('calc')}. A full-frame camera at ${fNum(e.eqAperture)} would collect the same total light — and show the same depth of field.`;
    ref('wedge').innerHTML = wedgeSvg(e.aovHorizontal, e.eqFocal);
    ref('formats').innerHTML = formatTable();
    root.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === preset)));
    const p = presets.find((x) => x.id === preset);
    ref('preset-note').innerHTML = p
      ? `${esc(p.cam.brand)} ${esc(shortPhone(p.cam.phone))} · ${esc(p.cam.camera)}: ${esc(p.cam.formatUsed)} ${tag('pub')} ${p.cam.eqFocal} mm equivalent ${tag(p.cam.eqFocalFrom === 'published' ? 'pub' : 'calc')} ${fNum(p.cam.aperture)} ${tag('pub')} → real focal length ${mm(p.cam.realFocal, 2)} ${tag('calc')}`
      : `Pick a phone camera above, or set any format, focal length and f-number.`;
  };
  const schedule = rafThrottle(render);

  const applyPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    preset = id;
    const entry = formats.find((f) => f.kind === 'phone' && f.name === normalizeFormat(p.cam.formatUsed));
    if (entry) sel = entry.id;
    focal = p.cam.realFocal;
    N = p.cam.aperture;
    root.querySelector<HTMLInputElement>('#le-focal')!.value = String(FOCAL.toPos(focal));
    root.querySelector<HTMLInputElement>('#le-n')!.value = String(APERTURE.toPos(N));
    render();
  };

  return {
    id: 'equivalence',
    title: 'Equivalent focal length and aperture',
    short: 'Equivalence',
    blurb: 'Crop factor, sensor sizes, what “equivalent” means',
    mount(el: HTMLElement, ctx: TopicContext) {
      root = el;
      formats = sensorFormats(ctx.phones);
      const mains = mainCameras(ctx.phones);
      const teles = periscopeCameras(ctx.phones).filter((c) => !c.sensorIsExample);
      presets = [
        ...mains.map((c) => ({ id: `main-${c.phoneId}`, label: `${shortPhone(c.phone)} main`, cam: c })),
        ...teles.map((c) => ({ id: `tele-${c.phoneId}`, label: `${shortPhone(c.phone)} ${c.opticalZoom ?? ''}× tele`.replace(' × ', ' '), cam: c })),
      ];
      const ex = mains.find((c) => c.phoneId === DEFAULT_MAIN) ?? mains[0];
      const example = ex
        ? `: the ${esc(shortPhone(ex.phone))}’s ${mm(ex.realFocal, 2)} main-camera lens on its ${esc(ex.formatUsed)} sensor (crop ×${ex.crop.toFixed(2)}) sees like a ${ex.eqFocal} mm lens on full frame`
        : '';
      const lead = ex
        ? `The ${esc(shortPhone(ex.phone))}’s main camera is listed as ${ex.eqFocal} mm ${fNum(ex.aperture)}, yet its lens has a real focal length of only about ${mm(ex.realFocal, 1)}. `
        : '';
      const options = formats.map((f) => `<option value="${f.id}">${esc(f.name)} — ×${f.crop.toFixed(2)}</option>`).join('');
      el.innerHTML = `
<header class="lt-head">
  <div class="eyebrow">Explainer 02 · Equivalence</div>
  <h3>Equivalent focal length and aperture</h3>
  <p class="lt-lead">${lead}“Equivalent” numbers translate any sensor size into the language of full-frame cameras — for angle of view, depth of field and total light, but not for exposure.</p>
</header>
<div class="lt-card lt-eq">
  <div class="lt-eq-fig">
    <div class="lt-field"><span class="lt-label">Sensor sizes to scale</span></div>
    <figure class="lt-fig" data-ref="overlay"></figure>
  </div>
  <div class="lt-eq-calc">
    <div class="lt-field"><span class="lt-label">Try a phone camera</span><div class="lt-chips" role="group" aria-label="Phone camera presets">${presets
      .map((p) => `<button class="lt-chip" data-preset="${p.id}" aria-pressed="false"><strong>${esc(p.label)}</strong></button>`)
      .join('')}</div></div>
    <p class="lt-note lt-preset-note" data-ref="preset-note"></p>
    <label class="lt-select"><span class="lt-label">Sensor format</span>
      <select id="le-format">${options}</select>
      <small><b data-ref="fmt-name"></b> <span data-ref="fmt-size"></span></small>
    </label>
    <div class="lt-ctrls one">
      ${sliderMarkup({ id: 'le-focal', label: 'Real focal length', value: FOCAL.toPos(focal), ticks: FOCAL_TICKS })}
      ${sliderMarkup({ id: 'le-n', label: 'f-number', value: APERTURE.toPos(N), ticks: N_TICKS })}
    </div>
    <div class="lt-results">
      <div class="lt-stat"><span>Equivalent focal length</span><b data-ref="r-eqf"></b><small>same angle of view on full frame</small></div>
      <div class="lt-stat"><span>Equivalent f-number</span><b data-ref="r-eqn"></b><small>same depth of field and total light</small></div>
      <div class="lt-stat"><span>Exposure</span><b data-ref="r-exp"></b><small>unchanged: light per mm² depends only on the f-number</small></div>
      <div class="lt-stat lt-stat-aov"><span>Angle of view</span><b data-ref="r-aov"></b><small>diagonal · <span data-ref="r-aov-hv"></span> (h × v)</small></div>
    </div>
    <div class="lt-light">
      <div class="lt-wedge-wrap" data-ref="wedge"></div>
      <p data-ref="r-light"></p>
    </div>
  </div>
</div>
<div class="lt-cols">
  <div class="lt-prose">
    <h4>Crop factor</h4>
    <p>The crop factor compares a sensor’s diagonal with the 43.3 mm diagonal of full frame (36 × 24 mm). Multiply a lens’ real focal length by it and you get the focal length that gives the <em>same angle of view</em> on full frame${example}.</p>
    <h4>Why phone sensors have fractions of an inch in their name</h4>
    <p>Phone sensors are named by “inch type” — 1/1.3", 1/2.5" — a legacy of video-camera tubes. A “1-inch” sensor has a diagonal of about 16 mm, not 25.4 mm, so a 1/1.3-inch sensor measures about 16 ÷ 1.3 ≈ 12.3 mm across. Makers round these names, so sizes derived from them are approximate (≈).</p>
    <h4>Equivalent aperture: depth of field and total light — not exposure</h4>
    <p><strong>f/1.8 is f/1.8 for exposure.</strong> The brightness of the image on the sensor — light per square millimetre — depends only on the f-number, so a phone at f/1.8 and a full-frame camera at f/1.8 need the same shutter speed and ISO for the same exposure. What differs is the <em>total</em> light: the smaller sensor has less area, so it gathers less light overall, which shows up as more noise. Multiplying the f-number by the crop factor gives the full-frame f-number with the same depth of field and the same total light for the same framing and shutter speed.</p>
    <p class="lt-note">Crop factors compare diagonals. Phone sensors are 4:3 while full frame is 3:2, so the exact area ratio differs slightly from crop².</p>
  </div>
  <aside class="lt-data">
    <h4>Formats in the data</h4>
    <div class="lt-table-wrap" data-ref="formats"></div>
    <p class="lt-note">Camera formats are the nominal image areas (APS-C as used by Fujifilm). Phone formats are computed from the published optical format (≈ 16/x mm diagonal, 4:3).</p>
  </aside>
</div>`;
      const fIn = el.querySelector<HTMLInputElement>('#le-focal')!;
      const nIn = el.querySelector<HTMLInputElement>('#le-n')!;
      fIn.addEventListener('input', () => {
        focal = FOCAL.toValue(Number(fIn.value));
        preset = null;
        schedule();
      });
      nIn.addEventListener('input', () => {
        N = APERTURE.toValue(Number(nIn.value));
        preset = null;
        schedule();
      });
      el.querySelector<HTMLSelectElement>('#le-format')!.addEventListener('change', (e) => {
        sel = (e.target as HTMLSelectElement).value;
        preset = null;
        render();
      });
      el.addEventListener('click', (e) => {
        const t = e.target as Element;
        const pick = t.closest<HTMLElement | SVGElement>('[data-pick], [data-fmt]');
        if (pick) {
          sel = (pick as HTMLElement).dataset.pick ?? (pick as SVGElement).dataset.fmt!;
          preset = null;
          render();
          return;
        }
        const pr = t.closest<HTMLElement>('[data-preset]');
        if (pr) applyPreset(pr.dataset.preset!);
      });
      const overlay = ref('overlay');
      width = Math.round(overlay.clientWidth);
      onWidth(overlay, (w) => {
        width = w;
        render();
      });
      const first = presets.find((p) => p.id === `main-${DEFAULT_MAIN}`) ?? presets[0];
      if (first) applyPreset(first.id);
      else render();
    },
    setActive() {
      /* static */
    },
  };
}
