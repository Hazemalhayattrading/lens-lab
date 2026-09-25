import * as THREE from 'three';
import { MainPipeline } from './render/MainPipeline';
import { createBench, createHardwareMaterials, createLensCradle, createPostOnCarrier } from './scene/bench';
import { LensAssembly } from './scene/lens/LensAssembly';
import { LENS } from './optics/config';
import { computeOptics } from './optics/opticsState';
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
  readonly lens: LensAssembly;
  private t = 0;

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

    const maxAperture = (LENS.focalLength / 2 / 2) * LAYOUT.kLateral;
    this.lens = new LensAssembly(OPTICAL_CENTER_X, LAYOUT.axisY, LAYOUT.axisZ, maxAperture);
    this.scene.add(this.lens.group);
    this.scene.add(createLensCradle(hw, OPTICAL_CENTER_X - 0.1, LAYOUT.axisY, 1.122));

    for (const d of [800, 2000, 8000]) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.8, 0.5),
        new THREE.MeshStandardMaterial({ color: '#8a6' }),
      );
      m.position.set(worldXForDistance(d), LAYOUT.axisY - 0.4, 0);
      m.castShadow = true;
      this.scene.add(m);
    }

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.rig = createCameraRig(renderer.domElement, aspect);
    this.pipeline = new MainPipeline(renderer, this.scene, this.rig.camera, 4);
    this.pipeline.setSize(container.clientWidth, container.clientHeight);

    window.addEventListener('resize', () => this.resize());
    this.capture = new URLSearchParams(location.search).has('capture');
    if (this.capture) {
      // Screenshot mode: render on demand only (software GL in CI is slow).
      this.frame();
    } else {
      renderer.setAnimationLoop(() => this.frame());
    }
  }

  private readonly capture: boolean;

  /** Render N frames synchronously (used by the screenshot tooling). */
  renderFrames(n = 1, dt = 1 / 60): number {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.frame(dt);
    return performance.now() - t0;
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / Math.max(1, h));
    this.pipeline.setSize(w, h);
  }

  private frame(fixedDt?: number): void {
    this.timer.update();
    const dt = fixedDt ?? Math.min(this.timer.getDelta(), 0.1);
    this.t += dt;
    // temporary demo animation (replaced by the state machine in Phase 7)
    const u = (Math.sin(this.t * 0.6) * 0.5 + 0.5);
    const s = 300 / Math.max(1e-3, u);
    const o = computeOptics(s, 5.6);
    this.lens.setFocus(o.extension * LAYOUT.kAxial, o.ringAngle);
    const debug = (window as unknown as { __lensDebug?: { explode?: number; f?: number; focus?: number } }).__lensDebug;
    if (debug) {
      if (debug.explode !== undefined) this.lens.setExploded(debug.explode);
      if (debug.focus !== undefined) {
        const od = computeOptics(debug.focus, debug.f ?? 5.6);
        this.lens.setFocus(od.extension * LAYOUT.kAxial, od.ringAngle);
      }
      if (debug.f !== undefined) this.lens.setAperture((LENS.focalLength / debug.f / 2) * LAYOUT.kLateral, debug.f);
    }
    this.rig.update(dt);
    this.pipeline.render(dt);
  }
}
