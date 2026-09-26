import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { LensState } from '../optics/lensModel';
import { LAYER_SENSOR, LAYER_SENSOR_ONLY, LAYOUT, OPTICAL_CENTER_X, depthMap } from '../scene/layout';
import {
  bokehFragment,
  cocDownsampleFragment,
  compositeFragment,
  displayFragment,
  fullscreenVertex,
  nearFilterFragment,
  nearGatherFragment,
  tileDilateFragment,
  tileMaxFragment,
} from './sensorShaders';

export interface SensorQuality {
  /** Render width in pixels (height = width / sensor aspect). */
  width: number;
  /** Bokeh gather samples (per layer). */
  samples: number;
  /** MSAA samples for the scene render. */
  msaa: number;
}

const TILE = 8;
const MAX_R_HALF = 40; // max CoC radius in half-res pixels

/**
 * Renders what the sensor "sees": a camera at the lens' perspective centre looking down the axis
 * with the lens' physical angle of view (any focal length, any sensor format), followed by a
 * depth-of-field pass whose blur is the real thin-lens circle of confusion of every pixel:
 *   scene → CoC + half-res downsample (mip-mapped) → near-field tile max + dilation
 *   → own blur (4a) + foreground blur (4b, filtered 4c) → full-res composite → display.
 */
export class SensorPipeline {
  readonly camera: THREE.PerspectiveCamera;
  private width = 0;
  private height = 0;
  private rtScene!: THREE.WebGLRenderTarget;
  private rtHalf!: THREE.WebGLRenderTarget;
  private rtTileA!: THREE.WebGLRenderTarget;
  private rtTileB!: THREE.WebGLRenderTarget;
  private rtBlur!: THREE.WebGLRenderTarget;
  private rtNearG!: THREE.WebGLRenderTarget;
  private rtNearF!: THREE.WebGLRenderTarget;
  private rtOut!: THREE.WebGLRenderTarget;
  private readonly quad = new FullScreenQuad();
  private readonly cocUniforms: Record<string, THREE.IUniform>;
  private readonly matCoc: THREE.ShaderMaterial;
  private readonly matTile: THREE.ShaderMaterial;
  private readonly matDilate: THREE.ShaderMaterial;
  private matBlur: THREE.ShaderMaterial;
  private matNearGather: THREE.ShaderMaterial;
  private readonly matNearFilter: THREE.ShaderMaterial;
  private readonly matComposite: THREE.ShaderMaterial;
  readonly matDisplay: THREE.ShaderMaterial;
  /** Uniforms shared by both gathers. */
  private readonly gatherUniforms = {
    uHalfTexel: { value: new THREE.Vector2() },
    uMaxR: { value: MAX_R_HALF },
    uBlades: { value: 9 },
    uPolygon: { value: 0 },
  };
  private quality: SensorQuality;
  private aspect = 1.5;
  private sensorWidthMm = 36;
  enabled = true;

  constructor(quality: SensorQuality) {
    this.quality = quality;
    this.camera = new THREE.PerspectiveCamera(27, 1.5, 0.25, 140);
    this.camera.position.set(OPTICAL_CENTER_X, LAYOUT.axisY, LAYOUT.axisZ);
    this.camera.lookAt(OPTICAL_CENTER_X + 10, LAYOUT.axisY, LAYOUT.axisZ);
    this.camera.layers.set(LAYER_SENSOR);
    this.camera.layers.enable(LAYER_SENSOR_ONLY);

    this.cocUniforms = {
      uNear: { value: this.camera.near },
      uFar: { value: this.camera.far },
      uCamX: { value: OPTICAL_CENTER_X },
      uXNear: { value: OPTICAL_CENTER_X + LAYOUT.xNearRel },
      uXInf: { value: OPTICAL_CENTER_X + LAYOUT.xInfRel },
      uDNear: { value: depthMap.dNear },
      uGamma: { value: depthMap.gamma },
      uF: { value: 50 },
      uN: { value: 2 },
      uUs: { value: 2000 },
      uVs: { value: 51.3 },
      uPxPerMm: { value: 1 },
      uMaxCoC: { value: MAX_R_HALF * 4 },
    };
    this.matCoc = this.mk(cocDownsampleFragment, { ...this.cocUniforms, tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.matTile = this.mk(tileMaxFragment, { tHalf: { value: null }, uHalfTexel: { value: new THREE.Vector2() } });
    this.matDilate = this.mk(tileDilateFragment, { tTile: { value: null }, uTileTexel: { value: new THREE.Vector2() }, uTileSize: { value: TILE } });
    this.matBlur = this.makeGather(bokehFragment, quality.samples);
    this.matNearGather = this.makeGather(nearGatherFragment, quality.samples);
    this.matNearFilter = this.mk(nearFilterFragment, { tNear: { value: null }, uHalfTexel: this.gatherUniforms.uHalfTexel });
    this.matComposite = this.mk(compositeFragment, { ...this.cocUniforms, tColor: { value: null }, tDepth: { value: null }, tBlur: { value: null }, tNear: { value: null } });
    this.matDisplay = this.mk(displayFragment, {
      tOut: { value: null },
      tHalf: { value: null },
      uOutTexel: { value: new THREE.Vector2() },
      uExposure: { value: 1 },
      uTime: { value: 0 },
      uPeaking: { value: 0 },
      uAcceptPx: { value: 1 },
      uPeakColor: { value: new THREE.Color('#ff4f9a') },
    });
    this.allocate();
  }

  private mk(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ vertexShader: fullscreenVertex, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false });
  }

  private makeGather(fragment: string, samples: number): THREE.ShaderMaterial {
    return this.mk(fragment, { tHalf: { value: null }, tTile: { value: null }, ...this.gatherUniforms }, { SAMPLES: samples });
  }

  private allocate(): void {
    const w = Math.round(this.quality.width / 4) * 4;
    const h = Math.round(w / this.aspect / 4) * 4;
    if (w === this.width && h === this.height && this.rtScene?.samples === this.quality.msaa) return;
    this.dispose();
    this.width = w;
    this.height = h;
    const depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.quality.msaa, depthTexture, depthBuffer: true });
    const half = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter } as const;
    // the own-blur gather behind defocused foreground pixels reads mip levels (prefiltering)
    this.rtHalf = new THREE.WebGLRenderTarget(w / 2, h / 2, { ...half, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.rtBlur = new THREE.WebGLRenderTarget(w / 2, h / 2, half);
    this.rtNearG = new THREE.WebGLRenderTarget(w / 2, h / 2, half);
    this.rtNearF = new THREE.WebGLRenderTarget(w / 2, h / 2, half);
    const tw = Math.ceil(w / 2 / TILE);
    const th = Math.ceil(h / 2 / TILE);
    const tile = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter } as const;
    this.rtTileA = new THREE.WebGLRenderTarget(tw, th, tile);
    this.rtTileB = new THREE.WebGLRenderTarget(tw, th, tile);
    this.rtOut = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });

    (this.matCoc.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    (this.matTile.uniforms.uHalfTexel.value as THREE.Vector2).set(2 / w, 2 / h);
    (this.matDilate.uniforms.uTileTexel.value as THREE.Vector2).set(1 / tw, 1 / th);
    this.gatherUniforms.uHalfTexel.value.set(2 / w, 2 / h);
    (this.matDisplay.uniforms.uOutTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    this.cocUniforms.uPxPerMm.value = w / this.sensorWidthMm;
  }

  setQuality(q: SensorQuality): void {
    const samplesChanged = q.samples !== this.quality.samples;
    this.quality = q;
    if (samplesChanged) {
      this.matBlur.dispose();
      this.matNearGather.dispose();
      this.matBlur = this.makeGather(bokehFragment, q.samples);
      this.matNearGather = this.makeGather(nearGatherFragment, q.samples);
    }
    this.allocate();
  }

  get output(): THREE.Texture {
    return this.rtOut.texture;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Aspect ratio of the current sensor (width / height). */
  get sensorAspect(): number {
    return this.aspect;
  }

  /**
   * Point the pipeline at a lens state. `maxAperture` is the lens' widest f-number (the iris
   * polygon appears in the bokeh once the blades enter the light path), `blades` its blade count.
   */
  update(o: LensState, maxAperture: number, blades: number): void {
    const aspect = o.sensor.width / o.sensor.height;
    if (Math.abs(aspect - this.aspect) > 1e-4 || Math.abs(o.sensor.width - this.sensorWidthMm) > 1e-6) {
      this.aspect = aspect;
      this.sensorWidthMm = o.sensor.width;
      this.width = 0; // force re-allocation
      this.allocate();
    }
    this.camera.fov = THREE.MathUtils.radToDeg(o.fovVertical);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.cocUniforms.uF.value = o.effectiveFocal;
    this.cocUniforms.uN.value = o.fNumber;
    this.cocUniforms.uUs.value = Number.isFinite(o.objectDistance) ? o.objectDistance : -1;
    this.cocUniforms.uVs.value = o.imageDistance;
    this.gatherUniforms.uBlades.value = blades;
    this.gatherUniforms.uPolygon.value = THREE.MathUtils.smoothstep(o.fNumber, maxAperture * 1.05, maxAperture * 1.75) * 0.85;
    this.matDisplay.uniforms.uAcceptPx.value = o.coc * (this.width / o.sensor.width);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, time: number): void {
    if (!this.enabled) return;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;

    // 1. scene from the lens' perspective centre
    renderer.setRenderTarget(this.rtScene);
    renderer.clear();
    renderer.render(scene, this.camera);

    // 2. CoC + downsample (mip chain generated for the prefiltered gather)
    this.matCoc.uniforms.tColor.value = this.rtScene.texture;
    this.matCoc.uniforms.tDepth.value = this.rtScene.depthTexture;
    this.pass(renderer, this.matCoc, this.rtHalf);
    // 3. near-field tile max + dilation
    this.matTile.uniforms.tHalf.value = this.rtHalf.texture;
    this.pass(renderer, this.matTile, this.rtTileA);
    this.matDilate.uniforms.tTile.value = this.rtTileA.texture;
    this.pass(renderer, this.matDilate, this.rtTileB);
    // 4a. own blur
    this.matBlur.uniforms.tHalf.value = this.rtHalf.texture;
    this.pass(renderer, this.matBlur, this.rtBlur);
    // 4b. foreground blur spreading over the image, 4c. denoised
    this.matNearGather.uniforms.tHalf.value = this.rtHalf.texture;
    this.matNearGather.uniforms.tTile.value = this.rtTileB.texture;
    this.pass(renderer, this.matNearGather, this.rtNearG);
    this.matNearFilter.uniforms.tNear.value = this.rtNearG.texture;
    this.pass(renderer, this.matNearFilter, this.rtNearF);
    // 5. composite
    this.matComposite.uniforms.tColor.value = this.rtScene.texture;
    this.matComposite.uniforms.tDepth.value = this.rtScene.depthTexture;
    this.matComposite.uniforms.tBlur.value = this.rtBlur.texture;
    this.matComposite.uniforms.tNear.value = this.rtNearF.texture;
    this.pass(renderer, this.matComposite, this.rtOut);

    this.matDisplay.uniforms.uTime.value = time;
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  private pass(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  /**
   * Draws the final sensor image (tone-mapped) into a rectangle of the default framebuffer.
   * `rect` is in CSS pixels relative to the canvas' top-left corner.
   */
  drawToScreen(renderer: THREE.WebGLRenderer, rect: { x: number; y: number; width: number; height: number }, canvasHeight: number): void {
    if (!this.enabled || rect.width < 2 || rect.height < 2) return;
    this.matDisplay.uniforms.tOut.value = this.rtOut.texture;
    this.matDisplay.uniforms.tHalf.value = this.rtHalf.texture;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    const y = canvasHeight - rect.y - rect.height;
    renderer.setViewport(rect.x, y, rect.width, rect.height);
    renderer.setScissor(rect.x, y, rect.width, rect.height);
    renderer.setScissorTest(true);
    this.quad.material = this.matDisplay;
    this.quad.render(renderer);
    renderer.setScissorTest(false);
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    for (const rt of [this.rtScene, this.rtHalf, this.rtTileA, this.rtTileB, this.rtBlur, this.rtNearG, this.rtNearF, this.rtOut]) rt?.dispose();
    this.rtScene?.depthTexture?.dispose();
  }
}
