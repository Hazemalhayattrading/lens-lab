/** Formatting helpers for optical quantities (inputs in mm). */

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/**
 * Kilometres from 100 km on (the far end of the depth ladder): whole numbers up to 99 999 km,
 * then a power of ten (2·10⁶ km), so readouts never need more than five digits.
 */
function farKm(mm: number): string {
  const km = mm / 1e6;
  if (km < 99999.5) return String(Math.round(km));
  let e = Math.floor(Math.log10(km));
  let m = Math.round(km / 10 ** e);
  if (m >= 10) [m, e] = [1, e + 1];
  return `${m}·10${[...String(e)].map((d) => SUPERSCRIPT[Number(d)]).join('')}`;
}

/** digits ≥ 2: precise (78.6 cm / 2.00 m); digits ≤ 1: compact labels (80 cm / 2.0 m). */
export function fmtDistance(mm: number, digits = 2): string {
  if (!Number.isFinite(mm)) return '∞';
  if (mm < 1000) return `${(mm / 10).toFixed(digits >= 2 ? 1 : 0)} cm`;
  if (mm >= 1e8) return `${farKm(mm)} km`;
  if (mm >= 1e6) return `${(mm / 1e6).toFixed(digits >= 2 ? 1 : 0)} km`;
  if (mm >= 100000) return `${Math.round(mm / 1000)} m`;
  if (mm >= 10000) return `${(mm / 1000).toFixed(digits >= 2 ? 1 : 0)} m`;
  return `${(mm / 1000).toFixed(digits)} m`;
}

/** Distance split into value + unit (for large readouts), with the numbers and units of fmtDistance. */
export function splitDistance(mm: number): { value: string; unit: string } {
  if (!Number.isFinite(mm)) return { value: '∞', unit: '' };
  if (mm < 1000) return { value: (mm / 10).toFixed(1), unit: 'cm' };
  if (mm < 10000) return { value: (mm / 1000).toFixed(2), unit: 'm' };
  if (mm < 100000) return { value: (mm / 1000).toFixed(1), unit: 'm' };
  if (mm < 1e6) return { value: String(Math.round(mm / 1000)), unit: 'm' };
  if (mm < 1e8) return { value: (mm / 1e6).toFixed(1), unit: 'km' };
  return { value: farKm(mm), unit: 'km' };
}

/** Depth of field: mm below 1 cm (macro), cm below 1 m, metres above. */
export function fmtDofCm(mm: number): string {
  if (!Number.isFinite(mm)) return '∞';
  if (mm < 10) return `${mm.toFixed(mm < 1 ? 2 : 1)} mm`;
  const cm = mm / 10;
  if (cm < 10) return `${cm.toFixed(1)} cm`;
  if (cm < 100) return `${Math.round(cm)} cm`;
  const m = mm / 1000;
  return m < 10 ? `${m.toFixed(2)} m` : m < 1000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Near – far limits; for razor-thin zones (macro) "30.0 cm ± 0.10 mm". */
export function fmtRange(near: number, far: number): string {
  if (Number.isFinite(far) && far - near < 10) {
    const mid = (near + far) / 2;
    return `${fmtDistance(mid)} ± ${((far - near) / 2).toFixed(far - near < 2 ? 2 : 1)} mm`;
  }
  const n = fmtDistance(near);
  const f = fmtDistance(far);
  // share the unit when both ends use it: "78.6–81.4 cm"
  const nu = n.lastIndexOf(' ');
  if (Number.isFinite(far) && nu > 0 && n.slice(nu) === f.slice(f.lastIndexOf(' '))) return `${n.slice(0, nu)}–${f}`;
  return `${n} – ${f}`;
}

export function fmtF(n: number): string {
  // published two-decimal values (f/0.95, f/1.78) keep both decimals; animated values get one
  if (Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 && Math.round(n * 100) % 10 !== 0) return `f/${n.toFixed(2)}`;
  const rounded = Math.round(n * 10) / 10;
  return `f/${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}`;
}

export function fmtMm(mm: number, digits = 2): string {
  return `${mm.toFixed(digits)} mm`;
}

/** Blur disc: µm below 0.1 mm for readability. */
export function fmtCoc(mm: number): string {
  if (mm < 0.0005) return '0 µm';
  if (mm < 0.1) return `${Math.round(mm * 1000)} µm`;
  return `${mm.toFixed(2)} mm`;
}

/** Reproduction ratio: 1:5.0, 1:1, 1.4:1. */
export function fmtRatio(m: number): string {
  if (m <= 1e-6) return '—';
  if (Math.abs(m - 1) < 0.005) return '1:1';
  if (m > 1) return `${m.toFixed(1)}:1`;
  return `1:${(1 / m).toFixed(1)}`;
}

/** Focal length: 50 mm, 6.9 mm. */
export function fmtFocal(mm: number): string {
  return `${mm >= 10 ? Math.round(mm) : mm.toFixed(1)} mm`;
}

/** Focal range of a lens: 24–70 mm or 50 mm. */
export function fmtFocalRange(min: number, max: number): string {
  if (Math.abs(max - min) < 1e-6) return fmtFocal(min);
  return `${Math.round(min)}–${Math.round(max)} mm`;
}

/** Aperture range: f/4.5–7.1 or f/2.8. */
export function fmtApertureRange(wide: number, tele: number): string {
  const n = (v: number) => fmtF(v).slice(2);
  return Math.abs(tele - wide) < 1e-6 ? fmtF(wide) : `f/${n(wide)}–${n(tele)}`;
}

/** Angle in degrees from radians. */
export function fmtDeg(rad: number, digits = 1): string {
  const d = (rad * 180) / Math.PI;
  return `${d >= 100 ? d.toFixed(0) : d.toFixed(digits)}°`;
}
