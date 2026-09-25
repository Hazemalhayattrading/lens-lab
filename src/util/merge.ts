import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merges all plain (non-instanced) meshes under `root` that share a material into one mesh per
 * material, baking their transforms relative to `root`. Cuts draw calls for static props.
 */
export function mergeStaticByMaterial(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; cast: boolean; receive: boolean }>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material)) return;
    if (mesh.userData.keep) return;
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()) as THREE.BufferGeometry;
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    let b = buckets.get(mesh.material);
    if (!b) {
      b = { geos: [], meshes: [], cast: false, receive: false };
      buckets.set(mesh.material, b);
    }
    b.geos.push(g);
    b.meshes.push(mesh);
    b.cast ||= mesh.castShadow;
    b.receive ||= mesh.receiveShadow;
  });
  for (const [material, b] of buckets) {
    if (b.meshes.length < 2) continue;
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    for (const m of b.meshes) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    root.add(mesh);
  }
  // drop groups that became empty
  const empties: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && o.type === 'Group' && o.children.length === 0) empties.push(o);
  });
  for (const e of empties) e.parent?.remove(e);
}
