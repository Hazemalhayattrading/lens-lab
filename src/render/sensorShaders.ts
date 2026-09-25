/** GLSL for the physically-driven depth-of-field pipeline of the sensor view. */

export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * Per-pixel circle of confusion from depth:
 *   depth → axial distance from the perspective centre (view z) → world X → ladder position u
 *   → physical distance T from the focal plane: T = d_near·(1 − u)^(−1/γ)
 *   → object distance from the lens u_d = T − v_s → thin-lens CoC with the lens' effective focal
 *   length: b = f²(u_d − u_s) / (N (u_s − f) u_d)  [mm on the sensor]  → pixels (W / sensor width).
 */
export const cocChunk = /* glsl */ `
uniform float uNear;
uniform float uFar;
uniform float uCamX;
uniform float uXNear;
uniform float uXInf;
uniform float uDNear;    // ladder: distance at u = 0, mm from the focal plane
uniform float uGamma;    // ladder exponent
uniform float uF;        // effective focal length, mm
uniform float uN;
uniform float uUs;       // focused object distance from the lens, mm (< 0 means infinity)
uniform float uVs;       // lens → sensor, mm
uniform float uPxPerMm;  // full-resolution pixels per sensor millimetre
uniform float uMaxCoC;   // clamp, full-res pixels (diameter)

float linearDepth(float z) {
  float ndc = z * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear));
}

float physicalDistance(float axial) {
  float x = uCamX + axial;
  float u = (x - uXNear) / (uXInf - uXNear);
  if (u >= 1.0) return 1.0e9;
  return uDNear * pow(1.0 - u, -1.0 / uGamma);
}

float cocMm(float T) {
  if (T > 1.0e8) return uUs < 0.0 ? 0.0 : uF * uF / (uN * (uUs - uF));
  float ud = max(T - uVs, uF * 1.02);
  if (uUs < 0.0) return -uF * uF / (uN * ud);
  return uF * uF * (ud - uUs) / (uN * (uUs - uF) * ud);
}

/** Signed CoC diameter in full-resolution pixels (negative = nearer than focus). */
float cocPixels(float depthSample) {
  float d = physicalDistance(linearDepth(depthSample));
  return clamp(cocMm(d) * uPxPerMm, -uMaxCoC, uMaxCoC);
}
`;

/** Pass 1: half-resolution colour + signed CoC radius (in half-res pixels) in alpha. */
export const cocDownsampleFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
varying vec2 vUv;
${cocChunk}
void main() {
  vec2 o = uTexel * 0.5;
  vec2 uv0 = vUv + vec2(-o.x, -o.y);
  vec2 uv1 = vUv + vec2(o.x, -o.y);
  vec2 uv2 = vUv + vec2(-o.x, o.y);
  vec2 uv3 = vUv + vec2(o.x, o.y);
  vec3 c0 = texture2D(tColor, uv0).rgb;
  vec3 c1 = texture2D(tColor, uv1).rgb;
  vec3 c2 = texture2D(tColor, uv2).rgb;
  vec3 c3 = texture2D(tColor, uv3).rgb;
  float k0 = cocPixels(texture2D(tDepth, uv0).x);
  float k1 = cocPixels(texture2D(tDepth, uv1).x);
  float k2 = cocPixels(texture2D(tDepth, uv2).x);
  float k3 = cocPixels(texture2D(tDepth, uv3).x);
  float kmin = min(min(k0, k1), min(k2, k3));
  float kavg = 0.25 * (k0 + k1 + k2 + k3);
  // keep near-field blur dominant so foreground bokeh can spread over the background
  float k = kmin < -2.0 ? kmin : kavg;
  vec3 c = 0.25 * (c0 + c1 + c2 + c3);
  gl_FragColor = vec4(c, k * 0.25);
}`;

/** Pass 2: per-tile maximum near-field CoC radius (tile = 8×8 half-res pixels). */
export const tileMaxFragment = /* glsl */ `
uniform sampler2D tHalf;
uniform vec2 uHalfTexel;
varying vec2 vUv;
void main() {
  float m = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 off = (vec2(float(x), float(y)) - 1.5) * 2.0 * uHalfTexel;
      m = max(m, -texture2D(tHalf, vUv + off).a);
    }
  }
  gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
}`;

/** Pass 3: spread each tile's near CoC to every tile it can reach. */
export const tileDilateFragment = /* glsl */ `
uniform sampler2D tTile;
uniform vec2 uTileTexel;
uniform float uTileSize;
varying vec2 vUv;
void main() {
  float m = texture2D(tTile, vUv).r;
  for (int y = -5; y <= 5; y++) {
    for (int x = -5; x <= 5; x++) {
      vec2 d = vec2(float(x), float(y));
      float n = texture2D(tTile, vUv + d * uTileTexel).r;
      float reach = (max(abs(d.x), abs(d.y)) - 1.0) * uTileSize;
      if (n >= reach) m = max(m, n);
    }
  }
  gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
}`;

const gatherCommon = /* glsl */ `
const float GOLDEN = 2.39996323;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
/** i-th of n points of a golden-angle spiral in a unit iris-shaped disc. */
vec2 irisPoint(int i, int n, float rot, float seg, float polygon) {
  float fi = float(i) + 0.5;
  float r = sqrt(fi / float(n));
  float th = fi * GOLDEN + rot;
  float a = mod(th, seg) - seg * 0.5;
  r *= mix(1.0, cos(seg * 0.5) / cos(a), polygon);
  return vec2(cos(th), sin(th)) * r;
}
/** Mip level whose texels match the spacing of n samples spread over a disc of radius R. */
float lodFor(float R, int n) {
  return max(0.0, log2(R * 1.7725 / sqrt(float(n))) - 0.35);
}
`;

/**
 * Pass 4a: the pixel's own blur (background, midground and defocused foreground), gathered at half
 * resolution with an iris-shaped kernel. A background sample may never bleed over a sharper
 * foreground pixel; behind a defocused foreground pixel everything within its disc shows through
 * (the foreground blur is semi-transparent) — read from a mip level matched to the sample spacing,
 * so a small foreground object turns into a smooth veil instead of speckles.
 */
export const bokehFragment = /* glsl */ `
uniform sampler2D tHalf;
uniform vec2 uHalfTexel;
uniform float uMaxR;
uniform float uBlades;
uniform float uPolygon;
varying vec2 vUv;
${gatherCommon}
void main() {
  vec4 center = texture2D(tHalf, vUv);
  float c0 = center.a;
  float R = clamp(abs(c0), 0.0, uMaxR);
  if (R < 0.5) {
    gl_FragColor = vec4(center.rgb, 0.0);
    return;
  }
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float seg = 6.2831853 / uBlades;
  bool nearCentre = c0 < -0.5;
  float lod = nearCentre ? lodFor(R, SAMPLES) : 0.0;
  vec3 acc = center.rgb;
  float tot = 1.0;
  for (int i = 0; i < SAMPLES; i++) {
    vec2 o = irisPoint(i, SAMPLES, rot, seg, uPolygon) * R;
    float dist = length(o);
    vec4 s = textureLod(tHalf, vUv + o * uHalfTexel, lod);
    float w = 1.0;
    if (!nearCentre) {
      float sr = abs(s.a);
      if (s.a > c0) sr = min(sr, abs(c0) * 2.0 + 0.5);
      w = smoothstep(dist - 0.75, dist + 0.25, sr);
    }
    acc += s.rgb * w;
    tot += w;
  }
  gl_FragColor = vec4(acc / tot, smoothstep(0.35, 1.25, R));
}`;

/**
 * Pass 4b: foreground blur spreading over the pixel (premultiplied colour, coverage). Only samples
 * nearer than the pixel whose own blur disc reaches it count, weighted by (R/r)² — the density a
 * foreground point spreads over its disc (scatter-as-gather).
 */
export const nearGatherFragment = /* glsl */ `
uniform sampler2D tHalf;
uniform sampler2D tTile;
uniform vec2 uHalfTexel;
uniform float uMaxR;
uniform float uBlades;
uniform float uPolygon;
varying vec2 vUv;
${gatherCommon}
void main() {
  float c0 = texture2D(tHalf, vUv).a;
  float R = clamp(texture2D(tTile, vUv).r, 0.0, uMaxR);
  if (R < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float rot = ign(gl_FragCoord.xy + 17.0) * 6.2831853;
  float seg = 6.2831853 / uBlades;
  vec3 acc = vec3(0.0);
  float cover = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    vec2 o = irisPoint(i, SAMPLES, rot, seg, uPolygon) * R;
    float dist = length(o);
    vec4 s = texture2D(tHalf, vUv + o * uHalfTexel);
    float sr = -s.a;
    if (sr > 0.5 && s.a < c0 - 0.5) {
      float w = smoothstep(dist - 0.75, dist + 0.25, sr) * min(R * R / (sr * sr), 16.0);
      acc += s.rgb * w;
      cover += w;
    }
  }
  float alpha = clamp(cover / float(SAMPLES), 0.0, 1.0);
  gl_FragColor = cover > 0.0 ? vec4(acc / cover * alpha, alpha) : vec4(0.0);
}`;

/** Pass 4c: small tent filter on the (smooth, premultiplied) near layer to remove sampling noise. */
export const nearFilterFragment = /* glsl */ `
uniform sampler2D tNear;
uniform vec2 uHalfTexel;
varying vec2 vUv;
void main() {
  vec2 d = uHalfTexel * 1.5;
  vec4 c = texture2D(tNear, vUv) * 4.0;
  c += (texture2D(tNear, vUv + vec2(d.x, 0.0)) + texture2D(tNear, vUv - vec2(d.x, 0.0)) + texture2D(tNear, vUv + vec2(0.0, d.y)) + texture2D(tNear, vUv - vec2(0.0, d.y))) * 2.0;
  c += texture2D(tNear, vUv + d) + texture2D(tNear, vUv - d) + texture2D(tNear, vUv + vec2(d.x, -d.y)) + texture2D(tNear, vUv + vec2(-d.x, d.y));
  gl_FragColor = c / 16.0;
}`;

/** Pass 5: sharp full-resolution image ← own half-resolution blur ← foreground blur on top. */
export const compositeFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBlur;
uniform sampler2D tNear;
varying vec2 vUv;
${cocChunk}
void main() {
  vec3 sharp = texture2D(tColor, vUv).rgb;
  vec4 b = texture2D(tBlur, vUv);
  float k = cocPixels(texture2D(tDepth, vUv).x);
  float blend = max(smoothstep(1.0, 3.0, abs(k)), b.a);
  vec3 base = mix(sharp, b.rgb, blend);
  vec4 n = texture2D(tNear, vUv);
  gl_FragColor = vec4(base * (1.0 - n.a) + n.rgb, 1.0);
}`;

/** Display: ACES filmic (same curve as the main view), natural vignetting, grain, peaking. */
export const displayFragment = /* glsl */ `
uniform sampler2D tOut;
uniform sampler2D tHalf;
uniform vec2 uOutTexel;
uniform float uExposure;
uniform float uTime;
uniform float uPeaking;
uniform float uAcceptPx;   // acceptable CoC in full-res pixels
uniform vec3 uPeakColor;
varying vec2 vUv;

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= 1.0 / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 c = texture2D(tOut, vUv).rgb * uExposure;
  vec2 p = vUv - 0.5;
  float r2 = dot(p * vec2(1.5, 1.0), p * vec2(1.5, 1.0));
  c *= 1.0 - 0.5 * r2;
  c = aces(c);
  if (uPeaking > 0.5) {
    float l = luma(c);
    float lx = luma(aces(texture2D(tOut, vUv + vec2(uOutTexel.x, 0.0)).rgb * uExposure));
    float ly = luma(aces(texture2D(tOut, vUv + vec2(0.0, uOutTexel.y)).rgb * uExposure));
    float edge = length(vec2(lx - l, ly - l));
    float cocFull = abs(texture2D(tHalf, vUv).a) * 4.0;
    float inFocus = 1.0 - smoothstep(uAcceptPx, uAcceptPx * 1.8, cocFull);
    float peak = inFocus * smoothstep(0.035, 0.12, edge);
    c = mix(c, uPeakColor, clamp(peak * 1.3, 0.0, 1.0));
  }
  c += (hash(vUv * 1234.5 + fract(uTime)) - 0.5) * 0.018;
  gl_FragColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);
}`;
