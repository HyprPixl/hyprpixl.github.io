import { startLava, stopLava } from './lavaOrb.js';

(() => {
  const btn = document.getElementById('lava-toggle-btn');
  if (!btn) return;
  let active = false;
  btn.addEventListener('click', () => {
    active = !active;
    if (active) {
      startLava();
      btn.textContent = 'Lava Lamp: ON';
      document.body.classList.add('lava-on');
    } else {
      stopLava();
      btn.textContent = 'Lava Lamp';
      document.body.classList.remove('lava-on');
    }
  });
})();
