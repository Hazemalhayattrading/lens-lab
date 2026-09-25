import * as THREE from 'three';
import { LENS } from '../../optics/config';
import { buildElementEdge, buildElementGeometry, ELEMENTS, type ElementSpec, frontSurfaceH, rearSurfaceH } from './elements';
import { addGlassRim } from './glassRim';
import { Iris } from './iris';
import {
  APERTURE_PSI0,
  apertureRingAngle,
  apertureScaleTexture,
  DISTANCE_PSI_INF,
  distanceScaleTexture,
  indexScaleTexture,
  knurlTextures,
  nameRingTexture,
  ribTextures,
} from './lensTextures';
import { CUT_PHI_LENGTH, revolve, ringProfile } from './revolve';

const V2 = (r: number, h: number) => new THREE.Vector2(r, h);
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** World angle (φ, lathe convention) where the fixed index mark sits: front, just below the cut. */
export const INDEX_PHI = THREE.MathUtils.degToRad(22);

interface MovingPart {
  object: THREE.Object3D;
  assembled: THREE.Vector3;
  exploded: THREE.Vector3;
  delay: number;
  /** Hide the part once it has left (internal parts that would only clutter the exploded view). */
  hideWhenExploded?: boolean;
}

/** Barrel parts lift up and back, out of the optical path, when the lens is exploded. */
const LIFT = new THREE.Vector3(0, 1.42, -1.85);

export interface SurfaceInfo {
  /** World X of the surface vertex. */
  x: number;
  /** Element-local sag function → world X at height r. */
  xAt: (r: number) => number;
  radius: number;
}

export class LensAssembly {
  readonly group = new THREE.Group();
  /** Parts fixed to the lens mount (do not move when focusing). */
  readonly fixed = new THREE.Group();
  /** The focusing group: all glass + iris + helicoid tube + front ring. */
  readonly cell = new THREE.Group();
  readonly iris: Iris;
  readonly focusRingMeshes: THREE.Mesh[] = [];
  /** Group of the focus ring (its origin lies on the ring's rotation axis). */
  focusRing!: THREE.Group;
  readonly glassMaterials: THREE.MeshPhysicalMaterial[] = [];

  private readonly parts: MovingPart[] = [];
  private readonly elementGroups: { spec: ElementSpec; group: THREE.Group }[] = [];
  private readonly gripTextures: THREE.Texture[] = [];
  private readonly distanceTex: THREE.Texture;
  private readonly apertureTex: THREE.Texture;
  private readonly ribTex: THREE.Texture;
  private readonly gripRepeatAround = 120;
  private travel = 0;
  private explode = 0;
  private readonly ringHighlight: THREE.MeshPhysicalMaterial;

  constructor(
    readonly centerX: number,
    readonly axisY: number,
    readonly axisZ: number,
    /** Radius of the aperture at f/2 in world units. */
    maxApertureRadius: number,
  ) {
    this.group.name = 'lens';
    this.group.position.set(centerX, axisY, axisZ);
    this.group.add(this.fixed, this.cell);

    // ---------- materials ----------
    const black = new THREE.MeshPhysicalMaterial({
      color: '#0d0e10',
      metalness: 0.6,
      roughness: 0.36,
      clearcoat: 0.7,
      clearcoatRoughness: 0.26,
    });
    const section = new THREE.MeshPhysicalMaterial({ color: '#a4a8b0', metalness: 1, roughness: 0.34 });
    const chrome = new THREE.MeshPhysicalMaterial({ color: '#d4d8de', metalness: 1, roughness: 0.26, envMapIntensity: 0.8 });
    const innerBlack = new THREE.MeshStandardMaterial({ color: '#050506', metalness: 0.2, roughness: 0.85 });
    // ground (frosted) element edges: soft grey, reads as glass thickness instead of a black slab
    const edgeMat = new THREE.MeshPhysicalMaterial({ color: '#59616b', metalness: 0, roughness: 0.62, transmission: 0.25, thickness: 0.2, clearcoat: 0.2 });
    const accent = new THREE.MeshPhysicalMaterial({
      color: '#2fc6ff',
      metalness: 0.85,
      roughness: 0.28,
      emissive: '#0a4a66',
      emissiveIntensity: 0.6,
      clearcoat: 1,
    });

    const knurl = knurlTextures();
    this.gripTextures.push(knurl.normalMap, knurl.roughnessMap);
    for (const t of this.gripTextures) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(this.gripRepeatAround * 0.75, 10);
    }
    this.ringHighlight = new THREE.MeshPhysicalMaterial({
      color: '#15171a',
      metalness: 0.75,
      roughness: 0.4,
      normalMap: knurl.normalMap,
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughnessMap: knurl.roughnessMap,
      clearcoat: 0.3,
      emissive: '#39c8ff',
      emissiveIntensity: 0,
    });
    const gripMat = this.ringHighlight;

    this.distanceTex = distanceScaleTexture();
    this.distanceTex.repeat.set(0.75, 1);
    const scaleMat = new THREE.MeshPhysicalMaterial({
      map: this.distanceTex,
      metalness: 0.5,
      roughness: 0.34,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
    });

    this.apertureTex = apertureScaleTexture();
    this.apertureTex.repeat.set(0.75, 1);
    const apertureMat = new THREE.MeshPhysicalMaterial({
      map: this.apertureTex,
      metalness: 0.5,
      roughness: 0.36,
      clearcoat: 0.8,
    });
    this.ribTex = ribTextures();
    this.ribTex.wrapS = this.ribTex.wrapT = THREE.RepeatWrapping;
    this.ribTex.repeat.set(96 * 0.75, 1);
    const ribMat = new THREE.MeshPhysicalMaterial({
      color: '#131417',
      metalness: 0.7,
      roughness: 0.42,
      normalMap: this.ribTex,
      normalScale: new THREE.Vector2(1.2, 1.2),
      clearcoat: 0.4,
    });

    // DoF scale marks: travel ≈ ±N·c → ring angle
    const maxTravel = (LENS.focalLength * LENS.focalLength) / (LENS.minFocus - LENS.focalLength);
    const throwRad = THREE.MathUtils.degToRad(LENS.ringThrowDeg);
    const dofAngle = (n: number) => ((n * LENS.cocLimit) / maxTravel) * throwRad;
    const indexTex = indexScaleTexture([
      { label: '16', angle: dofAngle(16), color: '#e08a1e' },
      { label: '5.6', angle: dofAngle(5.6), color: '#1d9bd1' },
    ]);
    // centre of the texture (u = 0.5) must land on INDEX_PHI: u_tex = u·0.75 + offset
    indexTex.repeat.set(0.75, 1);
    indexTex.offset.set(0.5 - (INDEX_PHI / CUT_PHI_LENGTH) * 0.75, 0);
    const indexMat = new THREE.MeshPhysicalMaterial({ map: indexTex, metalness: 0.9, roughness: 0.3 });

    const nameMat = new THREE.MeshPhysicalMaterial({ map: nameRingTexture(), metalness: 0.5, roughness: 0.4, clearcoat: 0.6 });

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], parent: THREE.Object3D) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const solid = (profile: THREE.Vector2[], surface: THREE.Material, parent: THREE.Object3D) =>
      mesh(revolve(profile, { groups: true }), [surface, section], parent);
    const skin = (r: number, h0: number, h1: number, mat: THREE.Material, parent: THREE.Object3D) => {
      const g = new THREE.LatheGeometry([V2(r, h0), V2(r, h1)], 160, 0, CUT_PHI_LENGTH);
      g.applyMatrix4(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
      return mesh(g, mat, parent);
    };

    // ---------- fixed barrel ----------
    const addFixed = (assembled: number, exploded: number, delay: number, lift = true) => {
      const g = new THREE.Group();
      g.position.x = assembled;
      this.fixed.add(g);
      const a = new THREE.Vector3(assembled, 0, 0);
      const e = new THREE.Vector3(exploded, 0, 0);
      if (lift) e.add(LIFT);
      this.parts.push({ object: g, assembled: a, exploded: e, delay });
      return g;
    };

    // Rear bayonet mount (chrome) with three lugs
    const mount = addFixed(0, -0.95, 0.0);
    solid(
      [V2(0.8, -1.46), V2(0.98, -1.46), V2(1.02, -1.42), V2(1.02, -1.3), V2(0.8, -1.3)],
      chrome,
      mount,
    );
    for (let i = 0; i < 3; i++) {
      const a0 = (i / 3) * Math.PI * 2 + 0.3;
      const lug = new THREE.LatheGeometry([V2(1.02, -1.44), V2(1.09, -1.44), V2(1.09, -1.4), V2(1.02, -1.4)], 12, a0, 0.55);
      lug.applyMatrix4(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
      if (a0 + 0.55 < CUT_PHI_LENGTH) mesh(lug, chrome, mount);
    }

    // Rear barrel (black) + red mount index dot is part of the texture-less body
    const rearBarrel = addFixed(0, -0.62, 0.05);
    solid(ringProfile(0.9, 1.1, -1.3, -0.62, 0.02), black, rearBarrel);

    // Aperture ring: ribbed grip + engraved f-numbers
    const apRing = addFixed(0, -0.3, 0.1);
    solid(ringProfile(1.0, 1.13, -0.62, -0.3, 0.015), black, apRing);
    skin(1.132, -0.6, -0.49, ribMat, apRing);
    skin(1.132, -0.47, -0.32, apertureMat, apRing);

    // Centre barrel (fixed, carries the index + DoF scale; the lens clamp grips it)
    const centre = addFixed(0, 0, 0.15);
    solid(ringProfile(1.0, 1.12, -0.3, 0.1, 0.012), black, centre);
    skin(1.123, -0.1, 0.08, indexMat, centre);
    // accent ring
    solid(ringProfile(1.12, 1.135, -0.28, -0.25), accent, centre);

    // Focus ring (rotates via its textures; stays axially fixed)
    const focus = addFixed(0, 0.36, 0.2);
    this.focusRing = focus;
    solid(ringProfile(1.12, 1.18, 0.1, 1.04, 0.01), black, focus);
    this.focusRingMeshes.push(skin(1.183, 0.12, 0.31, scaleMat, focus));
    const grip = solid(
      [V2(1.18, 0.36), V2(1.228, 0.36), V2(1.25, 0.39), V2(1.25, 0.98), V2(1.228, 1.01), V2(1.18, 1.01)],
      gripMat,
      focus,
    );
    this.focusRingMeshes.push(grip);

    // ---------- focusing cell ----------
    const addCell = (assembled: number, exploded: number, delay: number, lift = false, hide = false) => {
      const g = new THREE.Group();
      g.position.x = assembled;
      this.cell.add(g);
      const a = new THREE.Vector3(assembled, 0, 0);
      const e = new THREE.Vector3(exploded, 0, 0);
      if (lift) e.add(LIFT);
      this.parts.push({ object: g, assembled: a, exploded: e, delay, hideWhenExploded: hide });
      return g;
    };

    // Helicoid tube carrying the optics (visible when it extends at close focus)
    const tube = addCell(0, 0.36, 0.2, true, true);
    solid(ringProfile(0.99, 1.1, 0.1, 1.3, 0.01), black, tube);
    mesh(new THREE.LatheGeometry([V2(0.991, 1.29), V2(0.991, 0.11)], 96, 0, CUT_PHI_LENGTH).applyMatrix4(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)), innerBlack, tube);

    // Front name ring + filter thread
    const front = addCell(0, 0.78, 0.26, true);
    solid(ringProfile(1.0, 1.12, 1.26, 1.44, 0.018), black, front);
    solid(ringProfile(1.02, 1.07, 1.44, 1.5), chrome, front);
    const nameRing = new THREE.RingGeometry(1.0, 1.1, 128, 1, 0, CUT_PHI_LENGTH);
    // RingGeometry lies in XY; map (x, y) → lathe convention (y = -r sinφ, z = r cosφ), facing +X
    {
      const p = nameRing.getAttribute('position') as THREE.BufferAttribute;
      const n = nameRing.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        // RingGeometry: x = r cos θ, y = r sin θ. Use θ as φ.
        p.setXYZ(i, 1.442, -y, x);
        n.setXYZ(i, 1, 0, 0);
      }
      // (x_r, y_r, z_r) → (z_w, −y_w, x_w) is a proper rotation, so the winding already faces +X
    }
    mesh(nameRing, nameMat, front);

    // Iris housing (two thin plates) + blades, at the stop (h = 0)
    const irisGroup = addCell(0, 0, 0.15);
    const housingOuter = 0.9;
    const bladeMat = new THREE.MeshPhysicalMaterial({
      color: '#26282c',
      metalness: 0.9,
      roughness: 0.28,
      clearcoat: 0.5,
      side: THREE.DoubleSide,
    });
    const irisMetal = new THREE.MeshPhysicalMaterial({ color: '#2a2c31', metalness: 0.9, roughness: 0.3, clearcoat: 0.6 });
    this.iris = new Iris(LENS.bladeCount, housingOuter - 0.02, maxApertureRadius, bladeMat);
    irisGroup.add(this.iris.group);
    solid(ringProfile(maxApertureRadius, housingOuter, 0.018, 0.045, 0.004), irisMetal, irisGroup);
    solid(ringProfile(maxApertureRadius, housingOuter, -0.045, -0.018, 0.004), irisMetal, irisGroup);
    solid(ringProfile(housingOuter - 0.035, housingOuter, -0.045, 0.045), irisMetal, irisGroup);
    solid(ringProfile(housingOuter - 0.004, housingOuter + 0.012, -0.012, 0.012), accent, irisGroup);

    // Glass elements
    ELEMENTS.forEach((spec, i) => {
      const glass = new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        metalness: 0,
        roughness: 0.02,
        transmission: 1,
        thickness: Math.max(0.12, spec.thickness),
        ior: spec.ior,
        attenuationColor: new THREE.Color(spec.tint),
        attenuationDistance: 3,
        specularIntensity: 1,
        envMapIntensity: 2.2,
        iridescence: 0.45,
        iridescenceIOR: 1.33,
        iridescenceThicknessRange: [200, 450],
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      addGlassRim(glass);
      this.glassMaterials.push(glass);
      const g = addCell(spec.hFront, spec.hFrontExploded, 0.12 + Math.abs(i - 2.5) * 0.03);
      const body = new THREE.Mesh(buildElementGeometry(spec), glass);
      body.renderOrder = 2;
      g.add(body);
      const edge = new THREE.Mesh(buildElementEdge(spec), edgeMat);
      edge.castShadow = true;
      g.add(edge);
      this.elementGroups.push({ spec, group: g });
    });

    this.setExploded(0);
    this.setFocus(0, 0);
    this.setAperture(maxApertureRadius, 2);
  }

  /** Move the focusing group by `travel` world units and rotate the focus ring to `ringAngle`. */
  setFocus(travel: number, ringAngle: number): void {
    this.travel = travel;
    this.cell.position.x = travel;
    // ring-local ψ = φ + θ − φ_idx + ψ∞  →  u_tex = u·0.75 + (θ − φ_idx + ψ∞)/(2π)
    this.distanceTex.offset.x = (ringAngle - INDEX_PHI + DISTANCE_PSI_INF) / (Math.PI * 2);
    const k = (ringAngle / (Math.PI * 2)) * this.gripRepeatAround;
    for (const t of this.gripTextures) t.offset.x = k;
  }

  setAperture(radius: number, fNumber: number): void {
    this.iris.setRadius(radius);
    this.apertureTex.offset.x = (apertureRingAngle(fNumber) - INDEX_PHI + APERTURE_PSI0) / (Math.PI * 2);
    this.ribTex.offset.x = (apertureRingAngle(fNumber) / (Math.PI * 2)) * 96;
  }

  /** 0 = assembled, 1 = exploded (staggered per part). */
  setExploded(t: number): void {
    this.explode = t;
    for (const p of this.parts) {
      const local = THREE.MathUtils.clamp((t - p.delay) / (1 - 0.3), 0, 1);
      const k = easeInOut(smoothstep(local) * 0.5 + local * 0.5);
      p.object.position.lerpVectors(p.assembled, p.exploded, k);
      if (p.hideWhenExploded) {
        p.object.visible = k < 0.35;
      }
    }
  }

  get explodeAmount(): number {
    return this.explode;
  }

  setRingHover(amount: number): void {
    this.ringHighlight.emissiveIntensity = amount * 0.35;
  }

  /** Current world-space optical surfaces, front (subject side) to rear. */
  getSurfaces(out: SurfaceInfo[] = []): SurfaceInfo[] {
    out.length = 0;
    const base = this.centerX + this.travel;
    for (const { spec, group } of this.elementGroups) {
      const h0 = base + group.position.x; // world X of the front vertex
      out.push({ x: h0, xAt: (r) => h0 + frontSurfaceH(spec, r), radius: spec.radius });
      out.push({ x: h0 - spec.thickness, xAt: (r) => h0 + rearSurfaceH(spec, r), radius: spec.radius });
    }
    return out;
  }

  /** World X of the iris (the aperture stop = thin-lens principal plane). */
  get stopX(): number {
    return this.centerX + this.travel;
  }
}
