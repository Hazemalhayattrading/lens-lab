import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { LENS } from '../optics/config';
import type { OpticsState } from '../optics/opticsState';
import { LAYER_SENSOR, LAYOUT, OPTICAL_CENTER_X, depthMap } from '../scene/layout';
import {
  bokehFragment,
  cocDownsampleFragment,
  compositeFragment,
  displayFragment,
  fullscreenVertex,
  tileDilateFragment,
  tileMaxFragment,
} from './sensorShaders';

export interface SensorQuality {
  /** Render width in pixels (height = width · 2/3, the 36 × 24 aspect). */
  width: number;
  /** Bokeh gather samples. */
  samples: number;
  /** MSAA samples for the scene render. */
  msaa: number;
}

const TILE = 8;
const MAX_R_HALF = 40; // max CoC radius in half-res pixels

/**
 * Renders what the sensor "sees": a camera at the lens' optical centre looking down the axis
 * with the physical angle of view, followed by a depth-of-field pass whose blur is the real
 * thin-lens circle of confusion of every pixel.
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
  private rtOut!: THREE.WebGLRenderTarget;
  private readonly quad = new FullScreenQuad();
  private readonly cocUniforms: Record<string, THREE.IUniform>;
  private readonly matCoc: THREE.ShaderMaterial;
  private readonly matTile: THREE.ShaderMaterial;
  private readonly matDilate: THREE.ShaderMaterial;
  private matBlur: THREE.ShaderMaterial;
  private readonly matComposite: THREE.ShaderMaterial;
  readonly matDisplay: THREE.ShaderMaterial;
  private quality: SensorQuality;
  enabled = true;

  constructor(quality: SensorQuality) {
    this.quality = quality;
    this.camera = new THREE.PerspectiveCamera(27, 1.5, 0.5, 40);
    this.camera.position.set(OPTICAL_CENTER_X, LAYOUT.axisY, LAYOUT.axisZ);
    this.camera.lookAt(OPTICAL_CENTER_X + 10, LAYOUT.axisY, LAYOUT.axisZ);
    this.camera.layers.set(LAYER_SENSOR);

    this.cocUniforms = {
      uNear: { value: this.camera.near },
      uFar: { value: this.camera.far },
      uCamX: { value: OPTICAL_CENTER_X },
      uXNear: { value: OPTICAL_CENTER_X + LAYOUT.xNearRel },
      uXInf: { value: OPTICAL_CENTER_X + LAYOUT.xInfRel },
      uD0: { value: depthMap.d0 },
      uWNear: { value: depthMap.dNear / (depthMap.dNear + depthMap.d0) },
      uF: { value: LENS.focalLength },
      uN: { value: 2 },
      uS: { value: 2000 },
      uPxPerMm: { value: 1 },
      uMaxCoC: { value: MAX_R_HALF * 4 },
    };
    const mk = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}) =>
      new THREE.ShaderMaterial({ vertexShader: fullscreenVertex, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false });

    this.matCoc = mk(cocDownsampleFragment, { ...this.cocUniforms, tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.matTile = mk(tileMaxFragment, { tHalf: { value: null }, uHalfTexel: { value: new THREE.Vector2() } });
    this.matDilate = mk(tileDilateFragment, { tTile: { value: null }, uTileTexel: { value: new THREE.Vector2() }, uTileSize: { value: TILE } });
    this.matBlur = this.makeBlur(quality.samples);
    this.matComposite = mk(compositeFragment, { ...this.cocUniforms, tColor: { value: null }, tDepth: { value: null }, tBlur: { value: null } });
    this.matDisplay = mk(displayFragment, {
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

  private makeBlur(samples: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: bokehFragment,
      defines: { SAMPLES: samples },
      uniforms: {
        tHalf: { value: null },
        tTile: { value: null },
        uHalfTexel: { value: new THREE.Vector2() },
        uMaxR: { value: MAX_R_HALF },
        uBlades: { value: LENS.bladeCount },
        uPolygon: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  private allocate(): void {
    const w = Math.round(this.quality.width / 4) * 4;
    const h = Math.round((w * 2) / 3 / 4) * 4;
    if (w === this.width && h === this.height && this.rtScene?.samples === this.quality.msaa) return;
    this.dispose();
    this.width = w;
    this.height = h;
    const depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.rtScene = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.quality.msaa,
      depthTexture,
      depthBuffer: true,
    });
    const half = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter } as const;
    this.rtHalf = new THREE.WebGLRenderTarget(w / 2, h / 2, half);
    this.rtBlur = new THREE.WebGLRenderTarget(w / 2, h / 2, half);
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
    (this.matBlur.uniforms.uHalfTexel.value as THREE.Vector2).set(2 / w, 2 / h);
    (this.matDisplay.uniforms.uOutTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    this.cocUniforms.uPxPerMm.value = w / LENS.sensorWidth;
  }

  setQuality(q: SensorQuality): void {
    const samplesChanged = q.samples !== this.quality.samples;
    this.quality = q;
    if (samplesChanged) {
      this.matBlur.dispose();
      this.matBlur = this.makeBlur(q.samples);
      (this.matBlur.uniforms.uHalfTexel.value as THREE.Vector2).set(2 / this.width, 2 / this.height);
    }
    this.allocate();
  }

  get output(): THREE.Texture {
    return this.rtOut.texture;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  update(o: OpticsState): void {
    this.camera.fov = THREE.MathUtils.radToDeg(o.fovVertical);
    this.camera.aspect = LENS.sensorWidth / LENS.sensorHeight;
    this.camera.updateProjectionMatrix();
    this.cocUniforms.uN.value = o.fNumber;
    this.cocUniforms.uS.value = Number.isFinite(o.focusDistance) ? o.focusDistance : -1;
    // iris polygon shows up in the bokeh once the blades enter the light path
    this.matBlur.uniforms.uPolygon.value = THREE.MathUtils.smoothstep(o.fNumber, 2.1, 3.5) * 0.85;
    this.matDisplay.uniforms.uAcceptPx.value = LENS.cocLimit * (this.width / LENS.sensorWidth);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, time: number): void {
    if (!this.enabled) return;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;

    // 1. scene from the lens' optical centre
    renderer.setRenderTarget(this.rtScene);
    renderer.clear();
    renderer.render(scene, this.camera);

    // 2. CoC + downsample
    this.matCoc.uniforms.tColor.value = this.rtScene.texture;
    this.matCoc.uniforms.tDepth.value = this.rtScene.depthTexture;
    this.pass(renderer, this.matCoc, this.rtHalf);
    // 3. near-field tile max + dilation
    this.matTile.uniforms.tHalf.value = this.rtHalf.texture;
    this.pass(renderer, this.matTile, this.rtTileA);
    this.matDilate.uniforms.tTile.value = this.rtTileA.texture;
    this.pass(renderer, this.matDilate, this.rtTileB);
    // 4. bokeh gather
    this.matBlur.uniforms.tHalf.value = this.rtHalf.texture;
    this.matBlur.uniforms.tTile.value = this.rtTileB.texture;
    this.pass(renderer, this.matBlur, this.rtBlur);
    // 5. composite
    this.matComposite.uniforms.tColor.value = this.rtScene.texture;
    this.matComposite.uniforms.tDepth.value = this.rtScene.depthTexture;
    this.matComposite.uniforms.tBlur.value = this.rtBlur.texture;
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
    for (const rt of [this.rtScene, this.rtHalf, this.rtTileA, this.rtTileB, this.rtBlur, this.rtOut]) rt?.dispose();
    this.rtScene?.depthTexture?.dispose();
  }
}
