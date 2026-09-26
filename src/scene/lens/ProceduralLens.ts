import * as THREE from 'three';
import type { RingTarget } from '../../interaction/FocusRingDrag';
import type { LabLens } from '../../lab/labLens';
import type { OpticsFrame } from '../../lab/optics';
import { buildOpticalLayout, wallFor, type LayoutElement, type OpticalLayout } from '../../lab/opticalLayout';
import { SPECIAL_COLORS } from '../../lab/specialGlass';
import { BENCH } from '../bench';
import { LAYOUT, OPTICAL_CENTER_X } from '../layout';
import type { SurfaceInfo } from '../rays/RayBundles';
import { buildElementEdge, buildElementGeometry, frontSurfaceH, rearSurfaceH, type ElementSpec } from './elements';
import { addGlassRim } from './glassRim';
import { Iris } from './iris';
import { knurlTextures, ribTextures } from './lensTextures';
import type { LensCallout, MountedLens } from './MountedLens';
import { CUT_PHI_LENGTH, revolve, ringProfile } from './revolve';

/** Where on the bench a library lens may sit (world X), with its iris on the optical centre. */
const X_FRONT_MAX = LAYOUT.mountX + LAYOUT.lensMaxLength;
const X_REAR_MIN = -2.55;
const R_MAX = LAYOUT.lensMaxRadius;

const V2 = (r: number, h: number) => new THREE.Vector2(r, h);
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Ring {
  kind: 'focus' | 'zoom' | 'control' | 'collar';
  h0: number;
  h1: number;
}

interface BarrelPart {
  object: THREE.Object3D;
  assembled: THREE.Vector3;
  exploded: THREE.Vector3;
  delay: number;
}

/**
 * A library lens built procedurally from its specs: barrel to the maker's diameter × length
 * (uniformly scaled to fit the bench), the published element / group count in an illustrative
 * layout (see lab/opticalLayout.ts), special glass colour-coded, moving zoom / focus sections, iris
 * with the published blade count, focus + zoom rings. The iris sits on the optical centre.
 */
export class ProceduralLens implements MountedLens {
  readonly group = new THREE.Group();
  readonly layout: OpticalLayout;
  /** World units per mm. */
  readonly k: number;
  readonly focusRingMeshes: THREE.Mesh[] = [];
  readonly focusRing = new THREE.Group();
  readonly ringThrow = THREE.MathUtils.degToRad(150);
  readonly zoomRing: RingTarget | null = null;
  readonly zoomThrow = THREE.MathUtils.degToRad(80);
  readonly support: { x: number; radius: number };
  readonly iris: Iris;

  private readonly sectionGroups: THREE.Group[] = [];
  private readonly spread: number[] = [];
  private readonly frontTube: THREE.Group | null = null;
  private readonly parts: BarrelPart[] = [];
  private readonly specs: { el: LayoutElement; spec: ElementSpec; section: THREE.Group }[] = [];
  private readonly stopGroup = new THREE.Group();
  private readonly focusTex: THREE.Texture[] = [];
  private readonly zoomTex: THREE.Texture[] = [];
  private readonly ringMats: THREE.MeshPhysicalMaterial[] = [];
  private readonly zoomMats: THREE.MeshPhysicalMaterial[] = [];
  private readonly calloutList: (LensCallout & { anchor: () => THREE.Vector3 })[] = [];
  private readonly gripRepeat = 150;
  private readonly rings: Ring[];
  private readonly baseX: number;
  private zoom = 0;
  private explodeAmount = 0;
  private aperture = 0;

  constructor(readonly lens: LabLens) {
    const lay = buildOpticalLayout(lens);
    this.layout = lay;
    const L = lay.length;
    const D = lay.diameter;
    const wall = wallFor(D);

    // ---- scale: fit diameter and length (incl. zoom extension and stop travel) around the optical centre
    const zs = lens.isZoom ? [0, 0.25, 0.5, 0.75, 1] : [0];
    let front = 0;
    let rear = 0;
    for (const z of zs) {
      const stop = lay.stopH + lay.sectionOffset(lay.stopSection, z, 0);
      front = Math.max(front, L + lay.extension(z) - stop);
      rear = Math.max(rear, stop);
    }
    const k = Math.min((2 * R_MAX) / D, (X_FRONT_MAX - OPTICAL_CENTER_X) / front, (OPTICAL_CENTER_X - X_REAR_MIN) / rear);
    this.k = k;
    this.baseX = OPTICAL_CENTER_X - lay.stopH * k;
    this.group.name = `lens:${lens.id}`;
    this.group.position.set(this.baseX, LAYOUT.axisY, LAYOUT.axisZ);

    // ---- materials
    const satin = new THREE.MeshPhysicalMaterial({ color: '#111215', metalness: 0.55, roughness: 0.46, clearcoat: 0.45, clearcoatRoughness: 0.4 });
    const section = new THREE.MeshPhysicalMaterial({ color: '#a4a8b0', metalness: 1, roughness: 0.34 });
    const chrome = new THREE.MeshPhysicalMaterial({ color: '#a9aeb6', metalness: 1, roughness: 0.42, envMapIntensity: 0.65 });
    const cellMat = new THREE.MeshStandardMaterial({ color: '#0b0b0d', metalness: 0.4, roughness: 0.62 });
    const sleeveMat = new THREE.MeshPhysicalMaterial({ color: '#1c1e22', metalness: 0.7, roughness: 0.3, clearcoat: 0.6 });
    const accent = new THREE.MeshPhysicalMaterial({ color: '#2fc6ff', metalness: 0.85, roughness: 0.28, emissive: '#0a4a66', emissiveIntensity: 0.6, clearcoat: 1 });
    const edgeMat = new THREE.MeshPhysicalMaterial({ color: '#59616b', metalness: 0, roughness: 0.62, transmission: 0.25, thickness: 0.2, clearcoat: 0.2 });
    const knurl = knurlTextures();
    const rib = ribTextures();
    const ribbed = (tex: THREE.Texture[], repeatAround: number, rows: number) => {
      const n = rib.clone();
      n.wrapS = n.wrapT = THREE.RepeatWrapping;
      n.repeat.set(repeatAround * 0.75, rows);
      n.needsUpdate = true;
      tex.push(n);
      return new THREE.MeshPhysicalMaterial({ color: '#141518', metalness: 0.2, roughness: 0.72, normalMap: n, normalScale: new THREE.Vector2(1.6, 1.6), clearcoat: 0.1, emissive: '#39c8ff', emissiveIntensity: 0 });
    };
    const knurlMat = () => {
      const nm = knurl.normalMap.clone();
      const rm = knurl.roughnessMap.clone();
      for (const t of [nm, rm]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(this.gripRepeat * 0.75, 6);
        t.needsUpdate = true;
      }
      return new THREE.MeshPhysicalMaterial({ color: '#17181b', metalness: 0.75, roughness: 0.4, normalMap: nm, roughnessMap: rm, normalScale: new THREE.Vector2(1.2, 1.2), clearcoat: 0.3 });
    };

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], parent: THREE.Object3D) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const K = (pts: THREE.Vector2[]) => pts.map((p) => V2(p.x * k, p.y * k));
    const solid = (profile: THREE.Vector2[], surface: THREE.Material, parent: THREE.Object3D, segments = 128) =>
      mesh(revolve(K(profile), { groups: true, segments }), [surface, section], parent);

    // ---- barrel layout
    const outer = lay.outerRadius;
    this.rings = ringLayout(lens, L);
    const extending = lens.isZoom && lens.zoomExtends;
    const hSplit = extending ? L - Math.max(10, (lens.layout === 'zoom-standard' || lens.layout === 'zoom-wide' ? 0.12 : 0.2) * L) : L - Math.max(4, 0.035 * L);
    const extMax = Math.max(lay.extension(0), lay.extension(1), lay.extension(0.5));
    const lift = new THREE.Vector3(0, 0.25 + 1.05 * R_MAX, -(0.35 + 1.3 * R_MAX));
    const addPart = (delay: number, explodedDx: number, liftIt = true) => {
      const g = new THREE.Group();
      this.group.add(g);
      const e = new THREE.Vector3(explodedDx, 0, 0);
      if (liftIt) e.add(lift);
      this.parts.push({ object: g, assembled: new THREE.Vector3(), exploded: e, delay });
      return g;
    };

    // mount: chrome bayonet with three lugs
    const tR = lay.throat / 2;
    const mount = addPart(0, -0.7);
    solid([V2(tR - 1.2, -0.2), V2(tR + 2.6, -0.2), V2(tR + 3, 0.3), V2(tR + 3, 3.2), V2(tR - 1.2, 3.2)], chrome, mount);
    for (let i = 0; i < 3; i++) {
      const a0 = (i / 3) * Math.PI * 2 + 0.3;
      if (a0 + 0.55 > CUT_PHI_LENGTH) continue;
      const lug = new THREE.LatheGeometry(K([V2(tR + 3, 0.2), V2(tR + 5, 0.2), V2(tR + 5, 1.6), V2(tR + 3, 1.6)]), 12, a0, 0.55);
      lug.applyMatrix4(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
      mesh(lug, chrome, mount);
    }

    // fixed shell with grooves under the rings; the rings sit in them
    const groove = Math.min(1.4, wall * 0.35);
    const inRing = (h: number) => this.rings.some((r) => h > r.h0 + 0.01 && h < r.h1 - 0.01);
    const shellProfile = (h0: number, h1: number, radius: (h: number) => number, inner: (h: number) => number) => {
      const hs = new Set<number>();
      const n = 64;
      for (let i = 0; i <= n; i++) hs.add(h0 + ((h1 - h0) * i) / n);
      for (const r of this.rings) for (const h of [r.h0, r.h1]) if (h > h0 && h < h1) hs.add(h);
      const sorted = [...hs].sort((a, b) => a - b);
      const outerPts: THREE.Vector2[] = [];
      for (const h of sorted) {
        const onEdge = this.rings.find((r) => Math.abs(h - r.h0) < 1e-6 || Math.abs(h - r.h1) < 1e-6);
        if (onEdge) {
          // step into / out of the groove
          const before = inRing(h - 0.02);
          const after = inRing(h + 0.02);
          outerPts.push(V2(radius(h) - (before ? groove : 0), h), V2(radius(h) - (after ? groove : 0), h));
        } else outerPts.push(V2(radius(h) - (inRing(h) ? groove : 0), h));
      }
      const innerPts = sorted
        .slice()
        .reverse()
        .map((h) => V2(inner(h), h));
      return [...outerPts, ...innerPts];
    };
    const shell = addPart(0.08, 0);
    /** Depth of the front name ring (a separate part in front of the shell). */
    const FRONT_RING = 3.5;
    const shellEnd = extending ? hSplit : L - FRONT_RING;
    solid(shellProfile(3.2, shellEnd, outer, (h) => outer(h) - wall), satin, shell, 160);

    // rings: focus, zoom, control, tripod collar
    for (const r of this.rings) {
      const part = addPart(r.kind === 'focus' ? 0.18 : 0.14, 0);
      const R0 = outer((r.h0 + r.h1) / 2);
      let mat: THREE.Material;
      let profile: THREE.Vector2[];
      if (r.kind === 'focus' || r.kind === 'zoom') {
        const lines = r.kind === 'zoom' ? 110 : 150;
        const m = ribbed(r.kind === 'focus' ? this.focusTex : this.zoomTex, lines, 1);
        (r.kind === 'focus' ? this.ringMats : this.zoomMats).push(m);
        mat = m;
        const c = Math.min(1.2, (r.h1 - r.h0) * 0.12);
        profile = [V2(R0 - groove, r.h0), V2(R0 + 0.2, r.h0), V2(R0 + 0.9, r.h0 + c), V2(R0 + 0.9, r.h1 - c), V2(R0 + 0.2, r.h1), V2(R0 - groove, r.h1)];
      } else if (r.kind === 'control') {
        mat = knurlMat();
        profile = ringProfile(R0 - groove, R0 + 0.35, r.h0, r.h1, 0.25);
      } else {
        mat = new THREE.MeshPhysicalMaterial({ color: '#202226', metalness: 0.85, roughness: 0.3, clearcoat: 0.7 });
        profile = ringProfile(R0 - groove, R0 + 2.2, r.h0, r.h1, 0.6);
      }
      const ringMesh = solid(profile, mat, part, 160);
      if (r.kind === 'focus') {
        part.add(this.focusRing);
        this.focusRingMeshes.push(ringMesh);
      } else if (r.kind === 'zoom') {
        const zoomRing = new THREE.Group();
        part.add(zoomRing);
        const meshes = [ringMesh];
        const mats = this.zoomMats;
        this.zoomRing = {
          focusRingMeshes: meshes,
          focusRing: zoomRing,
          ringThrow: this.zoomThrow,
          setRingHover: (a) => {
            for (const m of mats) m.emissiveIntensity = a * 0.35;
          },
        };
      }
    }

    // accent ring near the mount (the Lens Lab signature, not a maker's trade dress)
    {
      const h = Math.min(0.12 * L, 14);
      const part = addPart(0.1, 0);
      solid(ringProfile(outer(h) - 0.4, outer(h) + 0.18, h, h + Math.max(0.9, 0.012 * L)), accent, part);
    }

    // AF / IS switch panel on the visible flank
    if (lens.data?.autofocus && !/manual/i.test(lens.data.autofocus)) {
      const part = addPart(0.12, 0);
      const h = this.rings.some((r) => r.kind === 'collar') ? 0.2 * L : Math.max(12, 0.24 * L);
      const R = outer(h);
      const phi = 0.55;
      const len = Math.min(26, 0.16 * L);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(len * k, 0.8 * k, 9 * k), satin);
      const place = (o: THREE.Object3D, r: number, x: number, ph: number) => {
        o.position.set(x * k, -r * k * Math.sin(ph), r * k * Math.cos(ph));
        o.rotation.x = ph + Math.PI / 2;
      };
      place(panel, R + 0.3, h, phi);
      part.add(panel);
      const toggles = lens.stabilized ? 2 : 1;
      for (let i = 0; i < toggles; i++) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(3.2 * k, 1.1 * k, 2.4 * k), accent);
        place(t, R + 0.9, h - len / 2 + (len * (i + 1)) / (toggles + 1), phi);
        part.add(t);
      }
    }

    // front: name ring with the lens' spec (no maker names or trade dress) + filter thread
    const a0 = lay.elements[0].a;
    const frontParent = extending ? new THREE.Group() : addPart(0.24, 0.55);
    if (extending) {
      this.frontTube = frontParent;
      const part = addPart(0.24, 0.55);
      part.add(frontParent);
      // front barrel + the inner sleeve that slides out of the fixed shell
      solid(shellProfile(hSplit, L - FRONT_RING, outer, (h) => outer(h) - wall), satin, frontParent, 160);
      const rs = outer(hSplit) - wall;
      solid(ringProfile(rs - 1.0, rs - 0.2, hSplit - extMax - 6, hSplit + 1), sleeveMat, frontParent);
    }
    const innerAt = (h: number) => outer(h) - wall - 1.1;
    {
      const rOut = outer(L) - wall * 0.5;
      const rIn = Math.min(rOut - 2, a0 + 1.4);
      // the lip itself stays outside the section tubes so moving groups never cut through it
      solid(ringProfile(Math.max(rIn, innerAt(L) + 0.25), outer(L) - 0.2, L - FRONT_RING, L, 0.3), satin, frontParent);
      const ring = new THREE.RingGeometry(rIn * k, rOut * k, 128, 1, 0, CUT_PHI_LENGTH);
      const p = ring.getAttribute('position') as THREE.BufferAttribute;
      const nrm = ring.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        p.setXYZ(i, (L + 0.02) * k, -y, x);
        nrm.setXYZ(i, 1, 0, 0);
      }
      const tex = specRingTexture(lens, rIn / rOut);
      mesh(ring, new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.5, roughness: 0.4, clearcoat: 0.6 }), frontParent);
    }

    // ---- optics: one group per moving section (section tube, cells, glass; the iris in its section)
    const els = lay.elements;
    lay.sections.forEach((sec, si) => {
      const g = new THREE.Group();
      g.name = sec.name;
      this.group.add(g);
      this.sectionGroups.push(g);
      const list = sec.elements.map((i) => els[i]);
      if (!list.length && !sec.carriesStop) {
        this.spread.push(0);
        return;
      }
      // axial extent of the section's glass at its rims
      let hi = -Infinity;
      let lo = Infinity;
      let rTube = Infinity;
      for (const e of list) {
        hi = Math.max(hi, e.h + frontSurfaceH(worldSpec(e, 1), e.a), e.h);
        lo = Math.min(lo, e.h - e.thickness + Math.min(0, rearSurfaceH(worldSpec(e, 1), e.a) + e.thickness), e.h - e.thickness);
        rTube = Math.min(rTube, innerAt(e.h), innerAt(e.h - e.thickness));
      }
      if (sec.carriesStop) {
        hi = Math.max(hi, lay.stopH + 2.2);
        lo = Math.min(lo, lay.stopH - 2.2);
        rTube = Math.min(rTube, innerAt(lay.stopH));
      }
      const tubeW = Math.max(0.9, 0.018 * D);
      const rTubeIn = rTube - tubeW;
      solid(ringProfile(rTubeIn, rTube, lo - 0.3, hi + 0.3, 0.2), cellMat, g, 112);

      // cells: one per air-spaced group, from the glass edge out to the section tube
      for (let i = 0; i < list.length; ) {
        let j = i;
        while (j < list.length - 1 && list[j].cementedToNext) j++;
        const first = list[i];
        const last = list[j];
        const aMax = Math.max(...list.slice(i, j + 1).map((e) => e.a));
        const cf = first.h + frontSurfaceH(worldSpec(first, 1), first.a) + 0.7;
        const cr = last.h + rearSurfaceH(worldSpec(last, 1), last.a) - 0.7;
        if (rTubeIn - (aMax - 0.35) > 0.3) solid(ringProfile(aMax - 0.35, rTubeIn, cr, cf, 0.15), cellMat, g, 112);
        i = j + 1;
      }

      // glass
      for (const e of list) {
        const spec = worldSpec(e, k);
        const kinds = e.special?.kinds ?? [];
        const color = kinds.length ? new THREE.Color(SPECIAL_COLORS[kinds[0]]) : null;
        const glass = new THREE.MeshPhysicalMaterial({
          color: '#ffffff',
          metalness: 0,
          roughness: 0.02,
          transmission: 1,
          thickness: Math.max(0.06, spec.thickness),
          ior: spec.ior,
          attenuationColor: color ? color.clone().lerp(new THREE.Color('#ffffff'), 0.55) : new THREE.Color(spec.tint),
          attenuationDistance: color ? 1.2 : 3,
          specularIntensity: 1,
          envMapIntensity: 2.2,
          iridescence: 0.45,
          iridescenceIOR: 1.33,
          iridescenceThicknessRange: [200, 450],
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        addGlassRim(glass, color ?? undefined, color ? 0.6 : 0.22);
        const eg = new THREE.Group();
        eg.position.x = spec.hFront;
        g.add(eg);
        const body = new THREE.Mesh(buildElementGeometry(spec), glass);
        body.renderOrder = 2;
        eg.add(body);
        const edge = new THREE.Mesh(
          buildElementEdge(spec),
          color ? new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.35), emissive: color, emissiveIntensity: 0.85, roughness: 0.5 }) : edgeMat,
        );
        edge.castShadow = true;
        eg.add(edge);
        this.specs.push({ el: e, spec, section: g });
      }

      // exploded view: sections spread along the axis away from the iris
      const d = si - lay.stopSection;
      this.spread.push(d < 0 ? -d * 0.18 : -(d + (sec.carriesStop ? 0 : 1)) * 0.14);
    });
    // keep the exploded sections on the bench
    {
      const frontSec = this.spread[0];
      const frontX = this.baseX + (L + extMax) * k + frontSec;
      if (frontX > X_FRONT_MAX + 0.35) {
        const f = Math.max(0, (X_FRONT_MAX + 0.35 - (this.baseX + (L + extMax) * k)) / frontSec);
        for (let i = 0; i < this.spread.length; i++) if (this.spread[i] > 0) this.spread[i] *= f;
      }
    }

    // iris: housing plates + blades (published blade count)
    const stopSec = this.sectionGroups[lay.stopSection];
    this.stopGroup.position.x = lay.stopH * k;
    stopSec.add(this.stopGroup);
    const housingOuter = (innerAt(lay.stopH) - Math.max(0.9, 0.018 * D)) * k;
    const maxR = lay.stopSemi * k;
    const bladeMat = new THREE.MeshPhysicalMaterial({ color: '#26282c', metalness: 0.9, roughness: 0.28, clearcoat: 0.5, side: THREE.DoubleSide });
    const irisMetal = new THREE.MeshPhysicalMaterial({ color: '#2a2c31', metalness: 0.9, roughness: 0.3, clearcoat: 0.6 });
    this.iris = new Iris(lens.blades, Math.max(maxR * 1.3, housingOuter - 0.01), maxR, bladeMat);
    this.stopGroup.add(this.iris.group);
    const plate = Math.max(0.006, 0.9 * k);
    const hOut = Math.max(maxR * 1.32, housingOuter);
    const irisSolid = (p: THREE.Vector2[], m: THREE.Material) => mesh(revolve(p, { groups: true, segments: 112 }), [m, section], this.stopGroup);
    irisSolid(ringProfile(maxR, hOut, plate * 0.35, plate * 1.25, plate * 0.1), irisMetal);
    irisSolid(ringProfile(maxR, hOut, -plate * 1.25, -plate * 0.35, plate * 0.1), irisMetal);
    irisSolid(ringProfile(hOut - plate * 0.8, hOut + plate * 0.2, -plate * 0.3, plate * 0.3), accent);

    // ---- cradle support: widest plain part of the fixed barrel that sits over the rail
    let best = { x: this.baseX + 0.5 * L * k, radius: outer(0.5 * L) * k, score: -Infinity };
    for (let i = 0; i <= 40; i++) {
      const h = 0.1 * L + (0.8 * L * i) / 40;
      if (h > shellEnd - 6) continue;
      const pad = 0.2 / k;
      if (this.rings.some((r) => h + pad > r.h0 && h - pad < r.h1)) continue;
      const x = this.baseX + h * k;
      if (x > BENCH.railXMax - 0.42 || x < -3.0) continue;
      const radius = outer(h) * k;
      const score = radius * 10 - Math.abs(h / L - 0.45);
      if (score > best.score) best = { x, radius, score };
    }
    this.support = { x: best.x, radius: best.radius };

    // ---- callouts: special glass (always), moving sections (exploded)
    const seen = new Set<string>();
    for (const s of lay.specials) {
      if (seen.has(s.label)) continue;
      seen.add(s.label);
      const first = this.specs.find((x) => x.el.index === s.elements[0]);
      if (!first) continue;
      const color = SPECIAL_COLORS[s.kinds[0]];
      const count = s.elements.length > 1 ? ` <span class="v">×${s.elements.length}</span>` : '';
      this.calloutList.push({
        id: `glass-${s.label}`,
        html: `<span class="dot" style="color:${color}"></span>${escapeHtml(s.label)}${count}`,
        color,
        world: new THREE.Vector3(),
        explodedOnly: false,
        anchor: () => this.elementTop(first.el, first.section),
      });
    }
    lay.sections.forEach((sec, si) => {
      if (sec.moves === 'fixed' || !sec.elements.length) return;
      const e = els[sec.elements[Math.floor(sec.elements.length / 2)]];
      const g = this.sectionGroups[si];
      const what = sec.moves === 'zoom' ? 'zooms' : sec.moves === 'focus' ? 'focuses' : 'zooms + focuses';
      this.calloutList.push({
        id: `sec-${si}`,
        html: `<span class="arrows">⟷</span>${escapeHtml(sec.name)} <span class="v">${what}</span>`,
        color: '#c8d3e6',
        world: new THREE.Vector3(),
        explodedOnly: true,
        anchor: () => {
          const v = new THREE.Vector3((e.h - e.thickness / 2) * k, -(innerAt(e.h) + 1) * k, 0);
          return g.localToWorld(v);
        },
      });
    });

    this.setExploded(0);
    this.applyPose(0, 0, lens.physics.maxAperture.wide, lens.physics.maxAperture.wide, 0);
  }

  // ------------------------------------------------------------------ pose

  apply(o: OpticsFrame, explode: number): void {
    this.setExploded(explode);
    this.applyPose(o.zoom, o.ringFraction, o.fNumber, o.maxApertureNow, explode);
  }

  private applyPose(zoom: number, focus: number, fNumber: number, maxAperture: number, explode: number): void {
    const lay = this.layout;
    const k = this.k;
    this.zoom = zoom;
    const e = easeInOut(THREE.MathUtils.clamp(explode, 0, 1));
    this.sectionGroups.forEach((g, si) => {
      g.position.x = lay.sectionOffset(si, zoom, focus) * k + this.spread[si] * e;
    });
    if (this.frontTube) this.frontTube.position.x = lay.extension(zoom) * k;
    // iris: wide open = full housing opening; stopping down scales it by N_max / N
    this.aperture = lay.stopSemi * k * Math.min(1, maxAperture / fNumber);
    this.iris.setRadius(this.aperture);
    // rotate the ring grips (texture offset follows the ring angle)
    const fk = ((focus * this.ringThrow) / (Math.PI * 2)) * this.gripRepeat;
    for (const t of this.focusTex) t.offset.x = fk;
    const zk = ((zoom * this.zoomThrow) / (Math.PI * 2)) * 110;
    for (const t of this.zoomTex) t.offset.x = zk;
  }

  private setExploded(t: number): void {
    this.explodeAmount = t;
    for (const p of this.parts) {
      const local = THREE.MathUtils.clamp((t - p.delay) / 0.7, 0, 1);
      const kk = easeInOut(smoothstep(local) * 0.5 + local * 0.5);
      p.object.position.lerpVectors(p.assembled, p.exploded, kk);
    }
  }

  setRingHover(amount: number): void {
    for (const m of this.ringMats) m.emissiveIntensity = amount * 0.35;
  }

  // ------------------------------------------------------------------ ray tracer interface

  getSurfaces(out: SurfaceInfo[] = []): SurfaceInfo[] {
    out.length = 0;
    const base = this.group.position.x;
    for (const { spec, section } of this.specs) {
      const x0 = base + section.position.x + spec.hFront;
      out.push({ x: x0, xAt: (r) => x0 + frontSurfaceH(spec, r), radius: spec.radius });
      out.push({ x: x0 - spec.thickness, xAt: (r) => x0 + rearSurfaceH(spec, r), radius: spec.radius });
    }
    return out;
  }

  get stopX(): number {
    return this.group.position.x + this.sectionGroups[this.layout.stopSection].position.x + this.layout.stopH * this.k;
  }

  get apertureRadius(): number {
    return this.aperture;
  }

  /** Ray height at the front element ÷ at the iris: rays fan out to the entrance pupil. */
  pupilScale(x: number): number {
    const xs = this.stopX;
    const first = this.specs[0];
    const xf = this.group.position.x + first.section.position.x + first.spec.hFront;
    if (x <= xs || xf <= xs) return 1;
    const t = smoothstep(THREE.MathUtils.clamp((x - xs) / (xf - xs), 0, 1));
    return 1 + (this.layout.pupilRatio(this.zoom) - 1) * t;
  }

  get frontX(): number {
    return this.group.position.x + (this.layout.length + this.layout.extension(this.zoom)) * this.k;
  }

  // ------------------------------------------------------------------ labels

  ringHintPoint(out: THREE.Vector3): THREE.Vector3 {
    const r = this.rings.find((x) => x.kind === 'focus');
    const h = r ? (r.h0 + r.h1) / 2 : this.layout.length * 0.6;
    const R = this.layout.outerRadius(h) * this.k;
    out.set(h * this.k, -R * 0.55, R * 0.9);
    return this.group.localToWorld(out);
  }

  irisLabelPoint(out: THREE.Vector3): THREE.Vector3 {
    out.set(this.stopX, LAYOUT.axisY - this.layout.outerRadius(this.layout.stopH) * this.k * 0.8, 0.3);
    return out;
  }

  private elementTop(e: LayoutElement, section: THREE.Group): THREE.Vector3 {
    const v = new THREE.Vector3((e.h - e.thickness / 2) * this.k, e.a * this.k, 0);
    return section.localToWorld(v);
  }

  callouts(): readonly LensCallout[] {
    this.group.updateMatrixWorld();
    for (const c of this.calloutList) c.world.copy(c.anchor());
    return this.calloutList;
  }

  get explode(): number {
    return this.explodeAmount;
  }

  dispose(): void {
    const textures = new Set<THREE.Texture>();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v);
        mat.dispose();
      }
    });
    for (const t of textures) t.dispose();
  }
}

/** Element in world (k = scale) or mm (k = 1) units, in the ElementSpec form the geometry helpers use. */
function worldSpec(e: LayoutElement, k: number): ElementSpec {
  const special = e.special?.kinds ?? [];
  const ior = special.includes('fluorite') ? 1.434 : special.some((s) => s.includes('dispersion')) ? 1.5 : special.includes('high-refractive') ? 1.9 : e.power > 0 ? 1.62 : 1.72;
  return {
    id: `E${e.index + 1}`,
    name: `Element ${e.index + 1}`,
    glass: e.special?.label ?? (e.power > 0 ? 'Crown' : 'Flint'),
    hFront: e.h * k,
    hFrontExploded: e.h * k,
    thickness: e.thickness * k,
    r1: e.r1 * k,
    r2: e.r2 * k,
    radius: e.a * k,
    ior,
    tint: e.power > 0 ? '#f2fffb' : '#fffbee',
  };
}

/** Focus / zoom / control rings along the barrel (fractions of the length; illustrative). */
function ringLayout(lens: LabLens, L: number): Ring[] {
  const r = (kind: Ring['kind'], a: number, b: number): Ring => ({ kind, h0: a * L, h1: b * L });
  switch (lens.layout) {
    case 'super-tele':
      return [r('collar', 0.1, 0.16), r('focus', 0.22, 0.31)];
    case 'telephoto':
      return [r('collar', 0.14, 0.2), r('focus', 0.3, 0.42)];
    case 'zoom-tele':
      return [r('zoom', 0.28, 0.46), r('focus', 0.54, 0.66)];
    case 'zoom-super':
      return [r('collar', 0.12, 0.18), r('zoom', 0.3, 0.48), r('focus', 0.54, 0.64)];
    case 'zoom-standard':
    case 'zoom-wide':
      return [r('zoom', 0.36, 0.6), r('focus', 0.66, 0.8)];
    default:
      if (L < 55) return [r('focus', 0.42, 0.84)];
      return [r('focus', 0.48, 0.76), r('control', 0.82, 0.88)];
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Front name ring: the lens' focal length, maximum aperture and filter size (no brand names). */
function specRingTexture(lens: LabLens, innerFrac: number): THREE.Texture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.fillStyle = '#0b0c0e';
  x.fillRect(0, 0, S, S);
  const p = lens.physics;
  const focal = p.focal.min === p.focal.max ? `${p.focal.min}mm` : `${p.focal.min}-${p.focal.max}mm`;
  const ap = p.maxAperture.wide === p.maxAperture.tele ? `1:${p.maxAperture.wide}` : `1:${p.maxAperture.wide}-${p.maxAperture.tele}`;
  const filter = lens.data?.filterMm ? `⌀${lens.data.filterMm}mm` : '';
  const text = `${focal}   ${ap}   ${filter}   ${lens.elements} ELEMENTS · ${lens.groups} GROUPS   `;
  x.translate(S / 2, S / 2);
  // RingGeometry UVs map the outer radius to the texture edge
  const radius = (S / 2) * (0.5 + innerFrac / 2);
  const size = Math.max(22, Math.min(40, (S / 2) * (1 - innerFrac) * 0.55));
  x.font = `600 ${size}px Inter, system-ui, sans-serif`;
  x.fillStyle = '#e8e8e8';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const total = text.length;
  // the ring is cut away over its last quarter: keep the text on the visible 270°
  for (let i = 0; i < total; i++) {
    x.save();
    x.rotate(-Math.PI + 0.12 + (i / total) * (Math.PI * 1.5 - 0.24));
    x.translate(0, -radius);
    x.fillText(text[i], 0, 0);
    x.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
