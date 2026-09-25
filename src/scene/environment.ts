import * as THREE from 'three';
import { makeCanvas } from '../util/textures';

/**
 * Procedural "product studio" environment: a near-black cyclorama with a few large
 * soft boxes and strip lights. Rendered once into a PMREM so glass and metal get crisp,
 * contrasty reflections (the look of a studio product shot).
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 top = vec3(0.045, 0.05, 0.06);
          vec3 horizon = vec3(0.02, 0.022, 0.028);
          vec3 floorC = vec3(0.006, 0.006, 0.007);
          vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.7)) : mix(horizon, floorC, pow(-y, 0.5));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  env.add(dome);

  const panel = (w: number, h: number, color: THREE.ColorRepresentation, intensity: number) => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
    m.color.multiplyScalar(intensity);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  };

  // Large overhead soft box (key)
  const top = panel(22, 12, '#fff4e6', 5.5);
  top.position.set(4, 22, 6);
  top.lookAt(0, 0, 0);
  env.add(top);

  // Tall strip lights left and right → long vertical highlights on glass and metal
  const left = panel(3, 26, '#eef2ff', 6);
  left.position.set(-24, 8, 8);
  left.lookAt(0, 4, 0);
  env.add(left);

  const right = panel(3, 26, '#fff0e0', 4.5);
  right.position.set(24, 8, 4);
  right.lookAt(0, 4, 0);
  env.add(right);

  // Cool rim from behind
  const rim = panel(30, 3, '#b8d2ff', 3.5);
  rim.position.set(0, 10, -24);
  rim.lookAt(0, 2, 0);
  env.add(rim);

  // Soft front fill (dim) so dark metal still reads
  const fill = panel(30, 10, '#ffffff', 0.9);
  fill.position.set(0, 6, 26);
  fill.lookAt(0, 2, 0);
  env.add(fill);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  env.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}

/** Screen-space background: a soft radial studio gradient. */
export function createBackdropTexture(): THREE.Texture {
  const [c, x] = makeCanvas(1024, 1024);
  const g = x.createRadialGradient(560, 430, 40, 512, 520, 760);
  g.addColorStop(0, '#1a2130');
  g.addColorStop(0.35, '#0e131c');
  g.addColorStop(0.7, '#07090e');
  g.addColorStop(1, '#030406');
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 1024);
  // subtle dither to avoid banding
  const img = x.getImageData(0, 0, 1024, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 3;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
