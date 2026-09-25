import { LENS, SUBJECTS, type SubjectId } from '../optics/config';
import { depthMap } from '../scene/layout';

type Ease = (t: number) => number;
export const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);

class Tween {
  private from = 0;
  private to = 0;
  private t = 1;
  private duration = 1;
  private ease: Ease = easeInOutCubic;
  value: number;

  constructor(v: number) {
    this.value = v;
    this.to = v;
  }

  start(to: number, duration: number, ease: Ease = easeInOutCubic): void {
    this.from = this.value;
    this.to = to;
    this.t = 0;
    this.duration = Math.max(1e-3, duration);
    this.ease = ease;
  }

  set(v: number): void {
    this.value = v;
    this.to = v;
    this.t = 1;
  }

  get target(): number {
    return this.to;
  }

  get active(): boolean {
    return this.t < 1;
  }

  update(dt: number): boolean {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / this.duration);
    this.value = this.from + (this.to - this.from) * this.ease(this.t);
    return true;
  }
}

export type FocusSource = 'slider' | 'ring' | 'button' | 'key' | 'init';

/**
 * Application state. Focus is animated in "slider space" u = depthMap.toU(distance), so the
 * plane of focus glides at constant speed through the diorama; aperture is animated in stops.
 */
export class LabState {
  private readonly focusU = new Tween(depthMap.toU(2000));
  /** Exponentially-smoothed follower for direct manipulation (slider / ring drag). */
  private followU: number | null = null;
  private readonly stops = new Tween(LabState.toStops(5.6));
  private readonly explodeT = new Tween(1);
  exploded = true;
  apertureTarget = 5.6;
  lastFocusSource: FocusSource = 'init';
  changed = true;

  static toStops(n: number): number {
    return 2 * Math.log2(n);
  }
  static fromStops(s: number): number {
    return Math.pow(2, s / 2);
  }

  get u(): number {
    return this.focusU.value;
  }
  get targetU(): number {
    return this.followU ?? this.focusU.target;
  }
  get focusDistance(): number {
    return depthMap.fromU(Math.min(1, Math.max(0, this.focusU.value)));
  }
  get fNumber(): number {
    return LabState.fromStops(this.stops.value);
  }
  get explode(): number {
    return this.explodeT.value;
  }
  get animating(): boolean {
    return this.focusU.active || this.stops.active || this.explodeT.active || this.followU !== null;
  }

  /** Animate to a focus distance (mm). */
  focusTo(distance: number, source: FocusSource = 'button', duration?: number): void {
    const u = Math.min(1, Math.max(0, depthMap.toU(distance)));
    const d = duration ?? 0.55 + Math.abs(u - this.focusU.value) * 1.1;
    this.followU = null;
    this.focusU.start(u, d);
    this.lastFocusSource = source;
    this.changed = true;
  }

  focusSubject(id: SubjectId): void {
    const s = SUBJECTS.find((x) => x.id === id)!;
    this.focusTo(s.distance, 'button');
  }

  /** Direct manipulation (slider): follow the target with a short, smooth lag. */
  followFocusU(u: number, source: FocusSource): void {
    this.followU = Math.min(1, Math.max(0, u));
    this.lastFocusSource = source;
    this.changed = true;
  }

  /** Direct manipulation without smoothing (focus ring: it must stay glued to the finger). */
  setFocusDistance(distance: number, source: FocusSource): void {
    const u = Math.min(1, Math.max(0, depthMap.toU(distance)));
    this.followU = null;
    this.focusU.set(u);
    this.lastFocusSource = source;
    this.changed = true;
  }

  setAperture(n: number): void {
    this.apertureTarget = n;
    const target = LabState.toStops(n);
    this.stops.start(target, 0.5 + Math.abs(target - this.stops.value) * 0.09, easeInOutCubic);
    this.changed = true;
  }

  setExploded(on: boolean): void {
    this.exploded = on;
    this.explodeT.start(on ? 1 : 0, 1.9, (t) => t);
    this.changed = true;
  }

  update(dt: number): boolean {
    let moved = false;
    if (this.followU !== null) {
      const k = 1 - Math.exp(-dt * 16);
      const next = this.focusU.value + (this.followU - this.focusU.value) * k;
      if (Math.abs(this.followU - next) < 1e-5) {
        this.focusU.set(this.followU);
        this.followU = null;
      } else {
        this.focusU.set(next);
      }
      moved = true;
    }
    moved = this.focusU.update(dt) || moved;
    moved = this.stops.update(dt) || moved;
    moved = this.explodeT.update(dt) || moved;
    if (moved) this.changed = true;
    return moved;
  }

  static readonly apertures = LENS.apertures;
}
