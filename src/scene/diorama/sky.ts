import * as THREE from 'three';
import { canvasTexture, makeCanvas } from '../../util/textures';
import { LAYER_SENSOR_ONLY } from '../layout';
import { createSkyMaterial } from './skyShader';

/** Back of the light box: dark anodised panel with vertical ribs and a small silkscreen. */
function lightboxBackTexture(): THREE.Texture {
  const W = 2048;
  const H = 512;
  const [c, x] = makeCanvas(W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#23262c');
  g.addColorStop(1, '#14161a');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 24; i++) {
    const px = (i + 0.5) * (W / 24);
    x.fillStyle = 'rgba(255,255,255,0.05)';
    x.fillRect(px - 2, 0, 4, H);
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.fillRect(px + 2, 0, 3, H);
  }
  x.fillStyle = 'rgba(230,232,238,0.55)';
  x.font = '600 26px "JetBrains Mono Variable", ui-monospace, monospace';
  x.textAlign = 'center';
  x.fillText('LENS·LAB  SKY LIGHT-BOX  ·  ∞  ·  5600 K', W / 2, H * 0.86);
  return canvasTexture(c, { srgb: true });
}

export interface SkyPanel {
  group: THREE.Group;
  panel: THREE.Mesh;
}

/**
 * Cylindrical light-box behind the diorama, centred on the lens' perspective centre and facing it.
 * `radius` is measured from (cx, ·, 0). Its surface shows the procedural sky exactly as the lens
 * sees it in that direction.
 */
export function buildSkyPanel(cx: number, radius: number, yBottom: number, yTop: number, halfAngle: number): SkyPanel {
  const group = new THREE.Group();
  group.name = 'sky';
  const height = yTop - yBottom;
  const geo = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true, Math.PI / 2 - halfAngle, halfAngle * 2);
  const panel = new THREE.Mesh(geo, createSkyMaterial(THREE.BackSide));
  panel.position.set(cx, yBottom + height / 2, 0);
  group.add(panel);

  // the back of the light box + a slim aluminium frame along the top edge
  const backGeo = new THREE.CylinderGeometry(radius + 0.06, radius + 0.06, height + 0.06, 96, 1, true, Math.PI / 2 - halfAngle - 0.006, halfAngle * 2 + 0.012);
  const back = new THREE.Mesh(backGeo, new THREE.MeshPhysicalMaterial({ map: lightboxBackTexture(), metalness: 0.55, roughness: 0.5, side: THREE.FrontSide }));
  back.position.copy(panel.position);
  back.castShadow = true;
  group.add(back);
  const postMat = new THREE.MeshPhysicalMaterial({ color: '#8c929b', metalness: 1, roughness: 0.32 });
  for (const sgn of [-1, 1]) {
    const a = sgn * (halfAngle + 0.006);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, height + 0.12, 0.07), postMat);
    post.position.set(cx + (radius + 0.03) * Math.cos(a), yBottom + height / 2, (radius + 0.03) * Math.sin(a));
    post.rotation.y = -a;
    post.castShadow = true;
    group.add(post);
  }
  const rimGeo = new THREE.TorusGeometry(radius + 0.03, 0.03, 8, 96, halfAngle * 2 + 0.012);
  const rim = new THREE.Mesh(rimGeo, new THREE.MeshPhysicalMaterial({ color: '#9ea3ab', metalness: 1, roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2;
  rim.rotation.z = -halfAngle - 0.006;
  rim.position.set(cx, yTop + 0.03, 0);
  group.add(rim);
  return { group, panel };
}

/** Sky dome around the whole scene, visible to the sensor camera only (wide-angle lenses). */
export function buildSkyDome(cx: number, cy: number, radius: number): THREE.Mesh {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), createSkyMaterial(THREE.BackSide));
  dome.position.set(cx, cy, 0);
  dome.layers.set(LAYER_SENSOR_ONLY);
  dome.name = 'sky-dome';
  dome.frustumCulled = false;
  return dome;
}
