import * as THREE from 'three';
import { LENS, SUBJECTS, type SubjectId } from '../../optics/config';
import type { OpticsState } from '../../optics/opticsState';
import { imageDistance } from '../../optics/thinLens';
import { LAYOUT, OPTICAL_CENTER_X } from '../layout';
import type { LensAssembly, SurfaceInfo } from '../lens/LensAssembly';
import { GlowLines } from './GlowLines';

export const SUBJECT_COLORS: Record<SubjectId, THREE.Color> = {
  cabin: new THREE.Color('#ffb04f'),
  trees: new THREE.Color('#5dffa2'),
  mountain: new THREE.Color('#8fb0ff'),
};

const EDGE_RAYS = 14;

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
  // defocused: bokeh disc with a bright rim
  float disc = 1.0 - smoothstep(0.9, 1.0, r);
  float rim = exp(-pow((r - 0.9) / 0.07, 2.0));
  float blur = disc * 0.45 + rim * 1.3;
  // in focus: a hot point with a small four-point glint
  float core = exp(-r * r * 60.0) * 3.0 + exp(-r * r * 8.0) * 0.5;
  float glint = (exp(-abs(p.x) * 40.0) * exp(-abs(p.y) * 3.5) + exp(-abs(p.y) * 40.0) * exp(-abs(p.x) * 3.5)) * 0.9;
  float sharp = core + glint;
  float k = mix(blur, sharp, uSharp);
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

interface Bundle {
  id: SubjectId;
  distance: number;
  source: THREE.Vector3;
  color: THREE.Color;
  cone: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  disc: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  marker: THREE.Sprite;
  imageMarker: THREE.Sprite;
  /** Latest computed values (for UI / labels). */
  image: THREE.Vector3;
  hitCenter: THREE.Vector3;
  discRadius: number;
  imageBehindSensor: boolean;
}

export interface BundleVisibility {
  cabin: boolean;
  trees: boolean;
  mountain: boolean;
}

export class RayBundles {
  readonly group = new THREE.Group();
  readonly lines = new GlowLines(1400, { width: 2.2, intensity: 1.35, pulse: 1.6 });
  readonly ghost = new GlowLines(300, { width: 1.4, intensity: 0.5, depthTest: false, pulse: 0 });
  readonly bundles: Bundle[] = [];
  private readonly surfaces: SurfaceInfo[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(sources: { id: SubjectId; position: THREE.Vector3 }[]) {
    this.group.name = 'rays';
    this.group.add(this.lines.mesh, this.ghost.mesh);
    const glow = glowSprite();

    for (const s of sources) {
      const subject = SUBJECTS.find((x) => x.id === s.id)!;
      const color = SUBJECT_COLORS[s.id];
      // cone surface: EDGE_RAYS rays × 14 points
      const K = 14;
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
      marker.scale.setScalar(0.22);
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
        distance: subject.distance,
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
      });
    }
  }

  setResolution(w: number, h: number): void {
    this.lines.setResolution(w, h);
    this.ghost.setResolution(w, h);
  }

  update(o: OpticsState, lens: LensAssembly, time: number, show: BundleVisibility, highlight: SubjectId | null): void {
    const f = LENS.focalLength;
    const kA = LAYOUT.kAxial;
    const kL = LAYOUT.kLateral;
    const axisY = LAYOUT.axisY;
    const axisZ = LAYOUT.axisZ;
    const xL = lens.stopX;
    const xS = LAYOUT.sensorX;
    lens.getSurfaces(this.surfaces);
    const surfaces = this.surfaces;
    const xFront = surfaces[0].x;
    const xRear = surfaces[surfaces.length - 1].x - 0.2;
    const apertureR = (kL * (f / o.fNumber)) / 2;
    const rayR = apertureR * 0.96;

    this.lines.begin();
    this.ghost.begin();
    this.lines.setTime(time);

    const Lin = new THREE.Vector3();
    const Lout = new THREE.Vector3();
    const pointAt = (x: number, P: THREE.Vector3, Q: THREE.Vector3, I: THREE.Vector3, out: THREE.Vector3) => {
      Lin.subVectors(Q, P).multiplyScalar((x - P.x) / (Q.x - P.x)).add(P);
      Lout.subVectors(I, Q).multiplyScalar((x - Q.x) / (I.x - Q.x)).add(Q);
      const t = THREE.MathUtils.clamp((xFront - x) / (xFront - xRear), 0, 1);
      const w = t * t * (3 - 2 * t);
      return out.lerpVectors(Lin, Lout, w);
    };

    for (const b of this.bundles) {
      const visible = show[b.id];
      b.cone.visible = visible;
      b.disc.visible = visible;
      b.marker.visible = visible;
      b.imageMarker.visible = visible;
      if (!visible) continue;
      const emphasis = highlight === null || highlight === b.id ? 1 : 0.35;

      const P = b.source;
      const vd = imageDistance(f, b.distance);
      const tanY = (P.y - axisY) / (P.x - OPTICAL_CENTER_X);
      const tanZ = (P.z - axisZ) / (P.x - OPTICAL_CENTER_X);
      const I = b.image.set(xL - kA * vd, axisY - kL * vd * tanY, axisZ - kL * vd * tanZ);
      b.imageBehindSensor = I.x < xS;

      const conePos = b.cone.geometry.getAttribute('position') as THREE.BufferAttribute;
      const coneDen = b.cone.geometry.getAttribute('density') as THREE.BufferAttribute;
      const chiefPts: THREE.Vector3[] = [];

      const trace = (rho: number, phi: number): THREE.Vector3[] => {
        const Q = new THREE.Vector3(xL, axisY + rho * Math.sin(phi), axisZ + rho * Math.cos(phi));
        const pts: THREE.Vector3[] = [P.clone()];
        for (const s of surfaces) {
          const p = new THREE.Vector3();
          let x = s.x;
          for (let it = 0; it < 2; it++) {
            pointAt(x, P, Q, I, p);
            const r = Math.hypot(p.y - axisY, p.z - axisZ);
            x = s.xAt(Math.min(r, s.radius));
          }
          pointAt(x, P, Q, I, p);
          pts.push(p);
        }
        // exit ray to the sensor plane
        const hit = new THREE.Vector3().subVectors(I, Q).multiplyScalar((xS - Q.x) / (I.x - Q.x)).add(Q);
        pts.push(hit);
        return pts;
      };

      // chief ray
      const chief = trace(0, 0);
      chiefPts.push(...chief);
      this.lines.addPolyline(chief, b.color, 0.55 * emphasis, 0, 0.8);
      b.hitCenter.copy(chief[chief.length - 1]);

      for (let j = 0; j < EDGE_RAYS; j++) {
        const phi = (j / EDGE_RAYS) * Math.PI * 2 + 0.2;
        const pts = trace(rayR, phi);
        this.lines.addPolyline(pts, b.color, 0.9 * emphasis, 0, 1);
        const hit = pts[pts.length - 1];
        if (b.imageBehindSensor) {
          this.ghost.add(hit, I, b.color, 0.5 * emphasis, 0, 1, 1);
        }
        for (let k = 0; k < pts.length; k++) {
          conePos.setXYZ(j * pts.length + k, pts[k].x, pts[k].y, pts[k].z);
          const local = pts[k].distanceTo(chiefPts[k]);
          coneDen.setX(j * pts.length + k, local < 1e-4 ? 9 : Math.pow(rayR / local, 2));
        }
      }
      conePos.needsUpdate = true;
      coneDen.needsUpdate = true;
      b.cone.geometry.computeVertexNormals();
      b.cone.material.uniforms.uOpacity.value = 0.045 * emphasis;

      // blur disc on the sensor (exact CoC, lateral scale)
      const subj = o.subjects.find((s) => s.id === b.id)!;
      const radius = (kL * subj.coc) / 2;
      b.discRadius = radius;
      const minSize = 0.07;
      const sharp = THREE.MathUtils.clamp(1 - radius / 0.012, 0, 1);
      const size = Math.max(radius * 2 * 1.08, minSize * sharp + radius * 2 * (1 - sharp) * 1.08, 0.012);
      b.disc.scale.set(1, size, size);
      b.disc.position.set(xS + 0.004, b.hitCenter.y, b.hitCenter.z);
      b.disc.material.uniforms.uSharp.value = sharp;
      b.disc.material.uniforms.uOpacity.value = 1.8 * emphasis;

      // where the rays actually converge
      b.imageMarker.position.copy(I);
      (b.imageMarker.material as THREE.SpriteMaterial).opacity = (b.imageBehindSensor ? 0.55 : 0.9) * emphasis * (sharp > 0.95 ? 0 : 1);
      (b.marker.material as THREE.SpriteMaterial).opacity = emphasis;
    }
    this.lines.end();
    this.ghost.end();
    void this.tmp;
  }
}
