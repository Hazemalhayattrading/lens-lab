import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

/**
 * Main (orbit) view post-processing:
 *   HDR scene → mipmap bloom → ACES filmic tone mapping → subtle vignette (→ SMAA when MSAA is off)
 */
export class MainPipeline {
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  readonly vignette: VignetteEffect;
  private readonly renderPass: RenderPass;
  private readonly effectPass: EffectPass;
  private smaaPass: EffectPass | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    multisampling: number,
  ) {
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling,
    });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: 1.15,
      luminanceThreshold: 0.72,
      luminanceSmoothing: 0.28,
      radius: 0.72,
      levels: 7,
    });
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.62 });
    this.effectPass = new EffectPass(camera, this.bloom, toneMapping, this.vignette);
    this.composer.addPass(this.effectPass);
    this.setMultisampling(multisampling);
  }

  setMultisampling(samples: number): void {
    this.composer.multisampling = samples;
    const wantSmaa = samples === 0;
    if (wantSmaa && !this.smaaPass) {
      this.smaaPass = new EffectPass(undefined, new SMAAEffect({ preset: SMAAPreset.HIGH }));
      this.composer.addPass(this.smaaPass);
    } else if (!wantSmaa && this.smaaPass) {
      this.composer.removePass(this.smaaPass);
      this.smaaPass.dispose();
      this.smaaPass = null;
    }
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.mainCamera = camera;
    this.effectPass.mainCamera = camera;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  render(delta: number): void {
    this.renderer.setRenderTarget(null);
    this.composer.render(delta);
  }
}
