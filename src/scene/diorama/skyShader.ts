import * as THREE from 'three';
import { LAYOUT, OPTICAL_CENTER_X } from '../layout';

/**
 * Procedural dusk sky as a function of the viewing direction from the lens' perspective centre.
 * The same function paints the light-box behind the diorama (seen by everyone) and the sky dome
 * that only the sensor camera sees, so a 10 mm lens gets a seamless sky while a 600 mm lens gets
 * the same colours behind the bird.
 */
export const skyChunk = /* glsl */ `
uniform vec3 uSkyCentre;
uniform float uSkyTime;

float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = skyHash(i);
  float b = skyHash(i + vec2(1.0, 0.0));
  float c = skyHash(i + vec2(0.0, 1.0));
  float d = skyHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float skyFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * skyNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

vec3 skyGradient(float el) {
  // elevation (degrees) → colour: warm horizon, violet band, deep blue night above
  vec3 c = vec3(1.0, 0.886, 0.722);                                       // −6°
  c = mix(c, vec3(1.0, 0.765, 0.541), smoothstep(-6.0, -2.0, el));       // −2°
  c = mix(c, vec3(0.878, 0.529, 0.416), smoothstep(-2.0, 1.2, el));      //  1°
  c = mix(c, vec3(0.541, 0.353, 0.525), smoothstep(1.2, 4.2, el));       //  4°
  c = mix(c, vec3(0.231, 0.247, 0.471), smoothstep(4.2, 9.0, el));       //  9°
  c = mix(c, vec3(0.086, 0.141, 0.302), smoothstep(9.0, 18.0, el));      // 18°
  c = mix(c, vec3(0.043, 0.071, 0.165), smoothstep(18.0, 40.0, el));     // 40°
  c = mix(c, vec3(0.02, 0.035, 0.09), smoothstep(40.0, 90.0, el));       // zenith
  return c;
}

/** Linear-light sky colour for a world direction (normalised). px = angular size of a pixel (rad). */
vec3 skyColor(vec3 d, float px) {
  float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float az = degrees(atan(d.z, d.x));          // 0° = straight down the optical axis, + = right
  vec3 c = skyGradient(el);
  c = pow(c, vec3(2.2));                       // sRGB design colours → linear

  // warm glow where the sun has just set (right of the frame)
  float sun = exp(-pow((az - 28.0) / 22.0, 2.0)) * exp(-max(el + 1.0, 0.0) / 5.0);
  c += vec3(1.0, 0.55, 0.28) * sun * 0.35;

  // wispy clouds lit from below, near the horizon
  vec2 cp = vec2(az * 0.09, el * 0.55);
  float cl = skyFbm(cp * vec2(1.0, 3.2) + vec2(uSkyTime * 0.004, 0.0));
  float band = smoothstep(0.5, 3.5, el) * (1.0 - smoothstep(6.0, 13.0, el));
  float cloud = smoothstep(0.52, 0.8, cl) * band;
  vec3 cloudCol = mix(vec3(1.0, 0.62, 0.45), vec3(0.55, 0.38, 0.55), smoothstep(2.0, 11.0, el));
  c = mix(c, pow(cloudCol, vec3(2.2)) * 1.1, cloud * 0.55);

  // stars: one candidate per 0.35° cell, kept point-like at any focal length
  float starFade = smoothstep(4.0, 14.0, el) * (1.0 - cloud);
  vec2 sc = vec2(az, el) / 0.35;
  vec2 cell = floor(sc);
  float h = skyHash(cell);
  if (h > 0.982 && starFade > 0.0) {
    vec2 pos = cell + vec2(skyHash(cell + 3.1), skyHash(cell + 7.7));
    float distDeg = length((sc - pos) * 0.35);
    float sigma = max(degrees(px) * 0.9, 0.012);
    float b = pow(skyHash(cell + 1.3), 4.0);
    c += vec3(0.85, 0.9, 1.0) * exp(-distDeg * distDeg / (2.0 * sigma * sigma)) * (0.25 + 3.0 * b) * starFade;
  }

  // crescent moon
  vec2 mp = vec2(az + 13.0, el - 10.5);
  float r = length(mp);
  float disc = 1.0 - smoothstep(0.78, 0.84, r);
  float shadow = 1.0 - smoothstep(0.66, 0.72, length(mp - vec2(0.34, 0.2)));
  c += vec3(1.0, 0.95, 0.85) * max(disc - shadow, 0.0) * 3.0;
  c += vec3(1.0, 0.92, 0.8) * exp(-r * r / 8.0) * 0.07;
  return c;
}
`;

export const skyUniforms = {
  uSkyCentre: { value: new THREE.Vector3(OPTICAL_CENTER_X, LAYOUT.axisY, LAYOUT.axisZ) },
  uSkyTime: { value: 0 },
};

const vertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragment = /* glsl */ `
uniform float uSkyGain;
varying vec3 vWorld;
${skyChunk}
void main() {
  vec3 d = normalize(vWorld - uSkyCentre);
  float px = length(fwidth(d));
  gl_FragColor = vec4(skyColor(d, px) * uSkyGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Material that paints the procedural sky on any surface (light-box panel, dome). */
export function createSkyMaterial(side: THREE.Side, gain = 1.35): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { ...skyUniforms, uSkyGain: { value: gain } },
    side,
    depthWrite: true,
    fog: false,
  });
}
