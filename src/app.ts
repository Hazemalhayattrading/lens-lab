import * as THREE from 'three';
import { MainPipeline } from './render/MainPipeline';
import { createBench, createHardwareMaterials, createLensCradle } from './scene/bench';
import { LensAssembly } from './scene/lens/LensAssembly';
import { LENS } from './optics/config';
import { computeOptics } from './optics/opticsState';
import { createCameraRig } from './scene/cameraRig';
import { createBackdropTexture, createStudioEnvironment } from './scene/environment';
import { LAYOUT, OPTICAL_CENTER_X } from './scene/layout';
import { createLights } from './scene/lights';
import { createSensorStand, type SensorStand } from './scene/sensorStand';
import { Diorama } from './scene/diorama/Diorama';
import { FocusPlane } from './scene/focusPlane';
import { applyFocusOverlayTo } from './scene/focusOverlay';
import { RayBundles } from './scene/rays/RayBundles';

export class LensLabApp {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly rig;
  private readonly pipeline: MainPipeline;
  private readonly timer = new THREE.Timer();
  private readonly container: HTMLElement;
  readonly lens: LensAssembly;
  readonly sensor: SensorStand;
  readonly diorama: Diorama;
  readonly focusPlane = new FocusPlane();
  readonly rays: RayBundles;
  /** Minimal state until the full state machine lands (Phase 7). */
  readonly state = { focus: 2000, fNumber: 5.6, explode: 1 };
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

    this.sensor = createSensorStand(hw);
    this.scene.add(this.sensor.group);

    this.diorama = new Diorama();
    this.scene.add(this.diorama.group);
    applyFocusOverlayTo(this.diorama.group);
    this.scene.add(this.focusPlane.group);
    this.rays = new RayBundles(this.diorama.subjects);
    this.scene.add(this.rays.group);

    const maxAperture = (LENS.focalLength / 2 / 2) * LAYOUT.kLateral;
    this.lens = new LensAssembly(OPTICAL_CENTER_X, LAYOUT.axisY, LAYOUT.axisZ, maxAperture);
    this.scene.add(this.lens.group);
    this.scene.add(createLensCradle(hw, OPTICAL_CENTER_X - 0.1, LAYOUT.axisY, 1.122));

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.rig = createCameraRig(renderer.domElement, aspect);
    this.pipeline = new MainPipeline(renderer, this.scene, this.rig.camera, 4);
    this.pipeline.setSize(container.clientWidth, container.clientHeight);
    this.updateLineResolution();

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

  private updateLineResolution(): void {
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rays.setResolution(v.x, v.y);
    this.focusPlane.lines.setResolution(v.x, v.y);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / Math.max(1, h));
    this.pipeline.setSize(w, h);
    this.updateLineResolution();
  }

  private frame(fixedDt?: number): void {
    this.timer.update();
    const dt = fixedDt ?? Math.min(this.timer.getDelta(), 0.1);
    this.t += dt;
    const debug = (window as unknown as { __lensDebug?: { explode?: number; f?: number; focus?: number } }).__lensDebug;
    if (debug) {
      if (debug.explode !== undefined) this.state.explode = debug.explode;
      if (debug.focus !== undefined) this.state.focus = debug.focus;
      if (debug.f !== undefined) this.state.fNumber = debug.f;
    }
    const o = computeOptics(this.state.focus, this.state.fNumber);
    this.lens.setExploded(this.state.explode);
    this.lens.setFocus(o.extension * LAYOUT.kAxial, o.ringAngle);
    this.lens.setAperture((LENS.focalLength / o.fNumber / 2) * LAYOUT.kLateral, o.fNumber);
    this.rays.update(o, this.lens, this.t, { cabin: true, trees: true, mountain: true }, null);
    this.focusPlane.update(o, this.t, { focus: true, zone: true, frustum: true });
    this.rig.update(dt);
    this.pipeline.render(dt);
  }
}
