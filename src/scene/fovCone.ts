import * as THREE from 'three';
import { LAYOUT, OPTICAL_CENTER_X } from './layout';
import { GlowLines } from './rays/GlowLines';

const vertex = /* glsl */ `
attribute float along;
varying float vAlong;
varying vec3 vWorld;
void main() {
  vAlong = along;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uAxisY;
uniform float uFloorY;
uniform float uTime;
varying float vAlong;
varying vec3 vWorld;
void main() {
  if (vWorld.y < uFloorY) discard;
  // fade in from the lens, fade out towards infinity and far off to the sides
  float a = smoothstep(0.0, 0.08, vAlong) * (1.0 - smoothstep(0.7, 1.0, vAlong));
  float lateral = max(abs(vWorld.z), abs(vWorld.y - uAxisY) * 1.4);
  a *= 1.0 - smoothstep(3.2, 6.0, lateral);
  // faint travelling scan lines: the view "flows" out of the lens
  float scan = 0.75 + 0.25 * sin((vAlong * 26.0 - uTime * 1.2) * 6.2831);
  gl_FragColor = vec4(uColor * a * uOpacity * scan, 1.0);
}`;

/**
 * The lens' field of view as a cone (a rectangular pyramid, like the sensor) starting at the
 * perspective centre: drawn from the front of the lens to infinity. A 16 mm lens opens it to
 * ~97° × 74°, a 600 mm lens closes it to a 3.4° × 2.3° needle.
 */
export class FovCone {
  readonly group = new THREE.Group();
  readonly lines = new GlowLines(24, { width: 1.5, intensity: 1, pulse: 0 });
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly pos: THREE.BufferAttribute;
  private readonly color = new THREE.Color('#bcd4ff');
  private readonly edgeColor = new THREE.Color('#d7e6ff');
  /** World X where the cone ends (for labels). */
  endX = 0;
  /** Half extents at the cone end. */
  endHalfW = 0;
  endHalfH = 0;
  opacity = 1;

  constructor(floorY: number) {
    this.group.name = 'fov-cone';
    const geo = new THREE.BufferGeometry();
    // 4 side faces, each a quad from the near rectangle to the far rectangle (subdivided along)
    const STEPS = 12;
    const verts = 4 * (STEPS + 1) * 2;
    this.pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const along = new Float32Array(verts);
    const idx: number[] = [];
    for (let f = 0; f < 4; f++) {
      for (let s = 0; s <= STEPS; s++) {
        const i = (f * (STEPS + 1) + s) * 2;
        along[i] = along[i + 1] = s / STEPS;
        if (s < STEPS) idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
    geo.setAttribute('position', this.pos);
    geo.setAttribute('along', new THREE.BufferAttribute(along, 1));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uColor: { value: this.color },
          uOpacity: { value: 0.05 },
          uAxisY: { value: LAYOUT.axisY },
          uFloorY: { value: floorY },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.group.add(this.mesh, this.lines.mesh);
  }

  /**
   * @param fovH, fovV full angles (radians)
   * @param startX world X of the lens front (the cone is drawn from here)
   */
  update(fovH: number, fovV: number, startX: number, time: number): void {
    const cx = OPTICAL_CENTER_X;
    const tx = Math.tan(fovH / 2);
    const ty = Math.tan(fovV / 2);
    const x0 = Math.max(startX, cx + 0.05);
    const x1 = cx + LAYOUT.xInfRel;
    this.endX = x1;
    this.endHalfW = (x1 - cx) * tx;
    this.endHalfH = (x1 - cx) * ty;
    const STEPS = 12;
    // faces: top (+y), right (+z), bottom (−y), left (−z); corners go around the rectangle
    const corners: [number, number][] = [
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ];
    const at = (x: number, sy: number, sz: number, out: THREE.Vector3) =>
      out.set(x, LAYOUT.axisY + sy * (x - cx) * ty, LAYOUT.axisZ + sz * (x - cx) * tx);
    const p = new THREE.Vector3();
    for (let f = 0; f < 4; f++) {
      const [ay, az] = corners[f];
      const [by, bz] = corners[(f + 1) % 4];
      for (let s = 0; s <= STEPS; s++) {
        const x = x0 + ((x1 - x0) * s) / STEPS;
        const i = (f * (STEPS + 1) + s) * 2;
        at(x, ay, az, p);
        this.pos.setXYZ(i, p.x, p.y, p.z);
        at(x, by, bz, p);
        this.pos.setXYZ(i + 1, p.x, p.y, p.z);
      }
    }
    this.pos.needsUpdate = true;
    this.mesh.material.uniforms.uTime.value = time;
    this.mesh.material.uniforms.uOpacity.value = 0.055 * this.opacity;

    // edges (fade with the same lateral limit as the faces)
    this.lines.begin();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const lateral = Math.max(this.endHalfW, this.endHalfH * 1.4);
    // clip the edges where the faces have faded out
    const xClip = lateral > 5.2 ? cx + 5.2 / Math.max(tx, ty * 1.4) : x1;
    for (const [sy, sz] of corners) {
      at(x0, sy, sz, a);
      at(xClip, sy, sz, b);
      this.lines.add(a, b, this.edgeColor, 0.3 * this.opacity, 0, 1);
    }
    if (xClip >= x1 - 1e-6) {
      for (let f = 0; f < 4; f++) {
        const [ay, az] = corners[f];
        const [by, bz] = corners[(f + 1) % 4];
        at(x1, ay, az, a);
        at(x1, by, bz, b);
        this.lines.add(a, b, this.edgeColor, 0.22 * this.opacity, 0, 1);
      }
    }
    this.lines.end();
  }

  setResolution(w: number, h: number): void {
    this.lines.setResolution(w, h);
  }
}
