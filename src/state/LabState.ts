import { subjectById, type SubjectId } from '../optics/config';
import { maxApertureAtZoom, minApertureAtZoom, mfdAtZoom, zoomForFocal } from '../optics/lensModel';
import { TEACHING_LENS, type LabLens } from '../lab/labLens';
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

export type FocusSource = 'slider' | 'ring' | 'button' | 'key' | 'init' | 'lens';

const toStops = (n: number) => 2 * Math.log2(n);
const fromStops = (s: number) => Math.pow(2, s / 2);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Application state of the lab. Focus is animated in "ladder space" u = depthMap.toU(distance), so
 * the plane of focus glides at constant speed through the diorama; aperture is animated in stops;
 * the zoom ring in ring position z ∈ [0, 1]. Every value is limited to what the mounted lens can do.
 */
export class LabState {
  lens: LabLens = TEACHING_LENS;
  private readonly focusU = new Tween(depthMap.toU(2000));
  /** Exponentially smoothed follower for direct manipulation (slider). */
  private followU: number | null = null;
  private readonly stops = new Tween(toStops(2));
  private readonly zoomT = new Tween(0);
  private followZoom: number | null = null;
  private readonly explodeT = new Tween(1);
  exploded = true;
  /** The f-number the user asked for (the lens may clamp it). */
  apertureTarget = 2;
  /** Stay at the widest aperture while zooming (variable-aperture zooms). */
  wideOpen = true;
  lastFocusSource: FocusSource = 'init';
  changed = true;

  get zoom(): number {
    return this.zoomT.value;
  }
  get zoomTarget(): number {
    return this.followZoom ?? this.zoomT.target;
  }
  /** Closest focus at the current zoom, mm from the focal plane. */
  get minFocus(): number {
    return mfdAtZoom(this.lens.physics, this.zoom);
  }
  /**
   * Ladder position of the closest focus. The ladder starts (u = 0) at 0.2 m; a lens that focuses
   * closer gets u < 0 (the map extends smoothly below its start), so its whole range stays reachable.
   */
  get uMin(): number {
    return Math.min(depthMap.toU(this.minFocus), 1);
  }
  get u(): number {
    return clamp(this.focusU.value, this.uMin, 1);
  }
  get targetU(): number {
    return clamp(this.followU ?? this.focusU.target, this.uMin, 1);
  }
  get focusDistance(): number {
    const u = this.u;
    return u <= this.uMin + 1e-9 ? Math.max(this.minFocus, depthMap.fromU(u)) : depthMap.fromU(u);
  }
  get maxAperture(): number {
    return maxApertureAtZoom(this.lens.physics, this.zoom);
  }
  get minAperture(): number {
    return minApertureAtZoom(this.lens.physics, this.zoom);
  }
  get fNumber(): number {
    // wide open tracks the zoom's widest aperture, once the stops animation towards it has finished
    if (this.wideOpen && !this.stops.active) return this.maxAperture;
    return clamp(fromStops(this.stops.value), this.maxAperture, this.minAperture);
  }
  get explode(): number {
    return this.explodeT.value;
  }
  get animating(): boolean {
    return this.focusU.active || this.stops.active || this.explodeT.active || this.zoomT.active || this.followU !== null || this.followZoom !== null;
  }

  /** Mount another lens: zoom to the requested focal length (or the lens' widest), keep focus where possible. */
  setLens(lens: LabLens, focal?: number): void {
    const keepDistance = this.focusDistance;
    this.lens = lens;
    this.followZoom = null;
    this.zoomT.set(focal !== undefined ? zoomForFocal(lens.physics, focal) : 0);
    // keep the same distance if the new lens can focus there
    this.focusU.set(clamp(depthMap.toU(Math.max(keepDistance, this.minFocus)), this.uMin, 1));
    this.followU = null;
    const n = this.wideOpen ? this.maxAperture : clamp(this.apertureTarget, this.maxAperture, this.minAperture);
    this.stops.set(toStops(n));
    this.apertureTarget = n;
    this.lastFocusSource = 'lens';
    this.changed = true;
  }

  /**
   * Zooming to a longer closest focus only clamps the focus in the getters (zooming back restores
   * it); a new focus movement starts from where the focus actually is.
   */
  private rebaseFocus(): void {
    if (this.focusU.value !== this.u) this.focusU.set(this.u);
  }

  /** Animate to a focus distance (mm from the focal plane). */
  focusTo(distance: number, source: FocusSource = 'button', duration?: number): void {
    const u = clamp(depthMap.toU(Math.max(distance, this.minFocus)), this.uMin, 1);
    this.rebaseFocus();
    const d = duration ?? 0.55 + Math.abs(u - this.focusU.value) * 1.1;
    this.followU = null;
    this.focusU.start(u, d);
    this.lastFocusSource = source;
    this.changed = true;
  }

  focusSubject(id: SubjectId): void {
    this.focusTo(subjectById(id).distance, 'button');
  }

  /** Direct manipulation (slider): follow the target with a short, smooth lag. u is ladder space. */
  followFocusU(u: number, source: FocusSource): void {
    this.rebaseFocus();
    this.followU = clamp(u, this.uMin, 1);
    this.lastFocusSource = source;
    this.changed = true;
  }

  /** Direct manipulation without smoothing (focus ring: it must stay glued to the finger). */
  setFocusDistance(distance: number, source: FocusSource): void {
    this.followU = null;
    this.focusU.set(clamp(depthMap.toU(Math.max(distance, this.minFocus)), this.uMin, 1));
    this.lastFocusSource = source;
    this.changed = true;
  }

  setAperture(n: number): void {
    // start from the f-number on screen (wide open it follows the zoom, not the stored stops)
    const from = this.fNumber;
    this.wideOpen = n <= this.maxAperture * 1.01;
    const target = clamp(n, this.maxAperture, this.minAperture);
    this.apertureTarget = target;
    this.stops.set(toStops(from));
    this.stops.start(toStops(target), 0.5 + Math.abs(toStops(target) - toStops(from)) * 0.09, easeInOutCubic);
    this.changed = true;
  }

  /** Animate the zoom ring to position z (0 = widest). */
  zoomTo(z: number, duration?: number): void {
    const t = clamp(z, 0, 1);
    this.followZoom = null;
    this.zoomT.start(t, duration ?? 0.6 + Math.abs(t - this.zoomT.value) * 0.9);
    this.changed = true;
  }

  /** Direct manipulation of the zoom ring (slider / drag). */
  followZoomTo(z: number): void {
    this.followZoom = clamp(z, 0, 1);
    this.changed = true;
  }

  setExploded(on: boolean): void {
    this.exploded = on;
    this.explodeT.start(on ? 1 : 0, 1.9, (t) => t);
    this.changed = true;
  }

  update(dt: number): boolean {
    let moved = false;
    const k = 1 - Math.exp(-dt * 16);
    if (this.followU !== null) {
      const next = this.focusU.value + (this.followU - this.focusU.value) * k;
      if (Math.abs(this.followU - next) < 1e-5) {
        this.focusU.set(this.followU);
        this.followU = null;
      } else {
        this.focusU.set(next);
      }
      moved = true;
    }
    if (this.followZoom !== null) {
      const next = this.zoomT.value + (this.followZoom - this.zoomT.value) * k;
      if (Math.abs(this.followZoom - next) < 1e-5) {
        this.zoomT.set(this.followZoom);
        this.followZoom = null;
      } else {
        this.zoomT.set(next);
      }
      moved = true;
    }
    moved = this.focusU.update(dt) || moved;
    moved = this.stops.update(dt) || moved;
    moved = this.zoomT.update(dt) || moved;
    moved = this.explodeT.update(dt) || moved;
    if (moved) this.changed = true;
    return moved;
  }
}
