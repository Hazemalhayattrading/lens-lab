import * as THREE from 'three';

export interface LabelSpec {
  className?: string;
  color?: string;
  html: string;
  /** Higher priority labels keep their spot when labels collide. */
  priority?: number;
}

interface Item {
  el: HTMLElement;
  opacity: number;
  target: number;
  lastHtml: string;
  priority: number;
  // layout of the current frame
  want: boolean;
  x: number;
  y: number;
  anchor: 'center' | 'left' | 'right';
  w: number;
  h: number;
  sizeDirty: boolean;
}

/** HTML labels pinned to 3D positions (projected every frame), with simple collision avoidance. */
export class LabelLayer {
  private readonly items = new Map<string, Item>();
  private readonly v = new THREE.Vector3();
  /** Labels whose anchor falls outside this rect (CSS px) are hidden (they would sit on panels). */
  safe: { left: number; top: number; right: number; bottom: number } | null = null;
  /** Screen rects labels must never cover (e.g. the filmstrip window). */
  exclusions: { l: number; t: number; r: number; b: number }[] = [];

  constructor(private readonly container: HTMLElement) {}

  ensure(id: string, spec: LabelSpec): HTMLElement {
    let item = this.items.get(id);
    if (!item) {
      const el = document.createElement('div');
      el.className = `label ${spec.className ?? ''}`;
      if (spec.color) el.style.color = spec.color;
      el.style.opacity = '0';
      this.container.appendChild(el);
      item = { el, opacity: 0, target: 0, lastHtml: '', priority: spec.priority ?? 0, want: false, x: 0, y: 0, anchor: 'center', w: 0, h: 0, sizeDirty: true };
      this.items.set(id, item);
    }
    if (spec.priority !== undefined) item.priority = spec.priority;
    if (item.lastHtml !== spec.html) {
      item.el.innerHTML = spec.html;
      item.lastHtml = spec.html;
      item.sizeDirty = true;
    }
    return item.el;
  }

  /** Requests label `id` at world point `p` (+ screen offset). Call `resolve()` after all places. */
  place(id: string, p: THREE.Vector3, camera: THREE.Camera, show: boolean, offset: [number, number] = [0, 0], anchor: 'center' | 'left' | 'right' = 'center'): void {
    const item = this.items.get(id);
    if (!item) return;
    this.v.copy(p).project(camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const behind = this.v.z > 1 || this.v.z < -1;
    item.x = (this.v.x * 0.5 + 0.5) * w + offset[0];
    item.y = (-this.v.y * 0.5 + 0.5) * h + offset[1];
    item.anchor = anchor;
    const r = this.safe ?? { left: 0, top: 0, right: w, bottom: h };
    const onScreen = !behind && item.x > r.left + 20 && item.x < r.right - 20 && item.y > r.top + 10 && item.y < r.bottom - 10;
    item.want = show && onScreen;
  }

  /** Removes label `id` for good (e.g. callouts of a lens that was unmounted). */
  remove(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    item.el.remove();
    this.items.delete(id);
  }

  hide(id: string): void {
    const item = this.items.get(id);
    if (item) item.want = false;
  }

  /** Resolves overlaps (lower priority labels move or hide) and writes the transforms. */
  resolve(): void {
    const placed: { l: number; t: number; r: number; b: number }[] = [...this.exclusions];
    const W = this.container.clientWidth;
    const H = this.container.clientHeight;
    const safe = this.safe ?? { left: 0, top: 0, right: W, bottom: H };
    const list = [...this.items.values()].sort((a, b) => b.priority - a.priority);
    for (const item of list) {
      if (item.sizeDirty) {
        item.w = item.el.offsetWidth;
        item.h = item.el.offsetHeight;
        item.sizeDirty = false;
      }
      if (!item.want) {
        item.target = 0;
        continue;
      }
      let left0 = item.anchor === 'center' ? item.x - item.w / 2 : item.anchor === 'left' ? item.x : item.x - item.w;
      // keep the whole label inside the free region
      left0 = Math.min(Math.max(left0, safe.left + 6), safe.right - item.w - 6);
      let top = item.y - item.h / 2;
      const box = (t: number) => ({ l: left0 - 3, t: t - 2, r: left0 + item.w + 3, b: t + item.h + 2 });
      const hit = (bb: { l: number; t: number; r: number; b: number }) => placed.some((p) => bb.l < p.r && bb.r > p.l && bb.t < p.b && bb.b > p.t);
      let ok = !hit(box(top));
      for (const dy of [item.h + 6, -(item.h + 6), 2 * (item.h + 6)]) {
        if (ok) break;
        if (!hit(box(item.y - item.h / 2 + dy))) {
          top = item.y - item.h / 2 + dy;
          ok = true;
        }
      }
      if (!ok) {
        item.target = 0;
        continue;
      }
      item.target = 1;
      placed.push(box(top));
      item.el.style.transform = `translate3d(${left0.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
    }
  }

  update(dt: number): void {
    this.resolve();
    const k = 1 - Math.exp(-dt * 9);
    for (const item of this.items.values()) {
      item.opacity += (item.target - item.opacity) * k;
      const o = item.opacity < 0.01 ? 0 : item.opacity;
      item.el.style.opacity = o.toFixed(3);
      item.el.style.visibility = o === 0 ? 'hidden' : 'visible';
    }
  }
}
