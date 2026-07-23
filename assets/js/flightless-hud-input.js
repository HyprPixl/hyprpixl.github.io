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
  const releaseLaunch = typeof deps.releaseLaunch === 'function' ? deps.releaseLaunch : () => {};

  /* ════════════════ sim.paused contract ════════════════ */
  // Set here; the HTML main loop reads it to freeze sim stepping.
  // Only meaningful during 'ramp'/'flight' phases.
  sim.paused = false;

  /* ════════════════ device detection ════════════════ */
  const isCoarse = window.matchMedia('(pointer:coarse)').matches;

  /* ════════════════ contextual onboarding flags ════════════════ */
  // Each fires at most once per session.
  let shownPullUp   = false;
  let shownStall    = false;
  let shownBounce   = false;

  // Last-seen values for haptic polling and bounce detection.
  let _lastBounceCount = 0;
  let _lastSliding     = false;

  /* ════════════════ pause helper ════════════════ */
  const hintEl = document.getElementById('hint');

  function togglePause(){
    const phase = sim.phase;
    if(phase !== 'ramp' && phase !== 'flight') return;
    sim.paused = !sim.paused;
    if(sim.paused){
      hintEl.textContent = 'PAUSED — press P or Escape to resume';
      hintEl.style.display = 'block';
    }
    // When unpausing let the next renderHUD call restore the normal hint.
  }

  /* ════════════════ touch controls ════════════════ */
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

  /* ── Pause button injected into touch controls ── */
  // We reuse the existing #touch panel by appending a pause button to the
  // right group so it sits alongside the existing action buttons.
  const pauseBtn = document.createElement('button');
  pauseBtn.id = 't-pause';
  pauseBtn.className = 'tbtn';
  pauseBtn.setAttribute('aria-label', 'pause');
  pauseBtn.innerHTML = '&#9646;&#9646;'; // ❚❚
  pauseBtn.style.fontSize = '18px';
  const rightGroup = document.querySelector('#touch .tgroup:last-child');
  if(rightGroup) rightGroup.appendChild(pauseBtn);
  pauseBtn.addEventListener('pointerdown', e => { e.preventDefault(); SFX.ensure(); togglePause(); });

  /* ── Drag-to-steer on the canvas ── */
  // A vertical swipe/drag on the canvas sets up/down; doesn't interfere with
  // the existing #t-up / #t-down buttons.
  const canvas = document.getElementById('game');
  let dragStartY = null;
  const DRAG_DEAD = 12; // px deadzone before registering direction

  canvas.addEventListener('pointerdown', e => {
    // Only activate during flight; ignore multi-touch fingers beyond first.
    if(sim.phase !== 'flight' && sim.phase !== 'ramp') return;
    if(e.isPrimary === false) return;
    dragStartY = e.clientY;
  });
  canvas.addEventListener('pointermove', e => {
    if(dragStartY === null || !e.isPrimary) return;
    const dy = e.clientY - dragStartY;
    if(Math.abs(dy) < DRAG_DEAD){ input.up = false; input.down = false; return; }
    input.up   = dy < 0;   // swipe up   → pull up
    input.down = dy > 0;   // swipe down → dive
  });
  function endDrag(){
    if(dragStartY === null) return;
    dragStartY = null;
    input.up   = false;
    input.down = false;
  }
  canvas.addEventListener('pointerup',     endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave',  endDrag);

  /* ════════════════ keyboard ════════════════ */
  const introEl = document.getElementById('intro');
  const shopEl  = document.getElementById('shop');

  window.addEventListener('keydown', e => {
    if(e.repeat) return;
    switch(e.code){
      case 'ArrowUp': case 'KeyW': case 'ArrowLeft': case 'KeyA': input.up=true; e.preventDefault(); break;
      case 'ArrowDown': case 'KeyS': case 'ArrowRight': case 'KeyD': input.down=true; e.preventDefault(); break;
      case 'Space':
        e.preventDefault();
        if(sim.paused) break;
        // SPACE is the action key: launch off the perch, continue past the
        // results, otherwise it's the in-flight rocket boost.
        if(sim.phase==='perch') releaseLaunch();
        else if(sim.phase==='results') closeResults();
        else input.boost=true;
        break;
      case 'KeyF': input.ff=true; break;
      case 'KeyX': fireAfterburner(); break;
      case 'KeyC': fireGun(); break;
      case 'KeyP': case 'Escape': togglePause(); e.preventDefault(); break;
      case 'Enter':
        if(sim.paused) break; // eat Enter while paused, don't advance menus
        if(introEl.classList.contains('show')) startLaunch();
        else if(sim.phase==='shop' && shopEl.classList.contains('show')) startLaunch();
        else if(sim.phase==='perch') releaseLaunch();
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
  const ffBtn     = document.getElementById('ff-btn');
  const hudDist   = document.getElementById('hud-dist');
  const hudDistSub = document.getElementById('hud-dist-sub');
  const hudAlt    = document.getElementById('hud-alt');
  const hudSpd    = document.getElementById('hud-spd');
  const altWrap   = document.getElementById('alt-wrap');
  const spdWrap   = document.getElementById('spd-wrap');
  const fuelWrap  = document.getElementById('fuel-wrap');
  const fuelBar   = document.getElementById('fuel-bar');
  const HEAT_MAX_HUD = 3.0;   // mirrors physics HEAT_MAX (overheat threshold)
  const burnerWrap= document.getElementById('burner-wrap');
  const hudBurner = document.getElementById('hud-burner');

  // Hint text branches: keyboard phrasing vs touch phrasing.
  function flightHintText(st){
    if(!st) return '';
    if(isCoarse){
      // Touch device: reference the on-screen buttons.
      return (state.lvl?.wings > 0)
        ? '⬆ pull up · ⬇ dive for speed'
          + (st.thrust > 0 ? ' · \u{1F525} rocket' : '')
          + (st.gunLevel > 0 ? ' · \u{1F52B} fire' : '')
        : 'no wings yet… enjoy the flop';
    } else {
      // Keyboard/mouse device: reference key bindings.
      return (state.lvl?.wings > 0)
        ? '⇧ pull up · ⇩ dive for speed'
          + (st.thrust > 0 ? ' · SPACE rocket' : '')
          + (st.gunLevel > 0 ? ' · C fire cannon' : '')
          + ' · F fast-forward · P pause'
        : 'no wings yet… enjoy the flop';
    }
  }

  // One-time contextual hint overlay: shows briefly over the normal hint area.
  let contextHintTimer = 0;
  let contextHintText  = '';

  function showContextHint(text){
    contextHintText  = text;
    contextHintTimer = 4; // seconds to display (counted down in renderHUD via ~12 Hz)
  }

  function renderHUD(){
    const { run, st, phase } = sim;

    // Standard stat readouts.
    hudDist.textContent = fmtDist(Math.max(0, run.dist));
    // subline shows the record to beat — and flips to NEW BEST once you pass it
    if(hudDistSub){
      const best = state.best?.dist ?? 0;
      if(run.dist > best && best > 0){
        hudDistSub.textContent = '★ NEW BEST';
        hudDistSub.classList.add('record');
      } else {
        hudDistSub.textContent = best > 0 ? 'best ' + fmtDist(best) : 'distance';
        hudDistSub.classList.remove('record');
      }
    }
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
      // Bar WIDTH is fuel; bar COLOUR is heat: it warms from amber toward red
      // as the rocket nears overheat, then flashes once it actually overheats.
      const heatR = Math.min(1, (run.heat || 0) / HEAT_MAX_HUD);
      if(run.overheated){
        fuelBar.style.background = '';         // hand the colour to the flash animation
        fuelBar.classList.add('overheat');
      } else {
        fuelBar.classList.remove('overheat');
        fuelBar.style.background = heatR > 0.03
          ? `linear-gradient(90deg, hsl(${(40-40*heatR)|0},100%,48%), hsl(${(52-52*heatR)|0},100%,55%))`
          : '';                                // revert to the default CSS gradient
      }
    } else fuelWrap.style.display = 'none';
    if(state.perm.burner){
      burnerWrap.style.display = 'block';
      hudBurner.textContent = run.burnerUsed ? 'SPENT' : '\u{1F4A5} READY';
      hudBurner.className = run.burnerUsed ? 'spent' : '';
    } else burnerWrap.style.display = 'none';
    ffBtn.classList.toggle('on', input.ff);

    /* ── Haptic feedback on landings / bounces ── */
    if(navigator.vibrate){
      const bounceNow   = run.bounceCount ?? 0;
      const slidingNow  = !!run.sliding;
      if(bounceNow > _lastBounceCount){
        // New bounce — short sharp pulse, scaled by impact severity.
        navigator.vibrate(40);
      } else if(slidingNow && !_lastSliding){
        // Transition to sliding (landing) — two-pulse bump.
        navigator.vibrate([30, 20, 60]);
      }
      _lastBounceCount = bounceNow;
      _lastSliding     = slidingNow;
    }

    /* ── Contextual onboarding hints (first pull-up / stall / bounce) ── */
    // Only fire on days 1-3 so veterans aren't nagged.
    if(state.day <= 3 && phase === 'flight'){
      if(!shownPullUp && run.vy > 2 && (state.lvl?.wings ?? 0) > 0){
        shownPullUp = true;
        showContextHint('Good pull! ⬆ hold to keep climbing, ease off before you stall');
      } else if(!shownStall && (run.stalled ?? false)){
        shownStall = true;
        showContextHint('STALLED! ⬇ Dive to regain speed, then ease back up');
      } else if(!shownBounce && (run.bounceCount ?? 0) > 0){
        shownBounce = true;
        showContextHint('Bounced! Each bounce costs distance — aim for a flat, low approach');
      }
    }

    /* ── Hint display priority ── */
    // 1. Paused overlay (set by togglePause; already written before renderHUD runs)
    if(sim.paused) return; // keep PAUSED message as-is

    // 2. Sliding skip hint.
    if(run.sliding){
      // Reset context hint when we start sliding so it doesn't obscure the skip prompt.
      contextHintTimer = 0;
      hintEl.textContent = isCoarse
        ? 'sliding… tap ⏩ to skip ahead'
        : 'sliding… press ENTER to skip ahead';
      hintEl.style.display = 'block';
      return;
    }

    // 3. Contextual one-time call-outs.
    if(contextHintTimer > 0){
      contextHintTimer -= 0.08; // ~12 Hz tick = ~0.083 s per call
      hintEl.textContent = contextHintText;
      hintEl.style.display = 'block';
      return;
    }

    // 4. Persistent early-day flight hint.
    if(state.day <= 3 && phase === 'flight'){
      hintEl.textContent = flightHintText(st);
      hintEl.style.display = 'block';
    } else {
      hintEl.style.display = 'none';
    }
  }

  return { renderHUD };
}
