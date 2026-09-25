import * as THREE from 'three';
import { FocusRingDrag } from './interaction/FocusRingDrag';
import { LENS, SUBJECTS, type SubjectId } from './optics/config';
import { computeOptics, type OpticsState } from './optics/opticsState';
import { MainPipeline } from './render/MainPipeline';
import { AutoQuality, initialQuality, isLikelyMobile, QUALITY, type QualityLevel } from './render/quality';
import { SensorPipeline } from './render/SensorPipeline';
import { createBench, createHardwareMaterials, createLensCradle } from './scene/bench';
import { createCameraRig, VIEWS, type CameraRig } from './scene/cameraRig';
import { Diorama } from './scene/diorama/Diorama';
import { createBackdropTexture, createStudioEnvironment } from './scene/environment';
import { applyFocusOverlayTo, focusOverlay } from './scene/focusOverlay';
import { FocusPlane } from './scene/focusPlane';
import { LAYOUT, OPTICAL_CENTER_X, SENSOR_H } from './scene/layout';
import { LensAssembly } from './scene/lens/LensAssembly';
import { createLights, type LabLights } from './scene/lights';
import { RayBundles } from './scene/rays/RayBundles';
import { createSensorStand, type SensorStand } from './scene/sensorStand';
import { LabState } from './state/LabState';
import { fmtCoc, fmtDistance, fmtF } from './ui/format';
import { LabelLayer } from './ui/labels';
import { UI, type CameraPreset, type QualityChoice } from './ui/UI';

const PRESETS: Record<CameraPreset, { position: THREE.Vector3; target: THREE.Vector3 }> = {
  hero: VIEWS.hero,
  lens: { position: new THREE.Vector3(3.3, 4.9, 7.8), target: new THREE.Vector3(0.1, 2.55, -0.4) },
  sensor: { position: new THREE.Vector3(-0.75, 2.75, 3.45), target: new THREE.Vector3(-3.55, 1.85, 0) },
  diorama: { position: new THREE.Vector3(1.7, 4.7, 7.6), target: new THREE.Vector3(5.9, 1.75, -0.3) },
};

const SUBJECT_CSS: Record<SubjectId, string> = { cabin: 'var(--cabin)', trees: 'var(--trees)', mountain: 'var(--mountain)' };

export class LensLabApp {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly state = new LabState();
  readonly lens: LensAssembly;
  readonly sensor: SensorStand;
  readonly diorama: Diorama;
  readonly focusPlane = new FocusPlane();
  readonly rays: RayBundles;
  readonly sensorView: SensorPipeline;
  readonly rig: CameraRig;
  readonly ui: UI;
  private readonly pipeline: MainPipeline;
  private readonly lights: LabLights;
  private readonly labels: LabelLayer;
  private readonly ring: FocusRingDrag;
  private readonly auto: AutoQuality;
  private readonly timer = new THREE.Timer();
  private readonly container: HTMLElement;
  private readonly capture: boolean;
  private quality: QualityLevel;
  private qualityChoice: QualityChoice = 'auto';
  private t = 0;
  private highlight: SubjectId | null = null;
  private ringUsed = false;
  private lastShadowKey = '';
  /** Latest optics (exposed for debugging / tests). */
  optics: OpticsState;
  private sensorWidth = 0;
  private sensorImage: THREE.Texture | null = null;
  private portrait: boolean;
  /** Frames rendered so far (the loader fades once the first frames are on screen). */
  frameCount = 0;
  /** Overridable filmstrip rect (debug / screenshots). */
  filmstripRect: { x: number; y: number; width: number; height: number } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.capture = new URLSearchParams(location.search).has('capture');
    this.quality = initialQuality();
    const preset = QUALITY[this.quality];

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxDpr));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.transmissionResolutionScale = preset.transmissionScale;
    renderer.domElement.classList.add('gl');
    renderer.domElement.setAttribute('aria-label', '3D optics bench: sensor, lens and diorama');
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    // ---- world ----
    this.scene.environment = createStudioEnvironment(renderer);
    this.scene.environmentIntensity = 0.9;
    this.scene.background = createBackdropTexture();
    this.lights = createLights();
    this.lights.setShadowQuality(preset.shadowSize, preset.shadows);
    this.scene.add(this.lights.group);

    const hw = createHardwareMaterials();
    this.scene.add(createBench(hw));
    this.sensor = createSensorStand(hw);
    this.scene.add(this.sensor.group);
    const maxAperture = (LENS.focalLength / 2 / 2) * LAYOUT.kLateral;
    this.lens = new LensAssembly(OPTICAL_CENTER_X, LAYOUT.axisY, LAYOUT.axisZ, maxAperture);
    this.scene.add(this.lens.group);
    this.scene.add(createLensCradle(hw, OPTICAL_CENTER_X - 0.1, LAYOUT.axisY, 1.122));
    this.diorama = new Diorama();
    this.scene.add(this.diorama.group);
    applyFocusOverlayTo(this.diorama.group);
    this.scene.add(this.focusPlane.group);
    this.rays = new RayBundles(this.diorama.subjects);
    this.scene.add(this.rays.group);

    this.sensorView = new SensorPipeline({ width: 960, samples: preset.sensorSamples, msaa: preset.sensorMsaa });
    this.sensor.setImage(this.sensorView.output, 1.1);

    // ---- camera + post ----
    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.portrait = aspect < 0.9;
    this.rig = createCameraRig(renderer.domElement, aspect);
    this.pipeline = new MainPipeline(renderer, this.scene, this.rig.camera, preset.msaa);
    this.pipeline.setSize(container.clientWidth, container.clientHeight);

    // ---- state: start focused at ∞ and glide to the trees during the intro ----
    this.state.setFocusDistance(Infinity, 'init');
    this.state.setAperture(2);
    this.optics = computeOptics(this.state.focusDistance, this.state.fNumber);

    // ---- UI ----
    this.ui = new UI(document.body, {
      onSlider: (u) => this.state.followFocusU(u, 'slider'),
      onFocusSubject: (id) => this.state.focusSubject(id),
      onFocusDistance: (mm) => this.state.focusTo(mm),
      onAperture: (n) => this.state.setAperture(n),
      onExploded: (on) => this.state.setExploded(on),
      onQuality: (q) => this.setQualityChoice(q),
      onCamera: (p) => this.flyToPreset(p),
      onPeaking: (on) => (this.sensorView.matDisplay.uniforms.uPeaking.value = on ? 1 : 0),
      onHighlight: (id) => (this.highlight = id),
    });
    this.labels = new LabelLayer(this.ui.root.querySelector('.labels')!);

    this.ring = new FocusRingDrag(renderer.domElement, this.rig.camera, this.rig.controls, this.lens, () => this.state.focusDistance);
    this.ring.onFocus = (d) => this.state.setFocusDistance(d, 'ring');
    this.ring.onDragStart = () => (this.ringUsed = true);

    this.auto = new AutoQuality(this.quality, (level) => this.applyQuality(level));
    this.updateLineResolution();
    this.updateSafeArea();

    window.addEventListener('resize', () => this.resize());
    if (this.capture) {
      this.auto.enabled = false;
      this.state.setFocusDistance(2000, 'init');
      this.frame(1 / 60);
    } else {
      this.startIntro();
      renderer.setAnimationLoop(() => this.frame());
    }
  }

  // ------------------------------------------------------------------ intro / camera
  private startIntro(): void {
    const view = this.portrait ? VIEWS.heroPortrait : VIEWS.hero;
    const offset = view.position.clone().sub(view.target);
    this.rig.camera.position.copy(view.target).add(offset.multiplyScalar(1.55)).add(new THREE.Vector3(-2, 3.5, 0));
    this.rig.controls.target.copy(view.target).add(new THREE.Vector3(1.2, 0.4, 0));
    this.rig.flyTo(view.position, view.target, 3.2);
    window.setTimeout(() => this.state.focusTo(2000, 'init', 2.4), 900);
  }

  flyToPreset(p: CameraPreset): void {
    const preset = PRESETS[p];
    let pos = preset.position.clone();
    const target = preset.target.clone();
    if (p === 'hero' && this.portrait) {
      pos = VIEWS.heroPortrait.position.clone();
      target.copy(VIEWS.heroPortrait.target);
    } else if (this.portrait) {
      pos = target.clone().add(preset.position.clone().sub(preset.target).multiplyScalar(1.75));
    }
    this.rig.flyTo(pos, target, 1.6);
  }

  // ------------------------------------------------------------------ quality
  private setQualityChoice(q: QualityChoice): void {
    this.qualityChoice = q;
    if (q === 'auto') {
      this.auto.enabled = true;
      this.auto.set(this.quality);
    } else {
      this.auto.enabled = false;
      this.applyQuality(q);
    }
  }

  private applyQuality(level: QualityLevel): void {
    this.quality = level;
    const p = QUALITY[level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.maxDpr));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
    this.renderer.transmissionResolutionScale = p.transmissionScale;
    this.pipeline.setMultisampling(p.msaa);
    this.pipeline.setSize(this.container.clientWidth, this.container.clientHeight);
    this.lights.setShadowQuality(p.shadowSize, p.shadows);
    this.lastShadowKey = '';
    this.sensorWidth = 0; // re-evaluate sensor resolution
    this.updateLineResolution();
    if (this.qualityChoice === 'auto') this.ui.setQuality('auto');
  }

  /** Render the sensor view at (roughly) the resolution it is displayed at. */
  private updateSensorResolution(): void {
    const p = QUALITY[this.quality];
    const wanted = Math.min(p.sensorMaxWidth, Math.max(480, this.ui.filmDisplayWidth()));
    const bucket = Math.ceil(wanted / 120) * 120;
    if (bucket !== this.sensorWidth) {
      this.sensorWidth = bucket;
      this.sensorView.setQuality({ width: bucket, samples: p.sensorSamples, msaa: p.sensorMsaa });
    }
  }

  // ------------------------------------------------------------------ sizing
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
    this.updateSafeArea();
    const portrait = w / Math.max(1, h) < 0.9;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.flyToPreset('hero');
    }
  }

  private updateSafeArea(): void {
    const area = this.ui.safeArea();
    this.rig.setSafeArea(area, this.container.clientWidth, this.container.clientHeight);
    this.labels.safe = area;
  }

  /** Advance animations by `seconds` without rendering, then render one frame (test tooling). */
  advance(seconds: number): void {
    const steps = Math.ceil(seconds / 0.02);
    for (let i = 0; i < steps; i++) {
      this.state.update(0.02);
      this.rig.update(0.02);
    }
    this.frame(1 / 60);
  }

  /** Render N frames synchronously (used by the screenshot tooling). */
  renderFrames(n = 1, dt = 1 / 60): number {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.frame(dt);
    return performance.now() - t0;
  }

  // ------------------------------------------------------------------ frame
  private frame(fixedDt?: number): void {
    this.timer.update();
    const dt = fixedDt ?? Math.min(this.timer.getDelta(), 0.1);
    this.t += dt;
    this.frameCount++;

    const debug = (window as unknown as { __lensDebug?: { explode?: number; f?: number; focus?: number } }).__lensDebug;
    if (debug) {
      if (debug.explode !== undefined && (debug.explode > 0.5) !== this.state.exploded) this.state.setExploded(debug.explode > 0.5);
      if (debug.focus !== undefined && Math.abs(debug.focus - this.state.focusDistance) > 1) this.state.setFocusDistance(debug.focus, 'init');
      if (debug.f !== undefined && Math.abs(debug.f - this.state.apertureTarget) > 0.01) this.state.setAperture(debug.f);
      if (this.capture) {
        // screenshots: jump straight to targets
        for (let i = 0; i < 400; i++) this.state.update(0.02);
      }
    }

    this.state.update(dt);
    this.ring.update(dt);
    this.rig.update(dt);
    if (!this.capture) this.auto.sample(dt);

    const o = computeOptics(this.state.focusDistance, this.state.fNumber);
    this.optics = o;

    // lens mechanics
    this.lens.setExploded(this.state.explode);
    this.lens.setFocus(o.extension * LAYOUT.kAxial, o.ringAngle);
    this.lens.setAperture(((LENS.focalLength / o.fNumber) / 2) * LAYOUT.kLateral, o.fNumber);

    // teaching overlays
    this.rays.update(o, this.lens, this.t, { cabin: true, trees: true, mountain: true }, this.highlight);
    this.focusPlane.update(o, this.t, { focus: true, zone: true, frustum: true });

    // UI
    const focusedSubject = this.focusedSubject(o);
    this.ui.update(o, { u: this.state.u, exploded: this.state.exploded, apertureTarget: this.state.apertureTarget, focusTargetSubject: focusedSubject });
    const film = this.ui.filmRect();
    this.labels.exclusions = film ? [{ l: film.x - 16, t: film.y - 18, r: film.x + film.width + 16, b: film.y + film.height + 18 }] : [];
    this.updateLabels(o);
    this.labels.update(this.capture ? 10 : dt);
    this.updateSensorResolution();
    if (this.sensorImage !== this.sensorView.output) {
      // the render target is re-allocated when the resolution changes
      this.sensorImage = this.sensorView.output;
      this.sensor.setImage(this.sensorImage, 1.1);
    }

    // shadows only when something that casts them moved
    const shadowKey = `${o.extension.toFixed(4)}|${this.state.explode.toFixed(4)}`;
    if (shadowKey !== this.lastShadowKey) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadowKey = shadowKey;
    }

    // 1. what the sensor sees (no teaching overlays)
    focusOverlay.uOverlayOn.value = 0;
    this.sensorView.update(o);
    this.sensorView.render(this.renderer, this.scene, this.t);
    focusOverlay.uOverlayOn.value = 1;

    // 2. the lab
    this.pipeline.render(dt);

    // 3. sensor image into the filmstrip window
    const rect = this.filmstripRect ?? this.ui.filmRect();
    if (rect) this.sensorView.drawToScreen(this.renderer, rect, this.container.clientHeight);
  }

  private focusedSubject(o: OpticsState): SubjectId | null {
    const s = SUBJECTS.find((x) => Math.abs(x.distance - o.focusDistance) / x.distance < 0.015);
    return s ? s.id : null;
  }

  private updateLabels(o: OpticsState): void {
    const cam = this.rig.camera;
    const L = this.labels;
    const compact = this.container.clientWidth <= 820;
    for (const b of this.rays.bundles) {
      const s = o.subjects.find((x) => x.id === b.id)!;
      const subj = SUBJECTS.find((x) => x.id === b.id)!;
      const status = s.sharpness === 'sharp' ? 'sharp' : `blur ${fmtCoc(s.coc)}`;
      const html = compact
        ? `<span class="dot"></span>${subj.label}${s.sharpness === 'sharp' ? ' <span class="v">sharp</span>' : ''}`
        : `<span class="dot"></span>${subj.label} <span class="v">${fmtDistance(subj.distance, 1)} · ${status}</span>`;
      L.ensure(`s-${b.id}`, { color: SUBJECT_CSS[b.id], html, priority: 8 });
      L.place(`s-${b.id}`, b.source, cam, true, [12, -14], 'left');
    }

    // plane-of-focus tag at the top edge, on the side nearest the viewer
    const halfW = (this.focusPlane.focusX - OPTICAL_CENTER_X) * Math.tan(o.fovHorizontal / 2);
    const side = cam.position.z >= 0 ? 1 : -1;
    const plane = new THREE.Vector3(this.focusPlane.focusX, LAYOUT.axisY + this.focusPlane.focusHalfHeight, LAYOUT.axisZ + side * halfW * 0.72);
    L.ensure('plane', { className: 'plane', priority: 10, html: compact ? `Focus <span class="v">${fmtDistance(o.focusDistance)}</span>` : `Plane of focus <span class="v">${fmtDistance(o.focusDistance)}</span>` });
    L.place('plane', plane, cam, true, [0, -14]);

    // near / far limits (only when there is room on screen)
    const hh = this.focusPlane.focusHalfHeight;
    const nearP = new THREE.Vector3(this.focusPlane.nearX, LAYOUT.axisY + hh * 0.72, LAYOUT.axisZ);
    const farP = new THREE.Vector3(this.focusPlane.farX, LAYOUT.axisY + hh * 0.72, LAYOUT.axisZ);
    L.ensure('near', { className: 'limit', priority: 4, html: `near <span class="v">${fmtDistance(o.near)}</span>` });
    L.ensure('far', { className: 'limit', priority: 4, html: `far <span class="v">${fmtDistance(o.far)}</span>` });
    const a = nearP.clone().project(cam);
    const b2 = farP.clone().project(cam);
    const w = this.container.clientWidth;
    const sep = Math.abs(a.x - b2.x) * 0.5 * w;
    const roomy = sep > 110 && !compact;
    L.place('near', nearP, cam, roomy, [-8, 0], 'right');
    L.place('far', farP, cam, roomy && Number.isFinite(o.far), [8, 0], 'left');

    // sensor
    L.ensure('sensor', { className: 'part', priority: 6, html: `Sensor <span class="v">${o.imageDistance.toFixed(1)} mm from lens</span>` });
    L.place('sensor', new THREE.Vector3(LAYOUT.sensorX, LAYOUT.axisY + SENSOR_H / 2 + 0.62, 0), cam, !compact);

    // focus ring hint until the user has turned it once
    const ringWorld = this.lens.focusRing.localToWorld(new THREE.Vector3(0.7, -0.55, 1.12));
    L.ensure('ring', { className: 'hint', priority: 9, html: `↕ Drag the focus ring` });
    L.place('ring', ringWorld, cam, !this.ringUsed && this.t > 4.5, [0, 30]);

    // exploded-view part callouts
    const exploded = this.state.explode > 0.7;
    const irisWorld = new THREE.Vector3(this.lens.stopX, LAYOUT.axisY - 0.98, 0.3);
    L.ensure('iris', { className: 'part', priority: 3, html: `Iris <span class="v">${fmtF(o.fNumber)} · ⌀ ${o.apertureDiameter.toFixed(1)} mm</span>` });
    L.place('iris', irisWorld, cam, exploded && !compact, [0, 16]);
    const groupWorld = new THREE.Vector3(this.lens.stopX + 1.75, LAYOUT.axisY - 1.0, 0.3);
    L.ensure('group', { className: 'part', priority: 2, html: `Focusing group <span class="v">+${o.extension.toFixed(2)} mm travel</span>` });
    L.place('group', groupWorld, cam, exploded && !compact, [0, 26]);
  }

  /** Whether the renderer runs on a phone-class device (used for defaults). */
  static get mobile(): boolean {
    return isLikelyMobile();
  }
}
