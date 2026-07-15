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
    coinCluster, starPos, obstaclePos, ringPos,
    LANDMARKS, SCALE_H,
    COIN_CELL, COIN_R, STAR_CELL, STAR_R, OBST_CELL, RING_CELL, RING_R,
    fmtCash, hash01, clamp, lerp, RAD,
  } = deps;

  /* ════════════════ particles / popups ════════════════ */
  function burst(x, y, n, color, spread, dirBias){
    for(let i=0;i<n;i++){
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
    const n = dt*(8 + 34*t);
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

  /* ════════════════ rendering ════════════════ */
  function skyColor(alt){
    const t = clamp(alt/8000, 0, 1);
    const top =    [lerp(0x6d,0x02,t), lerp(0xb3,0x02,t), lerp(0xf2,0x10,t)];
    const bottom = [lerp(0xae,0x0b,t), lerp(0xe4,0x10,t), lerp(0xff,0x30,t)];
    const rgb = c => `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
    return { top:rgb(top), bottom:rgb(bottom), space:t };
  }

  const stars = Array.from({length:130}, (_,i)=>({ x:hash01(i), y:hash01(i+500), r:0.5+hash01(i+900)*1.3 }));

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
      if(hash01(i*3+seed) < 0.42) continue;
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

  function draw(dtReal){
    const p = sim.run || { x:0, y:0, vx:0, vy:0 };
    const sp = Math.hypot(p.vx, p.vy);

    // camera — the zoom/look-ahead targets are driven off a lightly smoothed
    // velocity, not the raw instantaneous one, so a sudden physics event
    // (launch kick, afterburner, thrust ignition) eases the camera in over a
    // few frames instead of snapping it in one, which reads as a hard hitch.
    if(cam.vxS===undefined){ cam.vxS = p.vx; cam.vyS = p.vy; }
    const velSmooth = 1-Math.pow(0.0006, dtReal);
    cam.vxS = lerp(cam.vxS, p.vx, velSmooth);
    cam.vyS = lerp(cam.vyS, p.vy, velSmooth);
    const spCam = Math.hypot(cam.vxS, cam.vyS);

    let tz, tx, ty;
    if(sim.phase==='shop'){
      tz = clamp(320/(sim.ramp.H+16), 1.2, 8);
      tx = -sim.ramp.len*0.28; ty = sim.ramp.H*0.32;
    } else {
      tz = clamp(1200/(80 + 2.0*spCam + 0.32*p.y), 0.8, 9);
      tx = p.x + cam.vxS*0.35;
      ty = Math.max(0, p.y - (sim.Hpx*0.30)/tz);
    }
    cam.z = lerp(cam.z, tz, 1-Math.pow(0.02, dtReal));
    cam.x = lerp(cam.x, tx, 1-Math.pow(0.001, dtReal));
    cam.y = lerp(cam.y, ty, 1-Math.pow(0.001, dtReal));
    let shx=0, shy=0;
    if(cam.shake>0.2){
      shx=(Math.random()-0.5)*cam.shake; shy=(Math.random()-0.5)*cam.shake;
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

    // far and mid cloud fields behind the mountains
    drawCloudLayer(sky.space, 0.22, 0.20, 760, 0.55, 11);
    drawCloudLayer(sky.space, 0.50, 0.30, 620, 0.80, 47);

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
    drawCloudLayer(sky.space, 0.85, 0.50, 520, 1.05, 3);

    drawCollectibles();
    drawRings();
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
      drawPenguin(px, py, sim.run.head + sim.run.tumble, Math.max(cam.z*1.3, 13));
    }
    ctx.restore();
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
        drawFishIcon(sx, sy, clamp(COIN_R*cam.z*0.6, 7, 14), c.gold);
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
      drawStarIcon(sx, sy, clamp(STAR_R*cam.z*0.8, 13, 28));
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
      const dead = state.lmHP[lm.id] <= 0;
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
    // support struts with diagonal cross-bracing
    ctx.strokeStyle = '#7a4a21'; ctx.lineWidth = Math.max(1.5, cam.z*0.35);
    for(let i=0;i<pts.length;i+=6){
      const sx = w2sX(pts[i].x);
      ctx.beginPath(); ctx.moveTo(sx, w2sY(pts[i].y)); ctx.lineTo(sx, w2sY(0)); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(122,74,33,0.65)'; ctx.lineWidth = Math.max(1, cam.z*0.2);
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
    ctx.strokeStyle = '#a0622d'; ctx.lineWidth = Math.max(3, cam.z*0.7);
    ctx.beginPath();
    ctx.moveTo(w2sX(pts[0].x), w2sY(pts[0].y));
    for(const p of pts) ctx.lineTo(w2sX(p.x), w2sY(p.y));
    ctx.stroke();
    ctx.strokeStyle = '#e8f4ff'; ctx.lineWidth = Math.max(1.2, cam.z*0.25);
    ctx.beginPath();
    ctx.moveTo(w2sX(pts[0].x), w2sY(pts[0].y));
    for(const p of pts) ctx.lineTo(w2sX(p.x), w2sY(p.y));
    ctx.stroke();
    // flag on top
    const top = pts[0];
    const fx = w2sX(top.x), fy = w2sY(top.y);
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy-26); ctx.stroke();
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
      // carbon swept wing, thin and glossy, upturned winglet
      ctx.fillStyle = '#2c3542';
      ctx.beginPath();
      ctx.moveTo(-s*1.9, -s*0.55);
      ctx.quadraticCurveTo(-s*0.3, -s*1.05, s*2.1, -s*1.25);
      ctx.lineTo(s*2.3, -s*1.7);
      ctx.lineTo(s*2.35, -s*1.2);
      ctx.quadraticCurveTo(s*0.4, -s*0.75, -s*1.9, -s*0.32);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(140,190,255,0.75)'; ctx.lineWidth = Math.max(1, s*0.05);
      ctx.beginPath();
      ctx.moveTo(-s*1.75, -s*0.5);
      ctx.quadraticCurveTo(-s*0.3, -s*0.98, s*2.05, -s*1.2);
      ctx.stroke();
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
      drawRingIcon(sx, sy, clamp(RING_R*cam.z*0.8, 16, 34));
    }
  }

  return {
    burst, stepParticles, stepSpeedLines, popup,
    draw, drawRamp, gliderName, drawGlider, drawPenguin,
    drawFishIcon, drawStarIcon, drawCollectibles,
    drawBird, drawBalloon, drawPlane, drawObstacles,
    drawLandmarks, drawRingIcon, drawRings, skyColor,
  };
}
