import { esc, fNum, mm, onWidth, phoneName, reducedMotion, tag, type Topic, type TopicContext } from '../dom';
import { foldLayout, pointAt, polylineLength, RAY_START, type FoldLayout, type FoldMode, type LensElement, type Pt } from '../fold';
import { periscopeCameras, periscopeNumbers, TYPICAL_PHONE_THICKNESS, type CameraExample } from '../physics';
import { shortPhone } from './smallSensors';

const T = TYPICAL_PHONE_THICKNESS;
const DEFAULT_TELE = 'google-pixel-11-pro-pro-xl';
const MODES: { id: FoldMode; label: string; short: string }[] = [
  { id: 'straight', label: 'Straight', short: 'Straight' },
  { id: 'prism', label: 'Periscope · 1 fold', short: '1 fold' },
  { id: 'tetra', label: 'Tetraprism-style · 4 folds', short: '4 folds' },
];
/** Photon speed along the rays, mm per second. */
const SPEED = 14;
const PHOTONS = 5;

const f1 = (v: number) => v.toFixed(1);

interface View {
  s: number;
  ox: number;
  oy: number;
  W: number;
  H: number;
}

function viewport(layouts: FoldLayout[], W: number): View {
  let minX = -9;
  let maxX = 10;
  let maxY = T + 1.5;
  for (const L of layouts) {
    minX = Math.min(minX, L.module.minX - 3);
    maxX = Math.max(maxX, L.module.maxX + 3);
    maxY = Math.max(maxY, L.module.maxY + 2.4);
  }
  const minY = RAY_START - 0.8;
  const narrow = W < 560;
  const maxH = narrow ? 300 : 430;
  const s = Math.min(W / (maxX - minX), maxH / (maxY - minY));
  const H = (maxY - minY) * s;
  const ox = (W - (maxX - minX) * s) / 2 - minX * s;
  return { s, ox, oy: -minY * s, W, H };
}

function elementPath(e: LensElement, P: (p: Pt) => string): string {
  const ax = e.axis;
  const pp = { x: -ax.y, y: ax.x };
  const at = (u: number, v: number): Pt => ({ x: e.center.x + ax.x * u + pp.x * v, y: e.center.y + ax.y * u + pp.y * v });
  const h = e.width / 2;
  const t = e.thickness / 2;
  if (e.kind === 'pos') {
    const rim = t * 0.28;
    return `M${P(at(-rim, -h))} Q${P(at(-t * 2 + rim, 0))} ${P(at(-rim, h))} L${P(at(rim, h))} Q${P(at(t * 2 - rim, 0))} ${P(at(rim, -h))} Z`;
  }
  const mid = t * 0.35;
  return `M${P(at(-t, -h))} Q${P(at(-mid * 2 + t, 0))} ${P(at(-t, h))} L${P(at(t, h))} Q${P(at(mid * 2 - t, 0))} ${P(at(t, -h))} Z`;
}

function foldSvg(L: FoldLayout, v: View, ghost: FoldLayout): string {
  const X = (x: number) => v.ox + x * v.s;
  const Y = (y: number) => v.oy + y * v.s;
  const P = (p: Pt) => `${f1(X(p.x))} ${f1(Y(p.y))}`;
  const narrow = v.W < 560;
  const bodyL = -8.5;
  const bodyR = (v.W - v.ox) / v.s + 2;
  let s = `<svg class="lt-fold" viewBox="0 0 ${f1(v.W)} ${f1(v.H)}" width="${f1(v.W)}" height="${f1(v.H)}" role="img" aria-label="Side section of a phone with a ${L.mode === 'straight' ? 'straight' : 'folded'} telephoto lens">
<defs>
  <linearGradient id="lt-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2230"/><stop offset="1" stop-color="#0f141d"/></linearGradient>
  <linearGradient id="lt-fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0.82" stop-color="#05070a" stop-opacity="0"/><stop offset="1" stop-color="#05070a" stop-opacity="0.95"/></linearGradient>
  <radialGradient id="lt-photon"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#c8f6ff" stop-opacity="0.95"/><stop offset="1" stop-color="#5fe0ff" stop-opacity="0"/></radialGradient>
  <pattern id="lt-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(255,107,107,0.08)"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,120,120,0.45)" stroke-width="1.4"/></pattern>
</defs>`;
  // phone body: back glass on top (the camera looks up), screen at the bottom
  s += `<rect class="f-body" x="${f1(X(bodyL))}" y="${f1(Y(0))}" width="${f1((bodyR - bodyL) * v.s)}" height="${f1(T * v.s)}" rx="${f1(Math.min(2.2 * v.s, 18))}"/>`;
  s += `<rect class="f-back" x="${f1(X(bodyL + 0.8))}" y="${f1(Y(0))}" width="${f1((bodyR - bodyL) * v.s)}" height="${f1(0.35 * v.s)}"/>`;
  s += `<rect class="f-screen" x="${f1(X(bodyL + 0.8))}" y="${f1(Y(T - 0.55))}" width="${f1((bodyR - bodyL) * v.s)}" height="${f1(0.55 * v.s)}"/>`;
  // ghost of the unfolded lens (folded modes)
  if (L.mode !== 'straight') {
    const gy = ghost.sensor.center.y;
    const gw = Math.max(...ghost.elements.map((e) => e.width)) / 2 + 0.5;
    s += `<rect class="f-ghost" x="${f1(X(-gw))}" y="${f1(Y(0))}" width="${f1(2 * gw * v.s)}" height="${f1((gy + 0.6) * v.s)}" rx="4"/>`;
    s += `<text class="f-ghost-t" x="${f1(X(gw) + 8)}" y="${f1(Y(Math.max(T + 3, (T + gy) / 2 + 1)))}">unfolded: ${mm(L.pathLength)}</text>`;
  } else {
    // straight: the barrel and the part that sticks out of the phone
    const gw = Math.max(...L.elements.map((e) => e.width)) / 2 + 0.5;
    const gy = L.sensor.center.y + 0.6;
    s += `<rect class="f-barrel" x="${f1(X(-gw))}" y="${f1(Y(0.2))}" width="${f1(2 * gw * v.s)}" height="${f1((gy - 0.2) * v.s)}" rx="3"/>`;
    if (gy > T) s += `<rect x="${f1(X(-gw))}" y="${f1(Y(T))}" width="${f1(2 * gw * v.s)}" height="${f1((gy - T) * v.s)}" fill="url(#lt-hatch)" class="f-over"/>`;
  }
  // beam (group opacity so overlapping parts do not stack)
  s += `<g class="f-beam">`;
  const [e0, e1] = L.edges;
  for (let i = 0; i < e0.length - 1; i++) s += `<path d="M${P(e0[i])} L${P(e0[i + 1])} L${P(e1[i + 1])} L${P(e1[i])} Z"/>`;
  s += `</g>`;
  if (L.prism) s += `<path class="f-prism" d="M${L.prism.map(P).join(' L')} Z"/>`;
  for (const m of L.mirrors) s += `<line class="f-mirror" x1="${f1(X(m.a.x))}" y1="${f1(Y(m.a.y))}" x2="${f1(X(m.b.x))}" y2="${f1(Y(m.b.y))}"/>`;
  for (const e of L.elements) s += `<path class="f-lens ${e.kind}" d="${elementPath(e, P)}"/>`;
  s += `<path class="f-ray" d="M${L.chief.map(P).join(' L')}"/>`;
  for (const e of L.edges) s += `<path class="f-ray edge" d="M${e.map(P).join(' L')}"/>`;
  // sensor + its board
  const sc = L.sensor.center;
  const al = L.sensor.along;
  const half = L.sensor.size / 2;
  const back = { x: -al.y, y: al.x }; // normal pointing away from the lens side
  const dirIn = { x: L.chief[L.chief.length - 1].x - L.chief[L.chief.length - 2].x, y: L.chief[L.chief.length - 1].y - L.chief[L.chief.length - 2].y };
  const sign = back.x * dirIn.x + back.y * dirIn.y > 0 ? 1 : -1;
  const b0 = { x: sc.x - al.x * (half + 0.4), y: sc.y - al.y * (half + 0.4) };
  const b1 = { x: sc.x + al.x * (half + 0.4), y: sc.y + al.y * (half + 0.4) };
  const off = (p: Pt, k: number): Pt => ({ x: p.x + back.x * sign * k, y: p.y + back.y * sign * k });
  s += `<path class="f-board" d="M${P(off(b0, 0.12))} L${P(off(b1, 0.12))} L${P(off(b1, 0.6))} L${P(off(b0, 0.6))} Z"/>`;
  s += `<line class="f-sensor" x1="${f1(X(sc.x - al.x * half))}" y1="${f1(Y(sc.y - al.y * half))}" x2="${f1(X(sc.x + al.x * half))}" y2="${f1(Y(sc.y + al.y * half))}"/>`;
  s += `<g class="f-photons"></g>`;

  // annotations
  const dimX = X(bodyL) - (narrow ? 6 : 10);
  s += `<g class="f-dim"><line x1="${f1(dimX)}" y1="${f1(Y(0))}" x2="${f1(dimX)}" y2="${f1(Y(T))}"/><line x1="${f1(dimX - 3)}" y1="${f1(Y(0))}" x2="${f1(dimX + 3)}" y2="${f1(Y(0))}"/><line x1="${f1(dimX - 3)}" y1="${f1(Y(T))}" x2="${f1(dimX + 3)}" y2="${f1(Y(T))}"/></g>`;
  s += `<text class="f-t dim" x="${f1(dimX + 6)}" y="${f1(Y(T) + 15)}">phone ≈ ${T} mm</text>`;
  const pill = (x: number, y: number, text: string, cls = '') => {
    const w = text.length * 6.3 + 14;
    x = Math.min(Math.max(x, w / 2 + 2), v.W - w / 2 - 2); // keep the pill inside the figure
    return `<g class="f-pill ${cls}"><rect x="${f1(x - w / 2)}" y="${f1(y - 10)}" width="${f1(w)}" height="19" rx="9.5"/><text x="${f1(x)}" y="${f1(y + 3.8)}" text-anchor="middle">${esc(text)}</text></g>`;
  };
  if (L.mode === 'straight') {
    const sx = X(Math.max(...L.elements.map((e) => e.width)) / 2 + 0.5) + 10;
    s += `<line class="f-dimline" x1="${f1(sx)}" y1="${f1(Y(L.lensCenter.y))}" x2="${f1(sx)}" y2="${f1(Y(sc.y))}"/>`;
    s += `<text class="f-t" x="${f1(sx + 8)}" y="${f1(Y((L.lensCenter.y + sc.y) / 2))}">lens → sensor ≈ ${mm(L.pathLength)}</text>`;
    if (sc.y > T) s += `<text class="f-t warn" x="${f1(sx + 8)}" y="${f1(Y((L.lensCenter.y + sc.y) / 2) + 17)}">sticks out ≈ ${mm(sc.y + 0.6 - T)}</text>`;
    s += pill(X(sc.x), Y(sc.y) + 22, 'sensor');
  } else if (L.mode === 'prism') {
    const y = Y(T) + 16;
    s += `<line class="f-dimline" x1="${f1(X(L.lensCenter.x))}" y1="${f1(y)}" x2="${f1(X(sc.x))}" y2="${f1(y)}"/>`;
    s += `<text class="f-t" x="${f1(X((L.lensCenter.x + sc.x) / 2))}" y="${f1(y + 16)}" text-anchor="middle">lens → sensor ≈ ${mm(L.pathLength)}${narrow ? '' : ', along the phone'}</text>`;
    s += pill(X(0), Y(RAY_START) + 2, '45° prism');
    s += pill(X(sc.x), Y(0) - 14, 'sensor');
    s += pill(X(L.lensCenter.x + 1), Y(0) - 14, 'lens');
  } else {
    s += pill(X(0), Y(RAY_START) + 2, 'lens');
    s += pill(X(sc.x), Y(T) + 18, 'sensor, lying flat');
    const px = L.prism ? Math.max(...L.prism.map((p) => p.x)) : sc.x;
    s += `<text class="f-t" x="${f1(X(px) + 10)}" y="${f1(Y(T / 2))}">4 reflections</text>`;
    s += `<text class="f-t sub" x="${f1(X(px) + 10)}" y="${f1(Y(T / 2) + 15)}">path ≈ ${mm(L.pathLength)}</text>`;
  }
  // soft fade where the phone continues off the right edge
  s += `<rect x="0" y="0" width="${f1(v.W)}" height="${f1(v.H)}" fill="url(#lt-fade)" pointer-events="none"/>`;
  s += '</svg>';
  return s;
}

export function createPeriscopeTopic(): Topic {
  let root: HTMLElement;
  let cams: CameraExample[] = [];
  let cam: CameraExample;
  let mode: FoldMode = 'prism';
  let width = 0;
  let active = false;
  let visible = true;
  let raf = 0;
  let t0 = 0;
  let layout: FoldLayout | null = null;
  let view: View | null = null;
  let photons: SVGCircleElement[] = [];
  const ref = (n: string) => root.querySelector<HTMLElement>(`[data-ref="${n}"]`)!;

  const numbers = (): string => {
    const n = periscopeNumbers(cam);
    const eqFrom =
      cam.eqFocalFrom === 'published'
        ? tag('pub')
        : `${tag('calc')}<small>${cam.opticalZoom}× optical zoom (published) × the main camera’s published equivalent focal length</small>`;
    const sensor = cam.sensorIsExample
      ? `<span class="lt-missing">not published</span> — example ${esc(cam.formatUsed)} ${tag('ex')}<small>≈ ${cam.sensor.width.toFixed(2)} × ${cam.sensor.height.toFixed(2)} mm, used only to illustrate</small>`
      : `${esc(cam.formatUsed)} ${tag('pub')}<small>≈ ${cam.sensor.width.toFixed(2)} × ${cam.sensor.height.toFixed(2)} mm ${tag('calc')}</small>`;
    return `<h4>The numbers</h4>
<div class="lt-data-name">${esc(phoneName(cam.brand, cam.phone))}</div>
<div class="lt-data-sub">${esc(cam.camera)}${cam.prism ? ` · ${esc(cam.prism)} ${tag('pub')}` : ''}</div>
<dl class="lt-dl">
  <dt>Equivalent focal length</dt><dd>${Math.round(cam.eqFocal)} mm ${eqFrom}</dd>
  <dt>Sensor</dt><dd>${sensor}</dd>
  <dt>Crop factor</dt><dd>×${cam.crop.toFixed(2)} ${tag(cam.sensorIsExample ? 'ex' : 'calc')}</dd>
  <dt>Real focal length</dt><dd><strong>${mm(cam.realFocal)}</strong> ${tag(cam.sensorIsExample ? 'ex' : 'calc')}<small>${Math.round(cam.eqFocal)} ÷ ${cam.crop.toFixed(2)}</small></dd>
  <dt>Aperture</dt><dd>${fNum(cam.aperture)} ${tag('pub')}</dd>
  <dt>Beam width (f/N)</dt><dd>${mm(n.pupil)} ${tag(cam.sensorIsExample ? 'ex' : 'calc')}</dd>
  <dt>Lens → sensor</dt><dd>≈ ${mm(n.track)} ${tag('approx')}<small>≈ the focal length, a rough rule for a simple telephoto</small></dd>
  <dt>Phone thickness</dt><dd>≈ ${T} mm ${tag('ex', 'typical')}<small>not from the data; camera bump not counted</small></dd>
</dl>
${cam.notes ? `<details class="lt-details"><summary>Notes on this data</summary><p>${esc(cam.notes)}</p></details>` : ''}`;
  };

  const prose = (): string => {
    const n = periscopeNumbers(cam);
    const name = shortPhone(cam.phone);
    const sensorWords = cam.sensorIsExample
      ? `Its sensor size is not published, so the drawing uses an example ${esc(cam.formatUsed)} sensor (crop ×${cam.crop.toFixed(2)}): with it, the real focal length would be about ${mm(cam.realFocal)}.`
      : `On its ${esc(cam.formatUsed)} sensor (crop ×${cam.crop.toFixed(2)}) that is a real focal length of about <strong>${mm(cam.realFocal)}</strong>.`;
    return `<h4>Why a long lens does not fit</h4>
<p>The ${esc(name)}’s telephoto is listed as ${Math.round(cam.eqFocal)} mm equivalent${cam.eqFocalFrom === 'zoom' ? ` (computed from its ${cam.opticalZoom}× zoom and the main camera’s equivalent focal length)` : ''}. ${sensorWords} A simple telephoto lens needs roughly its focal length between the front of the lens and the sensor — here about ${mm(n.track)} — but a phone is only about ${T} mm thick. Pointed straight out of the back, the lens would stick out by roughly ${mm(n.overhang)}.</p>
<h4>Fold it with a prism</h4>
<p>A periscope camera turns the light by 90° with a prism set at 45° just under the window, so the long part of the lens lies along the length of the phone instead of across its thickness. Length is not the problem any more — thickness still is: the lens and the prism must pass a beam about f/N = ${mm(n.pupil)} wide, and the sensor stands on its edge. That is one reason periscope telephotos have smaller apertures and smaller sensors than main cameras.</p>
<h4>Fold it four times</h4>
<p>Folding more than once packs the same path into a smaller block. The “4 folds” mode sketches a path with four internal reflections — the idea behind the design Apple calls a “tetraprism”. Here the lens sits under the window and the sensor lies flat, like a main camera’s. The drawing is a schematic: the makers do not publish the exact geometry.</p>
<h4>Other folded designs</h4>
<p>Reviews report that Samsung’s 5× module in the Galaxy S26 Ultra uses an “All Lenses on Prism” (ALoP) layout, with the lens elements stacked on top of the prism instead of between prism and sensor, and a longer closest-focus distance as the trade-off. Beyond their optical zoom, phones crop the sensor and merge frames: the makers advertise “optical-quality” 8× (iPhone 18 Pro) and 10× (Pixel 11 Pro) from their 48 MP telephoto sensors — see <a href="#learn/computational">Computational photography</a>.</p>`;
  };

  // ------------------------------------------------------------------ animation
  const placePhotons = (time: number) => {
    if (!layout || !view || !photons.length) return;
    const rays = [layout.chief, ...layout.edges];
    let i = 0;
    for (const ray of rays) {
      const Lr = polylineLength(ray);
      for (let j = 0; j < PHOTONS; j++, i++) {
        const sArc = (((time * SPEED) / 1000 + (j / PHOTONS) * Lr) % Lr + Lr) % Lr;
        const p = pointAt(ray, sArc);
        const c = photons[i];
        c.setAttribute('cx', f1(view.ox + p.x * view.s));
        c.setAttribute('cy', f1(view.oy + p.y * view.s));
        c.setAttribute('opacity', Math.max(0, Math.min(1, sArc / 2.5, (Lr - sArc) / 1.2)).toFixed(2));
      }
    }
  };
  const tick = (now: number) => {
    raf = 0;
    if (!active || !visible) return;
    placePhotons(now - t0);
    raf = requestAnimationFrame(tick);
  };
  const run = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!active || !visible || reducedMotion()) {
      placePhotons(1600); // a still frame with the light on its way
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const render = () => {
    const n = periscopeNumbers(cam);
    const input = { track: n.track, pupil: n.pupil, thickness: T, sensorSize: 0 };
    const sizeFor = (m: FoldMode) => (m === 'prism' ? cam.sensor.height : cam.sensor.width);
    const all = MODES.map((m) => foldLayout(m.id, { ...input, sensorSize: sizeFor(m.id) }));
    layout = all[MODES.findIndex((m) => m.id === mode)];
    if (width > 0) {
      view = viewport(all, width);
      ref('fold').innerHTML = foldSvg(layout, view, all[0]);
      const g = ref('fold').querySelector('.f-photons')!;
      photons = [];
      for (let i = 0; i < PHOTONS * 3; i++) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('r', i < PHOTONS ? '6' : '4');
        c.setAttribute('fill', 'url(#lt-photon)');
        c.setAttribute('class', i < PHOTONS ? 'chief' : 'edge');
        g.appendChild(c);
        photons.push(c);
      }
      // position them now: a fresh circle sits at the SVG origin until the first animation frame
      placePhotons(performance.now() - t0);
    }
    const m = layout.module;
    const status = ref('status');
    if (mode === 'straight') {
      status.className = 'lt-status bad';
      status.innerHTML = `<b>✕ Does not fit</b> the lens needs ≈ ${mm(n.track)} but the phone is ≈ ${T} mm thick — it would stick out ≈ ${mm(n.overhang)}`;
    } else {
      status.className = 'lt-status good';
      status.innerHTML = `<b>✓ Fits</b> ${mode === 'prism' ? 'one 45° fold lays the lens along the phone' : 'four reflections fold the path into a small block'}: optics ≈ ${mm(m.maxX - m.minX)} long × ${mm(m.maxY - Math.max(0, m.minY))} tall`;
    }
    root.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    ref('caption').innerHTML = `Side section, to scale (${esc(shortPhone(cam.phone))}${cam.sensorIsExample ? ', example sensor' : ''}). The beam is the full f/N = ${mm(n.pupil)} bundle; the lens is drawn as an ideal thin lens with schematic elements.${mode === 'tetra' ? ' Four-fold path: schematic, not a published design.' : ''}`;
    run();
  };

  const setCamera = (id: string) => {
    cam = cams.find((c) => c.phoneId === id) ?? cams[0];
    if (cam.prism?.toLowerCase().includes('tetraprism')) mode = 'tetra';
    root.querySelectorAll<HTMLElement>('[data-tele]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tele === cam.phoneId)));
    ref('numbers').innerHTML = numbers();
    ref('prose').innerHTML = prose();
    render();
  };

  return {
    id: 'periscope',
    title: 'Periscope zoom: folding a long lens',
    short: 'Periscope zoom',
    blurb: 'Why a 100 mm-equivalent lens needs a prism',
    mount(el: HTMLElement, ctx: TopicContext) {
      root = el;
      cams = periscopeCameras(ctx.phones);
      if (!cams.length) {
        el.innerHTML = `<p class="lt-empty">No folded telephoto camera in the phone data yet.</p>`;
        return;
      }
      const chips = cams
        .map(
          (c) =>
            `<button class="lt-chip" data-tele="${c.phoneId}" aria-pressed="false"><strong>${esc(shortPhone(c.phone))}</strong><small>${Math.round(c.eqFocal)} mm eq. · ${fNum(c.aperture)}</small></button>`,
        )
        .join('');
      el.innerHTML = `
<header class="lt-head">
  <div class="eyebrow">Explainer 03 · Telephoto</div>
  <h3>Periscope zoom: folding a long lens</h3>
  <p class="lt-lead">A 100 mm-equivalent telephoto needs a lens far longer than a phone is thick. The trick is to turn the light sideways and let the lens lie along the phone.</p>
</header>
<div class="lt-card">
  <div class="lt-ctrl-bar">
    <div class="lt-field"><span class="lt-label">Telephoto camera</span><div class="lt-chips" role="group" aria-label="Telephoto camera">${chips}</div></div>
    <div class="lt-field"><span class="lt-label">Layout</span><div class="seg lt-seg" role="group" aria-label="Lens layout">${MODES.map(
      (m) => `<button data-mode="${m.id}" aria-pressed="false"><span class="long">${m.label}</span><span class="short">${m.short}</span></button>`,
    ).join('')}</div></div>
  </div>
  <p class="lt-status" data-ref="status" aria-live="polite"></p>
  <figure class="lt-fig lt-fold-fig" data-ref="fold"></figure>
  <p class="lt-note" data-ref="caption"></p>
</div>
<div class="lt-cols">
  <div class="lt-prose" data-ref="prose"></div>
  <aside class="lt-data" data-ref="numbers"></aside>
</div>`;
      el.querySelectorAll<HTMLElement>('[data-tele]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.tele!)));
      el.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) =>
        b.addEventListener('click', () => {
          mode = b.dataset.mode as FoldMode;
          render();
        }),
      );
      const fig = ref('fold');
      width = Math.round(fig.clientWidth);
      onWidth(fig, (w) => {
        width = w;
        render();
      });
      new IntersectionObserver((entries) => {
        visible = entries[entries.length - 1].isIntersecting;
        run();
      }).observe(fig);
      t0 = performance.now();
      setCamera(cams.some((c) => c.phoneId === DEFAULT_TELE) ? DEFAULT_TELE : cams[0].phoneId);
    },
    setActive(on: boolean) {
      active = on;
      if (root && layout) run();
    },
  };
}
