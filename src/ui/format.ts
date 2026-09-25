/** Formatting helpers for optical quantities (inputs in mm). */

/** digits ≥ 2: precise (78.6 cm / 2.00 m); digits ≤ 1: compact labels (80 cm / 2.0 m). */
export function fmtDistance(mm: number, digits = 2): string {
  if (!Number.isFinite(mm)) return '∞';
  if (mm < 1000) return `${(mm / 10).toFixed(digits >= 2 ? 1 : 0)} cm`;
  if (mm >= 10000) return `${(mm / 1000).toFixed(digits >= 2 ? 1 : 0)} m`;
  return `${(mm / 1000).toFixed(digits)} m`;
}

/** Distance split into value + unit (for large readouts). */
export function splitDistance(mm: number): { value: string; unit: string } {
  if (!Number.isFinite(mm)) return { value: '∞', unit: '' };
  if (mm < 1000) return { value: (mm / 10).toFixed(1), unit: 'cm' };
  if (mm < 10000) return { value: (mm / 1000).toFixed(2), unit: 'm' };
  return { value: (mm / 1000).toFixed(1), unit: 'm' };
}

/** Depth of field in centimetres (the unit the brief asks for). */
export function fmtDofCm(mm: number): string {
  if (!Number.isFinite(mm)) return '∞';
  const cm = mm / 10;
  if (cm < 10) return `${cm.toFixed(1)} cm`;
  return `${Math.round(cm).toLocaleString('en-US')} cm`;
}

export function fmtF(n: number): string {
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

export function fmtRatio(m: number): string {
  if (m <= 0) return '—';
  return `1:${(1 / m).toFixed(1)}`;
}
