// Flightless — store/shop module.
//
// Owns everything about the in-between-flights shop screen: the tabbed
// upgrade/gear/bonus/medal shelves, the goals list, and the ramp-shape
// designer pop-over. It has no physics or rendering of its own — it's
// handed the save state, the upgrade/gear/medal data tables, and a handful
// of pure helper functions from the host page, and it owns the DOM inside
// #shop from there.
//
// This is split out of pages/flightless.html so the store UI can be
// iterated on independently of the flight sim, canvas renderer, and save
// system that still live in the host page.
export function createStore(deps){
  const {
    state, UPGRADES, GEAR, BONUS_SHOP, MEDALS, LANDMARKS, MILESTONES,
    contractsFor, upgCost, fmtCash, fmtDist, save, SFX, defaultState,
    getSt, getRamp, recompute, sampleShape, clamp, RAD,
  } = deps;

  const shopGrid = document.getElementById('shop-grid');
  const gearGrid = document.getElementById('gear-grid');
  const bonusGrid = document.getElementById('bonus-grid');
  const medalRow = document.getElementById('medal-row');
  const goalList = document.getElementById('goal-list');
  const tabsEl = document.getElementById('shop-tabs');
  const panels = {
    upgrades: document.getElementById('panel-upgrades'),
    gear: document.getElementById('panel-gear'),
    bonus: document.getElementById('panel-bonus'),
    medals: document.getElementById('panel-medals'),
  };
  const tabCountEls = {
    upgrades: document.getElementById('tab-count-upgrades'),
    gear: document.getElementById('tab-count-gear'),
    bonus: document.getElementById('tab-count-bonus'),
    medals: document.getElementById('tab-count-medals'),
  };

  tabsEl.addEventListener('click', e => {
    const btn = e.target.closest('.shop-tab');
    if(!btn) return;
    setTab(btn.dataset.tab);
  });
  function setTab(tab){
    tabsEl.querySelectorAll('.shop-tab').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
    for(const [name, el] of Object.entries(panels)) el.hidden = name!==tab;
  }
  function setTabCount(name, n){
    const el = tabCountEls[name];
    if(!el) return;
    el.textContent = n>0 ? String(n) : '';
    el.classList.toggle('on', n>0);
  }

  // ── ramp designer (collapsible pop-over) ──
  // A one-line summary button in the shop footer; the canvas appears above
  // it on demand. All four control points drag, including the lip, so the
  // exit angle and kicker are fully the player's. The world ramp rebuilds
  // live behind the shop while dragging.
  const edCv = document.getElementById('ramp-editor');
  const edCtx = edCv.getContext('2d');
  const shapeInfo = document.getElementById('shape-info');
  const rampPop = document.getElementById('ramp-pop');
  const ED_W=260, ED_H=120, ED_PAD=14, ED_TOP=12, ED_GROUND=ED_H-16;
  edCv.width = ED_W*2; edCv.height = ED_H*2; edCtx.setTransform(2,0,0,2,0,0);
  const edX = p => ED_PAD + p.x*(ED_W-2*ED_PAD);
  const edY = p => ED_GROUND - p.y*(ED_GROUND-ED_TOP);
  let edDrag = -1;

  function drawEditor(){
    const ramp = getRamp();
    if(!ramp) return;
    shapeInfo.textContent = `${Math.round(ramp.exitTh/RAD)}° nose · ${Math.round(ramp.H)} m tall`;
    if(!rampPop.classList.contains('open')) return;
    edCtx.clearRect(0,0,ED_W,ED_H);
    // faint height grid
    edCtx.strokeStyle = 'rgba(58,65,168,0.35)'; edCtx.lineWidth = 1;
    for(let g=1; g<=3; g++){
      const y = Math.round(ED_GROUND - (ED_GROUND-ED_TOP)*g/4) + 0.5;
      edCtx.beginPath(); edCtx.moveTo(0, y); edCtx.lineTo(ED_W, y); edCtx.stroke();
    }
    // the ice
    edCtx.fillStyle = 'rgba(180,220,255,0.13)';
    edCtx.fillRect(0, ED_GROUND, ED_W, ED_H-ED_GROUND);
    edCtx.strokeStyle = '#9fc6e8'; edCtx.lineWidth = 1;
    edCtx.beginPath(); edCtx.moveTo(0, ED_GROUND+0.5); edCtx.lineTo(ED_W, ED_GROUND+0.5); edCtx.stroke();
    // ramp silhouette + track
    const raw = sampleShape(state.rampShape);
    edCtx.fillStyle = 'rgba(160,98,45,0.28)';
    edCtx.beginPath();
    edCtx.moveTo(edX(raw[0]), ED_GROUND);
    raw.forEach(p => edCtx.lineTo(edX(p), Math.min(edY(p), ED_GROUND)));
    edCtx.lineTo(edX(raw[raw.length-1]), ED_GROUND);
    edCtx.closePath(); edCtx.fill();
    edCtx.strokeStyle = '#FFFF00'; edCtx.lineWidth = 2;
    edCtx.beginPath();
    raw.forEach((p,i)=> i ? edCtx.lineTo(edX(p), Math.min(edY(p), ED_GROUND)) : edCtx.moveTo(edX(p), edY(p)));
    edCtx.stroke();
    // launch direction off the lip
    const lipP = state.rampShape[state.rampShape.length-1];
    const ax = edX(lipP), ay = edY(lipP);
    const dx = Math.cos(ramp.exitTh), dy = -Math.sin(ramp.exitTh);
    edCtx.strokeStyle = 'rgba(255,80,80,0.9)'; edCtx.lineWidth = 1.5;
    edCtx.setLineDash([4,3]);
    edCtx.beginPath(); edCtx.moveTo(ax, ay); edCtx.lineTo(ax+dx*24, ay+dy*24); edCtx.stroke();
    edCtx.setLineDash([]);
    edCtx.beginPath();
    edCtx.moveTo(ax+dx*30, ay+dy*30);
    edCtx.lineTo(ax+dx*22-dy*4, ay+dy*22+dx*4);
    edCtx.lineTo(ax+dx*22+dy*4, ay+dy*22-dx*4);
    edCtx.closePath();
    edCtx.fillStyle = 'rgba(255,80,80,0.9)'; edCtx.fill();
    // handles — lip drawn as a red square so it reads as "the exit"
    state.rampShape.forEach((p,i)=>{
      const isLip = i === state.rampShape.length-1;
      edCtx.fillStyle = i===edDrag ? '#ffffff' : isLip ? '#ff5555' : '#ffd23f';
      edCtx.strokeStyle = '#000080'; edCtx.lineWidth = 1.5;
      if(isLip){
        edCtx.fillRect(edX(p)-6, edY(p)-6, 12, 12);
        edCtx.strokeRect(edX(p)-6, edY(p)-6, 12, 12);
      } else {
        edCtx.beginPath(); edCtx.arc(edX(p), edY(p), 7, 0, 7); edCtx.fill(); edCtx.stroke();
      }
    });
  }
  function edPos(e){
    const r = edCv.getBoundingClientRect();
    return { x:e.clientX-r.left, y:e.clientY-r.top };
  }
  edCv.addEventListener('pointerdown', e => {
    e.preventDefault();
    const m = edPos(e);
    let best=-1, bd=24*24;
    state.rampShape.forEach((p,i)=>{
      const d = (edX(p)-m.x)**2 + (edY(p)-m.y)**2;
      if(d < bd){ bd = d; best = i; }
    });
    edDrag = best;
    if(best >= 0) edCv.setPointerCapture(e.pointerId);
    drawEditor();
  });
  edCv.addEventListener('pointermove', e => {
    if(edDrag < 0) return;
    const m = edPos(e);
    const s = state.rampShape, last = s.length-1;
    const nx = clamp((m.x-ED_PAD)/(ED_W-2*ED_PAD), 0, 1);
    let ny = clamp((ED_GROUND-m.y)/(ED_GROUND-ED_TOP), 0.02, 1);
    if(edDrag === 0) ny = Math.max(ny, s[last].y + 0.12);   // gate stays above the lip
    if(edDrag === last) ny = Math.min(ny, s[0].y - 0.12);   // lip stays below the gate
    const lo = edDrag===0 ? 0 : s[edDrag-1].x + 0.07;
    const hi = edDrag===last ? 1 : s[edDrag+1].x - 0.07;
    s[edDrag] = { x: clamp(nx, lo, hi), y: ny };
    recompute();
    drawEditor();
  });
  const edUp = () => {
    if(edDrag < 0) return;
    edDrag = -1;
    save();
    renderShop();
  };
  edCv.addEventListener('pointerup', edUp);
  edCv.addEventListener('pointercancel', edUp);
  document.getElementById('ramp-toggle').addEventListener('click', () => {
    rampPop.classList.toggle('open');
    drawEditor();
  });
  document.getElementById('shape-reset').addEventListener('click', () => {
    state.rampShape = defaultState().rampShape;
    recompute();
    save();
    drawEditor();
  });

  function renderShop(){
    drawEditor();
    document.getElementById('shop-money').textContent = fmtCash(state.money);
    document.getElementById('shop-day').textContent = state.day;
    document.getElementById('shop-best').textContent = fmtDist(state.best.dist);
    document.getElementById('shop-bp').textContent = state.bp + ' BP';

    // goals
    goalList.innerHTML = '';
    let nextMarked = false;
    for(const [dist, cash] of MILESTONES){
      const li = document.createElement('li');
      const done = state.claimed.includes(dist);
      li.textContent = `${fmtDist(dist)} (${fmtCash(cash)})`;
      if(done) li.className = 'done';
      else if(!nextMarked){ li.className = 'next'; li.textContent = '▶ '+li.textContent; nextMarked = true; }
      goalList.appendChild(li);
    }
    // today's contracts
    for(const c of contractsFor(state.day)){
      const li = document.createElement('li');
      li.textContent = `\u{1F4CB} ${c.text} (+${fmtCash(c.reward)})`;
      li.style.color = 'var(--text)';
      goalList.appendChild(li);
    }
    // landmark status
    for(const lm of LANDMARKS){
      const hp = state.lmHP[lm.id];
      const li = document.createElement('li');
      if(hp <= 0){
        li.textContent = `\u{1F4A5} ${lm.name} destroyed`;
        li.className = 'done';
      } else {
        li.textContent = `\u{1F3AF} ${lm.name} @ ${fmtDist(lm.x)} — ${Math.ceil(hp/lm.hp*100)}%`;
      }
      goalList.appendChild(li);
    }

    // upgrade cards — unlock at distance milestones; a maxed-out upgrade drops
    // off the list entirely (its slot is free for a later "tier 2" upgrade),
    // and a fresh one you can't afford yet stays hidden too, except the single
    // cheapest one, which stays visible as the next thing to save toward.
    shopGrid.innerHTML = '';
    const upgAvail = UPGRADES.filter(u => state.best.dist >= (u.unlock||0) && state.lvl[u.id] < u.max);
    const cheapestNewUpg = upgAvail
      .filter(u => state.lvl[u.id]===0 && !(u.requires && state.lvl[u.requires]===0))
      .reduce((min,u) => (!min || upgCost(u) < upgCost(min)) ? u : min, null);
    let upgAffordable = 0;
    for(const u of upgAvail){
      const lvl = state.lvl[u.id];
      const cost = upgCost(u);
      const locked = u.requires && state.lvl[u.requires] === 0;
      if(!locked && lvl===0 && state.money < cost && u !== cheapestNewUpg) continue;
      const affordable = !locked && state.money >= cost;
      if(affordable) upgAffordable++;
      const card = document.createElement('div');
      card.className = 'upg' + (affordable ? ' affordable' : '');
      const pips = Array.from({length:u.max}, (_,i)=>`<div class="pip${i<lvl?' on':''}"></div>`).join('');
      const nextVal = ` → <b style="color:var(--yellow)">${u.val(lvl+1)}</b>`;
      card.innerHTML = `
        <div class="upg-head"><span class="upg-icon">${u.icon}</span><span class="upg-name">${u.name}</span></div>
        <div class="upg-desc">${u.desc}</div>
        <div class="upg-stat">${u.val(lvl)}${nextVal}</div>
        <div class="pips">${pips}</div>
        ${locked ? `<div class="locked-note">requires ${UPGRADES.find(x=>x.id===u.requires).name}</div>` : ''}
        <button ${(locked || state.money<cost)?'disabled':''}>Buy — ${fmtCash(cost)}</button>`;
      card.querySelector('button').addEventListener('click', () => {
        if(state.money < cost || locked) return;
        state.money -= cost;
        state.lvl[u.id]++;
        SFX.buy();
        save();
        renderShop();
        recompute();   // live-preview taller ramp behind the shop
      });
      shopGrid.appendChild(card);
    }
    setTabCount('upgrades', upgAffordable);

    // medal wall — earned bright, unearned greyed with the hint in the tooltip
    medalRow.innerHTML = '';
    for(const m of MEDALS){
      const got = state.medals.includes(m.id);
      const chip = document.createElement('div');
      chip.className = 'medal ' + (got ? 'on' : 'off');
      chip.textContent = m.icon;
      chip.title = `${m.name} (+${m.bp} BP) — ${m.desc}`;
      medalRow.appendChild(chip);
    }
    setTabCount('medals', 0);

    // bonus shop — permanent levels bought with BP
    bonusGrid.innerHTML = '';
    let bonusAffordable = 0;
    for(const b of BONUS_SHOP){
      const lvl = state.bonus[b.id];
      const maxed = lvl >= b.max;
      const cost = maxed ? 0 : b.cost[lvl];
      const affordable = !maxed && state.bp >= cost;
      if(affordable) bonusAffordable++;
      const card = document.createElement('div');
      card.className = 'upg gear' + (affordable ? ' affordable' : '');
      const pips = Array.from({length:b.max}, (_,i)=>`<div class="pip${i<lvl?' on':''}"></div>`).join('');
      card.innerHTML = `
        <div class="upg-head"><span class="upg-icon">${b.icon}</span><span class="upg-name">${b.name}</span></div>
        <div class="upg-desc">${b.desc}</div>
        <div class="pips">${pips}</div>
        <button ${(maxed || state.bp < cost)?'disabled':''}>${maxed ? 'MAX' : `Buy — ${cost} BP`}</button>`;
      card.querySelector('button').addEventListener('click', () => {
        if(maxed || state.bp < cost) return;
        state.bp -= cost;
        state.bonus[b.id]++;
        SFX.buy();
        save();
        renderShop();
        recompute();
      });
      bonusGrid.appendChild(card);
    }
    setTabCount('bonus', bonusAffordable);

    // gear cards (one-time permanent buys) — same unlock/hide rules as upgrades
    gearGrid.innerHTML = '';
    const gearAvail = GEAR.filter(g => state.best.dist >= (g.unlock||0) && !state.perm[g.id]);
    const cheapestNewGear = gearAvail.reduce((min,g) => (!min || g.cost < min.cost) ? g : min, null);
    let gearAffordable = 0;
    for(const g of gearAvail){
      if(state.money < g.cost && g !== cheapestNewGear) continue;
      const affordable = state.money >= g.cost;
      if(affordable) gearAffordable++;
      const card = document.createElement('div');
      card.className = 'upg gear' + (affordable ? ' affordable' : '');
      card.innerHTML = `
        <div class="upg-head"><span class="upg-icon">${g.icon}</span><span class="upg-name">${g.name}</span></div>
        <div class="upg-desc">${g.desc}</div>
        <button ${state.money<g.cost?'disabled':''}>Buy — ${fmtCash(g.cost)}</button>`;
      card.querySelector('button').addEventListener('click', () => {
        if(state.money < g.cost) return;
        state.money -= g.cost;
        state.perm[g.id] = true;
        SFX.buy();
        save();
        renderShop();
      });
      gearGrid.appendChild(card);
    }
    setTabCount('gear', gearAffordable);
  }

  setTab('upgrades');
  return { renderShop, drawEditor };
}
