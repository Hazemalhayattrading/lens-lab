import * as THREE from 'three';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#06080c');
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.5, 6);
camera.lookAt(0, 0, 0);

const lens = new THREE.Mesh(
  new THREE.SphereGeometry(1, 64, 32),
  new THREE.MeshStandardMaterial({ color: '#8ab4ff', roughness: 0.2, metalness: 0.1 }),
);
lens.scale.set(0.35, 1, 1);
scene.add(lens);
scene.add(new THREE.HemisphereLight('#ffffff', '#202030', 1.5));

renderer.setAnimationLoop((t) => {
  lens.rotation.y = t * 0.0005;
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
