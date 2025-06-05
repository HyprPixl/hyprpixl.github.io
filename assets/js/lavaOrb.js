// lavaOrb.js
import * as THREE from './three.module.min.js';

// — init renderer, scene, camera
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 100);
camera.position.z = 3;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.getElementById("lava-container").appendChild(renderer.domElement);

// — uniforms
const uniforms = { time: { value: 0 } };

// — main “lava” orb
const orbMat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader:   document.getElementById('vertexShader').textContent,
  fragmentShader: document.getElementById('fragmentShader').textContent
});
const geometry = new THREE.IcosahedronGeometry(1, 128);
const orb = new THREE.Mesh(geometry, orbMat);
scene.add(orb);

// — glow shell
const glowMat = new THREE.ShaderMaterial({
  uniforms:    { glowColor: { value: new THREE.Color(0xff6600) } },
  vertexShader:   document.getElementById('glowVertex').textContent,
  fragmentShader: document.getElementById('glowFragment').textContent,
  side: THREE.BackSide,
  blending: THREE.AdditiveBlending,
  transparent: true
});
const glow = new THREE.Mesh(geometry, glowMat);
glow.scale.set(1.2, 1.2, 1.2);
scene.add(glow);

// — mouse interaction
let mouseX = 0, mouseY = 0;
document.addEventListener('mousemove', (e) => {
  mouseX = (e.clientX / innerWidth) * 2 - 1;
  mouseY = -(e.clientY / innerHeight) * 2 + 1;
});

// — handle resize
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// — animation loop
function animate() {
  uniforms.time.value += 0.01;

  // gentle auto-rotation
  orb.rotation.y += 0.005;
  orb.rotation.x += 0.005;

  // ease toward mouse
  orb.rotation.x += (mouseY * 0.5 - orb.rotation.x) * 0.02;
  orb.rotation.y += (mouseX * 0.5 - orb.rotation.y) * 0.02;
  glow.rotation.copy(orb.rotation);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
