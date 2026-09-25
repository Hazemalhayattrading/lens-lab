export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  level: QualityLevel;
  maxDpr: number;
  msaa: number;
  shadows: boolean;
  shadowSize: number;
  sensorMaxWidth: number;
  sensorSamples: number;
  sensorMsaa: number;
  transmissionScale: number;
  bloomLevels: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { level: 'low', maxDpr: 1, msaa: 0, shadows: true, shadowSize: 1024, sensorMaxWidth: 720, sensorSamples: 40, sensorMsaa: 0, transmissionScale: 0.5, bloomLevels: 5 },
  medium: { level: 'medium', maxDpr: 1.5, msaa: 2, shadows: true, shadowSize: 1536, sensorMaxWidth: 1080, sensorSamples: 64, sensorMsaa: 2, transmissionScale: 0.75, bloomLevels: 6 },
  high: { level: 'high', maxDpr: 2, msaa: 4, shadows: true, shadowSize: 2048, sensorMaxWidth: 1600, sensorSamples: 96, sensorMsaa: 4, transmissionScale: 1, bloomLevels: 7 },
};

export function isLikelyMobile(): boolean {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || Math.min(window.innerWidth, window.innerHeight) < 600;
}

export function initialQuality(): QualityLevel {
  return isLikelyMobile() ? 'low' : 'medium';
}

/**
 * Auto quality: watches the frame rate for a few seconds at a time and steps down when the
 * device struggles (or up once when there is obvious headroom).
 */
export class AutoQuality {
  private acc = 0;
  private frames = 0;
  private triedUp = false;
  private cooldown = 2.5;
  enabled = true;

  constructor(private level: QualityLevel, private readonly apply: (level: QualityLevel) => void) {}

  get current(): QualityLevel {
    return this.level;
  }

  set(level: QualityLevel): void {
    this.level = level;
    this.acc = 0;
    this.frames = 0;
    this.cooldown = 2.5;
  }

  sample(dt: number): void {
    if (!this.enabled || document.hidden) return;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }
    this.acc += dt;
    this.frames++;
    if (this.acc < 3) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (fps < 38 && this.level !== 'low') {
      this.level = this.level === 'high' ? 'medium' : 'low';
      this.apply(this.level);
      this.cooldown = 2.5;
      this.triedUp = true;
    } else if (fps > 58 && this.level === 'medium' && !this.triedUp) {
      this.triedUp = true;
      this.level = 'high';
      this.apply(this.level);
      this.cooldown = 2.5;
    }
  }
}
