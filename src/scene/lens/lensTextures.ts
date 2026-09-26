import * as THREE from 'three';
import { canvasTexture, heightToNormal, makeCanvas } from '../../util/textures';
import { LENS } from '../../optics/config';
import { ringAngleForFocus } from '../../optics/helicoid';

const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';
const SANS = '"Inter Variable", system-ui, sans-serif';

/** Diamond-knurl tile (normal + roughness), meant to be repeated many times. */
export function knurlTextures(): { normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  const S = 64;
  const height = new Float32Array(S * S);
  const [rC, rX] = makeCanvas(S, S);
  const img = rX.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      const g1 = Math.abs(((u + v) % 1) - 0.5) * 2; // 0 at groove, 1 at ridge
      const g2 = Math.abs((((u - v) % 1) + 1) % 1 - 0.5) * 2;
      const h = Math.min(g1, g2);
      const shaped = Math.pow(h, 0.8);
      height[y * S + x] = shaped;
      const i = (y * S + x) * 4;
      const rough = 0.32 + (1 - shaped) * 0.45;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = rough * 255;
      img.data[i + 3] = 255;
    }
  }
  rX.putImageData(img, 0, 0);
  const normal = heightToNormal(height, S, S, 3.2);
  const nT = canvasTexture(normal, { repeat: [1, 1] });
  const rT = canvasTexture(rC, { repeat: [1, 1] });
  return { normalMap: nT, roughnessMap: rT };
}

/** Longitudinal ribs (for the aperture ring grip). */
export function ribTextures(): THREE.Texture {
  const W = 32;
  const H = 8;
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      height[y * W + x] = Math.pow(Math.abs(Math.sin(Math.PI * u)), 0.6);
    }
  }
  return canvasTexture(heightToNormal(height, W, H, 2.5), { repeat: [1, 1] });
}

/** Distances engraved on the focus ring (metres). */
const DISTANCE_MARKS: { d: number; label: string; major: boolean }[] = [
  { d: Infinity, label: '∞', major: true },
  { d: 10000, label: '10', major: false },
  { d: 5000, label: '5', major: true },
  { d: 3000, label: '3', major: false },
  { d: 2000, label: '2', major: true },
  { d: 1500, label: '1.5', major: false },
  { d: 1000, label: '1', major: true },
  { d: 700, label: '.7', major: false },
  { d: 500, label: '.5', major: true },
  { d: 400, label: '.4', major: false },
  { d: 360, label: '.36', major: true },
];

/**
 * Ring angle of a mark for a subject T mm from the focal plane — the lab's convention, like the
 * distance scale of a real lens. The helicoid is driven by the lens-to-subject distance u, with
 * u + v = T and 1/u + 1/v = 1/f; the closest focus (0.3 m from the lens) engraves as .36.
 */
function markAngle(T: number): number {
  if (!Number.isFinite(T)) return 0;
  const f = LENS.focalLength;
  return ringAngleForFocus((T + Math.sqrt(T * T - 4 * T * f)) / 2);
}

/** Ring-local angle of the ∞ mark on the distance band texture (radians). */
export const DISTANCE_PSI_INF = 0.35;

/**
 * Distance scale printed around the focus ring. Canvas x spans the full circumference (0…2π),
 * canvas y spans the band along the axis (top = towards the subject). Each mark sits at
 * ψ = ψ∞ + helicoid angle(T), T from the focal plane (`markAngle`), so the scale is compressed towards ∞ exactly like the real thing.
 */
export function distanceScaleTexture(): THREE.Texture {
  const W = 4096;
  const H = 192;
  const [c, x] = makeCanvas(W, H);
  x.fillStyle = '#0c0d0f';
  x.fillRect(0, 0, W, H);
  const pxPerRad = W / (Math.PI * 2);
  // minor ticks between marks
  x.strokeStyle = 'rgba(240,240,240,0.55)';
  x.lineWidth = 3;
  for (const d of [20000, 7000, 4000, 2500, 1750, 1250, 850, 600, 450]) {
    const px = (DISTANCE_PSI_INF + markAngle(d)) * pxPerRad;
    x.beginPath();
    x.moveTo(px, H * 0.02);
    x.lineTo(px, H * 0.2);
    x.stroke();
  }
  for (const m of DISTANCE_MARKS) {
    const psi = DISTANCE_PSI_INF + markAngle(m.d);
    const px = psi * pxPerRad;
    x.strokeStyle = '#f2f2f2';
    x.lineWidth = m.major ? 6 : 4;
    x.beginPath();
    x.moveTo(px, H * 0.02);
    x.lineTo(px, H * (m.major ? 0.3 : 0.22));
    x.stroke();
    x.save();
    x.translate(px, H * 0.62);
    x.rotate(-Math.PI / 2);
    x.fillStyle = m.d === Infinity ? '#ffffff' : '#ededed';
    x.font = `${m.major ? 700 : 600} ${m.d === Infinity ? 96 : 64}px ${SANS}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(m.label, 0, 0);
    x.restore();
  }
  // "m" unit label after the close-focus mark
  const pxM = (DISTANCE_PSI_INF + markAngle(360) + 0.12) * pxPerRad;
  x.save();
  x.translate(pxM, H * 0.62);
  x.rotate(-Math.PI / 2);
  x.fillStyle = '#ff9a3c';
  x.font = `700 58px ${SANS}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('m', 0, 0);
  x.restore();
  const tex = canvasTexture(c, { srgb: true, anisotropy: 16 });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export const APERTURE_STOPS = [2, 2.8, 4, 5.6, 8, 11, 16];
/** Aperture-ring rotation per full stop (radians). */
export const APERTURE_DEG_PER_STOP = 16;
export const APERTURE_PSI0 = 0.5;

export function apertureRingAngle(fNumber: number): number {
  const stops = 2 * Math.log2(fNumber / 2);
  return THREE.MathUtils.degToRad(stops * APERTURE_DEG_PER_STOP);
}

export function apertureScaleTexture(): THREE.Texture {
  const W = 4096;
  const H = 160;
  const [c, x] = makeCanvas(W, H);
  x.fillStyle = '#0c0d0f';
  x.fillRect(0, 0, W, H);
  const pxPerRad = W / (Math.PI * 2);
  for (const n of APERTURE_STOPS) {
    const px = (APERTURE_PSI0 + apertureRingAngle(n)) * pxPerRad;
    x.save();
    x.translate(px, H * 0.5);
    x.rotate(-Math.PI / 2);
    x.fillStyle = n === 16 ? '#ffb347' : n === 2 ? '#7fdcff' : '#e9e9e9';
    x.font = `700 62px ${MONO}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(String(n), 0, 0);
    x.restore();
    // half-stop dots
    const pxH = (APERTURE_PSI0 + apertureRingAngle(n) + THREE.MathUtils.degToRad(APERTURE_DEG_PER_STOP / 2)) * pxPerRad;
    if (n !== 16) {
      x.fillStyle = 'rgba(230,230,230,0.6)';
      x.beginPath();
      x.arc(pxH, H * 0.5, 6, 0, Math.PI * 2);
      x.fill();
    }
  }
  const tex = canvasTexture(c, { srgb: true, anisotropy: 16 });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * Index line + depth-of-field scale on the fixed barrel. Because DoF in helicoid travel is
 * ≈ ±N·c regardless of distance, a pair of fixed marks per f-number brackets the sharp zone
 * on the distance scale — the same trick real manual lenses use.
 */
export function indexScaleTexture(dofMarks: { label: string; angle: number; color: string }[]): THREE.Texture {
  const W = 4096;
  const H = 128;
  const [c, x] = makeCanvas(W, H);
  x.fillStyle = '#b9bcc2';
  x.fillRect(0, 0, W, H);
  // subtle brushed look
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`;
    x.fillRect(0, Math.random() * H, W, 1);
  }
  const pxPerRad = W / (Math.PI * 2);
  const center = W / 2;
  x.fillStyle = '#111';
  x.fillRect(center - 5, 0, 10, H * 0.9);
  for (const m of dofMarks) {
    for (const s of [-1, 1]) {
      const px = center + s * m.angle * pxPerRad;
      x.fillStyle = m.color;
      x.fillRect(px - 3.5, 0, 7, H * 0.42);
      x.save();
      x.translate(px, H * 0.72);
      x.rotate(-Math.PI / 2);
      x.font = `700 34px ${MONO}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(m.label, 0, 0);
      x.restore();
    }
  }
  const tex = canvasTexture(c, { srgb: true, anisotropy: 16 });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Engraving for the front name ring (polar text on an annulus). */
export function nameRingTexture(): THREE.Texture {
  const S = 1024;
  const [c, x] = makeCanvas(S, S);
  x.fillStyle = '#0b0c0e';
  x.fillRect(0, 0, S, S);
  x.translate(S / 2, S / 2);
  const text = 'LENS · LAB   PLANAR  1:2   f = 50 mm   ⌀ 52   MADE WITH THREE.JS   ';
  x.font = `600 40px ${SANS}`;
  x.fillStyle = '#e8e8e8';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const radius = S * 0.415;
  const total = text.length;
  for (let i = 0; i < total; i++) {
    const a = (i / total) * Math.PI * 2;
    x.save();
    x.rotate(a);
    x.translate(0, -radius);
    x.fillText(text[i], 0, 0);
    x.restore();
  }
  const tex = canvasTexture(c, { srgb: true, anisotropy: 8 });
  return tex;
}
