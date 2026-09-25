import * as THREE from 'three';

/**
 * Adds a faint fresnel rim glow to a physical glass material. In a dark studio, glass is read
 * almost entirely through its edges; this mimics the edge-lit ("dark-field") look of optics
 * photography without extra lights.
 */
export function addGlassRim(material: THREE.MeshPhysicalMaterial, color = new THREE.Color('#bfeaff'), strength = 0.22): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: color };
    shader.uniforms.uRimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uRimColor;
uniform float uRimStrength;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  float rimNdV = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
  float rim = pow(1.0 - rimNdV, 4.0);
  outgoingLight += uRimColor * rim * uRimStrength;
}
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'glass-rim';
}
