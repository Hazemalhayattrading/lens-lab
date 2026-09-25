import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraRig {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Smoothly fly to a view (position + target). */
  flyTo(position: THREE.Vector3, target: THREE.Vector3, duration?: number): void;
  update(dt: number): void;
  setAspect(aspect: number): void;
  isAnimating(): boolean;
}

const TARGET_BOUNDS = new THREE.Box3(new THREE.Vector3(-4.5, 0.4, -2), new THREE.Vector3(6.5, 3.2, 2));

/** Desktop and portrait framings of the bench. */
export const VIEWS = {
  hero: { position: new THREE.Vector3(0.6, 5.4, 12.4), target: new THREE.Vector3(1.0, 1.35, 0) },
  heroPortrait: { position: new THREE.Vector3(0.9, 9.5, 21), target: new THREE.Vector3(0.7, 1.3, 0) },
};

export function createCameraRig(dom: HTMLElement, aspect: number): CameraRig {
  const camera = new THREE.PerspectiveCamera(32, aspect, 0.1, 150);
  camera.layers.enable(0);
  camera.layers.enable(1);
  const view = aspect < 0.9 ? VIEWS.heroPortrait : VIEWS.hero;
  camera.position.copy(view.position);

  const controls = new OrbitControls(camera, dom);
  controls.target.copy(view.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  controls.panSpeed = 0.6;
  controls.minDistance = 3.2;
  controls.maxDistance = 30;
  controls.minPolarAngle = 0.28;
  controls.maxPolarAngle = 1.46;
  controls.minAzimuthAngle = -1.45;
  controls.maxAzimuthAngle = 1.45;
  controls.screenSpacePanning = true;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.update();

  // keep the pivot on the bench
  controls.addEventListener('change', () => {
    const t = controls.target;
    const clamped = t.clone().clamp(TARGET_BOUNDS.min, TARGET_BOUNDS.max);
    if (!clamped.equals(t)) {
      const d = clamped.sub(t);
      t.add(d);
      camera.position.add(d);
    }
  });

  let fly: {
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPos: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
    duration: number;
  } | null = null;

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  return {
    camera,
    controls,
    flyTo(position, target, duration = 1.6) {
      fly = {
        fromPos: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPos: position.clone(),
        toTarget: target.clone(),
        t: 0,
        duration,
      };
    },
    update(dt) {
      if (fly) {
        fly.t = Math.min(1, fly.t + dt / fly.duration);
        const k = ease(fly.t);
        camera.position.lerpVectors(fly.fromPos, fly.toPos, k);
        controls.target.lerpVectors(fly.fromTarget, fly.toTarget, k);
        if (fly.t >= 1) fly = null;
      }
      controls.update();
    },
    setAspect(a) {
      camera.aspect = a;
      camera.updateProjectionMatrix();
    },
    isAnimating() {
      return fly !== null;
    },
  };
}
