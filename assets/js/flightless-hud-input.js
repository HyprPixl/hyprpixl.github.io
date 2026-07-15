// Flightless — HUD readout + input module.
//
// Owns the `input` object physics reads every frame (up/down/boost/ff),
// the keyboard/touch bindings that mutate it, and the HUD DOM sync
// (distance/altitude/speed/fuel/burner readouts + hint text). Doesn't own
// any sim state itself — reads phase/run/st off the shared `sim` object,
// and calls out to injected callbacks for anything that isn't its concern
// (starting a launch, firing the afterburner/gun, closing results, etc).
export function createHudInput(deps){
  const {
    sim, state, input, SFX, fmtDist,
    startLaunch, closeResults, skipSlide, fireAfterburner, fireGun,
  } = deps;

  /* ════════════════ input ════════════════ */
  // `input` is created once in the host page and shared with the physics
  // and renderer modules, which read it every frame — not owned here.
  function bindHold(el, prop){
    const on = e => { e.preventDefault(); input[prop]=true; SFX.ensure(); };
    const off = () => { input[prop]=false; };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }
  bindHold(document.getElementById('t-up'), 'up');
  bindHold(document.getElementById('t-down'), 'down');
  bindHold(document.getElementById('t-boost'), 'boost');
  bindHold(document.getElementById('ff-btn'), 'ff');
  document.getElementById('t-burner').addEventListener('pointerdown', e => { e.preventDefault(); fireAfterburner(); });
  document.getElementById('t-gun').addEventListener('pointerdown', e => { e.preventDefault(); fireGun(); });

  const introEl = document.getElementById('intro');
  const shopEl = document.getElementById('shop');

  window.addEventListener('keydown', e => {
    if(e.repeat) return;
    switch(e.code){
      case 'ArrowUp': case 'KeyW': case 'ArrowLeft': case 'KeyA': input.up=true; e.preventDefault(); break;
      case 'ArrowDown': case 'KeyS': case 'ArrowRight': case 'KeyD': input.down=true; e.preventDefault(); break;
      case 'Space': input.boost=true; e.preventDefault(); break;
      case 'KeyF': input.ff=true; break;
      case 'KeyX': fireAfterburner(); break;
      case 'KeyC': fireGun(); break;
      case 'Enter':
        if(introEl.classList.contains('show')) startLaunch();
        else if(sim.phase==='shop' && shopEl.classList.contains('show')) startLaunch();
        else if(sim.phase==='results') closeResults();
        else if(sim.phase==='flight' && sim.run && sim.run.sliding) skipSlide();
        break;
    }
  });
  window.addEventListener('keyup', e => {
    switch(e.code){
      case 'ArrowUp': case 'KeyW': case 'ArrowLeft': case 'KeyA': input.up=false; break;
      case 'ArrowDown': case 'KeyS': case 'ArrowRight': case 'KeyD': input.down=false; break;
      case 'Space': input.boost=false; break;
      case 'KeyF': input.ff=false; break;
    }
  });

  /* ════════════════ HUD ════════════════ */
  const hintEl = document.getElementById('hint');
  const ffBtn = document.getElementById('ff-btn');
  const hudDist = document.getElementById('hud-dist');
  const hudAlt = document.getElementById('hud-alt');
  const hudSpd = document.getElementById('hud-spd');
  const altWrap = document.getElementById('alt-wrap');
  const spdWrap = document.getElementById('spd-wrap');
  const fuelWrap = document.getElementById('fuel-wrap');
  const fuelBar = document.getElementById('fuel-bar');
  const burnerWrap = document.getElementById('burner-wrap');
  const hudBurner = document.getElementById('hud-burner');

  function renderHUD(){
    const { run, st, phase } = sim;
    hudDist.textContent = fmtDist(Math.max(0, run.dist));
    if(state.perm.alti){
      altWrap.style.display = 'block';
      hudAlt.textContent = fmtDist(Math.max(0, run.y));
    } else altWrap.style.display = 'none';
    if(state.perm.speedo){
      spdWrap.style.display = 'block';
      hudSpd.textContent = Math.round(Math.hypot(run.vx, run.vy));
    } else spdWrap.style.display = 'none';
    if(st.fuelMax > 0){
      fuelWrap.style.display = 'block';
      fuelBar.style.width = (run.fuel/st.fuelMax*100)+'%';
    } else fuelWrap.style.display = 'none';
    if(state.perm.burner){
      burnerWrap.style.display = 'block';
      hudBurner.textContent = run.burnerUsed ? 'SPENT' : '\u{1F4A5} READY';
      hudBurner.className = run.burnerUsed ? 'spent' : '';
    } else burnerWrap.style.display = 'none';
    ffBtn.classList.toggle('on', input.ff);
    if(run.sliding){
      hintEl.textContent = 'sliding… press ENTER to skip ahead';
      hintEl.style.display = 'block';
    } else if(state.day <= 3 && phase==='flight'){
      hintEl.textContent = state.lvl.wings>0
        ? '⇧ pull up · ⇩ dive for speed' + (st.thrust>0 ? ' · SPACE rocket' : '') + (st.gunLevel>0 ? ' · C fire cannon' : '') + ' · F fast-forward'
        : 'no wings yet… enjoy the flop';
      hintEl.style.display = 'block';
    } else hintEl.style.display = 'none';
  }

  return { renderHUD };
}
