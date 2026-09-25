import * as THREE from 'three';

/**
 * Shared uniforms for the "plane of focus" overlay drawn on the diorama's own materials in
 * the main view: a glowing contour where the plane slices through the scene, and a faint tint
 * of the depth-of-field zone. Switched off while the sensor camera renders.
 */
export const focusOverlay = {
  uOverlayOn: { value: 1 },
  uFocusX: { value: 0 },
  uNearX: { value: 0 },
  uFarX: { value: 0 },
  uBandWidth: { value: 0.018 },
  uBandColor: { value: new THREE.Color('#62e7ff') },
  uZoneColor: { value: new THREE.Color('#3fb8ff') },
  uZoneStrength: { value: 0.07 },
  uBandStrength: { value: 3.2 },
};

export function applyFocusOverlay(material: THREE.Material): void {
  const m = material as THREE.MeshStandardMaterial;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    Object.assign(shader.uniforms, focusOverlay);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFocusWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 fw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fw = instanceMatrix * fw;
  #endif
  vFocusWorld = (modelMatrix * fw).xyz;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vFocusWorld;
uniform float uOverlayOn;
uniform float uFocusX;
uniform float uNearX;
uniform float uFarX;
uniform float uBandWidth;
uniform vec3 uBandColor;
uniform vec3 uZoneColor;
uniform float uZoneStrength;
uniform float uBandStrength;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if (uOverlayOn > 0.5) {
  float dx = (vFocusWorld.x - uFocusX) / uBandWidth;
  float band = exp(-dx * dx);
  float soft = 0.03;
  float zone = smoothstep(uNearX - soft, uNearX + soft, vFocusWorld.x) * (1.0 - smoothstep(uFarX - soft, uFarX + soft, vFocusWorld.x));
  totalEmissiveRadiance += uBandColor * band * uBandStrength + uZoneColor * zone * uZoneStrength;
}`,
      );
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (key ? key() : '') + '|focus-overlay';
  m.needsUpdate = true;
}

/** Applies the overlay to every standard/physical material under `root`. */
export function applyFocusOverlayTo(root: THREE.Object3D): void {
  const done = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (done.has(mat)) continue;
      if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        applyFocusOverlay(mat);
        done.add(mat);
      }
    }
  });
}
