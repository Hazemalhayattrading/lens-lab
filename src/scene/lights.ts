import * as THREE from 'three';

export interface LabLights {
  group: THREE.Group;
  key: THREE.SpotLight;
  /** Warm "set light" that rakes across the diorama like a low evening sun. */
  sun: THREE.SpotLight;
  setShadowQuality(size: number, enabled: boolean): void;
}

export function createLights(): LabLights {
  const group = new THREE.Group();
  group.name = 'lights';

  // Key: large soft spot from high front-right
  const key = new THREE.SpotLight('#fff3e4', 1400, 0, 0.46, 1, 2);
  key.position.set(1.2, 13.5, 6.5);
  key.target.position.set(0.9, 0.8, -0.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 6;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 6;
  group.add(key, key.target);

  // Cool rim light from behind-left: separates silhouettes from the dark background
  const rim = new THREE.DirectionalLight('#9ec4ff', 1.35);
  rim.position.set(-8, 7, -10);
  rim.target.position.set(0, 1, 0);
  group.add(rim, rim.target);

  // Warm low "sun": a far, tight spot that only rakes across the diorama (no spill on the lab)
  const sun = new THREE.SpotLight('#ffc27f', 1900, 0, 0.24, 0.55, 2);
  sun.position.set(19.5, 6.8, -8.5);
  sun.target.position.set(5.9, 1.55, -0.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 26;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  group.add(sun, sun.target);

  // Very low ambient so shadows never go fully black
  const hemi = new THREE.HemisphereLight('#b9c8e6', '#0b0a09', 0.35);
  group.add(hemi);

  // Lights must illuminate every render layer (main + sensor camera).
  group.traverse((o) => o.layers.enableAll());

  return {
    group,
    key,
    sun,
    setShadowQuality(size: number, enabled: boolean) {
      for (const l of [key, sun]) {
        l.castShadow = enabled;
        if (l.shadow.mapSize.x !== size) {
          l.shadow.mapSize.set(size, size);
          l.shadow.map?.dispose();
          (l.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
        }
      }
    },
  };
}
