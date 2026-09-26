import type { PhoneData } from '../../data/types';
import { sensorFromCrop } from '../../optics/formats';
import { blurPixels, discBlur, mix, over } from '../blur';
import { esc, fNum, logScale, mm, onWidth, pct, phoneName, rafThrottle, sliderMarkup, syncFill, tag, type Topic, type TopicContext } from '../dom';
import { FrameStack, mulberry32, theoreticalSnr } from '../noise';
import { depthOfField, mainCameras, type CameraExample } from '../physics';
import { DEFAULT_MAIN, SERIES, shortPhone } from './smallSensors';

// ------------------------------------------------------------------ colour helpers
const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const ENC = new Uint8ClampedArray(4096);
for (let i = 0; i < 4096; i++) {
  const l = i / 4095;
  ENC[i] = Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
}
const encode = (l: number) => ENC[Math.max(0, Math.min(4095, Math.round(l * 4095)))];

/** Canvas → premultiplied linear RGBA floats. */
function readLayer(c: HTMLCanvasElement): Float32Array {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    out[i] = LUT[d[i]] * a;
    out[i + 1] = LUT[d[i + 1]] * a;
    out[i + 2] = LUT[d[i + 2]] * a;
    out[i + 3] = a;
  }
  return out;
}

/** Premultiplied linear RGBA → canvas (opaque). */
function writeImage(c: HTMLCanvasElement, img: Float32Array): void {
  const g = c.getContext('2d')!;
  const id = g.createImageData(c.width, c.height);
  const d = id.data;
  for (let i = 0; i < img.length; i += 4) {
    d[i] = encode(img[i]);
    d[i + 1] = encode(img[i + 1]);
    d[i + 2] = encode(img[i + 2]);
    d[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
}

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

// ------------------------------------------------------------------ (a) multi-frame noise
const NW = 192;
const NH = 120;
/** Photons a pure-white sample collects in one exposure (a dim scene: every frame is noisy). */
const PHOTONS_WHITE = 80;
/** The flat grey card where the SNR is measured (pixel rectangle). */
const CARD = { x: 132, y: 58, w: 40, h: 34 };
/** Linear value of the card: λ = 0.2 × 80 = 16 photons → SNR₁ = 4, SNR₁₆ = 16. */
const CARD_LINEAR = 0.2;

function paintNightScene(): HTMLCanvasElement {
  const c = canvas(NW, NH);
  const g = c.getContext('2d')!;
  const rng = mulberry32(11);
  const sky = g.createLinearGradient(0, 0, 0, NH);
  sky.addColorStop(0, '#0a1430');
  sky.addColorStop(0.62, '#2b3a6a');
  sky.addColorStop(1, '#6a5a7a');
  g.fillStyle = sky;
  g.fillRect(0, 0, NW, NH);
  g.fillStyle = '#f4ecd2';
  g.beginPath();
  g.arc(34, 22, 9, 0, Math.PI * 2);
  g.fill();
  // buildings with lit windows
  let x = -4;
  while (x < NW) {
    const bw = 16 + rng() * 22;
    const bh = 34 + rng() * 46;
    g.fillStyle = rng() > 0.5 ? '#1a2238' : '#222a42';
    g.fillRect(x, NH - bh, bw, bh);
    for (let wy = NH - bh + 5; wy < NH - 8; wy += 7) {
      for (let wx = x + 3; wx < x + bw - 4; wx += 6) {
        if (rng() < 0.42) {
          g.fillStyle = rng() > 0.3 ? '#ffd28a' : '#9fd6ff';
          g.fillRect(wx, wy, 3, 4);
        }
      }
    }
    x += bw + 2;
  }
  // grey card on a wall (exact value so λ is known)
  const v = Math.round(255 * (1.055 * Math.pow(CARD_LINEAR, 1 / 2.4) - 0.055));
  g.fillStyle = '#10141e';
  g.fillRect(CARD.x - 4, CARD.y - 4, CARD.w + 8, CARD.h + 8);
  g.fillStyle = `rgb(${v},${v},${v})`;
  g.fillRect(CARD.x, CARD.y, CARD.w, CARD.h);
  return c;
}

function snrChart(W: number, lambda: number, measured: number[], n: number): string {
  const H = 188;
  const L = 34;
  const R = W - 14;
  const top = 26;
  const B = H - 30;
  const ymax = Math.ceil((theoreticalSnr(lambda, 16) * 1.12) / 4) * 4;
  const X = (k: number) => L + ((k - 1) / 15) * (R - L);
  const Y = (v: number) => B - (v / ymax) * (B - top);
  const f1 = (v: number) => v.toFixed(1);
  let s = `<svg class="lt-snr" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Signal-to-noise ratio against the number of merged frames">`;
  for (let v = 0; v <= ymax; v += 4) {
    s += `<line class="c-grid" x1="${L}" x2="${R}" y1="${f1(Y(v))}" y2="${f1(Y(v))}"/><text class="c-t" x="${L - 6}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${v}</text>`;
  }
  for (const k of [1, 4, 8, 12, 16]) s += `<text class="c-t" x="${f1(X(k))}" y="${B + 15}" text-anchor="middle">${k}</text>`;
  s += `<text class="c-cap" x="${R}" y="${H - 2}" text-anchor="end">frames merged, N</text>`;
  s += `<text class="c-cap" x="${L - 26}" y="${top - 13}">SNR</text>`;
  let d = '';
  for (let k = 1; k <= 16; k += 0.25) d += `${k === 1 ? 'M' : 'L'}${f1(X(k))} ${f1(Y(theoreticalSnr(lambda, k)))}`;
  s += `<path class="c-theory" d="${d}"/>`;
  measured.forEach((v, i) => {
    const on = i + 1 === n;
    s += `<circle class="c-dot${on ? ' on' : ''}" cx="${f1(X(i + 1))}" cy="${f1(Y(v))}" r="${on ? 6 : 4}" fill="${SERIES.phone}"/>`;
  });
  const vx = X(n);
  const vy = Y(measured[n - 1]);
  const label = `N = ${n}: ${measured[n - 1].toFixed(1)}`;
  const lw = label.length * 6.6 + 14;
  const lx = Math.min(Math.max(vx - lw / 2, L), R - lw);
  const ly = vy - 30 < top ? vy + 12 : vy - 30;
  s += `<g class="c-lab"><rect x="${f1(lx)}" y="${f1(ly)}" width="${f1(lw)}" height="19" rx="9.5"/><text x="${f1(lx + lw / 2)}" y="${f1(ly + 13.5)}" text-anchor="middle">${label}</text></g>`;
  s += '</svg>';
  return s;
}

// ------------------------------------------------------------------ (b) portrait mode
const PW = 400;
const PH = 300;
/** Illustrative scene distances (mm from the focal plane). */
const SUBJECT_D = 1200;
const HEDGE_D = 3000;
const CITY_D = 30000;
/** Portrait framing: a 2× crop of the main camera. */
const PORTRAIT_CROP = 2;
const invDepth = (d: number) => (1 / d - 1 / CITY_D) / (1 / SUBJECT_D - 1 / CITY_D);

interface PortraitLayers {
  bg: Float32Array;
  hedge: Float32Array;
  subject: Float32Array;
  lensMask: Float32Array;
}

function paintPortrait(): PortraitLayers {
  const rng = mulberry32(5);
  // --- background: dusk city far away
  const bg = canvas(PW, PH);
  let g = bg.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, PH);
  sky.addColorStop(0, '#0d1a36');
  sky.addColorStop(0.5, '#34406e');
  sky.addColorStop(0.72, '#b27a78');
  sky.addColorStop(0.8, '#e6a172');
  g.fillStyle = sky;
  g.fillRect(0, 0, PW, PH);
  let x = -6;
  while (x < PW) {
    const bw = 14 + rng() * 30;
    const bh = 40 + rng() * 90;
    g.fillStyle = rng() > 0.5 ? '#161d33' : '#1d2440';
    g.fillRect(x, 238 - bh, bw, bh + 70);
    for (let wy = 242 - bh; wy < 232; wy += 8) {
      for (let wx = x + 3; wx < x + bw - 3; wx += 6) {
        if (rng() < 0.35) {
          g.fillStyle = rng() > 0.25 ? '#ffcf86' : '#a8dcff';
          g.fillRect(wx, wy, 2, 3);
        }
      }
    }
    x += bw + 1;
  }
  g.fillStyle = '#0e131f';
  g.fillRect(0, 236, PW, PH - 236);
  for (let i = 0; i < 16; i++) {
    const lx = 8 + i * 26 + rng() * 10;
    const ly = 226 + rng() * 22;
    const glow = g.createRadialGradient(lx, ly, 0, lx, ly, 7);
    glow.addColorStop(0, '#fff4da');
    glow.addColorStop(0.3, 'rgba(255,214,150,0.8)');
    glow.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = glow;
    g.fillRect(lx - 7, ly - 7, 14, 14);
  }
  // string lights across the top
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const lx = t * PW;
    const ly = 36 + Math.sin(t * Math.PI) * 26;
    g.fillStyle = i % 3 === 0 ? '#ffd38c' : '#fff0cf';
    g.beginPath();
    g.arc(lx, ly, 2.2, 0, Math.PI * 2);
    g.fill();
  }
  // --- hedge at 3 m (bottom corners)
  const hedge = canvas(PW, PH);
  g = hedge.getContext('2d')!;
  for (let i = 0; i < 90; i++) {
    const left = i % 2 === 0;
    const hx = left ? rng() * 120 : PW - rng() * 120;
    const hy = PH - rng() * 70;
    const r = 10 + rng() * 16;
    g.fillStyle = rng() > 0.5 ? '#1b3526' : '#224030';
    g.beginPath();
    g.arc(hx, hy, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 60; i++) {
    const left = i % 2 === 0;
    const hx = left ? rng() * 110 : PW - rng() * 110;
    const hy = PH - 10 - rng() * 60;
    g.fillStyle = 'rgba(120,170,110,0.55)';
    g.beginPath();
    g.ellipse(hx, hy, 2.4, 1.3, rng() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // --- subject at 1.2 m: head and shoulders with flyaway hair and glasses
  const subj = canvas(PW, PH);
  g = subj.getContext('2d')!;
  const cx = 186;
  const jacket = g.createLinearGradient(0, 200, 0, PH);
  jacket.addColorStop(0, '#34466a');
  jacket.addColorStop(1, '#1e2940');
  g.fillStyle = jacket;
  g.beginPath();
  g.moveTo(cx - 150, PH);
  g.bezierCurveTo(cx - 140, 250, cx - 110, 222, cx - 44, 214);
  g.lineTo(cx + 44, 214);
  g.bezierCurveTo(cx + 110, 222, cx + 140, 250, cx + 150, PH);
  g.closePath();
  g.fill();
  const skin = g.createLinearGradient(cx - 50, 0, cx + 50, 0);
  skin.addColorStop(0, '#b77f63');
  skin.addColorStop(0.5, '#d9a585');
  skin.addColorStop(1, '#b27a5f');
  g.fillStyle = skin;
  g.beginPath();
  g.moveTo(cx - 22, 176);
  g.lineTo(cx - 24, 218);
  g.quadraticCurveTo(cx, 232, cx + 24, 218);
  g.lineTo(cx + 22, 176);
  g.closePath();
  g.fill();
  g.fillStyle = '#e8ecf3';
  g.beginPath();
  g.moveTo(cx - 30, 212);
  g.lineTo(cx, 238);
  g.lineTo(cx + 30, 212);
  g.lineTo(cx + 18, 208);
  g.lineTo(cx, 226);
  g.lineTo(cx - 18, 208);
  g.closePath();
  g.fill();
  // ears + face
  g.fillStyle = '#c48b6e';
  g.beginPath();
  g.ellipse(cx - 45, 132, 7, 12, 0, 0, Math.PI * 2);
  g.ellipse(cx + 45, 132, 7, 12, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = skin;
  g.beginPath();
  g.ellipse(cx, 128, 44, 56, 0, 0, Math.PI * 2);
  g.fill();
  // hair: cap + flyaway strands
  g.fillStyle = '#2b1d17';
  g.beginPath();
  g.ellipse(cx, 100, 50, 38, 0, Math.PI, Math.PI * 2);
  g.ellipse(cx - 34, 112, 16, 30, 0.25, 0, Math.PI * 2);
  g.ellipse(cx + 34, 112, 16, 30, -0.25, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(cx, 84, 48, 22, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(58,40,31,0.95)';
  g.lineCap = 'round';
  for (let i = 0; i < 110; i++) {
    const a = Math.PI * (1.02 + rng() * 0.96);
    const r0 = 44 + rng() * 6;
    const x0 = cx + Math.cos(a) * r0 * 1.08;
    const y0 = 96 + Math.sin(a) * r0 * 0.9;
    const len = 6 + rng() * 18;
    const bend = (rng() - 0.5) * 10;
    g.lineWidth = 0.6 + rng() * 0.7;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(x0 + Math.cos(a) * len * 0.5 + bend, y0 + Math.sin(a) * len * 0.5 - bend * 0.3, x0 + Math.cos(a + bend * 0.02) * len, y0 + Math.sin(a + bend * 0.02) * len);
    g.stroke();
  }
  // brows, eyes, nose, mouth
  g.strokeStyle = '#3a2820';
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(cx - 30, 110);
  g.quadraticCurveTo(cx - 20, 105, cx - 9, 109);
  g.moveTo(cx + 9, 109);
  g.quadraticCurveTo(cx + 20, 105, cx + 30, 110);
  g.stroke();
  g.fillStyle = '#2a211d';
  g.beginPath();
  g.ellipse(cx - 19, 124, 4.2, 3.2, 0, 0, Math.PI * 2);
  g.ellipse(cx + 19, 124, 4.2, 3.2, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(120,70,50,0.6)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(cx - 2, 130);
  g.quadraticCurveTo(cx - 6, 146, cx + 1, 150);
  g.stroke();
  g.strokeStyle = '#8f4f45';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - 12, 163);
  g.quadraticCurveTo(cx, 170, cx + 12, 163);
  g.stroke();
  // glasses
  const lens = (lx: number) => {
    g.beginPath();
    g.roundRect(lx - 15, 113, 30, 22, 7);
  };
  g.fillStyle = 'rgba(190,225,255,0.16)';
  lens(cx - 19);
  g.fill();
  lens(cx + 19);
  g.fill();
  g.strokeStyle = '#141414';
  g.lineWidth = 2.6;
  lens(cx - 19);
  g.stroke();
  lens(cx + 19);
  g.stroke();
  g.beginPath();
  g.moveTo(cx - 4, 121);
  g.quadraticCurveTo(cx, 117, cx + 4, 121);
  g.moveTo(cx - 34, 120);
  g.lineTo(cx - 44, 124);
  g.moveTo(cx + 34, 120);
  g.lineTo(cx + 44, 124);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(cx - 28, 131);
  g.lineTo(cx - 20, 116);
  g.moveTo(cx + 10, 131);
  g.lineTo(cx + 18, 116);
  g.stroke();
  // mask of the glass in the lenses (what a depth estimator can see through)
  const lm = canvas(PW, PH);
  const m = lm.getContext('2d')!;
  m.fillStyle = '#fff';
  m.beginPath();
  m.roundRect(cx - 32, 115, 26, 18, 6);
  m.roundRect(cx + 6, 115, 26, 18, 6);
  m.fill();
  const lmD = m.getImageData(0, 0, PW, PH).data;
  const lensMask = new Float32Array(PW * PH);
  for (let i = 0; i < lensMask.length; i++) lensMask[i] = lmD[i * 4 + 3] / 255;
  return { bg: readLayer(bg), hedge: readLayer(hedge), subject: readLayer(subj), lensMask };
}

/** Ideal depth map (nearness 0…1) from the layers' alpha. */
function idealDepth(L: PortraitLayers): Float32Array {
  const vH = invDepth(HEDGE_D);
  const out = new Float32Array(PW * PH);
  for (let p = 0; p < out.length; p++) {
    const as = L.subject[p * 4 + 3];
    const ah = L.hedge[p * 4 + 3];
    out[p] = as + (1 - as) * ah * vH;
  }
  return out;
}

/** What a phone might estimate: low resolution, rounded edges, glass seen as "far". */
function estimatedDepth(ideal: Float32Array, lensMask: Float32Array): Float32Array {
  const B = 10;
  const bw = Math.ceil(PW / B);
  const bh = Math.ceil(PH / B);
  const low = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let s = 0;
      let n = 0;
      for (let y = by * B; y < Math.min(PH, (by + 1) * B); y++)
        for (let x = bx * B; x < Math.min(PW, (bx + 1) * B); x++) {
          s += ideal[y * PW + x];
          n++;
        }
      low[by * bw + bx] = s / n;
    }
  const out = new Float32Array(PW * PH);
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      const fx = Math.min(bw - 1.001, Math.max(0, (x + 0.5) / B - 0.5));
      const fy = Math.min(bh - 1.001, Math.max(0, (y + 0.5) / B - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const v =
        low[y0 * bw + x0] * (1 - tx) * (1 - ty) + low[y0 * bw + x0 + 1] * tx * (1 - ty) + low[(y0 + 1) * bw + x0] * (1 - tx) * ty + low[(y0 + 1) * bw + x0 + 1] * tx * ty;
      // a soft threshold: the estimate snaps towards "subject" or "not subject"
      const sharp = v > 0.5 ? 0.5 + Math.min(0.5, (v - 0.5) * 1.8) : v * 0.9;
      out[y * PW + x] = sharp * (1 - 0.85 * lensMask[y * PW + x]);
    }
  return out;
}

function depthImage(depth: Float32Array): Float32Array {
  const out = new Float32Array(depth.length * 4);
  for (let p = 0; p < depth.length; p++) {
    const v = depth[p];
    // single-hue ramp: far = deep navy, near = pale cyan
    out[p * 4] = 0.004 + 0.72 * v * v;
    out[p * 4 + 1] = 0.01 + 0.86 * v * v;
    out[p * 4 + 2] = 0.03 + 0.92 * v;
    out[p * 4 + 3] = 1;
  }
  return out;
}

// ------------------------------------------------------------------ makers' features
const TECHNIQUES: { label: string; re: RegExp }[] = [
  { label: 'Multi-frame', re: /frames?\b|stack|burst|merg|several|multiple exposures|multi-frame/i },
  { label: 'Noise reduction', re: /noise/i },
  { label: 'HDR', re: /\bhdr\b|exposures of the same scene/i },
  { label: 'Portrait mode', re: /portrait mode|background blur/i },
  { label: 'Zoom', re: /zoom|super[- ]?res/i },
  { label: 'Generative AI', re: /generative/i },
];

function featuresHtml(phones: PhoneData[]): string {
  const withFeatures = phones.filter((p) => p.computational.length);
  if (!withFeatures.length) return `<p class="lt-note">No named features in the phone data yet.</p>`;
  return withFeatures
    .map(
      (p) => `<section class="lt-maker">
  <h5>${esc(phoneName(p.brand, p.name))}<small>as advertised by ${esc(p.brand)}</small></h5>
  <ul>${p.computational
    .map((f) => {
      const tags = TECHNIQUES.filter((t) => t.re.test(`${f.name} ${f.description}`)).map((t) => `<span class="lt-kw">${t.label}</span>`);
      return `<li><strong>${esc(f.name)}</strong>${tags.join('')}<p>${esc(f.description)}</p></li>`;
    })
    .join('')}</ul>
</section>`,
    )
    .join('');
}

// ------------------------------------------------------------------ static diagrams
const HDR_SVG = `<svg class="lt-mini" viewBox="0 0 360 150" role="img" aria-label="Exposure bracketing covers a wider brightness range than one exposure">
  <defs><linearGradient id="lt-scene" x1="0" x2="1"><stop offset="0" stop-color="#0b0f18"/><stop offset="1" stop-color="#fff2d6"/></linearGradient></defs>
  <text class="m-t" x="0" y="12">scene brightness</text><text class="m-t" x="360" y="12" text-anchor="end">shadows → sky</text>
  <rect x="0" y="18" width="360" height="12" rx="6" fill="url(#lt-scene)"/>
  <rect class="m-b" x="12" y="44" width="176" height="10" rx="5"/><text class="m-l" x="194" y="53">long exposure: clean shadows</text>
  <rect class="m-b" x="96" y="62" width="176" height="10" rx="5"/><text class="m-l" x="0" y="71">normal</text>
  <rect class="m-b" x="176" y="80" width="176" height="10" rx="5"/><text class="m-l" x="0" y="89">short: keeps the sky</text>
  <rect class="m-m" x="12" y="104" width="340" height="10" rx="5"/><text class="m-l" x="12" y="128">merged → tone-mapped into what a screen can show</text>
  <rect class="m-s" x="116" y="136" width="132" height="8" rx="4"/>
</svg>`;

function superResSvg(): string {
  const cell = 34;
  const ox = 8;
  const oy = 8;
  const cols = 5;
  const rows = 3;
  let s = `<svg class="lt-mini" viewBox="0 0 360 132" role="img" aria-label="Sub-pixel shifted frames sample between the pixel centres">`;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) s += `<rect class="m-px" x="${ox + c * cell}" y="${oy + r * cell}" width="${cell - 2}" height="${cell - 2}" rx="3"/>`;
  const shifts: [number, number, string][] = [
    [0.5, 0.5, SERIES.phone],
    [0.18, 0.28, SERIES.same],
    [0.74, 0.7, SERIES.chosen],
  ];
  for (const [dx, dy, col] of shifts) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) s += `<circle cx="${(ox + (c + dx) * cell - 1).toFixed(1)}" cy="${(oy + (r + dy) * cell - 1).toFixed(1)}" r="3.4" fill="${col}"/>`;
  const lx = ox + cols * cell + 14;
  const legend: [string, string][] = [
    [SERIES.phone, 'frame 1: pixel centres'],
    [SERIES.same, 'frame 2: shifted by hand shake'],
    [SERIES.chosen, 'frame 3: shifted again'],
  ];
  legend.forEach(([col, t], i) => (s += `<circle cx="${lx + 4}" cy="${22 + i * 22}" r="4" fill="${col}"/><text class="m-l" x="${lx + 14}" y="${26 + i * 22}">${t}</text>`));
  s += `<text class="m-t" x="${lx}" y="${104}">merged: samples between</text><text class="m-t" x="${lx}" y="${118}">the pixels → finer detail</text>`;
  s += '</svg>';
  return s;
}

// ------------------------------------------------------------------ topic
export function createComputationalTopic(): Topic {
  let root: HTMLElement;
  let cams: CameraExample[] = [];
  let cam: CameraExample;
  let stack: FrameStack | null = null;
  let cardSamples: number[] = [];
  let lambda = 16;
  let measured: number[] = [];
  let frames = 8;
  let chartW = 0;
  let layers: PortraitLayers | null = null;
  let ideal: Float32Array | null = null;
  let estimated: Float32Array | null = null;
  let simN = 2;
  let depthMode: 'ideal' | 'estimated' = 'ideal';
  let optical: Float32Array | null = null;
  let radii = { phoneBg: 0, phoneHedge: 0, simBg: 0, simHedge: 0, phoneFrac: 0, simFrac: 0 };
  const merged = new Float32Array(NW * NH * 3);
  const ref = (n: string) => root.querySelector<HTMLElement>(`[data-ref="${n}"]`)!;
  const SIM = logScale(1.4, 16);

  // ---- (a)
  const drawFrames = () => {
    if (!stack) return;
    const draw = (c: HTMLCanvasElement, data: Float32Array) => {
      const g = c.getContext('2d')!;
      const id = g.createImageData(NW, NH);
      for (let p = 0, i = 0; p < NW * NH; p++, i += 3) {
        id.data[p * 4] = encode(data[i] / PHOTONS_WHITE);
        id.data[p * 4 + 1] = encode(data[i + 1] / PHOTONS_WHITE);
        id.data[p * 4 + 2] = encode(data[i + 2] / PHOTONS_WHITE);
        id.data[p * 4 + 3] = 255;
      }
      g.putImageData(id, 0, 0);
    };
    draw(root.querySelector<HTMLCanvasElement>('[data-noise="one"]')!, stack.merge(1, merged));
    draw(root.querySelector<HTMLCanvasElement>('[data-noise="many"]')!, stack.merge(frames, merged));
    ref('n-many').textContent = `${frames} frame${frames > 1 ? 's' : ''} merged`;
    root.querySelector('[data-out="lc-frames"]')!.textContent = `N = ${frames}`;
    syncFill(root.querySelector<HTMLInputElement>('#lc-frames')!);
    ref('n-meas').textContent = measured[frames - 1].toFixed(1);
    ref('n-theory').textContent = theoreticalSnr(lambda, frames).toFixed(1);
    ref('n-theory-f').textContent = `√(${lambda} × ${frames})`;
    ref('n-noise').textContent = `${Math.round(100 / Math.sqrt(frames))} %`;
    if (chartW > 0) ref('chart').innerHTML = snrChart(chartW, lambda, measured, frames);
  };

  // ---- (b)
  const portraitNumbers = () => {
    const w = cam.sensor.width / PORTRAIT_CROP;
    const cropped = { width: w, height: cam.sensor.height / PORTRAIT_CROP };
    const phoneBg = depthOfField(cam.realFocal, cam.aperture, cropped, SUBJECT_D, CITY_D);
    const phoneHedge = depthOfField(cam.realFocal, cam.aperture, cropped, SUBJECT_D, HEDGE_D);
    const ff43 = sensorFromCrop(1); // 4:3 frame with the full-frame diagonal: the phone's framing on full frame
    const eq = cam.eqFocal * PORTRAIT_CROP;
    const simBg = depthOfField(eq, simN, ff43, SUBJECT_D, CITY_D);
    const simHedge = depthOfField(eq, simN, ff43, SUBJECT_D, HEDGE_D);
    radii = {
      phoneBg: blurPixels(phoneBg.backgroundBlurFrac, PW) / 2,
      phoneHedge: blurPixels(phoneHedge.backgroundBlurFrac, PW) / 2,
      simBg: blurPixels(simBg.backgroundBlurFrac, PW) / 2,
      simHedge: blurPixels(simHedge.backgroundBlurFrac, PW) / 2,
      phoneFrac: phoneBg.backgroundBlurFrac,
      simFrac: simBg.backgroundBlurFrac,
    };
    return eq;
  };

  const layered = (rBg: number, rHedge: number): Float32Array => {
    const L = layers!;
    const out = discBlur(L.bg, PW, PH, rBg);
    over(out, discBlur(L.hedge, PW, PH, rHedge));
    return over(out, L.subject);
  };

  const renderOptical = () => {
    const eq = portraitNumbers();
    optical = layered(radii.phoneBg, radii.phoneHedge);
    writeImage(root.querySelector<HTMLCanvasElement>('[data-portrait="optical"]')!, optical);
    ref('p-opt').innerHTML = `${esc(shortPhone(cam.phone))} lens, ${mm(cam.realFocal, 2)} ${fNum(cam.aperture)}: city lights blurred to <strong>${pct(radii.phoneFrac)}</strong> of the frame width (≈ ${Math.max(0, radii.phoneBg * 2).toFixed(1)} px here) ${tag('calc')}`;
    ref('p-frame').innerHTML = `Framing: a ${PORTRAIT_CROP}× crop of the main camera (${Math.round(eq)} mm-equivalent view). Illustrative scene: subject ${SUBJECT_D / 1000} m, hedge ${HEDGE_D / 1000} m, city lights ${CITY_D / 1000} m from the phone.`;
  };

  const renderSynthetic = () => {
    if (!layers || !optical || !ideal || !estimated) return;
    const eq = portraitNumbers();
    let out: Float32Array;
    if (depthMode === 'ideal') {
      out = layered(radii.simBg, radii.simHedge);
    } else {
      // the real pipeline: blur the captured photo itself, steered by the estimated depth map
      const bBg = discBlur(optical, PW, PH, radii.simBg);
      const bHedge = discBlur(optical, PW, PH, radii.simHedge);
      const vH = invDepth(HEDGE_D);
      const toHedge = new Float32Array(PW * PH);
      const keep = new Float32Array(PW * PH);
      for (let p = 0; p < keep.length; p++) {
        const v = estimated[p];
        toHedge[p] = Math.min(1, v / vH);
        keep[p] = Math.max(0, Math.min(1, (v - 0.55) / 0.3));
      }
      const blurred = mix(bHedge, bBg, toHedge);
      out = mix(optical, blurred, keep);
    }
    writeImage(root.querySelector<HTMLCanvasElement>('[data-portrait="synthetic"]')!, out);
    writeImage(root.querySelector<HTMLCanvasElement>('[data-portrait="depth"]')!, depthImage(depthMode === 'ideal' ? ideal : estimated));
    ref('p-syn').innerHTML = `Simulated full-frame look, ${Math.round(eq)} mm ${fNum(simN)}: <strong>${pct(radii.simFrac)}</strong> (≈ ${(radii.simBg * 2).toFixed(1)} px here) — ${(radii.simFrac / radii.phoneFrac).toFixed(0)}× the phone’s optical blur ${tag('calc')}`;
    root.querySelector('[data-out="lc-sim"]')!.textContent = fNum(simN);
    syncFill(root.querySelector<HTMLInputElement>('#lc-sim')!);
    root.querySelectorAll<HTMLElement>('[data-depth]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.depth === depthMode)));
    ref('p-depth-note').textContent =
      depthMode === 'ideal'
        ? 'Perfect depth map and clean layers — what the effect would look like if the phone knew the exact distance of every pixel.'
        : 'Estimated at low resolution: flyaway hair is lost, a sharp halo of background clings to the edges, and the depth estimate looks through the glasses, blurring the eyes behind them.';
  };
  const scheduleSynthetic = rafThrottle(renderSynthetic);

  const setCamera = (id: string) => {
    cam = cams.find((c) => c.phoneId === id) ?? cams[0];
    root.querySelectorAll<HTMLElement>('[data-pcam]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pcam === cam.phoneId)));
    renderOptical();
    renderSynthetic();
  };

  return {
    id: 'computational',
    title: 'Computational photography',
    short: 'Computational',
    blurb: 'Multi-frame merging, portrait mode, HDR, zoom',
    mount(el: HTMLElement, ctx: TopicContext) {
      root = el;
      cams = mainCameras(ctx.phones);
      const chips = cams
        .map((c) => `<button class="lt-chip" data-pcam="${c.phoneId}" aria-pressed="false"><strong>${esc(shortPhone(c.phone))}</strong><small>${mm(c.realFocal, 2)} ${fNum(c.aperture)}</small></button>`)
        .join('');
      const cardStyle = `left:${((CARD.x / NW) * 100).toFixed(2)}%;top:${((CARD.y / NH) * 100).toFixed(2)}%;width:${((CARD.w / NW) * 100).toFixed(2)}%;height:${((CARD.h / NH) * 100).toFixed(2)}%`;
      el.innerHTML = `
<header class="lt-head">
  <div class="eyebrow">Explainer 04 · Software</div>
  <h3>Computational photography</h3>
  <p class="lt-lead">A small sensor collects little light and a short lens barely blurs the background. Phones make up for both in software: they capture many frames and merge them, and they estimate depth to fake a large-sensor look.</p>
</header>

<section class="lt-sec" aria-labelledby="lc-a">
  <h4 class="lt-sec-h" id="lc-a"><span>a</span>Multi-frame noise reduction</h4>
  <div class="lt-card">
    <div class="lt-noise">
      <figure class="lt-shot"><div class="lt-shot-img"><canvas data-noise="one" width="${NW}" height="${NH}" aria-label="One noisy frame"></canvas><i class="lt-card-box" style="${cardStyle}"></i></div><figcaption>1 frame</figcaption></figure>
      <figure class="lt-shot"><div class="lt-shot-img"><canvas data-noise="many" width="${NW}" height="${NH}" aria-label="Merged frames"></canvas><i class="lt-card-box" style="${cardStyle}"></i></div><figcaption data-ref="n-many"></figcaption></figure>
    </div>
    <div class="lt-noise-ctl">
      ${sliderMarkup({ id: 'lc-frames', label: 'Frames merged', value: frames - 1, max: 15, ticks: [[0, '1'], [3, '4'], [7, '8'], [11, '12'], [15, '16']] })}
      <div class="lt-results three">
        <div class="lt-stat"><span>Measured SNR</span><b data-ref="n-meas"></b><small>grey card, merged frames</small></div>
        <div class="lt-stat"><span>Theory</span><b data-ref="n-theory"></b><small data-ref="n-theory-f"></small></div>
        <div class="lt-stat"><span>Noise left</span><b data-ref="n-noise"></b><small>of one frame = 1/√N</small></div>
      </div>
    </div>
    <div class="lt-chart">
      <div class="lt-legend"><span><i class="line"></i>theory √(λ·N), λ = <b data-ref="n-lambda"></b> photons</span><span><i class="dot" style="background:${SERIES.phone}"></i>measured on the simulated frames</span></div>
      <figure class="lt-fig" data-ref="chart"></figure>
    </div>
  </div>
  <div class="lt-prose wide">
    <p>Light arrives as photons, and they arrive randomly. A pixel that expects 16 photons in one exposure really counts 16 ± 4 (√16) — that scatter is <em>shot noise</em>, and it is worst when the sensor is small and the light is dim. Merging N frames of the same scene adds up N times the signal but only √N times the noise, so the signal-to-noise ratio grows as √N: 4 frames are twice as clean, 16 frames four times. The simulation draws every frame with real Poisson statistics (fixed seed) and measures the grey card; the dots follow the √N curve.</p>
    <p class="lt-note">Only photon noise is simulated. Real phones must also align the frames (hands shake), reject moving parts to avoid ghosts, and add a little electronic read noise per frame — which is why many short frames are slightly noisier than one long exposure of the same total time, but free of motion blur.</p>
  </div>
</section>

<section class="lt-sec" aria-labelledby="lc-b">
  <h4 class="lt-sec-h" id="lc-b"><span>b</span>Portrait mode: blur from a depth map</h4>
  <div class="lt-card">
    <div class="lt-ctrl-bar">
      <div class="lt-field"><span class="lt-label">Phone main camera</span><div class="lt-chips" role="group" aria-label="Phone">${chips}</div></div>
      <div class="lt-field"><span class="lt-label">Depth map</span><div class="seg lt-seg" role="group" aria-label="Depth map"><button data-depth="ideal" aria-pressed="true">Ideal</button><button data-depth="estimated" aria-pressed="false">Estimated</button></div></div>
    </div>
    <div class="lt-portrait">
      <figure class="lt-shot"><div class="lt-shot-img"><canvas data-portrait="optical" width="${PW}" height="${PH}" aria-label="What the phone's lens really gives"></canvas></div><figcaption><b>Optical</b> what the small sensor really gives</figcaption></figure>
      <figure class="lt-shot"><div class="lt-shot-img"><canvas data-portrait="depth" width="${PW}" height="${PH}" aria-label="Depth map"></canvas></div><figcaption><b>Depth map</b> bright = near</figcaption></figure>
      <figure class="lt-shot"><div class="lt-shot-img"><canvas data-portrait="synthetic" width="${PW}" height="${PH}" aria-label="Portrait mode result"></canvas></div><figcaption><b>Portrait mode</b> blur added in software</figcaption></figure>
    </div>
    <p class="lt-note lt-depth-note" data-ref="p-depth-note"></p>
    <div class="lt-portrait-ctl">
      ${sliderMarkup({ id: 'lc-sim', label: 'Simulated aperture', value: SIM.toPos(simN), ticks: [[SIM.toPos(1.4), 'f/1.4'], [SIM.toPos(2.8), 'f/2.8'], [SIM.toPos(5.6), 'f/5.6'], [SIM.toPos(16), 'f/16']] })}
      <ul class="lt-readout">
        <li><i style="background:${SERIES.phone}"></i><span data-ref="p-opt"></span></li>
        <li><i style="background:${SERIES.chosen}"></i><span data-ref="p-syn"></span></li>
      </ul>
    </div>
    <p class="lt-note" data-ref="p-frame"></p>
  </div>
  <div class="lt-prose wide">
    <p>The phone’s own optics leave the background almost sharp — a fraction of a percent of the frame. Portrait mode estimates how far away every pixel is (from the tiny parallax between the two halves of dual-pixel autofocus sites, from two cameras, and with machine-learning segmentation), then blurs each pixel by the disc a large-sensor lens would give at that distance. The slider sets that virtual lens; the maths is the same thin-lens blur used everywhere in the lab.</p>
    <p>The hard part is the edges. Depth maps are coarser than the photo, so <strong>fine hair</strong> is either blurred away or keeps a sharp halo of background; <strong>glasses</strong> confuse the estimate — the frame is thin and the lenses are transparent, so the eyes behind them can be treated as background; gaps between an arm and the body, fences and wine glasses cause similar mistakes. Switch the depth map to “Estimated” to see these artefacts.</p>
  </div>
</section>

<section class="lt-sec" aria-labelledby="lc-c">
  <h4 class="lt-sec-h" id="lc-c"><span>c</span>HDR and super-resolution zoom</h4>
  <div class="lt-two">
    <div class="lt-card lt-mini-card">
      <h5>HDR: bracketing and tone mapping</h5>
      ${HDR_SVG}
      <p>One exposure cannot hold both a bright sky and deep shadows: the sky clips to white or the shadows drown in noise. The phone takes a burst at different exposures (a bracket), aligns and merges them into one image with a much wider range, then <em>tone-maps</em> it — compressing the bright and dark ends so it fits what a screen or print can show. Diagram schematic.</p>
    </div>
    <div class="lt-card lt-mini-card">
      <h5>Super-resolution zoom</h5>
      ${superResSvg()}
      <p>Your hand is never perfectly still, so each frame of a burst lands a fraction of a pixel off the last. Merged carefully, the frames sample the scene between the pixel centres and fill in colour the sensor’s filter pattern missed, giving more real detail than one frame — useful when cropping past the optical zoom. At extreme zoom levels, AI upscaling adds plausible detail that was never captured.</p>
    </div>
  </div>
</section>

<section class="lt-sec" aria-labelledby="lc-d">
  <h4 class="lt-sec-h" id="lc-d"><span>d</span>What the makers call it</h4>
  <p class="lt-note">Named features from the lab’s phone data, with the makers’ own descriptions. The keyword tags link each to the techniques above; they are matched from the descriptions, not claims about how each feature works inside.</p>
  <div class="lt-makers">${featuresHtml(ctx.phones)}</div>
</section>`;

      // (a) frames: simulate once
      const clean = readLayer(paintNightScene());
      const expected = new Float32Array(NW * NH * 3);
      for (let p = 0; p < NW * NH; p++) for (let ch = 0; ch < 3; ch++) expected[p * 3 + ch] = clean[p * 4 + ch] * PHOTONS_WHITE;
      stack = new FrameStack(expected, 16, 2026);
      cardSamples = [];
      for (let y = CARD.y + 2; y < CARD.y + CARD.h - 2; y++) for (let x = CARD.x + 2; x < CARD.x + CARD.w - 2; x++) for (let ch = 0; ch < 3; ch++) cardSamples.push((y * NW + x) * 3 + ch);
      lambda = Math.round(expected[cardSamples[0]] * 10) / 10;
      measured = Array.from({ length: 16 }, (_, i) => stack!.snr(i + 1, cardSamples));
      ref('n-lambda').textContent = String(lambda);
      const fr = el.querySelector<HTMLInputElement>('#lc-frames')!;
      const scheduleFrames = rafThrottle(drawFrames);
      fr.addEventListener('input', () => {
        frames = Number(fr.value) + 1;
        scheduleFrames();
      });
      const chart = ref('chart');
      chartW = Math.round(chart.clientWidth);
      onWidth(chart, (w) => {
        chartW = w;
        drawFrames();
      });
      drawFrames();

      // (b) portrait
      layers = paintPortrait();
      ideal = idealDepth(layers);
      estimated = estimatedDepth(ideal, layers.lensMask);
      const sim = el.querySelector<HTMLInputElement>('#lc-sim')!;
      sim.addEventListener('input', () => {
        simN = SIM.toValue(Number(sim.value));
        scheduleSynthetic();
      });
      el.querySelectorAll<HTMLElement>('[data-depth]').forEach((b) =>
        b.addEventListener('click', () => {
          depthMode = b.dataset.depth as typeof depthMode;
          renderSynthetic();
        }),
      );
      el.querySelectorAll<HTMLElement>('[data-pcam]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.pcam!)));
      if (cams.length) setCamera(cams.some((c) => c.phoneId === DEFAULT_MAIN) ? DEFAULT_MAIN : cams[0].phoneId);
    },
    setActive() {
      /* renders on demand only */
    },
  };
}
