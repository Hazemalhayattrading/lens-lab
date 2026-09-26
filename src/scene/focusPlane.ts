import * as THREE from 'three';
import type { LensState } from '../optics/lensModel';
import { DIORAMA, PLINTH_TOP } from './diorama/terrain';
import { focusOverlay } from './focusOverlay';
import { LAYOUT, OPTICAL_CENTER_X, worldXForDistance } from './layout';
import { GlowLines } from './rays/GlowLines';

const planeVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const planeFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uFill;
uniform float uRim;
uniform float uGrid;
uniform vec2 uSize;
uniform float uTime;
uniform float uDashed;
uniform float uFloorY;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  if (vWorld.y < uFloorY) discard;
  vec2 p = vUv * uSize;                       // world units across the plane
  vec2 edge = min(p, uSize - p);
  float d = min(edge.x, edge.y);
  float rim = exp(-d * 90.0);
  float dash = uDashed > 0.5 ? step(0.5, fract((p.x + p.y) * 7.0)) : 1.0;
  vec2 g = abs(fract(p * 4.0 - 0.5) - 0.5) / fwidth(p * 4.0);
  float grid = 1.0 - min(min(g.x, g.y), 1.0);
  float scan = 0.5 + 0.5 * sin((p.y * 3.0 - uTime * 0.6) * 6.2831);
  float a = uFill * (0.75 + 0.25 * scan) + uGrid * grid + uRim * rim * dash;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

function planeMaterial(color: THREE.Color, fill: number, rim: number, grid: number, dashed: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: planeVertex,
    fragmentShader: planeFragment,
    uniforms: {
      uColor: { value: color },
      uFill: { value: fill },
      uRim: { value: rim },
      uGrid: { value: grid },
      uSize: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uDashed: { value: dashed ? 1 : 0 },
      uFloorY: { value: PLINTH_TOP },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * The plane of focus (glowing, inside the diorama) and the near/far limits of the sharp zone.
 * Each plane is the slice of the lens' field of view at that distance — exactly the patch of the
 * world that lands on the sensor — clamped to the diorama for very wide lenses.
 */
export class FocusPlane {
  readonly group = new THREE.Group();
  private readonly focus: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly near: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly far: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly lines = new GlowLines(32, { width: 1.6, intensity: 1, pulse: 0 });
  private readonly zoneColor = new THREE.Color('#58d6ff');
  /** World X of the current plane of focus (useful for labels). */
  focusX = 0;
  nearX = 0;
  farX = 0;
  focusHalfHeight = 1;
  focusHalfWidth = 1;

  constructor() {
    this.group.name = 'focus-plane';
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateY(Math.PI / 2); // face ±X
    const cyan = new THREE.Color('#57dcff');
    this.focus = new THREE.Mesh(geo, planeMaterial(cyan.clone(), 0.07, 2.4, 0.06, false));
    this.near = new THREE.Mesh(geo, planeMaterial(new THREE.Color('#57dcff'), 0.012, 0.9, 0.0, true));
    this.far = new THREE.Mesh(geo, planeMaterial(new THREE.Color('#57dcff'), 0.012, 0.9, 0.0, true));
    for (const m of [this.focus, this.near, this.far]) {
      m.renderOrder = 8;
      this.group.add(m);
    }
    this.group.add(this.lines.mesh);
  }

  /** Half extents of the field of view at world X (clamped to the diorama). */
  private extents(x: number, o: LensState): [number, number] {
    const dist = Math.max(0.05, x - OPTICAL_CENTER_X);
    const hw = Math.min(dist * Math.tan(o.fovHorizontal / 2), DIORAMA.halfWidthAt(dist) + 0.15);
    const hh = Math.min(dist * Math.tan(o.fovVertical / 2), 2.45);
    return [hw, hh];
  }

  private placePlane(mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>, x: number, o: LensState): [number, number] {
    const [hw, hh] = this.extents(x, o);
    mesh.position.set(x, LAYOUT.axisY, LAYOUT.axisZ);
    mesh.scale.set(1, hh * 2, hw * 2);
    mesh.material.uniforms.uSize.value.set(hw * 2, hh * 2);
    return [hw, hh];
  }

  update(o: LensState, time: number, visible: { focus: boolean; zone: boolean }): void {
    const xMax = OPTICAL_CENTER_X + LAYOUT.xInfRel;
    const fx = Math.min(worldXForDistance(o.focusDistance), xMax);
    const nx = Math.min(worldXForDistance(o.near), xMax);
    const farX = Math.min(worldXForDistance(o.far), xMax);
    this.focusX = fx;
    this.nearX = nx;
    this.farX = farX;
    [this.focusHalfWidth, this.focusHalfHeight] = this.placePlane(this.focus, fx, o);
    this.placePlane(this.near, nx, o);
    this.placePlane(this.far, farX, o);
    this.focus.visible = visible.focus;
    this.near.visible = visible.zone && Math.abs(nx - fx) > 0.004;
    this.far.visible = visible.zone && Math.abs(farX - fx) > 0.004 && farX < xMax - 0.002;
    for (const m of [this.focus, this.near, this.far]) m.material.uniforms.uTime.value = time;

    focusOverlay.uFocusX.value = visible.focus ? fx : -1e5;
    focusOverlay.uNearX.value = nx;
    focusOverlay.uFarX.value = visible.zone ? (Number.isFinite(o.far) ? farX : 1e5) : -1e5;

    // edges of the depth-of-field slab
    this.lines.begin();
    if (visible.zone && Math.abs(farX - nx) > 0.01) {
      const [nw, nh] = this.extents(nx, o);
      const [fw, fh] = this.extents(farX, o);
      for (const sz of [1, -1]) {
        const a = new THREE.Vector3(nx, LAYOUT.axisY + nh, LAYOUT.axisZ + sz * nw);
        const b = new THREE.Vector3(farX, LAYOUT.axisY + fh, LAYOUT.axisZ + sz * fw);
        this.lines.add(a, b, this.zoneColor, 0.55, 0, 1);
      }
    }
    this.lines.end();
  }
}
