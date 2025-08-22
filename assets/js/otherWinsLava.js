import * as THREE from './three.module.min.js';

(() => {
  const container = document.getElementById('wins-lava');
  if (!container || window.innerWidth < 900) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.z = 3;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const uniforms = { time: { value: 0 } };

  const orbMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: document.getElementById('vertexShader').textContent,
    fragmentShader: document.getElementById('fragmentShader').textContent
  });
  const geometry = new THREE.IcosahedronGeometry(1, 128);
  const orb = new THREE.Mesh(geometry, orbMat);
  scene.add(orb);

  const glowMat = new THREE.ShaderMaterial({
    uniforms: { glowColor: { value: new THREE.Color(0xff6600) } },
    vertexShader: document.getElementById('glowVertex').textContent,
    fragmentShader: document.getElementById('glowFragment').textContent,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true
  });
  const glow = new THREE.Mesh(geometry, glowMat);
  glow.scale.set(1.2, 1.2, 1.2);
  scene.add(glow);

  let mouseX = 0, mouseY = 0;
  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  });

  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  function animate() {
    uniforms.time.value += 0.01;

    orb.rotation.y += 0.005;
    orb.rotation.x += 0.005;

    orb.rotation.x += (mouseY * 0.5 - orb.rotation.x) * 0.02;
    orb.rotation.y += (mouseX * 0.5 - orb.rotation.y) * 0.02;
    glow.rotation.copy(orb.rotation);

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();
})();

