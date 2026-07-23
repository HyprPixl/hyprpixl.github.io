// Flightless — rendering module.
//
// Owns every pixel drawn to the canvas: the parallax sky/mountains/clouds,
// the ramp, landmarks, collectibles, obstacles, the penguin itself, and the
// particle/popup effects layered on top. No physics or game logic lives
// here — it reads `sim`/`cam`/`state` (all owned and mutated by the host
// page and the physics/world modules) and draws what it sees.
//
// `sim` bundles the fields that used to be top-level `let`s reassigned from
// other parts of the original inline script (phase, run, ramp, st,
// particles, speedLines, timeSim, W, Hpx) — this module only ever reads and
// mutates its properties, never reassigns `sim` itself. `cam`, `state`, and
// `input` are plain objects mutated in place by other modules, so they're
// passed straight through and referenced directly (no `sim.` wrapper).
export function createRenderer(deps){
  const {
    sim, cam, state, input, ctx, w2sX, w2sY,
    coinCluster, starPos, obstaclePos, ringPos, pickupPos,
    LANDMARKS, SCALE_H,
    COIN_CELL, COIN_R, STAR_CELL, STAR_R, OBST_CELL, RING_CELL, RING_R,
    PICKUP_CELL, PICKUP_R,
    fmtCash, hash01, clamp, lerp, RAD,
  } = deps;

  /* ════════════════ reduced-motion helper ════════════════ */
  // Check both the OS-level prefers-reduced-motion media query and the
  // in-game settings toggle (read defensively so old saves work).
  const _mqReduceMotion = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  function isReducedMotion(){
    const mq = _mqReduceMotion ? _mqReduceMotion.matches : false;
    const st = state.settings?.reduceMotion ?? false;
    return mq || st;
  }

  /* ════════════════ particles / popups ════════════════ */
  function burst(x, y, n, color, spread, dirBias){
    // halve particle count when reduced-motion is on
    const rm = isReducedMotion();
    const count = rm ? Math.max(1, Math.floor(n * 0.35)) : n;
    for(let i=0;i<count;i++){
      const a = dirBias!==undefined ? dirBias + (Math.random()-0.5)*0.9 : Math.random()*Math.PI*2;
      const s = Math.random()*spread;
      sim.particles.push({ x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s, life:0.5+Math.random()*0.5, color, size:0.15+Math.random()*0.3 });
    }
    if(sim.particles.length > 400) sim.particles.splice(0, sim.particles.length-400);
  }
  function stepParticles(dt){
    for(let i=sim.particles.length-1;i>=0;i--){
      const p = sim.particles[i];
      p.life -= dt; p.x += p.vx*dt; p.y += p.vy*dt; p.vy -= 4*dt;
      if(p.life<=0 || p.y<0) sim.particles.splice(i,1);
    }
    // step ambient weather particles
    stepAmbientParticles(dt);
  }

  /* ════════════════ homing missiles (Sky Cannon) ════════════════ */
  // The cannon no longer instant-kills: it launches a self-guiding missile
  // that arcs onto its target under a capped turn rate, trails fire + smoke,
  // and detonates on contact — running the payload the gun handed it. Missiles
  // live in world space and step on the same scaled sim clock as everything.
  const missiles = [];
  const MISSILE_SPEED = 300;   // m/s cruise
  const MISSILE_TURN  = 8.5;   // rad/s max steering (tight homing)
  const MISSILE_HITR  = 11;    // detonation radius, m
  function spawnMissile(x, y, tx, ty, onHit){
    const toT = Math.atan2(ty - y, tx - x);
    // launch off-axis (alternating side) so the homing curve actually reads
    const side = Math.random() < 0.5 ? 1 : -1;
    const a0 = toT + side * (0.5 + Math.random() * 0.55);
    const v0 = 130;
    missiles.push({ x, y, vx:Math.cos(a0)*v0, vy:Math.sin(a0)*v0, tx, ty, onHit, life:2.4, t:0 });
  }
  function stepMissiles(dt){
    if(sim.phase !== 'flight'){ if(missiles.length) missiles.length = 0; return; }
    const rm = isReducedMotion();
    for(let i = missiles.length - 1; i >= 0; i--){
      const m = missiles[i];
      m.life -= dt; m.t += dt;
      // steer heading toward the target, capped turn rate
      const desired = Math.atan2(m.ty - m.y, m.tx - m.x);
      let cur = Math.atan2(m.vy, m.vx);
      let d = desired - cur;
      while(d >  Math.PI) d -= 2*Math.PI;
      while(d < -Math.PI) d += 2*Math.PI;
      cur += clamp(d, -MISSILE_TURN*dt, MISSILE_TURN*dt);
      const sp = Math.min(MISSILE_SPEED, 130 + m.t*700);   // spool up to cruise
      m.vx = Math.cos(cur)*sp; m.vy = Math.sin(cur)*sp;
      m.x += m.vx*dt; m.y += m.vy*dt;
      // exhaust: fire sparks + a puff of smoke off the tail
      if(!rm){
        const bx = m.x - Math.cos(cur)*1.3, by = m.y - Math.sin(cur)*1.3;
        sim.particles.push({ x:bx, y:by, vx:(Math.random()-0.5)*4, vy:(Math.random()-0.5)*4,
          life:0.25+Math.random()*0.22, color: Math.random()<0.5 ? '#ffd166' : '#ff7a3c',
          size:0.12+Math.random()*0.16 });
        if(Math.random() < 0.5) sim.particles.push({ x:bx, y:by, vx:0, vy:0.4,
          life:0.5+Math.random()*0.3, color:'rgba(205,214,232,0.45)', size:0.22+Math.random()*0.12 });
      }
      // detonate on contact (or if it times out near the target)
      if(Math.hypot(m.tx - m.x, m.ty - m.y) <= MISSILE_HITR || m.life <= 0){
        try { m.onHit && m.onHit(); } catch(_){}
        burst(m.tx, m.ty, 26, '#ffae42', 13);
        burst(m.tx, m.ty, 12, '#fff2c0', 8);
        missiles.splice(i, 1);
      }
    }
  }
  function drawMissiles(){
    if(!missiles.length) return;
    for(const m of missiles){
      const sx = w2sX(m.x), sy = w2sY(m.y);
      // screen Y is inverted vs world Y, so the screen-space heading flips vy
      const ang = Math.atan2(-m.vy, m.vx);
      const s = Math.max(cam.z * 1.05, 10);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);
      // exhaust flame (flickers), streaming off the tail (local -x)
      const fl = s * (1.5 + Math.random() * 0.9);
      const g = ctx.createLinearGradient(-s*0.8, 0, -s*0.8 - fl, 0);
      g.addColorStop(0,   'rgba(255,224,130,0.95)');
      g.addColorStop(0.5, 'rgba(255,140,50,0.65)');
      g.addColorStop(1,   'rgba(255,80,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-s*0.8, -s*0.26); ctx.lineTo(-s*0.8 - fl, 0); ctx.lineTo(-s*0.8, s*0.26);
      ctx.closePath(); ctx.fill();
      // fins
      ctx.fillStyle = '#8fa3ff';
      ctx.beginPath(); ctx.moveTo(-s*0.5,-s*0.28); ctx.lineTo(-s*0.95,-s*0.58); ctx.lineTo(-s*0.55,-s*0.28); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-s*0.5, s*0.28); ctx.lineTo(-s*0.95, s*0.58); ctx.lineTo(-s*0.55, s*0.28); ctx.closePath(); ctx.fill();
      // body
      ctx.fillStyle = '#dfe6f4'; ctx.strokeStyle = '#2a3350'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s*0.4, -s*0.3); ctx.lineTo(-s*0.8, -s*0.3);
      ctx.lineTo(-s*0.8, s*0.3);  ctx.lineTo(s*0.4, s*0.3);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // nose cone
      ctx.fillStyle = '#ff6b57';
      ctx.beginPath(); ctx.moveTo(s*1.15, 0); ctx.lineTo(s*0.4, -s*0.3); ctx.lineTo(s*0.4, s*0.3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  /* ── speed streaks ──
     Short dashes anchored in WORLD space, seeded in the airspace ahead of the
     penguin, that fade in and out over ~half a second. Because they hold still
     while the penguin tears past, they read as real motion parallax instead of
     the old per-frame random flicker. */
  function stepSpeedLines(dt){
    for(let i=sim.speedLines.length-1;i>=0;i--){
      sim.speedLines[i].life += dt;
      if(sim.speedLines[i].life >= sim.speedLines[i].max) sim.speedLines.splice(i,1);
    }
    if(!sim.run || sim.run.sliding || sim.run.done || sim.phase!=='flight') return;
    const sp = Math.hypot(sim.run.vx, sim.run.vy);
    const t = clamp((sp-55)/140, 0, 1);
    if(t <= 0) return;
    const dir = Math.atan2(sim.run.vy, sim.run.vx);
    // reduce speed line density when reduced-motion is on
    const rm = isReducedMotion();
    const densityScale = rm ? 0.25 : 1;
    const n = dt*(8 + 34*t)*densityScale;
    let count = Math.floor(n) + (Math.random() < n-Math.floor(n) ? 1 : 0);
    const spanX = sim.W/cam.z, spanY = sim.Hpx/cam.z;
    while(count-- > 0){
      const ahead = (0.1 + Math.random()*0.6)*spanX;
      const side  = (Math.random()-0.5)*0.9*spanY;
      sim.speedLines.push({
        x: sim.run.x + Math.cos(dir)*ahead - Math.sin(dir)*side,
        y: Math.max(1, sim.run.y + Math.sin(dir)*ahead + Math.cos(dir)*side),
        life: 0, max: 0.4 + Math.random()*0.45,
      });
    }
    if(sim.speedLines.length > 110) sim.speedLines.splice(0, sim.speedLines.length-110);
  }

  const popupLayer = document.getElementById('popup-layer');
  function popup(text, size){
    const el = document.createElement('div');
    el.className = 'popup';
    el.style.left = '50%'; el.style.top = '32%';
    el.style.fontSize = (size||20)+'px';
    el.textContent = text;
    popupLayer.appendChild(el);
    setTimeout(()=>el.remove(), 1700);
  }

  /* ════════════════ debris system (landmark destruction) ════════════════ */
  // Each debris chunk has its own physics and tumbles until it hits y=0.
  // They live in sim.debris (created lazily so old saves don't break).
  function ensureDebris(){
    if(!sim.debris) sim.debris = [];
  }
  function spawnLandmarkDebris(x, y, lmId){
    ensureDebris();
    if(isReducedMotion()) return;
    // color and shape varies per landmark
    const palettes = {
      snowman: ['#f4f8ff','#e0e8f0','#d0dce8','#ff8c1a'],
      iceberg: ['#cfeaff','#8fc4e8','#a8d4f4','#e0f4ff'],
      wall:    ['#a89c8e','#c2b6a6','#847a6f','#7a6e63'],
    };
    const colors = palettes[lmId] || palettes.wall;
    const count = 18 + Math.floor(Math.random()*14);
    for(let i=0;i<count;i++){
      const a = (Math.random()*2-1)*Math.PI;
      const spd = 18 + Math.random()*55;
      sim.debris.push({
        x, y,
        vx: Math.cos(a)*spd,
        vy: Math.sin(a)*spd + 15,   // slight upward bias
        rot: Math.random()*Math.PI*2,
        rotV: (Math.random()-0.5)*8,
        w: 6 + Math.random()*18,
        h: 4 + Math.random()*12,
        color: colors[Math.floor(Math.random()*colors.length)],
        life: 1.0,
      });
    }
    if(sim.debris.length > 160) sim.debris.splice(0, sim.debris.length-160);
  }
  function stepDebris(dt){
    ensureDebris();
    for(let i=sim.debris.length-1;i>=0;i--){
      const d = sim.debris[i];
      d.x  += d.vx*dt; d.y  += d.vy*dt;
      d.vy -= 28*dt;             // gravity
      d.rot += d.rotV*dt;
      d.life -= dt*0.6;
      if(d.life <= 0 || d.y < -20) sim.debris.splice(i,1);
    }
  }
  function drawDebris(){
    ensureDebris();
    if(!sim.debris.length) return;
    for(const d of sim.debris){
      const sx = w2sX(d.x), sy = w2sY(d.y);
      if(sx<-80||sx>sim.W+80||sy<-80||sy>sim.Hpx+80) continue;
      ctx.save();
      ctx.globalAlpha = clamp(d.life, 0, 1);
      ctx.translate(sx, sy);
      ctx.rotate(d.rot);
      ctx.fillStyle = d.color;
      const sw = Math.max(2, d.w*cam.z*0.08);
      const sh = Math.max(2, d.h*cam.z*0.08);
      ctx.fillRect(-sw/2, -sh/2, sw, sh);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ════════════════ ambient weather particles ════════════════ */
  // Driven by state.dailyMod (read defensively). Kept in sim.ambient (lazy).
  function ensureAmbient(){
    if(!sim.ambient) sim.ambient = [];
  }
  // Return the current ambient mode: 'snow', 'aurora', or null.
  function ambientMode(){
    const id = state.dailyMod?.id ?? null;
    if(id === 'snow' || id === 'blizzard') return 'snow';
    if(id === 'aurora') return 'aurora';
    return null;
  }
  function stepAmbientParticles(dt){
    ensureAmbient();
    const mode = ambientMode();
    if(!mode || isReducedMotion()){
      sim.ambient.length = 0;
      return;
    }
    // age existing
    for(let i=sim.ambient.length-1;i>=0;i--){
      const a = sim.ambient[i];
      if(mode === 'snow'){
        a.x  += (a.vx + sim.W*0.00003)*dt*60;
        a.y  += a.vy*dt*60;
        a.life -= dt*0.12;
        if(a.y > sim.Hpx || a.life <= 0) sim.ambient.splice(i,1);
      } else { // aurora ribbon
        a.phase += dt*0.8;
        a.life  -= dt*0.05;
        if(a.life <= 0) sim.ambient.splice(i,1);
      }
    }
    // spawn new
    const maxP = 80;
    if(mode === 'snow' && sim.ambient.length < maxP){
      const toSpawn = Math.min(3, maxP - sim.ambient.length);
      for(let i=0;i<toSpawn;i++){
        sim.ambient.push({
          x: Math.random()*sim.W,
          y: -8,
          vx: (Math.random()-0.5)*0.5,
          vy: 0.4 + Math.random()*0.9,
          r:  1 + Math.random()*2.5,
          life: 1.0,
        });
      }
    } else if(mode === 'aurora' && sim.ambient.length < 6){
      sim.ambient.push({
        x: Math.random()*sim.W,
        baseY: 60 + Math.random()*sim.Hpx*0.25,
        w: sim.W*(0.25 + Math.random()*0.4),
        hue: 140 + Math.floor(Math.random()*80),
        phase: Math.random()*Math.PI*2,
        life: 1.0,
      });
    }
  }
  function drawAmbientParticles(){
    ensureAmbient();
    if(!sim.ambient.length) return;
    const mode = ambientMode();
    if(mode === 'snow'){
      ctx.fillStyle = 'rgba(230,245,255,0.85)';
      for(const a of sim.ambient){
        ctx.globalAlpha = clamp(a.life*1.5, 0, 0.8);
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if(mode === 'aurora'){
      for(const a of sim.ambient){
        const amp = sim.Hpx*0.055;
        const cy = a.baseY + Math.sin(a.phase + sim.timeSim*0.4)*amp;
        const g = ctx.createLinearGradient(a.x - a.w/2, cy, a.x + a.w/2, cy);
        const al = (clamp(a.life, 0, 1)*0.18).toFixed(3);
        g.addColorStop(0,   `hsla(${a.hue},80%,60%,0)`);
        g.addColorStop(0.3, `hsla(${a.hue},80%,65%,${al})`);
        g.addColorStop(0.7, `hsla(${(a.hue+35)%360},85%,70%,${al})`);
        g.addColorStop(1,   `hsla(${(a.hue+35)%360},80%,60%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(a.x, cy, a.w/2, sim.Hpx*0.07, 0, 0, 7);
        ctx.fill();
      }
    }
  }

  /* ════════════════ rendering ════════════════ */

  // ── day/night sky palette ──
  // The sky hue cycles over state.day: a dawn/day/dusk/night pattern that
  // repeats with a 4-day period. All arithmetic is deterministic from state.day.
  function dayPhase(){
    // returns a float 0-1 representing position in a soft 4-day cycle
    const day = (state.day ?? 0);
    // 0 = cool dawn, 0.25 = bright noon, 0.5 = warm dusk, 0.75 = deep night
    return (day % 4) / 4;
  }
  function skyColor(alt){
    const t = clamp(alt/8000, 0, 1);  // altitude factor (0=ground, 1=space)
    const ph = dayPhase();

    // Interpolate between four palette anchors (dawn/noon/dusk/night) in a
    // smooth cycle. We store [topR,topG,topB, botR,botG,botB].
    const palettes = [
      // dawn  — warm pink/orange horizon, soft indigo top
      [0x4a,0x5c,0xb8,  0xff,0xb0,0x60],
      // noon  — classic sky blue
      [0x6d,0xb3,0xf2,  0xae,0xe4,0xff],
      // dusk  — deep violet top, amber horizon
      [0x3a,0x28,0x7a,  0xff,0x7a,0x28],
      // night — near-black top, deep blue horizon
      [0x08,0x0a,0x28,  0x18,0x28,0x60],
    ];
    // smooth step through the 4 anchors
    const seg = ph * 4;
    const idx = Math.floor(seg) % 4;
    const nxt = (idx + 1) % 4;
    const frac = seg - Math.floor(seg);
    const sm   = frac*frac*(3-2*frac);  // smoothstep

    const pa = palettes[idx], pb = palettes[nxt];
    const topR = lerp(pa[0], pb[0], sm);
    const topG = lerp(pa[1], pb[1], sm);
    const topB = lerp(pa[2], pb[2], sm);
    const botR = lerp(pa[3], pb[3], sm);
    const botG = lerp(pa[4], pb[4], sm);
    const botB = lerp(pa[5], pb[5], sm);

    // blend toward deep-space blue as altitude rises
    const top = [lerp(topR,0x02,t), lerp(topG,0x02,t), lerp(topB,0x10,t)];
    const bot = [lerp(botR,0x0b,t), lerp(botG,0x10,t), lerp(botB,0x30,t)];
    const rgb = c => `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
    return { top:rgb(top), bottom:rgb(bot), space:t };
  }

  // ── ramp palette driven by day ──
  function rampPalette(){
    const day = state.day ?? 0;
    const v = (day % 7);     // 7-day visual cycle
    if(v < 1)      return { strut:'#7a4a21', track:'#a0622d', brace:'rgba(122,74,33,0.65)', snowCap:'#e8f4ff' };
    else if(v < 2) return { strut:'#5a6a30', track:'#7a9040', brace:'rgba(90,106,48,0.65)', snowCap:'#d8f4c0' };
    else if(v < 3) return { strut:'#5a3a7a', track:'#7a50a8', brace:'rgba(90,58,122,0.65)', snowCap:'#ecdcff' };
    else if(v < 4) return { strut:'#2a5a6a', track:'#3a7a8a', brace:'rgba(42,90,106,0.65)', snowCap:'#c0ecf4' };
    else if(v < 5) return { strut:'#8a4a2a', track:'#b85c30', brace:'rgba(138,74,42,0.65)', snowCap:'#f4d8c0' };
    else if(v < 6) return { strut:'#1a4a5a', track:'#2a6a7a', brace:'rgba(26,74,90,0.65)',  snowCap:'#b0d8ec' };
    else           return { strut:'#7a4a21', track:'#c07830', brace:'rgba(122,74,33,0.65)', snowCap:'#fff0c0' };
  }

  const stars = Array.from({length:240}, (_,i)=>({ x:hash01(i), y:hash01(i+500), r:0.5+hash01(i+900)*1.3 }));

  // ── parallax background ──
  // A layer at depth p follows fraction p of the camera's motion on BOTH axes,
  // and everything is sampled in world coordinates — so zooming scales the
  // scene about the screen centre instead of making layers slide sideways,
  // and distant things genuinely crawl while near things sweep past.

  // smooth value noise in [0,1]
  function ridgeN(u, seed){
    const i = Math.floor(u), t = u-i, sm = t*t*(3-2*t);
    return lerp(hash01(i*7+seed), hash01((i+1)*7+seed), sm);
  }
  // silhouette mountain ridge; profile lives in layer space (world · p) with
  // three noise octaves, so there are visible peaks at every camera zoom
  function drawRidge(p, amp, seg, color){
    const baseY = sim.Hpx*0.72 + cam.y*p*cam.z + 2;
    const hpx = amp * clamp(cam.z*0.35, 0.75, 1.5);
    if(baseY - hpx*1.1 > sim.Hpx+40 || baseY < -20) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-14, baseY);
    for(let sx=-14; sx<=sim.W+14; sx+=10){
      const xw = (sx - sim.W*0.5)/cam.z + cam.x*p;
      const hN = 0.58*ridgeN(xw/seg, p*997)
               + 0.30*ridgeN(xw/(seg*0.31), p*577)
               + 0.12*ridgeN(xw/(seg*0.11), p*211);
      ctx.lineTo(sx, baseY - hpx*(0.15+0.85*hN));
    }
    ctx.lineTo(sim.W+14, baseY);
    ctx.closePath(); ctx.fill();
  }

  // one cloud field at depth p: deterministic per cell, slow wind drift,
  // shaded underside beneath sunlit puffs, fading out as the air runs out
  function drawCloudLayer(spaceT, p, alpha, cell, sMul, seed){
    const fade = clamp(1 - spaceT/0.75, 0, 1);
    if(fade <= 0.02) return;
    const wOff = sim.timeSim*(3 + 9*p);          // wind; near layers drift faster
    const half = sim.W*0.55/cam.z;
    const i0 = Math.floor((cam.x*p - half + wOff)/cell), i1 = Math.ceil((cam.x*p + half + wOff)/cell);
    for(let i=i0;i<=i1;i++){
      if(hash01(i*3+seed) < 0.22) continue;
      const cx = i*cell + hash01(i*5+seed)*cell*0.8 - wOff;
      const cy = 140 + hash01(i*7+seed+2)*4300;
      const cs = (26 + hash01(i*13+seed+5)*74) * sMul * cam.z;
      const sx = (cx - cam.x*p)*cam.z + sim.W*0.5;
      const sy = sim.Hpx*0.72 - (cy - cam.y*p)*cam.z;
      if(sx<-cs*2.2||sx>sim.W+cs*2.2||sy<-cs||sy>sim.Hpx+cs) continue;
      const a = alpha*fade;
      ctx.fillStyle = `rgba(178,196,222,${(a*0.55).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(sx, sy+cs*0.12, cs*1.02, cs*0.30, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(sx, sy, cs, cs*0.34, 0, 0, 7);
      ctx.ellipse(sx-cs*0.55, sy+cs*0.10, cs*0.5, cs*0.24, 0, 0, 7);
      ctx.ellipse(sx+cs*0.5, sy+cs*0.09, cs*0.55, cs*0.26, 0, 0, 7);
      ctx.ellipse(sx-cs*0.15, sy-cs*0.16, cs*0.42, cs*0.26, 0, 0, 7);
      ctx.fill();
    }
  }

  // ── tracked landmark HP for detecting the kill transition ──
  // We remember the previous HP value for each landmark so we can detect
  // the exact frame it reaches 0 and spawn debris exactly once.
  const _prevLmHP = {};

  function draw(dtReal){
    const p = sim.run || { x:0, y:0, vx:0, vy:0 };
    const sp = Math.hypot(p.vx, p.vy);

    // camera — the zoom/look-ahead targets are driven off lightly smoothed
    // velocity AND altitude, not the raw instantaneous values, so a sudden
    // physics event (launch kick, afterburner, a bounce) eases the camera
    // in over a few frames instead of snapping it in one, which reads as a
    // hard hitch. altitude gets the same treatment as velocity — without it
    // a ground bounce or landmark impact yanks the zoom target every frame.
    if(cam.vxS===undefined){ cam.vxS = p.vx; cam.vyS = p.vy; cam.yS = p.y; }
    const velSmooth = 1-Math.pow(0.0006, dtReal);
    cam.vxS = lerp(cam.vxS, p.vx, velSmooth);
    cam.vyS = lerp(cam.vyS, p.vy, velSmooth);
    cam.yS  = lerp(cam.yS,  p.y,  velSmooth);
    const spCam = Math.hypot(cam.vxS, cam.vyS);

    let tz, tx, ty;
    if(sim.phase==='shop'){
      tz = clamp(320/(sim.ramp.H+16), 0.12, 8);
      tx = -sim.ramp.len*0.28; ty = sim.ramp.H*0.32;
    } else {
      // Tighter ceiling (14) so a slow/low moment (right off the ramp, a
      // gentle glide) reads as a close, intimate shot, and a much lower
      // floor (0.15) so a maxed ramp+rocket build flying fast and high
      // keeps opening the view up instead of pinning early and going
      // visually static right when a flight is at its most dramatic. Base
      // (60) is low enough that near-zero speed/altitude is already past
      // the ceiling and clamps there, guaranteeing a tight start every run.
      tz = clamp(1000/(60 + 2.5*spCam + 0.2*cam.yS), 0.15, 14);
      tx = p.x + cam.vxS*0.35;
      ty = Math.max(0, p.y - (sim.Hpx*0.30)/tz);
    }
    // zoom eases noticeably slower than position/look-ahead (0.1 vs 0.001
    // base — lower base = faster convergence) — a lazy, cinematic drift
    // instead of a camera that visibly hunts for its target every time
    // speed or altitude ticks over.
    cam.z = lerp(cam.z, tz, 1-Math.pow(0.1, dtReal));
    cam.x = lerp(cam.x, tx, 1-Math.pow(0.001, dtReal));
    cam.y = lerp(cam.y, ty, 1-Math.pow(0.001, dtReal));
    const rm = isReducedMotion();
    let shx=0, shy=0;
    if(!rm && cam.shake>0.2){
      shx=(Math.random()-0.5)*cam.shake; shy=(Math.random()-0.5)*cam.shake;
      cam.shake *= Math.pow(0.001, dtReal);
    } else if(rm && cam.shake>0){
      // still decay shake even if we're not applying it
      cam.shake *= Math.pow(0.001, dtReal);
    }
    ctx.save();
    ctx.translate(shx, shy);

    // sky
    const sky = skyColor(cam.y + sim.Hpx*0.4/cam.z);
    const grad = ctx.createLinearGradient(0,0,0,sim.Hpx);
    grad.addColorStop(0, sky.top); grad.addColorStop(1, sky.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(-10,-10,sim.W+20,sim.Hpx+20);

    // stars
    if(sky.space > 0.25){
      ctx.fillStyle = '#fff';
      for(const s of stars){
        ctx.globalAlpha = clamp((sky.space-0.25)*1.6,0,1) * (0.4+0.6*hash01(s.x*997));
        ctx.beginPath(); ctx.arc(s.x*sim.W, s.y*sim.Hpx, s.r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // sun — soft glow that sharpens as the air thins
    {
      const sx0 = sim.W*0.78, sy0 = sim.Hpx*0.17;
      const sunR = 80 + 30*sky.space;
      const sg = ctx.createRadialGradient(sx0, sy0, 3, sx0, sy0, sunR);
      sg.addColorStop(0, 'rgba(255,250,220,0.95)');
      sg.addColorStop(0.2, `rgba(255,240,170,${0.5-0.25*sky.space})`);
      sg.addColorStop(1, 'rgba(255,240,170,0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(sx0, sy0, sunR, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath(); ctx.arc(sx0, sy0, 13, 0, 7); ctx.fill();
    }

    // far/mid/wisp cloud fields behind the mountains — an extra distant wisp
    // layer plus tighter cell spacing on all of them for a busier, denser sky
    drawCloudLayer(sky.space, 0.08, 0.12, 900, 0.35, 71);
    drawCloudLayer(sky.space, 0.22, 0.24, 620, 0.55, 11);
    drawCloudLayer(sky.space, 0.50, 0.34, 500, 0.80, 47);

    // mountain ridges, far to near
    drawRidge(0.10, 150, 300, 'rgba(168,192,220,0.5)');
    drawRidge(0.24, 92, 190,  'rgba(120,150,186,0.65)');
    drawRidge(0.42, 54, 130,  'rgba(88,116,152,0.75)');

    // low haze hugging the horizon
    {
      const gy0 = w2sY(0);
      if(gy0 > -10 && gy0 < sim.Hpx+240){
        const hh = 110;
        const hg = ctx.createLinearGradient(0, gy0-hh, 0, gy0);
        hg.addColorStop(0, 'rgba(235,245,255,0)');
        hg.addColorStop(1, `rgba(235,245,255,${(0.34*(1-sky.space)).toFixed(3)})`);
        ctx.fillStyle = hg;
        ctx.fillRect(-10, gy0-hh, sim.W+20, hh);
      }
    }

    // near clouds float in front of the ridges
    drawCloudLayer(sky.space, 0.85, 0.50, 430, 1.05, 3);

    // ambient weather layer (snow / aurora)
    drawAmbientParticles();

    drawCollectibles();
    drawRings();
    drawPickups();
    drawObstacles();

    // ground
    const gy = w2sY(0);
    if(gy < sim.Hpx+20){
      const gg = ctx.createLinearGradient(0,gy,0,gy+90);
      gg.addColorStop(0,'#eaf6ff'); gg.addColorStop(0.12,'#bcd9ee'); gg.addColorStop(1,'#5d7f9c');
      ctx.fillStyle = gg;
      ctx.fillRect(-10, gy, sim.W+20, sim.Hpx-gy+20);
      // distance markers
      const step = cam.z>6 ? 50 : cam.z>2.2 ? 250 : cam.z>0.9 ? 1000 : 5000;
      const m0 = Math.max(0, Math.floor((cam.x - sim.W/cam.z)/step)*step);
      const m1 = (cam.x + sim.W/cam.z);
      ctx.fillStyle = '#33506b'; ctx.strokeStyle = '#33506b';
      ctx.font = `${Math.max(10,Math.min(13, cam.z*2+8))}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      for(let m=m0; m<=m1; m+=step){
        if(m===0) continue;
        const sx = w2sX(m);
        ctx.beginPath(); ctx.moveTo(sx, gy); ctx.lineTo(sx, gy+8); ctx.stroke();
        ctx.fillText(m>=1000 ? (m/1000)+'km' : m+'m', sx, gy+22);
      }
      // ice sheen streaks
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      const iceStep = 26;
      const c0 = Math.floor((cam.x - sim.W/cam.z)/iceStep), c1 = Math.ceil((cam.x + sim.W/cam.z)/iceStep);
      for(let i=c0;i<=c1;i++){
        if(hash01(i*11+3) < 0.55) continue;
        const sx = w2sX(i*iceStep + hash01(i*5+1)*iceStep);
        const ln = (10+hash01(i*9+6)*40)*clamp(cam.z*0.4, 0.5, 3);
        const yo = 8 + hash01(i*17+9)*46;
        ctx.beginPath(); ctx.moveTo(sx, gy+yo); ctx.lineTo(sx+ln, gy+yo*1.04); ctx.stroke();
      }
    }

    drawLandmarks();
    drawRamp();
    drawDebris();

    // flight trail — width & tint track speed so dives/climbs actually read as motion
    if(sim.run && sim.run.trail.length > 1){
      for(let i=1;i<sim.run.trail.length;i++){
        const a = sim.run.trail[i-1], b = sim.run.trail[i];
        const age = i/sim.run.trail.length;
        const fast = clamp((b.spd-40)/180, 0, 1);
        ctx.lineWidth = lerp(1.2, 3.2, fast) * clamp(cam.z, 0.6, 1.6);
        const r = lerp(255,120,fast), g = lerp(255,220,fast), bcol = 255;
        ctx.strokeStyle = `rgba(${r|0},${g|0},${bcol},${0.32*age})`;
        ctx.beginPath();
        ctx.moveTo(w2sX(a.x), w2sY(a.y));
        ctx.lineTo(w2sX(b.x), w2sY(b.y));
        ctx.stroke();
      }
    }

    // particles
    for(const pt of sim.particles){
      ctx.globalAlpha = clamp(pt.life*2, 0, 1);
      ctx.fillStyle = pt.color;
      const s = Math.max(2, pt.size*cam.z);
      ctx.fillRect(w2sX(pt.x)-s/2, w2sY(pt.y)-s/2, s, s);
    }
    ctx.globalAlpha = 1;
    drawMissiles();

    if(sim.run){
      const px = w2sX(sim.run.x), py = w2sY(sim.run.y);
      const rhoN = Math.exp(-sim.run.y/SCALE_H);
      // speed streaks — world-anchored, oriented along the (smoothed) velocity
      if(sim.speedLines.length){
        const sdir = Math.atan2(cam.vyS, cam.vxS);
        const lenW = clamp(sp*0.16, 3, 55);
        const ldx = Math.cos(sdir)*lenW, ldy = Math.sin(sdir)*lenW;
        const inten = clamp((sp-55)/140, 0.25, 1);
        ctx.lineWidth = Math.max(1, cam.z*0.18);
        ctx.lineCap = 'round';
        for(const sl of sim.speedLines){
          const lx = w2sX(sl.x), ly = w2sY(sl.y);
          if(lx<-90||lx>sim.W+90||ly<-90||ly>sim.Hpx+90) continue;
          const a = Math.sin(Math.PI*sl.life/sl.max)*0.38*inten;
          ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(w2sX(sl.x-ldx), w2sY(sl.y-ldy)); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      // reentry glow
      if(sp > 200 && rhoN > 0.35 && !sim.run.sliding){
        const heat = clamp((sp-200)/200, 0, 1) * clamp((rhoN-0.35)/0.5, 0, 1);
        const gsize = 30 + heat*40;
        const gl = ctx.createRadialGradient(px, py, 4, px, py, gsize);
        gl.addColorStop(0, `rgba(255,180,60,${0.55*heat})`);
        gl.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(px, py, gsize, 0, 7); ctx.fill();
      }
      // contact shadow when near the ground
      const gy0 = w2sY(0);
      if(sim.run.y < 70 && gy0 < sim.Hpx+20){
        const shA = (1-sim.run.y/70)*0.28;
        ctx.fillStyle = `rgba(10,20,40,${shA.toFixed(3)})`;
        const rs = Math.max(cam.z*1.3, 13)*(1.35 - sim.run.y/110);
        ctx.beginPath(); ctx.ellipse(px, gy0+3, rs, rs*0.25, 0, 0, 7); ctx.fill();
      }

      // ── speed/afterburner screen effect ──
      // A full-screen vignette + optional chromatic aberration at high velocity
      // or while thrusting. Implemented as cheap canvas post-effect:
      //   1. Dark edge vignette that ramps with speed.
      //   2. At very high speed: slight red/blue split drawn as two translucent
      //      copies of the penguin's silhouette offset horizontally.
      //   3. Translucent previous-frame smear when afterburner is active.
      if(!rm){
        const thrustOn = sim.run.thrusting ?? false;
        const speedT   = clamp((sp - 120) / 280, 0, 1);
        const effectT  = thrustOn ? clamp(speedT + 0.25, 0, 1) : speedT;

        if(effectT > 0.01){
          // vignette: radial gradient from transparent center to dark edge
          const vg = ctx.createRadialGradient(
            sim.W*0.5, sim.Hpx*0.5, sim.Hpx*0.1,
            sim.W*0.5, sim.Hpx*0.5, Math.hypot(sim.W, sim.Hpx)*0.65
          );
          vg.addColorStop(0, 'rgba(0,0,0,0)');
          vg.addColorStop(0.7, `rgba(0,0,10,${(effectT*0.18).toFixed(3)})`);
          vg.addColorStop(1,   `rgba(0,0,20,${(effectT*0.45).toFixed(3)})`);
          ctx.fillStyle = vg;
          ctx.fillRect(0, 0, sim.W, sim.Hpx);

          // lateral chromatic aberration: two faint colored bars near the
          // center of the screen, simulating lens separation at high speed
          if(speedT > 0.35){
            const ca = clamp((speedT-0.35)/0.65, 0, 1);
            const shift = ca * 6;
            // red fringe left
            ctx.fillStyle = `rgba(255,20,20,${(ca*0.07).toFixed(3)})`;
            ctx.fillRect(-shift, 0, sim.W, sim.Hpx);
            // blue fringe right
            ctx.fillStyle = `rgba(20,60,255,${(ca*0.07).toFixed(3)})`;
            ctx.fillRect(shift, 0, sim.W, sim.Hpx);
          }

          // horizontal motion lines across the screen at extreme speed
          if(speedT > 0.6){
            const mt = clamp((speedT-0.6)/0.4, 0, 1);
            ctx.strokeStyle = `rgba(255,255,255,${(mt*0.06).toFixed(3)})`;
            ctx.lineWidth = 1;
            const lineCount = Math.floor(mt * 12);
            for(let li=0; li<lineCount; li++){
              const ly2 = (li/(lineCount-1||1)) * sim.Hpx;
              ctx.beginPath();
              ctx.moveTo(0, ly2);
              ctx.lineTo(sim.W, ly2 + (Math.random()-0.5)*3);
              ctx.stroke();
            }
          }
        }
      }

      drawPenguin(px, py, sim.run.head + sim.run.tumble, Math.max(cam.z*1.3, 13));
    }
    ctx.restore();

    // step debris physics after restoring ctx so translations don't carry over
    stepDebris(dtReal);
  }

  function drawFishIcon(x, y, s, gold){
    ctx.save();
    ctx.translate(x, y + Math.sin(sim.timeSim*3 + x*0.05)*s*0.2);
    // soft glow so it reads as a pickup against any sky
    if(gold){
      s *= 1.25;
      const tw = 0.75 + 0.25*Math.sin(sim.timeSim*7 + x*0.1);
      ctx.fillStyle = `rgba(255,246,190,${(0.4*tw).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(0, 0, s*2.3, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,214,90,0.22)';
    ctx.beginPath(); ctx.arc(0, 0, s*1.9, 0, 7); ctx.fill();
    // forked tail
    ctx.fillStyle = gold ? '#ffce2e' : '#f09b1f';
    ctx.beginPath();
    ctx.moveTo(-s*0.65, 0);
    ctx.lineTo(-s*1.25, -s*0.5);
    ctx.lineTo(-s*1.0, 0);
    ctx.lineTo(-s*1.25, s*0.5);
    ctx.closePath(); ctx.fill();
    // dorsal fin
    ctx.beginPath();
    ctx.moveTo(-s*0.3, -s*0.35);
    ctx.quadraticCurveTo(s*0.05, -s*0.95, s*0.35, -s*0.4);
    ctx.closePath(); ctx.fill();
    // body
    ctx.fillStyle = gold ? '#ffe14d' : '#ffb63b';
    ctx.beginPath(); ctx.ellipse(0, 0, s, s*0.55, 0, 0, 7); ctx.fill();
    // belly
    ctx.fillStyle = gold ? '#fff6c0' : '#ffe08f';
    ctx.beginPath(); ctx.ellipse(s*0.08, s*0.18, s*0.7, s*0.28, 0, 0, 7); ctx.fill();
    // eye
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s*0.55, -s*0.12, s*0.16, 0, 7); ctx.fill();
    ctx.fillStyle = '#26160a';
    ctx.beginPath(); ctx.arc(s*0.6, -s*0.12, s*0.08, 0, 7); ctx.fill();
    ctx.restore();
  }
  function drawStarIcon(x, y, s){
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.75 + 0.25*Math.sin(sim.timeSim*4 + x*0.07 + y*0.05);
    ctx.fillStyle = '#fff6c0';
    ctx.beginPath();
    for(let k=0;k<10;k++){
      const a = -Math.PI/2 + k*Math.PI/5;
      const r = k%2===0 ? s : s*0.42;
      const px = Math.cos(a)*r, py = Math.sin(a)*r;
      if(k===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  function drawCollectibles(){
    if(!sim.run) return;
    const ci0 = Math.floor((cam.x - sim.W/cam.z)/COIN_CELL)-1, ci1 = Math.ceil((cam.x + sim.W/cam.z)/COIN_CELL)+1;
    for(let i=ci0;i<=ci1;i++){
      const cl = coinCluster(i);
      if(!cl) continue;
      for(let k=0;k<cl.length;k++){
        if(sim.run.collected.has('c'+i+'_'+k)) continue;
        const c = cl[k];
        const sx=w2sX(c.x), sy=w2sY(c.y);
        if(sx<-60||sx>sim.W+60||sy<-60||sy>sim.Hpx+60) continue;
        drawFishIcon(sx, sy, clamp(COIN_R*cam.z*0.6, 5, 11), c.gold);
      }
    }
    const si0 = Math.floor((cam.x - sim.W/cam.z)/STAR_CELL)-1, si1 = Math.ceil((cam.x + sim.W/cam.z)/STAR_CELL)+1;
    const sj0 = Math.max(0, Math.floor((cam.y - sim.Hpx/(2*cam.z))/STAR_CELL)-1), sj1 = Math.ceil((cam.y + sim.Hpx/(2*cam.z))/STAR_CELL)+1;
    for(let i=si0;i<=si1;i++) for(let j=sj0;j<=sj1;j++){
      if(sim.run.collected.has('s'+i+'_'+j)) continue;
      const s = starPos(i,j);
      if(!s) continue;
      const sx=w2sX(s.x), sy=w2sY(s.y);
      if(sx<-40||sx>sim.W+40||sy<-40||sy>sim.Hpx+40) continue;
      drawStarIcon(sx, sy, clamp(STAR_R*cam.z*0.8, 10, 22));
    }
  }

  function drawBird(x, y, s, seed){
    ctx.save();
    ctx.translate(x, y);
    const flap = Math.sin(sim.timeSim*6 + seed)*0.5 + 0.5;
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = Math.max(1.5, s*0.18);
    ctx.beginPath();
    ctx.moveTo(-s, -flap*s*0.6); ctx.lineTo(0, 0); ctx.lineTo(s, -flap*s*0.6);
    ctx.stroke();
    ctx.restore();
  }
  function drawBalloon(x, y, s, seed){
    ctx.save();
    ctx.translate(x, y);
    const hue = Math.floor(hash01(seed)*300);
    ctx.fillStyle = `hsl(${hue},70%,55%)`;
    ctx.beginPath(); ctx.ellipse(0, -s*0.3, s, s*1.15, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#4a3418'; ctx.lineWidth = Math.max(1, s*0.06);
    ctx.beginPath();
    ctx.moveTo(-s*0.5, s*0.6); ctx.lineTo(-s*0.28, s*1.1);
    ctx.moveTo(s*0.5, s*0.6); ctx.lineTo(s*0.28, s*1.1);
    ctx.stroke();
    ctx.fillStyle = '#5c4326';
    ctx.fillRect(-s*0.3, s*1.05, s*0.6, s*0.35);
    ctx.restore();
  }
  function drawPlane(x, y, s, seed){
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#d8dee8';
    ctx.beginPath(); ctx.ellipse(0, 0, s*1.3, s*0.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#b7c0d1';
    ctx.beginPath(); ctx.moveTo(-s*0.2,-s*0.15); ctx.lineTo(-s*1.1,-s*0.75); ctx.lineTo(-s*0.75,-s*0.15); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s*0.2,s*0.15); ctx.lineTo(-s*1.1,s*0.75); ctx.lineTo(-s*0.75,s*0.15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e63946';
    ctx.beginPath(); ctx.moveTo(s*1.0,0); ctx.lineTo(s*1.5,-s*0.3); ctx.lineTo(s*1.5,s*0.3); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawObstacles(){
    if(!sim.run) return;
    const i0 = Math.floor((cam.x - sim.W/cam.z)/OBST_CELL)-1, i1 = Math.ceil((cam.x + sim.W/cam.z)/OBST_CELL)+1;
    for(let i=i0;i<=i1;i++){
      if(sim.run.obGone.has('o'+i)) continue;
      const o = obstaclePos(i);
      if(!o) continue;
      const sx=w2sX(o.x), sy=w2sY(o.y);
      if(sx<-80||sx>sim.W+80||sy<-80||sy>sim.Hpx+80) continue;
      const s = clamp(o.type.r*cam.z*0.55, o.type.r*0.8, o.type.r*1.5);
      if(o.type.id==='bird') drawBird(sx, sy, s, i);
      else if(o.type.id==='balloon') drawBalloon(sx, sy, s, i);
      else drawPlane(sx, sy, s, i);
    }
  }

  function drawLandmarks(){
    const gy = w2sY(0);
    for(const lm of LANDMARKS){
      const sx = w2sX(lm.x);
      const wpx = Math.max(lm.w*cam.z, 8), hpx = lm.h*cam.z;
      if(sx < -wpx*3-160 || sx > sim.W+wpx*3+160) continue;

      // detect fresh kill → spawn debris
      const curHP  = state.lmHP[lm.id] ?? lm.hp;
      const prevHP = _prevLmHP[lm.id] ?? lm.hp;
      if(prevHP > 0 && curHP <= 0){
        // landmark just died this frame — big debris burst
        const worldY = lm.h * 0.3;   // mid-height of the structure
        spawnLandmarkDebris(lm.x, worldY, lm.id);
        // second burst at base
        spawnLandmarkDebris(lm.x, 0, lm.id);
      }
      _prevLmHP[lm.id] = curHP;

      const dead = curHP <= 0;
      if(lm.id === 'snowman'){
        ctx.fillStyle = '#f4f8ff';
        if(dead){
          ctx.beginPath(); ctx.ellipse(sx, gy, wpx*1.3, Math.max(3, hpx*0.10), 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#ff8c1a';
          ctx.fillRect(sx - wpx*0.5, gy - Math.max(2, hpx*0.05), Math.max(3, wpx*0.3), Math.max(2, hpx*0.03));
        } else {
          ctx.beginPath(); ctx.arc(sx, gy - hpx*0.22, hpx*0.24, 0, 7); ctx.fill();
          ctx.beginPath(); ctx.arc(sx, gy - hpx*0.55, hpx*0.19, 0, 7); ctx.fill();
          ctx.beginPath(); ctx.arc(sx, gy - hpx*0.83, hpx*0.14, 0, 7); ctx.fill();
          ctx.fillStyle = '#222';
          ctx.fillRect(sx - hpx*0.10, gy - hpx*1.02, hpx*0.20, hpx*0.06);
          ctx.fillRect(sx - hpx*0.06, gy - hpx*1.10, hpx*0.12, hpx*0.09);
          ctx.beginPath(); ctx.arc(sx - hpx*0.045, gy - hpx*0.86, Math.max(1, hpx*0.016), 0, 7); ctx.fill();
          ctx.beginPath(); ctx.arc(sx + hpx*0.045, gy - hpx*0.86, Math.max(1, hpx*0.016), 0, 7); ctx.fill();
          ctx.fillStyle = '#ff8c1a';
          ctx.beginPath();
          ctx.moveTo(sx, gy - hpx*0.84); ctx.lineTo(sx + hpx*0.11, gy - hpx*0.82); ctx.lineTo(sx, gy - hpx*0.80);
          ctx.closePath(); ctx.fill();
        }
      } else if(lm.id === 'iceberg'){
        ctx.fillStyle = dead ? 'rgba(191,230,255,0.55)' : '#cfeaff';
        ctx.strokeStyle = '#8fc4e8'; ctx.lineWidth = Math.max(1, cam.z*0.3);
        ctx.beginPath();
        if(dead){
          ctx.moveTo(sx - wpx*1.6, gy);
          ctx.lineTo(sx - wpx*0.9, gy - hpx*0.10);
          ctx.lineTo(sx - wpx*0.2, gy);
          ctx.lineTo(sx + wpx*0.4, gy - hpx*0.14);
          ctx.lineTo(sx + wpx*1.1, gy);
        } else {
          ctx.moveTo(sx - wpx*0.9, gy);
          ctx.lineTo(sx - wpx*0.6, gy - hpx*0.45);
          ctx.lineTo(sx - wpx*0.2, gy - hpx*0.30);
          ctx.lineTo(sx + wpx*0.05, gy - hpx);
          ctx.lineTo(sx + wpx*0.35, gy - hpx*0.55);
          ctx.lineTo(sx + wpx*0.7, gy - hpx*0.7);
          ctx.lineTo(sx + wpx*0.95, gy);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        // THE WALL — courses of grey brick to the stratosphere
        if(dead){
          ctx.fillStyle = '#9b9186';
          ctx.beginPath(); ctx.ellipse(sx, gy, wpx*2.0, Math.max(4, hpx*0.02), 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#847a6f';
          ctx.beginPath(); ctx.ellipse(sx - wpx*0.8, gy, wpx*0.9, Math.max(3, hpx*0.014), 0, 0, 7); ctx.fill();
        } else {
          const top = gy - hpx;
          ctx.fillStyle = '#a89c8e';
          ctx.fillRect(sx - wpx*0.5, top, wpx, hpx);
          ctx.strokeStyle = 'rgba(60,50,40,0.5)';
          ctx.lineWidth = Math.max(1, cam.z*0.2);
          const rows = Math.min(40, Math.max(6, Math.floor(hpx/26)));
          for(let rIdx=1; rIdx<rows; rIdx++){
            const y = top + hpx*rIdx/rows;
            ctx.beginPath(); ctx.moveTo(sx - wpx*0.5, y); ctx.lineTo(sx + wpx*0.5, y); ctx.stroke();
            const off = (rIdx%2) ? 0 : wpx*0.25;
            ctx.beginPath(); ctx.moveTo(sx - wpx*0.25 + off, y); ctx.lineTo(sx - wpx*0.25 + off, y - hpx/rows); ctx.stroke();
          }
          ctx.fillStyle = '#c2b6a6';
          ctx.fillRect(sx - wpx*0.58, top - Math.max(3, hpx*0.008), wpx*1.16, Math.max(3, hpx*0.008));
        }
      }
      // name + health bar when the penguin is anywhere near
      if(!dead && sim.run && Math.abs(sim.run.x - lm.x) < 1500){
        const frac = state.lmHP[lm.id]/lm.hp;
        const bw = Math.max(70, wpx*1.4);
        const by = Math.max(30, w2sY(lm.h) - 26);
        ctx.fillStyle = 'rgba(5,8,30,0.7)';
        ctx.fillRect(sx - bw/2 - 2, by - 2, bw + 4, 10);
        ctx.fillStyle = '#FF0000';
        ctx.fillRect(sx - bw/2, by, bw*frac, 6);
        ctx.fillStyle = '#eef1ff';
        ctx.font = '11px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${lm.name} ${Math.ceil(frac*100)}%`, sx, by - 7);
      }
    }
  }

  function drawRamp(){
    if(!sim.ramp) return;
    const pts = sim.ramp.pts;
    const pal = rampPalette();
    // support struts with diagonal cross-bracing
    ctx.strokeStyle = pal.strut; ctx.lineWidth = Math.max(1.5, cam.z*0.35);
    for(let i=0;i<pts.length;i+=6){
      const sx = w2sX(pts[i].x);
      ctx.beginPath(); ctx.moveTo(sx, w2sY(pts[i].y)); ctx.lineTo(sx, w2sY(0)); ctx.stroke();
    }
    ctx.strokeStyle = pal.brace; ctx.lineWidth = Math.max(1, cam.z*0.2);
    for(let i=0;i+6<pts.length;i+=6){
      const a = pts[i], b = pts[i+6];
      ctx.beginPath();
      ctx.moveTo(w2sX(a.x), w2sY(a.y*0.55));
      ctx.lineTo(w2sX(b.x), w2sY(b.y));
      ctx.moveTo(w2sX(a.x), w2sY(a.y*0.55));
      ctx.lineTo(w2sX(b.x), w2sY(b.y*0.5));
      ctx.stroke();
    }
    // track
    ctx.strokeStyle = pal.track; ctx.lineWidth = Math.max(3, cam.z*0.7);
    ctx.beginPath();
    ctx.moveTo(w2sX(pts[0].x), w2sY(pts[0].y));
    for(const p of pts) ctx.lineTo(w2sX(p.x), w2sY(p.y));
    ctx.stroke();
    ctx.strokeStyle = pal.snowCap; ctx.lineWidth = Math.max(1.2, cam.z*0.25);
    ctx.beginPath();
    ctx.moveTo(w2sX(pts[0].x), w2sY(pts[0].y));
    for(const p of pts) ctx.lineTo(w2sX(p.x), w2sY(p.y));
    ctx.stroke();
    // flag on top
    const top = pts[0];
    const fx = w2sX(top.x), fy = w2sY(top.y);
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy-26); ctx.stroke();
    // flag color cycles with day using the same palette key
    ctx.fillStyle = '#FF0000';
    ctx.beginPath(); ctx.moveTo(fx, fy-26); ctx.lineTo(fx+20, fy-20); ctx.lineTo(fx, fy-14); ctx.fill();
  }

  const gliderTier = l => l>=9?5 : l>=7?4 : l>=5?3 : l>=3?2 : l>=1?1 : 0;
  function gliderName(l){
    return ['no wings','Cardboard Planks','Bamboo Kite','Delta Wing','Carbon Swept','Golden Albatross'][gliderTier(l)];
  }
  // the rig strapped to the penguin's back — a visibly cooler glider for each
  // wing tier, drawn behind the body in the penguin's rotated frame
  function drawGlider(s, lvl){
    const tier = gliderTier(lvl);
    if(!tier) return;
    ctx.save();
    if(tier===1){
      // cardboard planks and packing tape
      ctx.rotate(0.12);
      ctx.fillStyle = '#cdb58c';
      ctx.fillRect(-s*1.25, -s*0.62, s*2.2, s*0.2);
      ctx.fillStyle = '#b09668';
      ctx.fillRect(-s*0.9, -s*0.62, s*0.22, s*0.2);
      ctx.fillRect(s*0.45, -s*0.62, s*0.22, s*0.2);
    } else if(tier===2){
      // bamboo kite: taut paper triangle on an A-frame
      ctx.strokeStyle = '#8a6d3f'; ctx.lineWidth = Math.max(1.5, s*0.09);
      ctx.beginPath(); ctx.moveTo(-s*0.1, -s*0.2); ctx.lineTo(s*0.05, -s*1.05); ctx.stroke();
      ctx.fillStyle = 'rgba(240,230,200,0.92)';
      ctx.beginPath();
      ctx.moveTo(-s*1.45, -s*0.85);
      ctx.lineTo(s*1.6, -s*1.1);
      ctx.lineTo(s*0.1, -s*0.5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8a6d3f'; ctx.lineWidth = Math.max(1, s*0.06);
      ctx.stroke();
    } else if(tier===3){
      // red delta wing with a white flash
      ctx.fillStyle = '#d1332e';
      ctx.beginPath();
      ctx.moveTo(-s*1.7, -s*0.75);
      ctx.quadraticCurveTo(-s*0.2, -s*1.5, s*1.9, -s*1.05);
      ctx.quadraticCurveTo(s*0.4, -s*0.85, -s*0.1, -s*0.35);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f4f6f8';
      ctx.beginPath();
      ctx.moveTo(-s*1.2, -s*0.78);
      ctx.quadraticCurveTo(0, -s*1.25, s*1.4, -s*1.0);
      ctx.quadraticCurveTo(s*0.3, -s*1.05, -s*0.75, -s*0.68);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#7a1d1a'; ctx.lineWidth = Math.max(1, s*0.06);
      ctx.beginPath(); ctx.moveTo(-s*0.1, -s*0.35); ctx.lineTo(0, -s*0.1); ctx.stroke();
    } else if(tier===4){
      // carbon swept wing: a raked, aggressively swept-back blade with a
      // two-plane carbon finish, a crisp separate winglet at the tip, a
      // glossy leading-edge highlight, and a faint woven-carbon hatch
      ctx.fillStyle = '#141a22';
      ctx.beginPath();
      ctx.moveTo(-s*1.85, -s*0.42);
      ctx.quadraticCurveTo(s*0.15, -s*0.9, s*2.55, -s*1.4);
      ctx.lineTo(s*2.3, -s*1.05);
      ctx.quadraticCurveTo(s*0.25, -s*0.62, -s*1.55, -s*0.22);
      ctx.closePath(); ctx.fill();
      // lighter top panel following the same sweep, reads as a second facet
      ctx.fillStyle = '#232d3a';
      ctx.beginPath();
      ctx.moveTo(-s*1.55, -s*0.5);
      ctx.quadraticCurveTo(s*0.2, -s*0.95, s*2.4, -s*1.32);
      ctx.lineTo(s*2.25, -s*1.14);
      ctx.quadraticCurveTo(s*0.3, -s*0.78, -s*1.35, -s*0.4);
      ctx.closePath(); ctx.fill();
      // upturned winglet, a distinct crisp blade off the raked tip
      ctx.fillStyle = '#0d1117';
      ctx.beginPath();
      ctx.moveTo(s*2.3, -s*1.32);
      ctx.lineTo(s*2.62, -s*1.82);
      ctx.lineTo(s*2.5, -s*1.22);
      ctx.closePath(); ctx.fill();
      // glossy leading-edge highlight
      ctx.strokeStyle = 'rgba(150,205,255,0.7)'; ctx.lineWidth = Math.max(1, s*0.05);
      ctx.beginPath();
      ctx.moveTo(-s*1.7, -s*0.46);
      ctx.quadraticCurveTo(s*0.2, -s*0.93, s*2.48, -s*1.38);
      ctx.stroke();
      // faint twill hatch so the panel reads as woven carbon, not flat plastic
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = Math.max(0.6, s*0.025);
      for(let i=1;i<5;i++){
        const t = i/5;
        const hx = lerp(-s*1.4, s*2.2, t), hy = lerp(-s*0.5, -s*1.2, t);
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - s*0.25, hy + s*0.32); ctx.stroke();
      }
    } else {
      // golden albatross: broad feathered wings with a soft glow
      const beat = Math.sin(sim.timeSim*3)*0.06;
      ctx.rotate(beat);
      ctx.fillStyle = 'rgba(255,225,120,0.25)';
      ctx.beginPath(); ctx.ellipse(0, -s*0.9, s*2.4, s*0.9, -0.1, 0, 7); ctx.fill();
      ctx.fillStyle = '#f6d76a';
      ctx.beginPath();
      ctx.moveTo(-s*0.2, -s*0.3);
      ctx.quadraticCurveTo(-s*1.4, -s*1.35, -s*2.5, -s*1.1);
      ctx.lineTo(-s*1.9, -s*0.75); ctx.lineTo(-s*2.2, -s*0.65); ctx.lineTo(-s*1.6, -s*0.45);
      ctx.quadraticCurveTo(-s*0.8, -s*0.25, -s*0.2, -s*0.3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffe89a';
      ctx.beginPath();
      ctx.moveTo(-s*0.1, -s*0.35);
      ctx.quadraticCurveTo(s*1.2, -s*1.5, s*2.6, -s*1.25);
      ctx.lineTo(s*2.0, -s*0.85); ctx.lineTo(s*2.3, -s*0.75); ctx.lineTo(s*1.7, -s*0.5);
      ctx.quadraticCurveTo(s*0.7, -s*0.2, -s*0.1, -s*0.35);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#c9a53a'; ctx.lineWidth = Math.max(1, s*0.05);
      ctx.beginPath();
      ctx.moveTo(-s*0.1, -s*0.35);
      ctx.quadraticCurveTo(s*1.2, -s*1.5, s*2.6, -s*1.25);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPenguin(px, py, ang, s){
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-ang);
    drawGlider(s, state.lvl.wings);
    // rocket pack — three visible models as the upgrade climbs
    if(sim.st.thrust > 0){
      const rl = state.lvl.rocket;
      if(rl <= 3){
        // strapped-on soda-can booster
        ctx.fillStyle = '#b8bec9';
        ctx.fillRect(-s*0.75, -s*0.85, s*0.9, s*0.42);
        ctx.fillStyle = '#FF0000';
        ctx.beginPath(); ctx.moveTo(s*0.15, -s*0.85); ctx.lineTo(s*0.45, -s*0.64); ctx.lineTo(s*0.15, -s*0.43); ctx.fill();
      } else if(rl <= 6){
        // twin chrome boosters
        ctx.fillStyle = '#c8cfda';
        ctx.fillRect(-s*0.85, -s*1.0,  s*1.1, s*0.3);
        ctx.fillRect(-s*0.85, -s*0.62, s*1.1, s*0.3);
        ctx.fillStyle = '#FF0000';
        ctx.beginPath(); ctx.moveTo(s*0.25, -s*1.0);  ctx.lineTo(s*0.55, -s*0.85); ctx.lineTo(s*0.25, -s*0.7);  ctx.fill();
        ctx.beginPath(); ctx.moveTo(s*0.25, -s*0.62); ctx.lineTo(s*0.55, -s*0.47); ctx.lineTo(s*0.25, -s*0.32); ctx.fill();
      } else {
        // the big one: finned red rocket with a porthole
        ctx.fillStyle = '#e63946';
        ctx.beginPath(); ctx.ellipse(-s*0.15, -s*0.85, s*0.85, s*0.3, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#f4f6f8';
        ctx.beginPath(); ctx.moveTo(s*0.55, -s*0.85); ctx.lineTo(s*0.95, -s*0.85); ctx.lineTo(s*0.62, -s*0.7); ctx.fill();
        ctx.beginPath(); ctx.arc(-s*0.1, -s*0.85, s*0.12, 0, 7); ctx.fill();
        ctx.fillStyle = '#a52833';
        ctx.beginPath(); ctx.moveTo(-s*0.85, -s*1.05); ctx.lineTo(-s*1.2, -s*1.25); ctx.lineTo(-s*0.95, -s*0.9); ctx.fill();
      }
      if(sim.run && sim.run.thrusting){
        ctx.fillStyle = '#ffb020';
        ctx.beginPath();
        ctx.moveTo(-s*0.85, -s*0.85); ctx.lineTo(-s*(1.45+Math.random()*0.5), -s*0.68); ctx.lineTo(-s*0.85, -s*0.5);
        ctx.fill();
      }
    }
    // scarf, streaming behind and fluttering
    {
      const wave = Math.sin(sim.timeSim*9)*0.5;
      ctx.fillStyle = '#e0313f';
      ctx.beginPath();
      ctx.moveTo(s*0.35, -s*0.42);
      ctx.quadraticCurveTo(-s*0.4, -s*(0.78+wave*0.25), -s*1.05, -s*(0.62+wave*0.4));
      ctx.lineTo(-s*0.72, -s*(0.34+wave*0.2));
      ctx.closePath(); ctx.fill();
    }
    // body
    ctx.fillStyle = '#1b2430';
    ctx.beginPath(); ctx.ellipse(0, 0, s, s*0.62, 0, 0, 7); ctx.fill();
    // belly
    ctx.fillStyle = '#f4f6f8';
    ctx.beginPath(); ctx.ellipse(s*0.08, s*0.2, s*0.7, s*0.38, 0, 0, 7); ctx.fill();
    // wing — angles with the stick, flaps in a panic on a hard pull
    {
      const pull = (sim.run && !sim.run.sliding && !sim.run.done) ? ((input.up?1:0)-(input.down?1:0)) : 0;
      const flap = pull>0 ? Math.sin(sim.timeSim*16)*0.35 : 0;
      ctx.fillStyle = '#101720';
      ctx.beginPath(); ctx.ellipse(-s*0.15, -s*0.05, s*0.42, s*0.2, 0.5 - pull*0.25 + flap, 0, 7); ctx.fill();
    }
    // beak
    ctx.fillStyle = '#ff9d00';
    ctx.beginPath(); ctx.moveTo(s*0.95, -s*0.12); ctx.lineTo(s*1.35, s*0.02); ctx.lineTo(s*0.9, s*0.16); ctx.fill();
    // eye + goggle band
    ctx.strokeStyle = '#ff2255'; ctx.lineWidth = Math.max(1.5, s*0.09);
    ctx.beginPath(); ctx.moveTo(s*0.25, -s*0.38); ctx.lineTo(s*0.85, -s*0.28); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s*0.62, -s*0.18, s*0.15, 0, 7); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(s*0.67, -s*0.18, s*0.07, 0, 7); ctx.fill();
    // feet
    ctx.fillStyle = '#ff9d00';
    ctx.beginPath(); ctx.ellipse(-s*0.75, s*0.28, s*0.22, s*0.1, -0.3, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawRingIcon(x, y, s){
    const pulse = 1 + 0.06*Math.sin(sim.timeSim*5 + x*0.03);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(255,214,90,0.25)';
    ctx.lineWidth = s*0.5;
    ctx.beginPath(); ctx.ellipse(0, 0, s*0.34*pulse, s*pulse, 0, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = Math.max(2, s*0.16);
    ctx.beginPath(); ctx.ellipse(0, 0, s*0.34*pulse, s*pulse, 0, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#fff6c0';
    ctx.lineWidth = Math.max(1, s*0.06);
    ctx.beginPath(); ctx.ellipse(-s*0.08, 0, s*0.30*pulse, s*0.92*pulse, 0, 0, 7); ctx.stroke();
    ctx.restore();
  }
  function drawRings(){
    if(!sim.run) return;
    const i0 = Math.floor((cam.x - sim.W/cam.z)/RING_CELL)-1, i1 = Math.ceil((cam.x + sim.W/cam.z)/RING_CELL)+1;
    for(let i=i0;i<=i1;i++){
      if(sim.run.collected.has('r'+i)) continue;
      const r = ringPos(i);
      if(!r) continue;
      const sx=w2sX(r.x), sy=w2sY(r.y);
      if(sx<-80||sx>sim.W+80||sy<-80||sy>sim.Hpx+80) continue;
      drawRingIcon(sx, sy, clamp(RING_R*cam.z*0.8, 13, 27));
    }
  }

  // fuel/boost canisters (world.js places them; keys are 'pk'+cellIndex)
  function drawPickupIcon(x, y, s, type){
    const bob = Math.sin(sim.timeSim*3 + x*0.04)*s*0.18;
    ctx.save();
    ctx.translate(x, y + bob);
    const glow = type===0 ? 'rgba(79,195,247,0.28)' : 'rgba(255,152,0,0.30)';
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, s*1.8, 0, 7); ctx.fill();
    if(type===0){
      // fuel canister — rounded blue can with a cap and a droplet mark
      ctx.fillStyle = '#2f9fd0';
      ctx.fillRect(-s*0.6, -s*0.8, s*1.2, s*1.6);
      ctx.fillStyle = '#4fc3f7';
      ctx.fillRect(-s*0.6, -s*0.8, s*1.2, s*0.5);
      ctx.fillStyle = '#e8f6ff';
      ctx.beginPath(); ctx.arc(0, s*0.15, s*0.32, 0, 7); ctx.fill();
      ctx.fillStyle = '#1c6f96';
      ctx.fillRect(-s*0.28, -s*1.02, s*0.56, s*0.24);
    } else {
      // speed boost — orange lightning chevrons
      ctx.fillStyle = '#ff9800';
      ctx.beginPath(); ctx.arc(0, 0, s*0.9, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff3d0'; ctx.lineWidth = Math.max(1.5, s*0.16); ctx.lineJoin='round';
      ctx.beginPath();
      ctx.moveTo(s*0.28, -s*0.7); ctx.lineTo(-s*0.28, s*0.05);
      ctx.lineTo(s*0.08, s*0.05); ctx.lineTo(-s*0.28, s*0.72);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawPickups(){
    if(!sim.run || typeof pickupPos !== 'function' || !PICKUP_CELL) return;
    const i0 = Math.floor((cam.x - sim.W/cam.z)/PICKUP_CELL)-1, i1 = Math.ceil((cam.x + sim.W/cam.z)/PICKUP_CELL)+1;
    for(let i=i0;i<=i1;i++){
      if(sim.run.collected.has('pk'+i)) continue;
      const p = pickupPos(i);
      if(!p) continue;
      const sx=w2sX(p.x), sy=w2sY(p.y);
      if(sx<-80||sx>sim.W+80||sy<-80||sy>sim.Hpx+80) continue;
      drawPickupIcon(sx, sy, clamp((PICKUP_R||18)*cam.z*0.7, 9, 20), p.type);
    }
  }

  return {
    burst, stepParticles, stepSpeedLines, stepMissiles, spawnMissile, popup,
    draw, drawRamp, gliderName, drawGlider, drawPenguin,
    drawFishIcon, drawStarIcon, drawCollectibles,
    drawBird, drawBalloon, drawPlane, drawObstacles,
    drawLandmarks, drawRingIcon, drawRings, skyColor,
    // new helpers added by this revision:
    spawnLandmarkDebris,   // call from world.js or host for a boss-kill burst
    isReducedMotion,       // expose so other modules can query it
    rampPalette,           // expose for potential shop background use
  };
}
