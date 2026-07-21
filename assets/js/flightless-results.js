// Flightless — end-of-flight results module.
//
// Owns scoring a finished run (cash from distance/altitude/speed/airtime,
// milestones, contracts, medals) and populating the results panel's DOM.
// Takes the shared sim object (for run/phase) and the save state, plus the
// data tables and formatting/sound/save helpers it needs — no physics or
// shop logic lives here.
export function createResults(deps){
  const { sim, state, input, SFX, save, fmtCash, fmtDist, MILESTONES, MEDALS, econLog } = deps;

  const clamp = (v,a,b) => v<a?a : v>b?b : v;

  // ── Headline flavor tables ──────────────────────────────────────────────
  // Multiple variants per distance tier. Picked deterministically by state.day
  // so a given day's headline is stable (no jitter on revisit).
  const HEADLINES = [
    { max:   30, lines:[
      'THAT WAS… A START',
      'OFF TO A SLOW START',
      'BARELY OFF THE RAMP',
      'THE RAMP MISSES YOU',
      'SPLAT. TRY AGAIN.',
    ]},
    { max:  200, lines:[
      'GETTING SOMEWHERE',
      'A RESPECTABLE WOBBLE',
      'YOU BRIEFLY FLEW',
      'AIRBORNE. SORT OF.',
      'PROGRESS. POSSIBLY.',
    ]},
    { max: 1000, lines:[
      'NOW WE\'RE FLYING',
      'THE HORIZON BECKONS',
      'DECENT LIFTOFF!',
      'THE WIND IS WILLING',
      'FEATHERS AND FURY',
    ]},
    { max: 8000, lines:[
      'INCREDIBLE FLIGHT',
      'THE CROWD GOES WILD',
      'SOARING IN STYLE',
      'HEIGHTS UNCHARTED',
      'A MASTERCLASS LAUNCH',
    ]},
    { max: Infinity, lines:[
      'ABSOLUTELY LEGENDARY',
      'PENGUIN HISTORY MADE',
      'THEY\'LL WRITE SONGS',
      'THE WALL TREMBLES',
      'MAXIMUM VELOCITY BIRD',
    ]},
  ];

  function pickHeadline(dist, day){
    const tier = HEADLINES.find(t => dist < t.max) || HEADLINES[HEADLINES.length-1];
    return tier.lines[day % tier.lines.length];
  }

  // ── Count-up animation ──────────────────────────────────────────────────
  let countUpTimers = [];
  function animateCash(el, target, delay, dur){
    el.textContent = '$0';
    const t0 = performance.now() + delay;
    let lastTick = 0;
    function frame(now){
      if(now < t0){ countUpTimers.push(requestAnimationFrame(frame)); return; }
      const t = clamp((now-t0)/dur, 0, 1);
      const eased = 1-Math.pow(1-t,3);
      el.textContent = fmtCash(target*eased);
      if(t<1){
        if(now-lastTick > 60 && target>0){ SFX.tick(); lastTick = now; }
        countUpTimers.push(requestAnimationFrame(frame));
      }
    }
    countUpTimers.push(requestAnimationFrame(frame));
  }

  function finishRun(){
    if(sim.run.done) return;
    sim.run.done = true;
    SFX.setThrust(false);
    sim.phase = 'results';

    const dist = Math.max(0, sim.run.dist);
    const cashDist = 6 + 2.0*Math.pow(dist, 0.9);
    const cashAlt = state.perm.alti ? sim.run.maxAlt*0.3 : 0;
    const cashSpd = state.perm.speedo ? sim.run.maxSpd*1.6 : 0;
    // airtime multiplier, the LtF classic: staying up pays, up to ×2 at 2 min
    const airMult = 1 + Math.min(sim.run.t, 120)/120;
    const payMult = sim.st.mult * airMult;
    const subtotal = (cashDist+cashAlt+cashSpd) * payMult;

    // milestones
    let bonusTotal = 0;
    const newBonuses = [];
    for(const [d, cash] of MILESTONES){
      if(dist >= d && !state.claimed.includes(d)){
        state.claimed.push(d); bonusTotal += cash; newBonuses.push([d, cash]);
      }
    }
    // contracts — judged against the targets locked in at launch
    const contractResults = sim.run.contracts.map((c, i) =>
      ({ ...c, got:c.val(sim.run), met:sim.run.contractsMet.has(i) || c.val(sim.run) >= c.target }));
    const contractTotal = contractResults.reduce((sum,c) => sum + (c.met ? c.reward : 0), 0);
    const skimCash = Math.round(sim.run.skimCash);

    // medals — permanent achievements; some pay cash, folded straight into
    // this flight's total the same as a milestone.
    const newMedals = [];
    for(const m of MEDALS){
      if(state.medals.includes(m.id)) continue;
      if(m.chk(sim.run)){ state.medals.push(m.id); newMedals.push(m); }
    }
    const medalTotal = newMedals.reduce((sum,m) => sum + (m.cash||0), 0);

    const total = Math.round(subtotal + bonusTotal + contractTotal + sim.run.smashCash
      + sim.run.coinCash + sim.run.starCash + sim.run.gunCash + sim.run.ringCash
      + skimCash + medalTotal);
    state.money += total;

    // lifetime "have I ever done X" flags — gate future daily contracts
    // (flightless-data.js's CONTRACT_POOL) so a mission never references a
    // mechanic the player hasn't discovered yet.
    if(!state.everDid || typeof state.everDid !== 'object') state.everDid = {};
    if(sim.run.coinCount > 0)  state.everDid.fish   = true;
    if(sim.run.ringCount > 0)  state.everDid.ring   = true;
    if(sim.run.starCount > 0)  state.everDid.star   = true;
    if(sim.run.gunKills > 0)   state.everDid.gun    = true;
    if(sim.run.obHits > 0)     state.everDid.smash  = true;
    if(sim.run.skimT > 0)      state.everDid.skim   = true;
    if(sim.run.bounceCount > 0)state.everDid.bounce = true;
    if(sim.run.maxCombo > 1)   state.everDid.combo  = true;
    if(sim.run.loopCount > 0)  state.everDid.loop   = true;

    if(typeof econLog?.logFlight === 'function'){
      econLog.logFlight({
        dist, alt: sim.run.maxAlt, spd: sim.run.maxSpd, earned: total,
        breakdown: {
          distance: Math.round(cashDist*payMult), altitude: Math.round(cashAlt*payMult),
          speed: Math.round(cashSpd*payMult), milestones: bonusTotal, contracts: contractTotal,
          smash: sim.run.smashCash, coins: sim.run.coinCash, stars: sim.run.starCash,
          gun: sim.run.gunCash, rings: sim.run.ringCash, skim: skimCash, medals: medalTotal,
        },
      });
    }

    const recD = dist > state.best.dist, recA = sim.run.maxAlt > state.best.alt, recS = sim.run.maxSpd > state.best.spd;
    state.best.dist = Math.max(state.best.dist, dist);
    state.best.alt = Math.max(state.best.alt, sim.run.maxAlt);
    state.best.spd = Math.max(state.best.spd, sim.run.maxSpd);

    // ── Sound barks (guarded — SFX.cheer/oof may not exist yet) ──────────
    const isRecord = recD || recA || recS || newMedals.length > 0;
    const isCrash  = dist < 30;
    if(isRecord && typeof SFX.cheer === 'function') SFX.cheer();
    if(isCrash  && typeof SFX.oof   === 'function') SFX.oof();

    // ── DOM ───────────────────────────────────────────────────────────────
    document.getElementById('res-day').textContent = state.day;
    document.getElementById('res-headline').textContent = pickHeadline(dist, state.day);
    document.getElementById('res-dist').textContent = fmtDist(dist);
    document.getElementById('res-alt').textContent = fmtDist(sim.run.maxAlt);
    document.getElementById('res-spd').textContent = Math.round(sim.run.maxSpd)+' m/s';
    document.getElementById('rec-dist').textContent = recD ? '★ NEW BEST' : '';
    document.getElementById('rec-alt').textContent = recA ? '★' : '';
    document.getElementById('rec-spd').textContent = recS ? '★' : '';

    document.getElementById('res-air').textContent = Math.round(sim.run.t);
    document.getElementById('cash-air').textContent = '×'+airMult.toFixed(2);
    const multRow = document.getElementById('res-mult-row');
    if(sim.st.mult > 1){
      multRow.style.display = 'flex';
      document.getElementById('cash-mult').textContent = '×'+sim.st.mult.toFixed(2);
    } else multRow.style.display = 'none';

    // clear any stragglers from the previous results screen BEFORE scheduling
    // this one's animations, or they'd be cancelled the moment they're queued
    countUpTimers.forEach(cancelAnimationFrame);
    countUpTimers = [];

    const bonusBox = document.getElementById('res-bonuses');
    bonusBox.innerHTML = '';

    // Milestones
    newBonuses.forEach(([d, cash], i) => {
      const row = document.createElement('div');
      row.className = 'res-row bonus';
      row.innerHTML = `<span class="val">\u{1F3C1} Milestone: ${fmtDist(d)}!</span><span class="cash"></span>`;
      bonusBox.appendChild(row);
      animateCash(row.querySelector('.cash'), cash, 1300+i*250, 500);
    });
    if(newBonuses.length) setTimeout(()=>SFX.ding(), 1300);

    // Demolition bonus
    if(sim.run.smashCash > 0){
      const row = document.createElement('div');
      row.className = 'res-row bonus';
      row.innerHTML = `<span class="val">\u{1F4A5} DEMOLITION!</span><span class="cash"></span>`;
      bonusBox.appendChild(row);
      animateCash(row.querySelector('.cash'), sim.run.smashCash, 1350, 600);
    }

    // Medals
    newMedals.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'res-row bonus';
      row.innerHTML = `<span class="val">\u{1F3C5} MEDAL: ${m.name}</span><span class="cash"></span>`;
      bonusBox.appendChild(row);
      if(m.cash > 0) animateCash(row.querySelector('.cash'), m.cash, 1450+i*250, 500);
      else row.querySelector('.cash').textContent = '';
    });
    if(newMedals.length) setTimeout(()=>SFX.ding(), 1500);

    // Contracts
    contractResults.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'res-row' + (c.met ? ' bonus' : '');
      if(c.met){
        row.innerHTML = `<span class="val">\u{1F4CB} Contract: ${c.text} ✓</span><span class="cash"></span>`;
        bonusBox.appendChild(row);
        animateCash(row.querySelector('.cash'), c.reward, 1400+i*250, 500);
      } else {
        row.innerHTML = `<span class="val" style="color:var(--muted)">\u{1F4CB} ${c.text} — ${c.got}/${c.target}</span><span class="cash" style="color:#555b9e">✗</span>`;
        bonusBox.appendChild(row);
      }
    });

    animateCash(document.getElementById('cash-dist'), Math.round(cashDist*payMult), 200, 700);
    const altRow = document.getElementById('res-alt-row');
    const spdRow = document.getElementById('res-spd-row');
    const altCashEl = document.getElementById('cash-alt');
    const spdCashEl = document.getElementById('cash-spd');
    if(state.perm.alti){
      altRow.style.display = 'flex';
      altCashEl.className = 'cash';
      animateCash(altCashEl, Math.round(cashAlt*payMult), 550, 500);
    } else { altRow.style.display = 'none'; }
    if(state.perm.speedo){
      spdRow.style.display = 'flex';
      spdCashEl.className = 'cash';
      animateCash(spdCashEl, Math.round(cashSpd*payMult), 850, 500);
    } else { spdRow.style.display = 'none'; }

    const coinsRow = document.getElementById('res-coins-row');
    if(sim.run.coinCount > 0){
      coinsRow.style.display = 'flex';
      document.getElementById('res-coins-count').textContent = sim.run.coinCount;
      animateCash(document.getElementById('cash-coins'), sim.run.coinCash, 950, 500);
    } else coinsRow.style.display = 'none';
    const starsRow = document.getElementById('res-stars-row');
    if(sim.run.starCount > 0){
      starsRow.style.display = 'flex';
      document.getElementById('res-stars-count').textContent = sim.run.starCount;
      animateCash(document.getElementById('cash-stars'), sim.run.starCash, 1100, 500);
    } else starsRow.style.display = 'none';
    const ringsRow = document.getElementById('res-rings-row');
    if(sim.run.ringCount > 0){
      ringsRow.style.display = 'flex';
      document.getElementById('res-rings-count').textContent = sim.run.ringCount;
      animateCash(document.getElementById('cash-rings'), sim.run.ringCash, 1150, 500);
    } else ringsRow.style.display = 'none';
    const skimRow = document.getElementById('res-skim-row');
    if(sim.run.skimT > 1){
      skimRow.style.display = 'flex';
      document.getElementById('res-skim-count').textContent = sim.run.skimT.toFixed(1);
      animateCash(document.getElementById('cash-skim'), skimCash, 1200, 500);
    } else skimRow.style.display = 'none';
    const gunRow = document.getElementById('res-gun-row');
    if(sim.run.gunKills > 0){
      gunRow.style.display = 'flex';
      document.getElementById('res-gun-count').textContent = sim.run.gunKills;
      animateCash(document.getElementById('cash-gun'), sim.run.gunCash, 1250, 500);
    } else gunRow.style.display = 'none';

    animateCash(document.getElementById('cash-total'), total, 1300+(newBonuses.length+newMedals.length+contractResults.length)*250, 900);

    state.day++;
    save();

    document.getElementById('hud').style.display = 'none';
    document.getElementById('hint').style.display = 'none';
    document.getElementById('ff-btn').style.display = 'none';
    input.ff = false;
    document.getElementById('touch').classList.remove('flying');
    document.getElementById('results').classList.add('show');
  }

  return { finishRun, animateCash };
}
