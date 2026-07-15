// Flightless — world objects module.
//
// Everything the penguin can fly into that isn't the ice itself: fish/star
// collectibles, bird/balloon/plane obstacles, boost rings, and the landmark
// bosses. All of it uses the same deterministic-cell-grid trick (hash01 of
// the cell index decides existence/type/position), so only the on-screen
// cells ever need to be considered instead of storing every object placed
// along a 35 km flight. Reads and mutates sim.run/sim.st/sim.phase — the
// shared flight state that's reassigned each flight by the physics module.
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
    if(i < 0 || hash01(i*17+3) < 0.35) return null;
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
  // multiplies its value; the chain resets when the clock runs out
  function comboMult(){
    sim.run.combo = sim.run.comboT > 0 ? sim.run.combo+1 : 1;
    sim.run.comboT = 3;
    sim.run.maxCombo = Math.max(sim.run.maxCombo, sim.run.combo);
    return Math.min(1 + 0.3*(sim.run.combo-1), 3);
  }
  function starPos(i, j){
    if(hash01(i*53+j*97+7) < 0.45) return null;
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
      sim.run.gunCash += o.type.cash; sim.run.gunKills++;
      popup(`\u{1F4A5} ${o.type.id} down! +${fmtCash(o.type.cash)}`, 20);
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
    if(i < 1 || hash01(i*71+29) < 0.45) return null;
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

  /* ════════════════ landmarks ════════════════ */
  // Physical bosses standing on the ice. Fly into one to damage it — the hurt
  // persists between days — and bring it down for a payout. The Wall is the
  // real victory condition. You CAN fly over them, but they won't forget you.
  function checkLandmarks(spNew){
    for(const lm of LANDMARKS){
      if(state.lmHP[lm.id] <= 0) continue;
      const face = lm.x - lm.w*0.5;
      if(sim.run.vx > 0 && sim.run.y < lm.h && sim.run.x >= face && sim.run.x <= lm.x + lm.w){
        const dmg = Math.max(1, Math.round(spNew * sim.st.smash));
        state.lmHP[lm.id] = Math.max(0, state.lmHP[lm.id] - dmg);
        if(state.lmHP[lm.id] <= 0){
          sim.run.smashCash += lm.reward;
          popup(`\u{1F4A5} ${lm.name} DESTROYED! +${fmtCash(lm.reward)}`, 30);
          SFX.boom();
          cam.shake = 16;
          burst(lm.x, Math.min(sim.run.y+10, lm.h*0.6), 40, lm.color, 18);
          sim.run.vx *= 0.7;               // smash straight through the wreckage
        } else {
          popup(`\u{1F4A5} -${dmg} · ${lm.name} ${Math.ceil(state.lmHP[lm.id]/lm.hp*100)}%`, 22);
          SFX.thump();
          cam.shake = Math.min(16, 8 + spNew*0.02);
          burst(face, sim.run.y, 20, lm.color, 10);
          sim.run.x = face - 1;
          sim.run.vx = -Math.abs(sim.run.vx)*(0.25 + 0.05*Math.min(state.lvl.plating,4));
          sim.run.tumble = Math.min(sim.run.tumble + 5, 8);
        }
        save();
        break;
      }
    }
  }

  return {
    coinCluster, comboMult, starPos, checkCollectibles,
    obstaclePos, checkObstacles, fireGun,
    ringPos, checkRings,
    checkLandmarks,
    COIN_CELL, COIN_MIN_ALT, COIN_MAX_ALT, COIN_R,
    STAR_CELL, STAR_MIN_ALT, STAR_R,
    OBST_CELL, RING_CELL, RING_R,
  };
}
