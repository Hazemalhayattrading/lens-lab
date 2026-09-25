import * as THREE from 'three';
import { rng } from '../../util/noise';
import { canvasTexture, makeCanvas } from '../../util/textures';

/** Painted dusk sky for the diorama's curved backdrop (a back-lit print, like a light box). */
export function skyTexture(): THREE.Texture {
  const W = 2048;
  const H = 1024;
  const [c, x] = makeCanvas(W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, '#070d22');
  g.addColorStop(0.28, '#16244d');
  g.addColorStop(0.5, '#3b3f78');
  g.addColorStop(0.64, '#8a5a86');
  g.addColorStop(0.76, '#e0876a');
  g.addColorStop(0.86, '#ffc38a');
  g.addColorStop(1.0, '#ffe2b8');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  const random = rng(8);
  // stars
  for (let i = 0; i < 900; i++) {
    const sx = random() * W;
    const sy = Math.pow(random(), 1.6) * H * 0.55;
    const b = random();
    const fade = 1 - sy / (H * 0.55);
    x.fillStyle = `rgba(255,255,255,${(0.25 + b * 0.75) * fade})`;
    const r = b > 0.97 ? 2.2 : b > 0.85 ? 1.4 : 0.8;
    x.beginPath();
    x.arc(sx, sy, r, 0, Math.PI * 2);
    x.fill();
    if (b > 0.985) {
      const glow = x.createRadialGradient(sx, sy, 0, sx, sy, 10);
      glow.addColorStop(0, `rgba(200,220,255,${0.5 * fade})`);
      glow.addColorStop(1, 'rgba(200,220,255,0)');
      x.fillStyle = glow;
      x.fillRect(sx - 10, sy - 10, 20, 20);
    }
  }
  // crescent moon
  const mx = W * 0.23;
  const my = H * 0.2;
  const halo = x.createRadialGradient(mx, my, 10, mx, my, 120);
  halo.addColorStop(0, 'rgba(255,244,220,0.35)');
  halo.addColorStop(1, 'rgba(255,244,220,0)');
  x.fillStyle = halo;
  x.fillRect(mx - 120, my - 120, 240, 240);
  // crescent: lit disc minus an offset disc, built as a single path (no compositing holes)
  x.fillStyle = '#fff6df';
  x.beginPath();
  x.arc(mx, my, 34, Math.PI * 0.62, Math.PI * 1.88, false);
  x.arc(mx + 14, my - 8, 30, Math.PI * 1.72, Math.PI * 0.77, true);
  x.closePath();
  x.fill();
  // wispy clouds lit from below
  for (let i = 0; i < 26; i++) {
    const cy = H * (0.55 + random() * 0.28);
    const cx = random() * W;
    const w = 180 + random() * 420;
    const h = 8 + random() * 16;
    const cg = x.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    const a = 0.12 + random() * 0.18;
    cg.addColorStop(0, 'rgba(255,190,150,0)');
    cg.addColorStop(0.5, `rgba(255,${170 + Math.floor(random() * 50)},140,${a})`);
    cg.addColorStop(1, 'rgba(255,190,150,0)');
    x.fillStyle = cg;
    x.beginPath();
    x.ellipse(cx, cy, w / 2, h, 0, 0, Math.PI * 2);
    x.fill();
  }
  const tex = canvasTexture(c, { srgb: true, anisotropy: 4 });
  return tex;
}

export interface SkyPanel {
  group: THREE.Group;
  panel: THREE.Mesh;
}

/**
 * Cylindrical backdrop centred on the lens' optical centre, facing the lens.
 * `radius` is measured from (cx, cy, 0).
 */
export function buildSkyPanel(cx: number, radius: number, yBottom: number, yTop: number, halfAngle: number): SkyPanel {
  const group = new THREE.Group();
  group.name = 'sky';
  const height = yTop - yBottom;
  const geo = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true, Math.PI / 2 - halfAngle, halfAngle * 2);
  const tex = skyTexture();
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = -1; // seen from inside → un-mirror
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
  mat.color.setScalar(1.35);
  const panel = new THREE.Mesh(geo, mat);
  panel.position.set(cx, yBottom + height / 2, 0);
  group.add(panel);

  // the back of the light box + a slim aluminium frame along the top edge
  const backGeo = new THREE.CylinderGeometry(radius + 0.06, radius + 0.06, height + 0.06, 96, 1, true, Math.PI / 2 - halfAngle - 0.006, halfAngle * 2 + 0.012);
  const back = new THREE.Mesh(backGeo, new THREE.MeshPhysicalMaterial({ color: '#15171b', metalness: 0.6, roughness: 0.45, side: THREE.FrontSide }));
  back.position.copy(panel.position);
  back.castShadow = true;
  group.add(back);
  const rimGeo = new THREE.TorusGeometry(radius + 0.03, 0.03, 8, 96, halfAngle * 2 + 0.012);
  const rim = new THREE.Mesh(rimGeo, new THREE.MeshPhysicalMaterial({ color: '#9ea3ab', metalness: 1, roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2;
  rim.rotation.z = -halfAngle - 0.006;
  rim.position.set(cx, yTop + 0.03, 0);
  group.add(rim);
  return { group, panel };
}
