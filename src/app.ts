import * as THREE from 'three';
import { MainPipeline } from './render/MainPipeline';
import { createBench, createHardwareMaterials, createPostOnCarrier } from './scene/bench';
import { createCameraRig } from './scene/cameraRig';
import { createBackdropTexture, createStudioEnvironment } from './scene/environment';
import { LAYOUT, OPTICAL_CENTER_X, SENSOR_H, SENSOR_W, worldXForDistance } from './scene/layout';
import { createLights } from './scene/lights';

export class LensLabApp {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly rig;
  private readonly pipeline: MainPipeline;
  private readonly timer = new THREE.Timer();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.classList.add('gl');
    this.renderer = renderer;

    this.scene.environment = createStudioEnvironment(renderer);
    this.scene.environmentIntensity = 0.9;
    this.scene.background = createBackdropTexture();

    const lights = createLights();
    this.scene.add(lights.group);

    const hw = createHardwareMaterials();
    this.scene.add(createBench(hw));

    // --- temporary placeholders (replaced in later phases) ---
    const sensorPost = createPostOnCarrier(hw, LAYOUT.sensorX, LAYOUT.axisY - SENSOR_H / 2 - 0.1);
    this.scene.add(sensorPost);
    const sensor = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, SENSOR_H + 0.3, SENSOR_W + 0.3),
      new THREE.MeshPhysicalMaterial({ color: '#202226', metalness: 0.5, roughness: 0.3 }),
    );
    sensor.position.set(LAYOUT.sensorX - 0.05, LAYOUT.axisY, 0);
    sensor.castShadow = true;
    this.scene.add(sensor);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 2.6, 64),
      new THREE.MeshPhysicalMaterial({ color: '#111', metalness: 0.8, roughness: 0.35 }),
    );
    lens.rotation.z = Math.PI / 2;
    lens.position.set(OPTICAL_CENTER_X, LAYOUT.axisY, 0);
    lens.castShadow = true;
    this.scene.add(lens);
    this.scene.add(createPostOnCarrier(hw, OPTICAL_CENTER_X, LAYOUT.axisY - 1.2));

    for (const d of [800, 2000, 8000]) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.8, 0.5),
        new THREE.MeshStandardMaterial({ color: '#8a6' }),
      );
      m.position.set(worldXForDistance(d), 1.5, 0);
      m.castShadow = true;
      this.scene.add(m);
    }

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.rig = createCameraRig(renderer.domElement, aspect);
    this.pipeline = new MainPipeline(renderer, this.scene, this.rig.camera, 4);
    this.pipeline.setSize(container.clientWidth, container.clientHeight);

    window.addEventListener('resize', () => this.resize());
    renderer.setAnimationLoop(() => this.frame());
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / Math.max(1, h));
    this.pipeline.setSize(w, h);
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.rig.update(dt);
    this.pipeline.render(dt);
  }
}
