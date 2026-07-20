// Flightless — world objects module.
//
// Everything the penguin can fly into that isn't the ice itself: fish/star
// collectibles, bird/balloon/plane obstacles, boost rings, landmark bosses,
// and fuel/boost pickups. All of it uses the same deterministic-cell-grid
// trick (hash01 of the cell index decides existence/type/position), so only
// the on-screen cells ever need to be considered instead of storing every
// object placed along a 35 km flight. Reads and mutates sim.run/sim.st/
// sim.phase — the shared flight state that's reassigned each flight by the
// physics module.
export function createWorld(deps){
  const { sim, cam, state, SFX, save, popup, burst, fmtCash,
          hash01, clamp, LANDMARKS, OBSTACLE_TYPES } = deps;

  /* ════════════════ collectibles ════════════════ */
  // Fish come in little arcs of 3–5 on a 1-D cell grid, banded inside the
  // altitude corridor a flight at that distance can plausibly reach — so
  // they're actually on your path instead of scattered through empty sky.
  // Stars only exist once you're genuinely high up, on a 2-D grid.
  const COIN_CELL = 140, COIN_MIN_ALT = 12, COIN_MAX_ALT = 3200, COIN_R = 12;
  const STAR_CELL = 260, STAR_MIN_ALT = 3200, STAR_R = 20;
  // how high anything worth placing can sit at distance x: hugging the ice off
  // the ramp, opening up as flights get longer
  const corridorTop = x => clamp(25 + x*0.55, 60, COIN_MAX_ALT);
  function coinCluster(i){
    if(i < 0 || hash01(i*17+3) < 0.18) return null;
    const cx = i*COIN_CELL + 20 + hash01(i*5+11)*(COIN_CELL-40);
    const top = corridorTop(cx);
    // skew toward the low corridor — that's where flights actually happen
    const cy = COIN_MIN_ALT + Math.pow(hash01(i*29+41), 1.8)*(top-COIN_MIN_ALT);
    const n = 3 + (hash01(i*43+5) < 0.4 ? 2 : 0);
    const slope = (hash01(i*31+8)-0.5)*1.1;     // arc leans up or down
    const bow = 8 + hash01(i*37+2)*12;          // gentle upward bow
    const goldK = hash01(i*97+13) < 0.14 ? (n>>1) : -1;   // rare golden fish, mid-arc
    const out = [];
    for(let k=0;k<n;k++){
      const t = k/(n-1) - 0.5;
      out.push({
        x: cx + t*44,
        y: Math.max(COIN_MIN_ALT, cy + t*44*slope + (1-4*t*t)*bow*0.4),
        gold: k === goldK,
      });
    }
    return out;
  }

  // ── combo chain ── collecting anything within 3 s of the last pickup
  // multiplies its value; the chain resets when the clock runs out.
  // Gun-kills and landmark hits also feed this chain so a hot streak
  // (gun blasts + smashing a landmark face) feels connected.
  function comboMult(){
    sim.run.combo = sim.run.comboT > 0 ? sim.run.combo+1 : 1;
    sim.run.comboT = 3;
    sim.run.maxCombo = Math.max(sim.run.maxCombo, sim.run.combo);
    return Math.min(1 + 0.3*(sim.run.combo-1), 3);
  }
  function starPos(i, j){
    if(hash01(i*53+j*97+7) < 0.28) return null;
    const y = j*STAR_CELL + hash01(i*11+j*13+9)*STAR_CELL;
    if(y < STAR_MIN_ALT) return null;
    return { x: i*STAR_CELL + hash01(i*7+j*3+2)*STAR_CELL, y };
  }
  function checkCollectibles(){
    const ci = Math.round(sim.run.x/COIN_CELL);
    for(let di=-1; di<=1; di++){
      const i = ci+di;
      const cl = coinCluster(i);
      if(!cl) continue;
      for(let k=0;k<cl.length;k++){
        const key = 'c'+i+'_'+k;
        if(sim.run.collected.has(key)) continue;
        const c = cl[k];
        if(Math.hypot(sim.run.x-c.x, sim.run.y-c.y) < COIN_R*2){
          sim.run.collected.add(key);
          const m = comboMult();
          const val = Math.round((10 + Math.round(hash01(i*3+k*7+1)*15)) * (c.gold?6:1) * m);
          sim.run.coinCash += val; sim.run.coinCount++;
          const tag = sim.run.combo > 1 ? ` ×${sim.run.combo}` : '';
          if(c.gold){
            popup(`✨ GOLDEN FISH +${fmtCash(val)}${tag}`, 24);
            SFX.ding();
            burst(c.x, c.y, 18, '#fff3b0', 9);
          } else {
            popup(`\u{1F41F} +${fmtCash(val)}${tag}`, 18);
            SFX.tick();
            burst(c.x, c.y, 10, '#ffd54a', 6);
          }
        }
      }
    }
    if(sim.run.y > STAR_MIN_ALT-50){
      const si = Math.round(sim.run.x/STAR_CELL), sj = Math.round(sim.run.y/STAR_CELL);
      for(let di=-1; di<=1; di++) for(let dj=-1; dj<=1; dj++){
        const i=si+di, j=sj+dj, key = 's'+i+'_'+j;
        if(sim.run.collected.has(key)) continue;
        const s = starPos(i,j);
        if(!s){ sim.run.collected.add(key); continue; }
        if(Math.hypot(sim.run.x-s.x, sim.run.y-s.y) < STAR_R*1.6){
          sim.run.collected.add(key);
          const m = comboMult();
          const val = Math.round((60 + Math.round(hash01(i*7+j*5)*60)) * m);
          sim.run.starCash += val; sim.run.starCount++;
          popup(`⭐ +${fmtCash(val)}${sim.run.combo>1?` ×${sim.run.combo}`:''}`, 24);
          SFX.ding();
          cam.shake = Math.min(cam.shake+4, 14);
          burst(s.x, s.y, 16, '#fff6c0', 9);
        }
      }
    }
  }

  /* ════════════════ obstacles ════════════════ */
  // Birds, balloons and planes share one x-cell grid; each cell deterministically
  // rolls a type then an existence chance, same trick as the coin/star fields.
  const OBST_CELL = 260;
  function obstaclePos(i){
    if(i < 0) return null;
    const x = i*OBST_CELL + 30 + hash01(i*7+5)*(OBST_CELL-60);
    // keep obstacles inside the reachable corridor at this distance — a plane
    // at 5 km altitude 200 m from the ramp is scenery, not gameplay. Only types
    // whose band fits the corridor here are even considered, so the early game
    // rolls birds instead of culled balloons.
    const corr = Math.max(corridorTop(x), 60);
    const fits = OBSTACLE_TYPES.filter(t => Math.min(t.maxAlt, corr*(t.id==='plane'?2:1)) > t.minAlt);
    if(!fits.length) return null;
    const roll = hash01(i*61+13);
    const type = fits[Math.min(fits.length-1, Math.floor(roll*roll*fits.length))];
    if(hash01(i*19+37) < type.skip) return null;
    const top = Math.min(type.maxAlt, corr*(type.id==='plane'?2:1));
    return { type, x, y: type.minAlt + Math.pow(hash01(i*23+41), 1.4)*(top-type.minAlt) };
  }
  function checkObstacles(){
    const oi = Math.round(sim.run.x/OBST_CELL);
    for(let di=-1; di<=1; di++){
      const i = oi+di, key = 'o'+i;
      if(sim.run.obGone.has(key)) continue;
      const o = obstaclePos(i);
      if(!o){ sim.run.obGone.add(key); continue; }
      if(Math.hypot(sim.run.x-o.x, sim.run.y-o.y) < o.type.r){
        sim.run.obGone.add(key);
        sim.run.obHits++;
        // a glancing thud, not a brick wall — keep the run alive
        sim.run.vx *= 0.72; sim.run.vy *= 0.72;
        sim.run.tumble = Math.min(sim.run.tumble + 3.5, 7);
        cam.shake = Math.min(cam.shake+8, 14);
        SFX.thump();
        popup(`\u{1F4A5} hit a ${o.type.id}!`, 20);
        burst(o.x, o.y, 16, '#555b6e', 8);
      }
    }
  }
  function fireGun(){
    if(sim.phase!=='flight' || !sim.run || sim.run.sliding || sim.run.done) return;
    if(!sim.st.gunLevel || sim.run.gunCooldown > 0) return;
    sim.run.gunCooldown = 0.4;
    const i0 = Math.floor((sim.run.x-40)/OBST_CELL), i1 = Math.ceil((sim.run.x+sim.st.gunRange)/OBST_CELL);
    let best=null, bestD=Infinity;
    for(let i=i0;i<=i1;i++){
      const key = 'o'+i;
      if(sim.run.obGone.has(key)) continue;
      const o = obstaclePos(i);
      if(!o || o.x < sim.run.x-40) continue;
      const d = Math.hypot(sim.run.x-o.x, sim.run.y-o.y);
      if(d <= sim.st.gunRange && d < bestD){ bestD = d; best = {i, o}; }
    }
    if(!best) return;
    const {i, o} = best;
    if(o.type.tough <= sim.st.gunLevel){
      sim.run.obGone.add('o'+i);
      sim.run.gunKills++;
      // gun kills feed the combo chain
      const m = comboMult();
      const val = Math.round(o.type.cash * m);
      sim.run.gunCash += val;
      popup(`\u{1F4A5} ${o.type.id} down! +${fmtCash(val)}${sim.run.combo>1?` ×${sim.run.combo}`:''}`, 20);
      SFX.boom();
      cam.shake = Math.min(cam.shake+6, 16);
      burst(o.x, o.y, 22, '#ffae42', 12);
    } else {
      popup('TOO TOUGH', 16);
      SFX.blip(200, 0.1, 'square', 0.05);
    }
  }

  /* ════════════════ boost rings ════════════════ */
  // Golden rings hanging in the corridor: thread one for a speed kick, cash,
  // and a link in the combo chain. Same deterministic cell trick as the rest.
  const RING_CELL = 420, RING_R = 24;
  function ringPos(i){
    if(i < 1 || hash01(i*71+29) < 0.30) return null;
    const x = i*RING_CELL + 40 + hash01(i*11+17)*(RING_CELL-80);
    const top = Math.max(corridorTop(x)*0.9, 55);
    return { x, y: 28 + Math.pow(hash01(i*41+3), 1.3)*(top-28) };
  }
  function checkRings(){
    const ri = Math.round(sim.run.x/RING_CELL);
    for(let di=-1; di<=1; di++){
      const i = ri+di, key = 'r'+i;
      if(sim.run.collected.has(key)) continue;
      const r = ringPos(i);
      if(!r){ sim.run.collected.add(key); continue; }
      if(Math.hypot(sim.run.x-r.x, sim.run.y-r.y) < RING_R){
        sim.run.collected.add(key);
        const m = comboMult();
        const val = Math.round(25*m);
        sim.run.ringCash += val; sim.run.ringCount++;
        const sp = Math.hypot(sim.run.vx, sim.run.vy) || 1;
        sim.run.vx += sim.run.vx/sp*16; sim.run.vy += sim.run.vy/sp*16;
        popup(`\u{1F4AB} RING! +16 m/s${sim.run.combo>1?` ×${sim.run.combo}`:''}`, 24);
        SFX.ding();
        cam.shake = Math.min(cam.shake+4, 12);
        burst(r.x, r.y, 18, '#ffe066', 10);
      }
    }
  }

  /* ════════════════ fuel / boost pickups ════════════════ */
  // Canisters on the deterministic cell grid: blue = fuel refill, orange =
  // short speed boost. Rendered by the render module via the exported *Pos()
  // helpers and cell constants below.
  const PICKUP_CELL = 550;
  // type 0 = fuel canister (blue), type 1 = speed boost (orange)
  function pickupPos(i){
    if(i < 1) return null;
    // ~55 % of cells have a pickup; split ~60/40 fuel/boost
    if(hash01(i*83+19) < 0.45) return null;
    const x = i*PICKUP_CELL + 50 + hash01(i*13+7)*(PICKUP_CELL-100);
    const top = Math.max(corridorTop(x)*0.85, 30);
    const y = 20 + Math.pow(hash01(i*37+53), 1.5)*(top-20);
    const type = hash01(i*61+29) < 0.6 ? 0 : 1;  // 0=fuel, 1=boost
    return { x, y, type };
  }
  const PICKUP_R = 18;
  function checkPickups(){
    // no pickups if rocket not installed (fuel would be wasted)
    const pi = Math.round(sim.run.x/PICKUP_CELL);
    for(let di=-1; di<=1; di++){
      const i = pi+di, key = 'pk'+i;
      if(sim.run.collected.has(key)) continue;
      const p = pickupPos(i);
      if(!p){ sim.run.collected.add(key); continue; }
      if(Math.hypot(sim.run.x-p.x, sim.run.y-p.y) < PICKUP_R*1.5){
        sim.run.collected.add(key);
        if(p.type === 0){
          // fuel canister: refill up to max
          const before = sim.run.fuel ?? 0;
          const maxFuel = sim.st.fuelMax ?? 0;
          if(maxFuel > 0){
            const gained = Math.min(maxFuel * 0.5, maxFuel - before);
            sim.run.fuel = Math.min(maxFuel, before + maxFuel * 0.5);
            popup(`⛽ FUEL +${gained.toFixed(1)}s`, 20);
            SFX.ding();
            burst(p.x, p.y, 14, '#4fc3f7', 7);
          } else {
            popup(`⛽ fuel canister (no rocket)`, 16);
            SFX.tick();
          }
        } else {
          // speed boost: brief velocity kick in current direction
          const sp = Math.hypot(sim.run.vx, sim.run.vy) || 1;
          const kick = 22;
          sim.run.vx += sim.run.vx/sp * kick;
          sim.run.vy += sim.run.vy/sp * kick;
          sim.run.boostT = (sim.run.boostT ?? 0) + 1.5; // signal to physics (read defensively)
          popup(`\u{1F7E0} BOOST +${kick} m/s!`, 22);
          SFX.ding();
          cam.shake = Math.min(cam.shake+5, 14);
          burst(p.x, p.y, 16, '#ff9800', 9);
        }
      }
    }
  }

  /* ════════════════ landmarks ════════════════ */
  // Physical bosses standing on the ice. Fly into one to damage it — the hurt
  // persists between days — and bring it down for a payout. The Wall is the
  // real victory condition.
  //
  // REWORK (P0): the old code reversed vx on every hit, so only one hit landed
  // per flight even against a 12 000 HP wall. The new resolution:
  //
  //   • CONTINUOUS RAM: while the player is inside the landmark's x-band and
  //     below its height, damage accumulates every physics step proportionally
  //     to speed × smash × SMASH_DPS × dt. This way a fast, well-built pass
  //     deals sustained damage through the entire width of the landmark. At
  //     maxed rocket + plating (~120 m/s at Wall), a single 0.38 s traverse
  //     deals ~6 600 dmg → the Wall falls in 2 passes, i.e. 1–2 skilled flights.
  //
  //   • PIERCE vs BOUNCE: if entry speed >= PIERCE_SPD the player punches
  //     through (vx slows but stays positive). Below that the player bounces
  //     back (gentler than the old hard reversal). The bounce still deals one
  //     hit's worth of damage, just no sustained pass.
  //
  //   • POPUP THROTTLE: damage accrues silently every step, but a HP-percent
  //     update popup fires once per 10 % HP lost so the screen stays readable.
  //
  //   • COMBO: entry into a living landmark feeds comboMult() once per pass,
  //     applying to the final payout (not per-step — that would be exploitable).
  //
  //   • FEEDBACK: if the player is in the x-band but too high to hit, a
  //     one-per-pass "too high, dive lower" popup fires. If the landmark is
  //     already destroyed a "already rubble" cue fires once.
  //
  // SMASH_DPS: damage per second per (m/s of speed × smash stat).
  // calibrated so: 120 m/s × 4.34 smash × SMASH_DPS × 0.38 s ≈ 6000 dmg
  //   → SMASH_DPS = 6000 / (120 × 4.34 × 0.38) ≈ 30.3  → use 30.
  const SMASH_DPS = 30;
  // Speed threshold for pierce (forward ram) vs bounce.
  const PIERCE_SPD = 50;
  // Physics step size used for cooldown ticking (matches the fixed sim timestep).
  const SIM_DT = 1/60;

  function checkLandmarks(spNew){
    // lmPassFired: transient set of string keys for once-per-pass popup guards
    if(!sim.run.lmPassFired) sim.run.lmPassFired = new Set();
    // lmInBandLast: which landmarks the player was inside on the previous step
    if(!sim.run.lmInBand) sim.run.lmInBand = new Set();
    // lmDmgAccum: fractional damage accumulator (float remainder before rounding)
    if(!sim.run.lmDmgAccum) sim.run.lmDmgAccum = {};
    // lmLastPct: last HP-percent at which we showed a damage popup (per landmark)
    if(!sim.run.lmLastPct) sim.run.lmLastPct = {};
    // lmEntryCombo: whether we've already fired comboMult() for this pass
    if(!sim.run.lmEntryCombo) sim.run.lmEntryCombo = {};

    let anyBandContact = false;

    for(const lm of LANDMARKS){
      const face = lm.x - lm.w*0.5;
      const inBand = sim.run.vx > 0
                  && sim.run.y < lm.h
                  && sim.run.x >= face
                  && sim.run.x <= lm.x + lm.w;

      // ── exited band cleanup ──
      if(!inBand){
        if(sim.run.lmInBand.has(lm.id)){
          sim.run.lmInBand.delete(lm.id);
          // allow re-entry to retrigger popup guards (only clear rubble/over keys)
          sim.run.lmPassFired.delete(lm.id + '_rubble');
          sim.run.lmPassFired.delete(lm.id + '_over');
          sim.run.lmEntryCombo[lm.id] = false;
        }
        // "flew over" check: in x-band but above the height cutoff
        if(sim.run.vx > 0 && sim.run.x >= face && sim.run.x <= lm.x + lm.w
           && sim.run.y >= lm.h && state.lmHP[lm.id] > 0){
          const overKey = lm.id + '_over';
          if(!sim.run.lmPassFired.has(overKey)){
            sim.run.lmPassFired.add(overKey);
            popup(`\u{2B06} Too high — dive below ${Math.round(lm.h)} m to hit ${lm.name}!`, 20);
            SFX.blip(180, 0.08, 'sawtooth', 0.06);
          }
        } else if(sim.run.x > lm.x + lm.w){
          sim.run.lmPassFired.delete(lm.id + '_over');
        }
        continue;
      }

      anyBandContact = true;
      sim.run.lmInBand.add(lm.id);

      // ── already destroyed ──
      if(state.lmHP[lm.id] <= 0){
        const rubbleKey = lm.id + '_rubble';
        if(!sim.run.lmPassFired.has(rubbleKey)){
          sim.run.lmPassFired.add(rubbleKey);
          popup(`\u{1F4A8} ${lm.name} is already rubble!`, 18);
          SFX.blip(300, 0.08, 'square', 0.05);
        }
        continue;
      }

      // ── entry vs sustain ──
      const justEntered = !sim.run.lmEntryCombo[lm.id];
      if(justEntered){
        sim.run.lmEntryCombo[lm.id] = true;
        if(spNew < PIERCE_SPD){
          // BOUNCE: one sharp hit, reverse out
          const dmg = Math.max(1, Math.round(spNew * sim.st.smash));
          const prevHP = state.lmHP[lm.id];
          state.lmHP[lm.id] = Math.max(0, prevHP - dmg);
          comboMult(); // feeds combo but we don't use the multiplier on bounce cash
          if(state.lmHP[lm.id] <= 0){
            _landmarkDestroyed(lm, spNew);
          } else {
            const pct = Math.ceil(state.lmHP[lm.id]/lm.hp*100);
            popup(`\u{1F4A5} -${dmg} · ${lm.name} ${pct}%`, 22);
            SFX.thump();
            cam.shake = Math.min(16, 8 + spNew*0.02);
            burst(face + lm.w*0.5, sim.run.y, 16, lm.color, 8);
            // bounce back (gentler than the old reversal)
            sim.run.x = face - 1;
            sim.run.vx = -Math.abs(sim.run.vx) * (0.18 + 0.04*Math.min(state.lvl.plating ?? 0, 4));
            sim.run.tumble = Math.min(sim.run.tumble + 4, 8);
            sim.run.lmLastPct[lm.id] = pct;
            save();
          }
          break; // only one landmark per step
        } else {
          // PIERCE entry: shake + sound burst, damage will accumulate below
          cam.shake = Math.min(16, 8 + spNew*0.03);
          SFX.thump();
          burst(face + lm.w*0.5, sim.run.y, 14, lm.color, 7);
          sim.run.lmLastPct[lm.id] = sim.run.lmLastPct[lm.id]
            ?? Math.ceil(state.lmHP[lm.id]/lm.hp*100);
        }
      }

      if(spNew < PIERCE_SPD) break; // already handled in bounce branch above

      // ── continuous pierce damage ──
      // damage = spNew * smash * SMASH_DPS * dt, accumulated as float
      const rawDmg = spNew * sim.st.smash * SMASH_DPS * SIM_DT;
      sim.run.lmDmgAccum[lm.id] = (sim.run.lmDmgAccum[lm.id] ?? 0) + rawDmg;
      const dmg = Math.floor(sim.run.lmDmgAccum[lm.id]);
      if(dmg < 1){ break; } // accumulate until we have at least 1 HP to remove
      sim.run.lmDmgAccum[lm.id] -= dmg;

      const prevHP = state.lmHP[lm.id];
      state.lmHP[lm.id] = Math.max(0, prevHP - dmg);

      // ── speed bleed: fast pass costs some speed, slow pass costs more ──
      // factor approaches 0 at very high speeds (light graze) → full bleed
      // at barely-pierce speeds.
      const bleedFactor = clamp(PIERCE_SPD / spNew, 0.1, 0.9);
      sim.run.vx *= (1 - bleedFactor * 0.018);  // gentle per-step bleed
      sim.run.tumble = Math.min(sim.run.tumble + 0.04, 6);

      if(state.lmHP[lm.id] <= 0){
        _landmarkDestroyed(lm, spNew);
        break;
      }

      // throttle damage popups: show once per 10 % HP bracket crossed
      const pct = Math.ceil(state.lmHP[lm.id]/lm.hp*100);
      const lastPct = sim.run.lmLastPct[lm.id] ?? 100;
      if(Math.floor(lastPct/10) > Math.floor(pct/10)){
        const comboTag = sim.run.combo > 1 ? ` ×${sim.run.combo}` : '';
        popup(`\u{1F4A5} ${lm.name} ${pct}%${comboTag}`, 20);
        cam.shake = Math.min(cam.shake+3, 14);
        sim.run.lmLastPct[lm.id] = pct;
      }

      save();
      break; // one landmark per step
    }
  }

  // Helper — fires the DESTROYED sequence (shared between bounce-kill and pierce-kill).
  function _landmarkDestroyed(lm, spNew){
    const m = comboMult();
    const val = Math.round(lm.reward * m);
    sim.run.smashCash += val;
    popup(`\u{1F4A5} ${lm.name} DESTROYED! +${fmtCash(val)}${sim.run.combo>1?` ×${sim.run.combo}`:''}`, 30);
    SFX.boom();
    cam.shake = 16;
    burst(lm.x, Math.min(sim.run.y+10, lm.h*0.6), 40, lm.color, 18);
    // punch clean through — big speed loss but vx stays positive
    sim.run.vx *= 0.5;
    sim.run.vy *= 0.65;
    save();
  }

  // No-op stub kept for forward compatibility if an orchestrator wires it.
  function tickCooldowns(_dt){ /* cooldowns now handled inside checkLandmarks */ }

  return {
    coinCluster, comboMult, starPos, checkCollectibles,
    obstaclePos, checkObstacles, fireGun,
    ringPos, checkRings,
    checkLandmarks,
    pickupPos, checkPickups, tickCooldowns,
    COIN_CELL, COIN_MIN_ALT, COIN_MAX_ALT, COIN_R,
    STAR_CELL, STAR_MIN_ALT, STAR_R,
    OBST_CELL, RING_CELL, RING_R,
    PICKUP_CELL, PICKUP_R,
  };
}
