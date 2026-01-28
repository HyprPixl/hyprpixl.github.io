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
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const timeUniform = { value: 0 };
  const frontUniforms = {
    time: timeUniform,
    warpAmp: { value: 0.2 },
    warpFreq: { value: 5.0 },
    warpPhase: { value: 0.0 },
    baseColor: { value: new THREE.Color(1.0, 0.3, 0.0) },
    baseAlpha: { value: 1.0 }
  };
  const backUniforms = {
    time: timeUniform,
    warpAmp: { value: 0.28 },
    warpFreq: { value: 3.2 },
    warpPhase: { value: 1.8 },
    baseColor: { value: new THREE.Color(0.9, 0.2, 0.05) },
    baseAlpha: { value: 0.55 }
  };
  const glowUniforms = {
    time: timeUniform,
    warpAmp: { value: 0.25 },
    warpFreq: { value: 4.2 },
    warpPhase: { value: 2.4 },
    glowColor: { value: new THREE.Color(0xff6600) }
  };

  const orbMat = new THREE.ShaderMaterial({
    uniforms: frontUniforms,
    vertexShader: document.getElementById('vertexShader').textContent,
    fragmentShader: document.getElementById('fragmentShader').textContent
  });
  const geometry = new THREE.IcosahedronGeometry(1, 128);
  const orb = new THREE.Mesh(geometry, orbMat);
  orb.renderOrder = 2;
  scene.add(orb);

  const backGeometry = new THREE.IcosahedronGeometry(1, 64);
  const backMat = new THREE.ShaderMaterial({
    uniforms: backUniforms,
    vertexShader: document.getElementById('vertexShader').textContent,
    fragmentShader: document.getElementById('fragmentShader').textContent,
    transparent: true,
    depthWrite: false
  });
  const backOrb = new THREE.Mesh(backGeometry, backMat);
  backOrb.scale.set(1.12, 1.12, 1.12);
  backOrb.position.z = -0.2;
  backOrb.renderOrder = 0;
  scene.add(backOrb);

  const glowMat = new THREE.ShaderMaterial({
    uniforms: glowUniforms,
    vertexShader: document.getElementById('glowVertex').textContent,
    fragmentShader: document.getElementById('glowFragment').textContent,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false
  });
  const glow = new THREE.Mesh(geometry, glowMat);
  glow.scale.set(1.2, 1.2, 1.2);
  glow.renderOrder = 1;
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
    renderer.setPixelRatio(window.devicePixelRatio || 1);
  }
  window.addEventListener('resize', onResize);

  function animate() {
    timeUniform.value += 0.01;

    orb.rotation.y += 0.005;
    orb.rotation.x += 0.005;
    backOrb.rotation.y -= 0.003;
    backOrb.rotation.x += 0.004;

    orb.rotation.x += (mouseY * 0.5 - orb.rotation.x) * 0.02;
    orb.rotation.y += (mouseX * 0.5 - orb.rotation.y) * 0.02;
    backOrb.rotation.x += (mouseY * 0.35 - backOrb.rotation.x) * 0.01;
    backOrb.rotation.y += (mouseX * 0.35 - backOrb.rotation.y) * 0.01;
    glow.rotation.copy(orb.rotation);

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();
})();

