import * as THREE from 'three';

/**
 * Instanced screen-space "glow" segments. Each segment is a camera-facing quad with a soft
 * core + halo, drawn additively (so it blooms). A per-vertex distance along the ray drives
 * travelling light pulses that show the direction light flows (subject → lens → sensor).
 */
const vertexShader = /* glsl */ `
uniform vec2 uResolution;
uniform float uWidth;
attribute vec3 instanceStart;
attribute vec3 instanceEnd;
attribute vec4 instanceColor;
attribute vec3 instanceDist; // x: dist at start, y: dist at end, z: width scale
varying vec4 vColor;
varying float vDist;
varying float vAcross;

void trimSegment(const in vec4 start, inout vec4 end) {
  float a = projectionMatrix[2][2];
  float b = projectionMatrix[3][2];
  float nearEstimate = -0.5 * b / a;
  float alpha = (nearEstimate - start.z) / (end.z - start.z);
  end.xyz = mix(start.xyz, end.xyz, alpha);
}

void main() {
  vec4 start = modelViewMatrix * vec4(instanceStart, 1.0);
  vec4 end = modelViewMatrix * vec4(instanceEnd, 1.0);
  if (start.z < 0.0 && end.z >= 0.0) trimSegment(start, end);
  else if (end.z < 0.0 && start.z >= 0.0) trimSegment(end, start);
  vec4 clipStart = projectionMatrix * start;
  vec4 clipEnd = projectionMatrix * end;
  vec2 ndcStart = clipStart.xy / clipStart.w;
  vec2 ndcEnd = clipEnd.xy / clipEnd.w;
  float aspect = uResolution.x / uResolution.y;
  vec2 dir = ndcEnd - ndcStart;
  dir.x *= aspect;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 offset = vec2(dir.y, -dir.x);
  offset.x /= aspect;
  vec2 along = dir;
  along.x /= aspect;
  float halfW = uWidth * instanceDist.z / uResolution.y;
  vec4 clip = position.x < 0.5 ? clipStart : clipEnd;
  // extend each end by half a width so consecutive segments join without gaps
  float cap = position.x < 0.5 ? -1.0 : 1.0;
  clip.xy += (offset * position.y + along * cap * 0.5) * halfW * clip.w;
  gl_Position = clip;
  vAcross = position.y;
  vDist = mix(instanceDist.x, instanceDist.y, position.x);
  vColor = instanceColor;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uPulseFreq;
uniform float uPulseSpeed;
uniform float uPulseAmount;
varying vec4 vColor;
varying float vDist;
varying float vAcross;
void main() {
  float a = clamp(1.0 - vAcross * vAcross, 0.0, 1.0);
  float core = pow(a, 10.0);
  float halo = pow(a, 2.0) * 0.28;
  float pulse = pow(0.5 + 0.5 * cos(6.2831853 * (vDist * uPulseFreq - uTime * uPulseSpeed)), 14.0);
  float k = (core + halo) * (1.0 + uPulseAmount * pulse);
  gl_FragColor = vec4(vColor.rgb * k * uIntensity * vColor.a, 1.0);
}
`;

export class GlowLines {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly material: THREE.ShaderMaterial;
  private readonly aStart: THREE.InstancedBufferAttribute;
  private readonly aEnd: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aDist: THREE.InstancedBufferAttribute;
  private count = 0;

  constructor(
    readonly capacity: number,
    opts: { width?: number; intensity?: number; depthTest?: boolean; pulse?: number; renderOrder?: number } = {},
  ) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aStart = mk(3);
    this.aEnd = mk(3);
    this.aColor = mk(4);
    this.aDist = mk(3);
    geo.setAttribute('instanceStart', this.aStart);
    geo.setAttribute('instanceEnd', this.aEnd);
    geo.setAttribute('instanceColor', this.aColor);
    geo.setAttribute('instanceDist', this.aDist);
    geo.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uWidth: { value: opts.width ?? 2.5 },
        uTime: { value: 0 },
        uIntensity: { value: opts.intensity ?? 1 },
        uPulseFreq: { value: 0.55 },
        uPulseSpeed: { value: 0.55 },
        uPulseAmount: { value: opts.pulse ?? 1.4 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: opts.depthTest ?? true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      // screen-aligned quads: their winding depends on the segment's direction, never cull them
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 10;
  }

  begin(): void {
    this.count = 0;
  }

  add(a: THREE.Vector3, b: THREE.Vector3, color: THREE.Color, alpha: number, d0: number, d1: number, widthScale = 1): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.aStart.setXYZ(i, a.x, a.y, a.z);
    this.aEnd.setXYZ(i, b.x, b.y, b.z);
    this.aColor.setXYZW(i, color.r, color.g, color.b, alpha);
    this.aDist.setXYZ(i, d0, d1, widthScale);
  }

  /** Adds a polyline; returns the cumulative length. */
  addPolyline(points: THREE.Vector3[], color: THREE.Color, alpha: number, startDist = 0, widthScale = 1): number {
    let d = startDist;
    for (let k = 0; k + 1 < points.length; k++) {
      const seg = points[k].distanceTo(points[k + 1]);
      this.add(points[k], points[k + 1], color, alpha, d, d + seg, widthScale);
      d += seg;
    }
    return d;
  }

  end(): void {
    this.mesh.geometry.instanceCount = this.count;
    for (const a of [this.aStart, this.aEnd, this.aColor, this.aDist]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  setResolution(w: number, h: number): void {
    this.material.uniforms.uResolution.value.set(w, h);
  }

  setTime(t: number): void {
    this.material.uniforms.uTime.value = t;
  }
}
