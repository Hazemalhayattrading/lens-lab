import * as THREE from 'three';
import { SUBJECTS, type SubjectId } from '../../optics/config';
import type { OpticsFrame } from '../../lab/optics';
import { convergenceOffset } from '../../optics/lensModel';
import { depthMap, LAYOUT, OPTICAL_CENTER_X } from '../layout';
import { GlowLines } from './GlowLines';

export const SUBJECT_COLORS = Object.fromEntries(SUBJECTS.map((s) => [s.id, new THREE.Color(s.color)])) as Record<SubjectId, THREE.Color>;

const EDGE_RAYS = 14;
/** Points per traced ray: source, one per optical surface (max), sensor hit. */
const MAX_POINTS = 2 + 64;
/** Most bundles drawn at once (the ones nearest the plane of focus). */
export const MAX_BUNDLES = 4;

/** What the ray tracer needs from the mounted lens. */
export interface SurfaceInfo {
  /** World X of the surface vertex. */
  x: number;
  /** World X of the surface at height r from the axis. */
  xAt: (r: number) => number;
  radius: number;
}
export interface RayLens {
  /** World X of the aperture stop (the iris). */
  readonly stopX: number;
  /** Radius of the current iris opening, world units. */
  readonly apertureRadius: number;
  /** Optical surfaces in world space, front (subject side) to rear. */
  getSurfaces(out: SurfaceInfo[]): SurfaceInfo[];
  /**
   * Height of a ray at world X ÷ its height at the iris (optional). In front of the iris the rays
   * fan out to the entrance pupil: wider than the iris in a telephoto, narrower in a retrofocus.
   */
  pupilScale?(x: number): number;
}

const discVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const discFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uSharp;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float disc = 1.0 - smoothstep(0.9, 1.0, r);
  float rim = exp(-pow((r - 0.9) / 0.07, 2.0));
  float blur = disc * 0.45 + rim * 1.3;
  float core = exp(-r * r * 60.0) * 3.0 + exp(-r * r * 8.0) * 0.5;
  float glint = (exp(-abs(p.x) * 40.0) * exp(-abs(p.y) * 3.5) + exp(-abs(p.y) * 40.0) * exp(-abs(p.x) * 3.5)) * 0.9;
  float k = mix(blur, core + glint, uSharp);
  gl_FragColor = vec4(uColor * k * uOpacity, 1.0);
}`;

const coneVertex = /* glsl */ `
attribute float density;
varying float vDensity;
varying vec3 vN;
varying vec3 vV;
void main() {
  vDensity = density;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const coneFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vDensity;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float edge = 0.35 + 0.65 * pow(1.0 - facing, 1.5);
  float k = uOpacity * sqrt(clamp(vDensity, 0.25, 9.0)) * edge;
  gl_FragColor = vec4(uColor * k, 1.0);
}`;

function glowSprite(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Bundle {
  id: SubjectId;
  source: THREE.Vector3;
  color: THREE.Color;
  cone: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  disc: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  marker: THREE.Sprite;
  imageMarker: THREE.Sprite;
  /** Where the rays converge (world). */
  image: THREE.Vector3;
  /** Centre of the blur disc on the sensor (world). */
  hitCenter: THREE.Vector3;
  discRadius: number;
  imageBehindSensor: boolean;
  /** 0..1 fade (bundles fade in and out as the lens / framing changes). */
  fade: number;
  active: boolean;
}

/** Normalised position of a world point in the sensor view (−1…1 across the frame; |v| > 1 = outside). */
export function framePosition(p: THREE.Vector3, fovH: number, fovV: number): { x: number; y: number } {
  const dx = Math.max(1e-4, p.x - OPTICAL_CENTER_X);
  return {
    x: (p.z - LAYOUT.axisZ) / dx / Math.tan(fovH / 2),
    y: (p.y - LAYOUT.axisY) / dx / Math.tan(fovV / 2),
  };
}

/**
 * Light from the diorama subjects, traced through the lens to the sensor. Entry rays run from the
 * subject to points on the iris; inside the lens the path is shared by the element surfaces;
 * behind the iris each cone converges where the thin-lens model puts the image — solved so that
 * it cuts the sensor in a disc of exactly the subject's circle of confusion, at the spot where the
 * subject appears in the sensor view (PLAN.md, Phase 2 decision 6).
 */
export class RayBundles {
  readonly group = new THREE.Group();
  readonly lines = new GlowLines(MAX_BUNDLES * (EDGE_RAYS + 1) * (MAX_POINTS - 1), { width: 2.2, intensity: 1.35, pulse: 1.6 });
  readonly ghost = new GlowLines(MAX_BUNDLES * EDGE_RAYS, { width: 1.4, intensity: 0.5, depthTest: false, pulse: 0 });
  readonly bundles: Bundle[] = [];
  private readonly surfaces: SurfaceInfo[] = [];
  private readonly coneK = 12;

  constructor(sources: { id: SubjectId; position: THREE.Vector3 }[]) {
    this.group.name = 'rays';
    this.group.add(this.lines.mesh, this.ghost.mesh);
    const glow = glowSprite();
    for (const s of sources) {
      const color = SUBJECT_COLORS[s.id];
      const K = this.coneK;
      const coneGeo = new THREE.BufferGeometry();
      coneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EDGE_RAYS * K * 3), 3).setUsage(THREE.DynamicDrawUsage));
      coneGeo.setAttribute('density', new THREE.BufferAttribute(new Float32Array(EDGE_RAYS * K), 1).setUsage(THREE.DynamicDrawUsage));
      const idx: number[] = [];
      for (let j = 0; j < EDGE_RAYS; j++) {
        const jn = (j + 1) % EDGE_RAYS;
        for (let k = 0; k < K - 1; k++) {
          const a = j * K + k;
          const b = jn * K + k;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      coneGeo.setIndex(idx);
      const cone = new THREE.Mesh(
        coneGeo,
        new THREE.ShaderMaterial({
          vertexShader: coneVertex,
          fragmentShader: coneFragment,
          uniforms: { uColor: { value: color }, uOpacity: { value: 0.05 } },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      cone.frustumCulled = false;
      cone.renderOrder = 9;

      const discGeo = new THREE.PlaneGeometry(1, 1);
      discGeo.rotateY(Math.PI / 2);
      const disc = new THREE.Mesh(
        discGeo,
        new THREE.ShaderMaterial({
          vertexShader: discVertex,
          fragmentShader: discFragment,
          uniforms: { uColor: { value: color }, uSharp: { value: 0 }, uOpacity: { value: 1.6 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      disc.renderOrder = 11;

      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: color.clone().multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      marker.scale.setScalar(0.2);
      marker.position.copy(s.position);
      marker.renderOrder = 12;
      const imageMarker = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glow, color: color.clone().multiplyScalar(1.4), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false }),
      );
      imageMarker.scale.setScalar(0.1);
      imageMarker.renderOrder = 13;

      this.group.add(cone, disc, marker, imageMarker);
      this.bundles.push({
        id: s.id,
        source: s.position.clone(),
        color,
        cone,
        disc,
        marker,
        imageMarker,
        image: new THREE.Vector3(),
        hitCenter: new THREE.Vector3(),
        discRadius: 0,
        imageBehindSensor: false,
        fade: 0,
        active: false,
      });
    }
  }

  setResolution(w: number, h: number): void {
    this.lines.setResolution(w, h);
    this.ghost.setResolution(w, h);
  }

  /** Subjects that get a bundle: in the frame, nearest the plane of focus first. */
  static pick(o: OpticsFrame): Set<SubjectId> {
    const uf = depthMap.toU(o.focusDistance);
    const list = o.subjects
      .filter((s) => s.inFrame)
      .sort((a, b) => Math.abs(depthMap.toU(a.distance) - uf) - Math.abs(depthMap.toU(b.distance) - uf))
      .slice(0, MAX_BUNDLES);
    return new Set(list.map((s) => s.id));
  }

  update(o: OpticsFrame, lens: RayLens, sensorSize: { w: number; h: number }, time: number, dt: number, show: Set<SubjectId>, highlight: SubjectId | null, master = 1): void {
    const kL = LAYOUT.kLateral;
    const axisY = LAYOUT.axisY;
    const axisZ = LAYOUT.axisZ;
    const xL = lens.stopX;
    const xS = LAYOUT.sensorX;
    const D = xL - xS;
    lens.getSurfaces(this.surfaces);
    const surfaces = this.surfaces;
    const pupil = lens.pupilScale ? (x: number) => lens.pupilScale!(x) : null;
    const xFront = surfaces.length ? surfaces[0].x : xL + 0.5;
    const xRear = surfaces.length ? surfaces[surfaces.length - 1].x - 0.2 : xL - 0.5;
    const apertureR = Math.max(0.004, lens.apertureRadius);
    const rayR = apertureR * 0.96;

    this.lines.begin();
    this.ghost.begin();
    this.lines.setTime(time);

    const Lin = new THREE.Vector3();
    const Lout = new THREE.Vector3();
    const pointAt = (x: number, P: THREE.Vector3, Q: THREE.Vector3, I: THREE.Vector3, out: THREE.Vector3) => {
      Lin.subVectors(Q, P).multiplyScalar((x - P.x) / (Q.x - P.x)).add(P);
      Lout.subVectors(I, Q).multiplyScalar((x - Q.x) / (I.x - Q.x)).add(Q);
      const t = THREE.MathUtils.clamp((xFront - x) / Math.max(1e-4, xFront - xRear), 0, 1);
      const w = t * t * (3 - 2 * t);
      return out.lerpVectors(Lin, Lout, w);
    };
    const k = 1 - Math.exp(-dt * 6);

    for (const b of this.bundles) {
      b.active = show.has(b.id);
      b.fade += ((b.active ? 1 : 0) - b.fade) * (dt > 5 ? 1 : k);
      const on = b.fade > 0.01 && master > 0.01;
      b.cone.visible = on;
      b.disc.visible = on;
      b.marker.visible = on;
      b.imageMarker.visible = on;
      if (!on) continue;
      const subj = o.subjects.find((s) => s.id === b.id)!;
      const emphasis = (highlight === null || highlight === b.id ? 1 : 0.35) * b.fade * master;

      // where the subject appears in the sensor view → where its image lands on the sensor (inverted)
      const P = b.source;
      const fp = framePosition(P, o.fovHorizontal, o.fovVertical);
      const H = b.hitCenter.set(xS, axisY - fp.y * sensorSize.h * 0.5, axisZ - fp.x * sensorSize.w * 0.5);
      // exact blur disc on the sensor (lateral scale) and the convergence point that produces it
      const discD = subj.coc * kL;
      const far = subj.cocSigned > 0;
      const a = Math.max(convergenceOffset(discD, apertureR, D, far), -D * 8);
      const Q0 = new THREE.Vector3(xL, axisY, axisZ);
      const I = b.image.copy(H).sub(Q0).multiplyScalar((xS + a - xL) / (xS - xL)).add(Q0);
      b.imageBehindSensor = I.x < xS;

      const conePos = b.cone.geometry.getAttribute('position') as THREE.BufferAttribute;
      const coneDen = b.cone.geometry.getAttribute('density') as THREE.BufferAttribute;
      const K = this.coneK;

      const chiefAt = new THREE.Vector3();
      const place = (x: number, Q: THREE.Vector3, s: SurfaceInfo, p: THREE.Vector3) => {
        pointAt(x, P, Q, I, p);
        if (pupil && Q !== Q0) {
          // spread the ray away from the chief ray towards the entrance pupil (inside the glass)
          pointAt(x, P, Q0, I, chiefAt);
          const d = p.distanceTo(chiefAt);
          const m = Math.min(pupil(x), (s.radius * 0.95) / Math.max(1e-6, d));
          p.sub(chiefAt).multiplyScalar(m).add(chiefAt);
        }
        return p;
      };
      const trace = (rho: number, phi: number): THREE.Vector3[] => {
        const Q = rho === 0 ? Q0 : new THREE.Vector3(xL, axisY + rho * Math.sin(phi), axisZ + rho * Math.cos(phi));
        const pts: THREE.Vector3[] = [P.clone()];
        for (const s of surfaces) {
          const p = new THREE.Vector3();
          let x = s.x;
          for (let it = 0; it < 2; it++) {
            place(x, Q, s, p);
            const r = Math.hypot(p.y - axisY, p.z - axisZ);
            x = s.xAt(Math.min(r, s.radius));
          }
          place(x, Q, s, p);
          pts.push(p);
        }
        if (!surfaces.length) pts.push(Q.clone());
        pts.push(new THREE.Vector3().subVectors(I, Q).multiplyScalar((xS - Q.x) / (I.x - Q.x)).add(Q));
        return pts;
      };
      /** Resample a traced ray to K points for the cone surface. */
      const resample = (pts: THREE.Vector3[], out: THREE.Vector3[]) => {
        out.length = 0;
        for (let i = 0; i < K; i++) {
          const t = (i / (K - 1)) * (pts.length - 1);
          const i0 = Math.min(pts.length - 2, Math.floor(t));
          out.push(new THREE.Vector3().lerpVectors(pts[i0], pts[i0 + 1], t - i0));
        }
        return out;
      };

      const chief = trace(0, 0);
      this.lines.addPolyline(chief, b.color, 0.55 * emphasis, 0, 0.8);
      const chiefK = resample(chief, []);
      const tmp: THREE.Vector3[] = [];
      for (let j = 0; j < EDGE_RAYS; j++) {
        const phi = (j / EDGE_RAYS) * Math.PI * 2 + 0.2;
        const pts = trace(rayR, phi);
        this.lines.addPolyline(pts, b.color, 0.9 * emphasis, 0, 1);
        const hit = pts[pts.length - 1];
        if (b.imageBehindSensor) this.ghost.add(hit, I, b.color, 0.5 * emphasis, 0, 1, 1);
        resample(pts, tmp);
        for (let q = 0; q < K; q++) {
          conePos.setXYZ(j * K + q, tmp[q].x, tmp[q].y, tmp[q].z);
          const local = tmp[q].distanceTo(chiefK[q]);
          coneDen.setX(j * K + q, local < 1e-4 ? 9 : Math.pow(rayR / local, 2));
        }
      }
      conePos.needsUpdate = true;
      coneDen.needsUpdate = true;
      b.cone.geometry.computeVertexNormals();
      b.cone.material.uniforms.uOpacity.value = 0.045 * emphasis;

      const radius = discD / 2;
      b.discRadius = radius;
      const sharp = THREE.MathUtils.clamp(1 - radius / 0.012, 0, 1);
      const size = Math.max(radius * 2 * 1.08, 0.07 * sharp + radius * 2 * (1 - sharp) * 1.08, 0.012);
      b.disc.scale.set(1, size, size);
      b.disc.position.set(xS + 0.004, H.y, H.z);
      b.disc.material.uniforms.uSharp.value = sharp;
      b.disc.material.uniforms.uOpacity.value = 1.8 * emphasis;

      b.imageMarker.position.copy(I);
      (b.imageMarker.material as THREE.SpriteMaterial).opacity = (b.imageBehindSensor ? 0.55 : 0.9) * emphasis * (sharp > 0.95 ? 0 : 1);
      (b.marker.material as THREE.SpriteMaterial).opacity = emphasis;
    }
    this.lines.end();
    this.ghost.end();
  }
}
