// Flightless — flight-sim physics module.
//
// Owns the ramp geometry, upgrade→stat derivation, and the ramp/flight/slide
// integrators that make up the actual simulation: a 2-D point mass with
// attitude, lift and drag pulled from the angle of attack against a real
// exponential atmosphere, run on a fixed timestep with semi-implicit Euler
// (see main loop) so it's deterministic and identical in cost every frame.
//
// `phase`, `run`, `ramp`, `st`, `particles`, `speedLines` and `timeSim` are
// all reassigned as the sim runs, so they live as properties on the shared
// `sim` object passed in — every module that touches them sees the same
// live values instead of a stale closure.
export function createPhysics(deps){
  const {
    sim, cam, state, input, SFX, save, popup, burst, fmtDist, fmtCash,
    clamp, lerp, angDiff, hash01, RAD, onFinishRun,
    checkCollectibles, checkObstacles, checkRings, checkLandmarks, checkPickups,
    MILESTONES, contractsFor,
  } = deps;

  // physical stats derived from upgrade levels (overrides let upgrade cards preview values)
  function derive(over){
    const L = Object.assign({}, state.lvl, over||{});
    const B = state.bonus;                                  // permanent bonus-shop levels
    const wings = L.wings;
    const mass  = 10;                                       // kg, penguin + kit
    const wingS = wings===0 ? 0.02 : 0.10 + 0.09*wings;     // m² lifting area
    const ar    = wings===0 ? 1.2  : 3 + 0.55*wings;        // wing aspect ratio
    const cdA   = Math.max(0.006, 0.022 - 0.0016*L.aero) * (1 - 0.07*B.aero);  // m², body parasite drag area
    const cd0w  = 0.008;                                    // clean-wing profile drag coeff
    const k     = 1/(Math.PI*ar*0.85);                      // induced drag factor (e = 0.85)
    const cd0eff = cdA/wingS + cd0w;
    // upgrades buy ramp track length; the player-drawn spline (state.rampShape)
    // decides what that length is spent on — see buildRamp. Base and linear
    // term keep early levels close to the old curve (still affordable/modest
    // in 1-3 days); the steep quadratic term is what makes a maxed ramp truly
    // preposterous — level 12 lands at ~3500 m, 10x the old ~350 m cap.
    const rampLen = 32 + 12*L.ramp + 23*L.ramp*L.ramp;
    const mu = Math.max(0.008, 0.02 - 0.0012*L.aero);
    const sling = L.sling * 20;
    const rampV0 = 2 + sling;
    return {
      mass, wingS, ar, cdA, cd0w, k,
      clSlope: 2*Math.PI*ar/(ar+2),                         // finite-wing lift slope, /rad
      rampLen, rampV0,
      mu,
      wingAuth: wings===0 ? 1.5 : 2.4 + 0.35*wings,         // pitch authority rad/s
      gMax:   4 + 0.9*L.struts,                             // structural load limit, g
      // Diminishing returns: hyperbolic cap so high rocket levels still feel
      // powerful but don't grow linearly forever.  Level 1→~17.6 m/s²;
      // level 5→~47 m/s²; level 10→~61 m/s² (vs 90 with old linear formula).
      thrust: L.rocket ? 10 + 8*L.rocket / (1 + 0.055*L.rocket) : 0,
      fuelMax:L.rocket ? 2 + 1.3*L.fuel : 0,
      regenRate: 0.12*L.regen,      // s of burn refilled per second spent gliding (not thrusting)
      sling,
      rest:   L.bounce ? 0.12 + 0.09*L.bounce : 0,
      mult:   (1 + 0.35*L.sponsor) * (1 + 0.12*B.cash),
      smash:  (1 + 0.35*L.plating) * (1 + 0.4*B.skull),
      gunLevel: L.gun,
      gunRange: L.gun ? 260 + 90*L.gun : 0,
      slideDecel: Math.max(3, 6.5 - 0.35*L.aero),
      bestLD: 1/(2*Math.sqrt(cd0eff*k)),                    // best glide ratio
      vDive:  Math.sqrt(2*mass*9.81/(1.225*(cdA + wingS*cd0w))),
    };
  }

  // Catmull-Rom through the control points (endpoints doubled for tangents)
  function sampleShape(ctrl){
    const P = [ctrl[0], ...ctrl, ctrl[ctrl.length-1]];
    const out = [];
    for(let seg=0; seg<ctrl.length-1; seg++){
      const p0=P[seg], p1=P[seg+1], p2=P[seg+2], p3=P[seg+3];
      for(let i=(seg===0?0:1); i<=16; i++){
        const t=i/16, t2=t*t, t3=t2*t;
        out.push({
          x: 0.5*(2*p1.x + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          y: 0.5*(2*p1.y + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
        });
      }
    }
    return out;
  }

  // The track is the player's spline scaled so its arc length is exactly `len`
  // (the material bought with upgrades). Shape-space y spans SHAPE_ASPECT of a
  // unit so its proportions match the editor canvas — the ramp you draw is the
  // ramp you get — and the whole curve is dropped so its LOWEST point rests
  // just above the ice (anchoring the lip instead would flatten any curve that
  // dips below it into the ground).
  const SHAPE_ASPECT = 0.4;
  function buildRamp(len){
    const raw = sampleShape(state.rampShape).map(p => ({ x:p.x, y:p.y*SHAPE_ASPECT }));
    let L = 0;
    for(let i=1;i<raw.length;i++) L += Math.hypot(raw[i].x-raw[i-1].x, raw[i].y-raw[i-1].y);
    const s = len/Math.max(L, 0.01);
    const lip = raw[raw.length-1];
    let minY = Infinity;
    for(const p of raw) minY = Math.min(minY, p.y);
    const pts = raw.map(p => ({ x:(p.x-lip.x)*s, y:(p.y-minY)*s + 0.5, th:0 }));
    for(let i=0;i<pts.length-1;i++)
      pts[i].th = Math.atan2(pts[i+1].y-pts[i].y, pts[i+1].x-pts[i].x);
    pts[pts.length-1].th = pts[pts.length-2].th;
    const cum = [0];
    for(let i=1;i<pts.length;i++)
      cum.push(cum[i-1] + Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y));
    let H = 0;
    for(const p of pts) H = Math.max(H, p.y);
    return { pts, cum, len:cum[cum.length-1], exitTh:pts[pts.length-1].th, H };
  }

  // exit-speed estimate: gravity drop minus friction, which telescopes to
  // μg·Δx along any downhill-then-flat path (∫μg·cosθ ds = μg·dx)
  function rampExitEst(d, r){
    const p0 = r.pts[0], lip = r.pts[r.pts.length-1];
    return Math.sqrt(Math.max(1,
      d.rampV0*d.rampV0 + 2*9.81*(p0.y-lip.y) - 2*d.mu*9.81*Math.max(0, lip.x-p0.x)));
  }
  function rampPoint(s){
    const {pts, cum} = sim.ramp;
    s = clamp(s, 0, sim.ramp.len);
    let i = 1;
    while(i<cum.length-1 && cum[i]<s) i++;
    const t = (s-cum[i-1]) / (cum[i]-cum[i-1] || 1);
    return { x:lerp(pts[i-1].x, pts[i].x, t), y:lerp(pts[i-1].y, pts[i].y, t), th:lerp(pts[i-1].th, pts[i].th, t) };
  }

  function newRun(){
    sim.st = derive();
    sim.ramp = buildRamp(sim.st.rampLen);
    sim.speedLines = [];
    const start = rampPoint(0);
    sim.run = {
      x:start.x, y:start.y, vx:0, vy:0,
      head:start.th, rampS:0, rampV:sim.st.rampV0,
      fuel:sim.st.fuelMax, sliding:false, done:false,
      dist:0, maxAlt:0, maxSpd:0, t:0,          // records only count once airborne
      thrusting:false, tumble:0, stalled:false,
      burnerUsed:false, tankUsed:false,
      trail:[], trailT:0,
      collected:new Set(), coinCash:0, coinCount:0, starCash:0, starCount:0,
      obGone:new Set(), gunCash:0, gunKills:0, gunCooldown:0,
      ringCash:0, ringCount:0, combo:0, comboT:0, maxCombo:0,
      skimT:0, skimCash:0, skimSeg:0, skimQuiet:0, bounceCount:0,
      obHits:0, smashCash:0, contractsMet:new Set(), contractT:0,
      contracts:contractsFor(state.day),   // locked in at launch

      // overheat: accumulates while thrusting, dissipates at rest; triggers
      // penalty above HEAT_MAX, auto-resets once cooled
      heat:0, overheated:false,

      // style/contract tracking
      slideless:true,       // true until the first slide or bounce
      lowAltTime:0,         // seconds spent airborne below LOW_ALT_M metres

      // coast-on-fumes: set true at landing when fuel is nearly empty
      coastOnFumes:false,

      msQueue: MILESTONES.map(m=>m[0]).filter(d=>!state.claimed.includes(d)),
    };
  }

  // 2-D flight dynamics on a point mass with attitude. Lift and drag come from
  // the angle of attack against a real exponential atmosphere; the whole sim
  // runs on a fixed timestep (see main loop) with semi-implicit Euler, so it's
  // deterministic and identical in cost every frame.
  const G = 9.81;
  const RHO0 = 1.225;           // sea-level air density, kg/m³
  const SCALE_H = 8500;         // atmospheric scale height, m
  const A_STALL = 15*RAD;       // stall angle of attack
  const GLIDE_ANG = -7*RAD;     // hands-off trim seeks this shallow glide slope

  // Ramp-phase drag compensation. Quadratic air drag integrates with distance
  // (and any uphill kicker at the end scales up right along with the rest of
  // the player-drawn spline), so once ramp levels push track length well past
  // what the original ~350 m max ever reached, uncompensated drag eats the
  // entire speed gain and can even stall the sled out before the lip — the
  // opposite of the huge launches a preposterous ramp should deliver. Below
  // the old max length nothing changes (scale is 1); beyond it, ramp-phase
  // drag eases off so extra track keeps buying extra exit speed instead of
  // taxing itself to death.
  const RAMP_DRAG_REF_LEN = 350;

  // overheat: sustained rocket use risks a melt-down.
  // heat climbs at 1/s while thrusting, cools at HEAT_COOL/s otherwise.
  // Above HEAT_MAX the thrust is cut to HEAT_PENALTY fraction; a popup fires
  // once. Once heat falls below HEAT_RESUME the penalty lifts.
  const HEAT_RISE   = 1.0;      // heat units / s while thrusting
  const HEAT_COOL   = 0.4;      // heat units / s while not thrusting
  const HEAT_MAX    = 3.0;      // total seconds of sustained burn before penalty
  const HEAT_RESUME = 1.5;      // hysteresis: penalty clears only once heat < this
  const HEAT_PENALTY = 0.3;     // thrust fraction when overheated

  // low-altitude tracking: time spent airborne below this height (metres)
  const LOW_ALT_M = 50;

  // 0 below stall, 1 fully separated, smooth in between
  function stallBlend(aoa){
    const t = clamp((Math.abs(aoa)-A_STALL)/(10*RAD), 0, 1);
    return t*t*(3-2*t);
  }
  // thin-airfoil linear region blending into flat-plate behaviour past stall
  function liftCoef(aoa, slope, s){
    return slope*aoa*(1-s) + 1.05*Math.sin(2*aoa)*s;
  }

  function trackProgress(){
    sim.run.dist = Math.max(sim.run.dist, sim.run.x);
    if(sim.run.msQueue.length && sim.run.dist >= sim.run.msQueue[0]){
      popup(`\u{1F3C1} ${fmtDist(sim.run.msQueue[0])}!`, 26);
      SFX.ding();
      sim.run.msQueue.shift();
    }
  }

  function stepRamp(h){
    const th = rampPoint(sim.run.rampS).th;
    // waxed track: gravity along the slope, a whisper of friction, air drag
    // (drag eased off on preposterously long ramps — see RAMP_DRAG_REF_LEN)
    const dragScale = Math.min(1, RAMP_DRAG_REF_LEN / sim.st.rampLen);
    const accS = -G*Math.sin(th) - sim.st.mu*G*Math.cos(th)
               - 0.5*RHO0*sim.run.rampV*sim.run.rampV*sim.st.cdA*dragScale/sim.st.mass;
    sim.run.rampV = Math.max(0.3, sim.run.rampV + accS*h);
    sim.run.rampS += sim.run.rampV*h;
    if(Math.random() < h*sim.run.rampV*1.5) burst(sim.run.x, sim.run.y+0.2, 1, '#e8f6ff', 2);
    // a spline with an uphill stretch can eat all the momentum; rather than
    // crawl the rest of the track forever, tip off it where the speed died
    if(sim.run.rampV < 0.6) sim.run.rampCrawl = (sim.run.rampCrawl||0) + h;
    else sim.run.rampCrawl = 0;
    if(sim.run.rampCrawl > 2.5){
      const p = rampPoint(sim.run.rampS);
      sim.run.x = p.x; sim.run.y = p.y; sim.run.head = p.th;
      sim.run.vx = Math.cos(p.th)*sim.run.rampV;
      sim.run.vy = Math.sin(p.th)*sim.run.rampV;
      sim.phase = 'flight';
      popup('ran out of track speed…', 18);
      return;
    }
    if(sim.run.rampS >= sim.ramp.len){
      const over = sim.run.rampS - sim.ramp.len;
      const lip = rampPoint(sim.ramp.len);
      sim.run.x = lip.x; sim.run.y = lip.y; sim.run.head = sim.ramp.exitTh;
      sim.run.vx = Math.cos(sim.ramp.exitTh)*sim.run.rampV;
      sim.run.vy = Math.sin(sim.ramp.exitTh)*sim.run.rampV;
      sim.phase = 'flight';
      cam.shake = Math.min(12, 2 + sim.run.rampV*0.05);
      SFX.launch();
      popup(`LIFTOFF — ${Math.round(sim.run.rampV)} m/s!`, 22);
      burst(sim.run.x, sim.run.y, 18, '#ffe066', 8);
      // hand this substep's leftover time to the flight integrator so the
      // transition neither drops nor double-counts a slice of time
      const leftover = clamp(over/Math.max(sim.run.rampV, 0.5), 0, h);
      if(leftover > 0) stepFlight(leftover);
    } else {
      const p = rampPoint(sim.run.rampS);
      sim.run.x=p.x; sim.run.y=p.y; sim.run.head=p.th;
      sim.run.vx = Math.cos(p.th)*sim.run.rampV;
      sim.run.vy = Math.sin(p.th)*sim.run.rampV;
    }
  }

  function stepFlight(h){
    sim.run.t += h;
    sim.run.gunCooldown = Math.max(0, sim.run.gunCooldown - h);
    sim.run.comboT = Math.max(0, sim.run.comboT - h);
    const rhoN = Math.exp(-sim.run.y/SCALE_H);   // 1 at sea level
    const rho = RHO0*rhoN;

    if(sim.run.sliding){
      // grinding along the ice: snow friction + aerodynamic drag
      const q = 0.5*rho*sim.run.vx*sim.run.vx;
      const dec = sim.st.slideDecel + q*sim.st.cdA/sim.st.mass;
      if(Math.abs(sim.run.vx) <= dec*h || Math.abs(sim.run.vx) < 0.5){ sim.run.vx=0; onFinishRun(); return; }
      sim.run.vx -= dec*h*Math.sign(sim.run.vx);
      sim.run.x += sim.run.vx*h;
      sim.run.head = lerp(sim.run.head, 0, 1-Math.pow(0.001, h));
      if(Math.random() < h*45) burst(sim.run.x, 0.3, 1, '#cfe8ff', 2);
      checkLandmarks(Math.abs(sim.run.vx));
      trackProgress();
      return;
    }

    const sp = Math.hypot(sim.run.vx, sim.run.vy);
    const velA = sp > 0.5 ? Math.atan2(sim.run.vy, sim.run.vx) : sim.run.head;
    const q = 0.5*rho*sp*sp;

    // ── attitude ──
    // The stick commands angle of attack, not a direction: lift is what bends
    // the flight path, so agility comes from speed, wing area and the airframe
    // g-limit — fast flight carves wide arcs, slow flight mushes. Hands-off,
    // the penguin trims to exactly carry its weight: a steady cruise that
    // holds its line instead of ballooning upward. Past the g-limit the pull
    // input is capped, so a high-speed pull uses a small, efficient AoA.
    const stick = (input.up?1:0) - (input.down?1:0);
    const qS = Math.max(q*sim.st.wingS*sim.st.clSlope, 1e-6);
    const aoaG = sim.st.gMax*sim.st.mass*G/qS;      // AoA that pulls the structural limit
    // hands-off trim: enough lift to carry the weight, plus a gentle (≤0.6 g)
    // correction toward a shallow glide — climbs arc over, dives ease out,
    // and level flight settles into a steady descent instead of ballooning up.
    // Under rocket power the seek is off: the rocket flies the line it's on.
    const boosting = input.boost && sim.st.thrust>0 && sim.run.fuel>0;
    const gCorr = G*Math.max(Math.cos(velA), 0)
                + (boosting ? 0 : clamp(sp*0.5*(GLIDE_ANG - velA), -0.6*G, 0.6*G));
    const aoaHold = clamp(sim.st.mass*gCorr/qS, -2*RAD, A_STALL*0.75);
    const aoaTgt = stick>0 ? Math.min(A_STALL*1.3, aoaG)
                 : stick<0 ? Math.max(-A_STALL*0.4, -aoaG*0.6)
                 : aoaHold;
    const airEff = clamp(q/120, 0.15, 1);
    const slew = sim.st.wingAuth*(0.35+0.65*airEff)*h;
    const aoa1 = angDiff(sim.run.head, velA);
    sim.run.head = velA + clamp(aoa1 + clamp(aoaTgt-aoa1, -slew, slew), -0.9, 0.9);

    // ── forces (accelerations, m/s²) ──
    // Daily-modifier wind: state.dailyMod is an optional object set at
    // launch from DAILY_MOD_TABLE (flightless-data.js). Read defensively —
    // an absent dailyMod or missing field is a guaranteed no-op.
    const wind = state.dailyMod?.windX ?? 0;    // m/s² horizontal acceleration
    const windY = state.dailyMod?.windY ?? 0;   // m/s² vertical (optional, e.g. updraft)
    let ax = wind, ay = -G + windY;

    sim.run.thrusting = input.boost && sim.st.thrust>0 && sim.run.fuel>0;
    if(sim.run.thrusting){
      sim.run.fuel = Math.max(0, sim.run.fuel - h);
      // ── overheat ── heat climbs while thrusting; cools when not
      sim.run.heat = Math.min(sim.run.heat + HEAT_RISE*h, HEAT_MAX*1.5);
      if(!sim.run.overheated && sim.run.heat >= HEAT_MAX){
        sim.run.overheated = true;
        popup('\u{1F321} OVERHEAT — thrust reduced!', 20);
        cam.shake = Math.min(cam.shake + 4, 6);
      }
      const thrustEff = sim.run.overheated ? HEAT_PENALTY : 1.0;
      ax += Math.cos(sim.run.head)*sim.st.thrust*thrustEff;
      ay += Math.sin(sim.run.head)*sim.st.thrust*thrustEff;
      if(Math.random() < h*120) burst(sim.run.x - Math.cos(sim.run.head)*1.5, sim.run.y - Math.sin(sim.run.head)*1.5, 2, '#ff8c1a', 3, sim.run.head+Math.PI);
      // extra heat-glow VFX when running hot
      if(sim.run.overheated && Math.random() < h*60) burst(sim.run.x, sim.run.y, 1, '#ff3300', 4, sim.run.head+Math.PI);
    } else {
      // cool down when not thrusting
      sim.run.heat = Math.max(0, sim.run.heat - HEAT_COOL*h);
      if(sim.run.overheated && sim.run.heat < HEAT_RESUME){
        sim.run.overheated = false;
      }
      // Fuel Regen: slowly refills the tank while gliding, capped at fuelMax
      if(sim.st.regenRate > 0 && sim.st.fuelMax > 0){
        sim.run.fuel = Math.min(sim.st.fuelMax, sim.run.fuel + sim.st.regenRate*h);
      }
    }
    SFX.setThrust(sim.run.thrusting);

    let stallS = 0;
    if(sp > 0.5){
      const aoa = angDiff(sim.run.head, velA);
      stallS = stallBlend(aoa);
      const cl = liftCoef(aoa, sim.st.clSlope, stallS);
      // wing profile + induced + separated-flow drag; body parasite drag apart
      const cdWing = sim.st.cd0w + sim.st.k*cl*cl + 1.3*Math.sin(aoa)*Math.sin(aoa)*stallS;
      const lift = q*sim.st.wingS*cl/sim.st.mass;
      const drag = q*(sim.st.cdA + sim.st.wingS*cdWing)/sim.st.mass;
      ax += -Math.sin(velA)*lift - Math.cos(velA)*drag;
      ay +=  Math.cos(velA)*lift - Math.sin(velA)*drag;
    }

    // semi-implicit Euler
    sim.run.vx += ax*h; sim.run.vy += ay*h;
    sim.run.x += sim.run.vx*h; sim.run.y += sim.run.vy*h;
    const spNew = Math.hypot(sim.run.vx, sim.run.vy);

    // stall feedback: buffet as the wing lets go, tumble in a deep stall
    if(stallS > 0.05 && q*sim.st.wingS > 15) cam.shake = Math.min(cam.shake + 20*h*stallS, 3);
    if(stallS > 0.8 && spNew < 22 && sim.run.y > 4 && !sim.run.thrusting) sim.run.tumble += 9*h;
    else sim.run.tumble *= Math.pow(0.01, h);
    if(stallS > 0.5 && spNew < 26 && sim.run.y > 4 && !sim.run.thrusting){
      if(!sim.run.stalled && sim.st.wingS > 0.05){ sim.run.stalled = true; popup('STALL! nose down to recover', 18); }
    } else if(stallS < 0.2) sim.run.stalled = false;

    // reentry heat: screaming through thick air
    if(spNew > 200 && rhoN > 0.35 && Math.random() < h*140){
      burst(sim.run.x, sim.run.y, 1, '#ff6a00', 8, Math.atan2(sim.run.vy, sim.run.vx)+Math.PI);
    }

    // ground contact
    if(sim.run.y <= 0 && sim.run.vy < 0){
      sim.run.y = 0;
      const impact = -sim.run.vy;
      if(state.perm.tank && !sim.run.tankUsed && sim.st.fuelMax > 0){
        sim.run.tankUsed = true;
        if(sim.run.fuel < sim.st.fuelMax*0.5){ sim.run.fuel = sim.st.fuelMax*0.5; popup('\u{1F6E2} RESERVE TANK!', 22); }
      }
      if(sim.st.rest>0 && impact>2){
        // even lazy landings get a real hop: floor the rebound so the belly
        // works at low speed instead of silently splatting
        sim.run.vy = Math.max(impact*sim.st.rest, Math.min(impact*0.45, 2.0));
        sim.run.vx *= 0.94;
        sim.run.bounceCount++;
        sim.run.slideless = false;   // touched ground — no longer slideless
        cam.shake = Math.min(10, impact*0.12);
        SFX.thump();
        burst(sim.run.x, 0.5, 10, '#cfe8ff', 5);
        if(sim.run.vy < 1.1){ sim.run.vy=0; sim.run.sliding=true; }
      } else {
        sim.run.vy=0; sim.run.vx*=0.75; sim.run.sliding=true;
        sim.run.slideless = false;   // touched ground — no longer slideless
        cam.shake = Math.min(10, impact*0.15);
        SFX.thump();
        burst(sim.run.x, 0.5, 12, '#cfe8ff', 5);
      }
      if(sim.run.sliding){
        sim.run.thrusting=false; SFX.setThrust(false);
        // coast-on-fumes: reward landing nearly empty
        if(sim.st.fuelMax > 0 && sim.run.fuel <= sim.st.fuelMax * 0.08){
          sim.run.coastOnFumes = true;
        }
      }
    }

    // ── ice skimming ── hugging the deck at speed pays out: ground effect
    // gives a whisper of free lift, and the metre keeps running while you
    // hold the line. Pull away for more than a second and the segment ends.
    if(sim.run.y > 0.1 && sim.run.y < 6 && spNew > 28 && !sim.run.sliding){
      sim.run.skimT += h; sim.run.skimSeg += h; sim.run.skimQuiet = 0;
      sim.run.skimCash += h*(6 + spNew*0.12);
      sim.run.vy += 1.2*h;   // ground-effect cushion
      if(sim.run.skimSeg > 0.8 && sim.run.skimSeg - h <= 0.8){
        popup('\u{2744} SKIMMING!', 20); SFX.tick();
      }
      if(Math.random() < h*30) burst(sim.run.x, 0.4, 1, '#e6f6ff', 3);
    } else if(sim.run.skimSeg > 0){
      sim.run.skimQuiet += h;
      if(sim.run.skimQuiet > 1) sim.run.skimSeg = 0;
    }

    // records only count in the air, off the ramp
    sim.run.maxAlt = Math.max(sim.run.maxAlt, sim.run.y);
    sim.run.maxSpd = Math.max(sim.run.maxSpd, spNew);
    // style tracking: time spent airborne and low (ground-hugger playstyle)
    if(sim.run.y > 0.5 && sim.run.y < LOW_ALT_M) sim.run.lowAltTime += h;
    checkCollectibles();
    checkObstacles();
    checkRings();
    if(checkPickups) checkPickups();
    checkLandmarks(spNew);

    // live contract completion — celebrate it the moment it happens
    sim.run.contractT -= h;
    if(sim.run.contractT <= 0){
      sim.run.contractT = 0.5;
      sim.run.contracts.forEach((c, idx) => {
        if(!sim.run.contractsMet.has(idx) && c.val(sim.run) >= c.target){
          sim.run.contractsMet.add(idx);
          popup(`\u{1F4CB} CONTRACT: ${c.text} ✓ +${fmtCash(c.reward)}`, 22);
          SFX.ding();
        }
      });
    }

    // flight trail
    sim.run.trailT -= h;
    if(sim.run.trailT <= 0){
      sim.run.trail.push({x:sim.run.x, y:sim.run.y, spd:spNew});
      if(sim.run.trail.length > 80) sim.run.trail.shift();
      sim.run.trailT = 0.07;
    }

    trackProgress();
    if(sim.run.t > 900) onFinishRun();  // safety valve
  }

  function skipSlide(){
    if(!sim.run || !sim.run.sliding || sim.run.done) return;
    // stopping distance under friction a plus quadratic drag b·v²:
    //   s = ln(1 + b·v²/a) / (2b)
    const a = sim.st.slideDecel;
    const b = 0.5*RHO0*sim.st.cdA/sim.st.mass;
    const v = Math.abs(sim.run.vx);
    sim.run.x += Math.log(1 + b*v*v/a)/(2*b) * Math.sign(sim.run.vx);
    sim.run.vx = 0;
    sim.run.dist = Math.max(sim.run.dist, sim.run.x);
    onFinishRun();
  }

  function fireAfterburner(){
    if(sim.phase!=='flight' || !sim.run || sim.run.sliding || sim.run.done) return;
    if(!state.perm.burner || sim.run.burnerUsed) return;
    sim.run.burnerUsed = true;
    sim.run.vx += Math.cos(sim.run.head)*90;
    sim.run.vy += Math.sin(sim.run.head)*90;
    cam.shake = Math.min(16, cam.shake+10);
    SFX.boom();
    popup('\u{1F4A5} AFTERBURNER!', 28);
    burst(sim.run.x - Math.cos(sim.run.head)*2, sim.run.y - Math.sin(sim.run.head)*2, 24, '#ff8c1a', 14, sim.run.head+Math.PI);
  }

  return {
    derive, sampleShape, buildRamp, rampExitEst, rampPoint, newRun,
    stepRamp, stepFlight, skipSlide, fireAfterburner,
    SCALE_H,
  };
}
