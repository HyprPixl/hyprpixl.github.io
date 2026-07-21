// Flightless — store/shop module.
//
// Owns everything about the in-between-flights shop screen: the single
// unified upgrade tree (upgrades + one-time gear, all one grid now — no
// more tabs), the goals list (milestones + daily contracts + landmarks +
// the medal wall), and the ramp-shape designer pop-over. It has no physics
// or rendering of its own — it's handed the save state, the upgrade/medal
// data tables, and a handful of pure helper functions from the host page,
// and it owns the DOM inside #shop from there.
//
// This is split out of pages/flightless.html so the store UI can be
// iterated on independently of the flight sim, canvas renderer, and save
// system that still live in the host page.
export function createStore(deps){
  const {
    state, UPGRADES, MEDALS, LANDMARKS, MILESTONES,
    contractsFor, upgCost, fmtCash, fmtDist, save, SFX, defaultState,
    getSt, getRamp, recompute, sampleShape, clamp, RAD, econLog,
  } = deps;
  const DAILY_CAP_BASE = typeof deps.DAILY_CAP_BASE === 'number' ? deps.DAILY_CAP_BASE : 3;

  // Defensive reads for optional deps that may arrive in a future save/data
  // agent pass.  Never throw if absent — just no-op the feature.
  const dailyDealFor = typeof deps.dailyDealFor === 'function' ? deps.dailyDealFor : null;
  const exportSave   = typeof deps.save?.exportSave === 'function'
    ? () => deps.save.exportSave()
    : typeof deps.exportSave === 'function'
      ? deps.exportSave
      : null;
  const importSave   = typeof deps.save?.importSave === 'function'
    ? s => deps.save.importSave(s)
    : typeof deps.importSave === 'function'
      ? deps.importSave
      : null;

  // ── daily delivery cap ──
  // Fish Co. only drops off so many upgrades before your next flight — a
  // hard cap on $ purchases (every tree node, leveled or one-time), raised
  // by buying Cargo Crate levels. Resets the moment a flight happens
  // (state.day changes). Without this, a payout that comfortably affords
  // every upgrade's base cost turns each shop visit into clicking "buy" ten
  // times in a row with no real prioritization.
  let capDay = state.day;
  let purchasesToday = 0;
  function dailyCap(){ return DAILY_CAP_BASE + (state.lvl.cargo ?? 0); }
  function capRemaining(){
    if(capDay !== state.day){ capDay = state.day; purchasesToday = 0; }
    return dailyCap() - purchasesToday;
  }
  function registerPurchase(){
    if(capDay !== state.day){ capDay = state.day; purchasesToday = 0; }
    purchasesToday++;
  }

  const shopGrid = document.getElementById('shop-grid');
  const medalRow = document.getElementById('medal-row');
  const goalList = document.getElementById('goal-list');

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

  // ── ramp designer presets ──
  // Preset control-point arrays: each entry is a full rampShape replacement.
  // Points are in normalised [0,1]×[0,1] coordinates matching the editor's
  // convention: x increases left→right along the ramp base, y=0 is ground
  // level and y=1 is the top of the editor canvas.
  const RAMP_PRESETS = [
    {
      label: '🚀 Steep Launch',
      // Gate high, kicker near the end, lip shoots near-vertical.
      shape: [
        { x: 0.08, y: 0.82 },
        { x: 0.38, y: 0.65 },
        { x: 0.68, y: 0.38 },
        { x: 0.92, y: 0.14 },
      ],
    },
    {
      label: '🪂 Long Glide',
      // Gentle ramp for maximum horizontal carry rather than altitude.
      shape: [
        { x: 0.06, y: 0.55 },
        { x: 0.32, y: 0.42 },
        { x: 0.62, y: 0.28 },
        { x: 0.94, y: 0.18 },
      ],
    },
    {
      label: '🛹 Trick Ramp',
      // Mid-height kicker with a sharp upswing at the lip for combos/style.
      shape: [
        { x: 0.07, y: 0.45 },
        { x: 0.28, y: 0.35 },
        { x: 0.60, y: 0.50 },
        { x: 0.90, y: 0.22 },
      ],
    },
  ];

  // Build the preset button row and append it into #ramp-pop (above the
  // canvas) so the DOM order is: presets → canvas → footer.
  const presetRow = document.createElement('div');
  presetRow.style.cssText = 'display:flex;gap:4px;justify-content:center;flex-wrap:wrap;margin-bottom:2px;';
  for(const preset of RAMP_PRESETS){
    const btn = document.createElement('button');
    btn.textContent = preset.label;
    btn.style.cssText = [
      'font-family:inherit',
      'font-size:10px',
      'cursor:pointer',
      'background:var(--panel)',
      'color:var(--text)',
      'border:1px solid var(--border)',
      'padding:3px 7px',
      'border-radius:3px',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--yellow)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--border)'; });
    btn.addEventListener('click', () => {
      // Deep-copy the preset so later drags don't mutate our constant.
      state.rampShape = preset.shape.map(p => ({ ...p }));
      recompute();
      save();
      drawEditor();
    });
    presetRow.appendChild(btn);
  }
  // Insert before the canvas (first child of ramp-pop).
  rampPop.insertBefore(presetRow, rampPop.firstChild);

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

  // ── save export / import UI ──
  // Wire export/import buttons into the shop footer's notes area (next to the
  // reset link).  The buttons are no-ops if save.exportSave/importSave are not
  // provided — guarded above at module top.
  (function buildSaveButtons(){
    const notesEl = document.querySelector('#shop .notes');
    if(!notesEl) return;   // DOM not yet ready somehow; skip gracefully

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;margin-top:2px;';

    if(exportSave){
      const exportBtn = document.createElement('button');
      exportBtn.className = 'reset-link';
      exportBtn.textContent = '📋 export save';
      exportBtn.title = 'Copy save data to clipboard';
      exportBtn.addEventListener('click', async () => {
        try {
          const str = exportSave();
          if(typeof str !== 'string' || !str) return;
          await navigator.clipboard.writeText(str);
          exportBtn.textContent = '✅ copied!';
          setTimeout(() => { exportBtn.textContent = '📋 export save'; }, 2000);
        } catch(err) {
          // Clipboard can be blocked; fall back to a prompt the user can copy from.
          const str = exportSave();
          if(str) prompt('Copy this save string:', str);
        }
      });
      row.appendChild(exportBtn);
    }

    if(importSave){
      const importBtn = document.createElement('button');
      importBtn.className = 'reset-link';
      importBtn.textContent = '📥 import save';
      importBtn.title = 'Paste a save string to restore progress';
      importBtn.addEventListener('click', () => {
        const str = prompt('Paste your save string:');
        if(!str) return;
        try {
          const imported = importSave(str.trim());
          if(!imported || typeof imported !== 'object') throw new Error('empty save');
          // Apply IN PLACE — every module holds a reference to this same
          // `state` object, so reassigning it would leave them reading a stale
          // copy. Mirror the reset-progress flow in the host page.
          for(const k of Object.keys(state)) delete state[k];
          Object.assign(state, imported);
          save();
          // Reload the shop to reflect the new state.
          recompute();
          renderShop();
        } catch(err) {
          alert('Import failed — save string may be invalid.\n' + (err?.message ?? err));
        }
      });
      row.appendChild(importBtn);
    }

    if(row.childElementCount > 0) notesEl.appendChild(row);

    // ── economy log (separate from the save file) ──
    // Copies a plain-text ledger of every purchase and flight payout, so a
    // player can play a stretch of days and hand the log to someone else for
    // balance tuning. No-op if econLog wasn't provided.
    if(econLog){
      const econRow = document.createElement('div');
      econRow.style.cssText = 'display:flex;gap:10px;margin-top:2px;';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'reset-link';
      copyBtn.textContent = '🧾 copy econ log';
      copyBtn.title = 'Copy a day-by-day ledger of purchases and flight earnings';
      copyBtn.addEventListener('click', async () => {
        const txt = econLog.toText();
        try {
          await navigator.clipboard.writeText(txt);
          copyBtn.textContent = '✅ copied!';
          setTimeout(() => { copyBtn.textContent = '🧾 copy econ log'; }, 2000);
        } catch(err) {
          prompt('Copy this econ log:', txt);
        }
      });
      econRow.appendChild(copyBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'reset-link';
      clearBtn.textContent = '🗑 clear econ log';
      clearBtn.title = 'Erase the recorded ledger (does not touch your save)';
      clearBtn.addEventListener('click', () => {
        if(!econLog.entries.length) return;
        if(!confirm('Clear the recorded economy log? This does not affect your save.')) return;
        econLog.clear();
      });
      econRow.appendChild(clearBtn);

      notesEl.appendChild(econRow);
    }
  })();

  function renderShop(){
    drawEditor();
    document.getElementById('shop-money').textContent = fmtCash(state.money);
    document.getElementById('shop-day').textContent = state.day;
    document.getElementById('shop-best').textContent = fmtDist(state.best.dist);
    const capEl = document.getElementById('shop-cap');
    if(capEl){
      const remaining = Math.max(0, capRemaining());
      capEl.textContent = `${remaining}/${dailyCap()}`;
      document.getElementById('shop-cap-chip')?.classList.toggle('cap-out', remaining <= 0);
    }

    // controls hint — only mention controls for gear the player actually owns
    const controlsHintEl = document.getElementById('controls-hint');
    if(controlsHintEl){
      const segs = ['⬆/⬇ or W/S steer'];
      if(state.lvl.rocket > 0) segs.push('SPACE rocket');
      if(state.perm.burner) segs.push('X afterburner');
      if(state.lvl.gun > 0) segs.push('C fire cannon');
      segs.push('F fast-forward', 'ENTER launch');
      controlsHintEl.textContent = segs.join(' · ');
    }

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

    // medal wall — unified into Goals (no separate tab): earned bright,
    // unearned greyed, cash value (if any) shown in the tooltip
    medalRow.innerHTML = '';
    for(const m of MEDALS){
      const got = state.medals.includes(m.id);
      const chip = document.createElement('div');
      chip.className = 'medal ' + (got ? 'on' : 'off');
      chip.textContent = m.icon;
      chip.title = `${m.name}${m.cash > 0 ? ' (+'+fmtCash(m.cash)+')' : ''} — ${m.desc}`;
      medalRow.appendChild(chip);
    }

    // ── daily deal resolution (defensive: dailyDealFor may be absent) ──
    const todaysDeal = dailyDealFor ? (function(){
      try { return dailyDealFor(state.day); } catch(_){ return null; }
    })() : null;
    // todaysDeal is expected to be { id, discount } — e.g. { id: 'engine', discount: 0.25 }

    // upgrade tree — unlocked at distance milestones AND tree prerequisites.
    // A maxed-out node drops off the list entirely (its slot is free for a
    // later tier), and a locked one (missing a prerequisite) doesn't show
    // at all — no "requires X + Y" clutter for nodes you can't work toward
    // yet. Everything whose prerequisites ARE met stays visible regardless
    // of affordability — a real tree has real branches, hiding options
    // behind "only show the cheapest" fights against letting the player see
    // and choose between them. `oneTime` nodes (formerly the separate GEAR
    // list — Speedometer, Altimeter, Afterburner, Reserve Tank) are bought
    // once ever: ownership lives in state.perm[id] instead of state.lvl[id],
    // so physics/hud/results (which already read state.perm.speedo etc.)
    // needed no changes.
    shopGrid.innerHTML = '';
    function isOwned(id){
      const u = UPGRADES.find(x => x.id === id);
      if(!u) return false;
      return u.oneTime ? !!state.perm[id] : (state.lvl[id] ?? 0) > 0;
    }
    function ownedLevel(u){ return u.oneTime ? (state.perm[u.id] ? 1 : 0) : (state.lvl[u.id] ?? 0); }
    const missingRequires = u => (u.requires || []).filter(id => !isOwned(id));
    const upgAvail = UPGRADES.filter(u =>
      state.best.dist >= (u.unlock||0) && ownedLevel(u) < u.max && missingRequires(u).length === 0);
    for(const u of upgAvail){
      const lvl = ownedLevel(u);
      const baseCost = upgCost(u);

      // Apply daily deal discount if this upgrade matches today's deal.
      const isDailyDeal = todaysDeal && todaysDeal.id === u.id;
      const dealDiscount = isDailyDeal && typeof todaysDeal.discount === 'number'
        ? clamp(todaysDeal.discount, 0, 0.9)
        : 0;
      const cost = isDailyDeal ? Math.max(1, Math.round(baseCost * (1 - dealDiscount))) : baseCost;
      const capOut = capRemaining() <= 0;

      const affordable = !capOut && state.money >= cost;
      const card = document.createElement('div');
      card.className = 'upg' + (affordable ? ' affordable' : '') + (isDailyDeal ? ' daily-deal' : '');

      // ── stat projection ladder ──
      // Show current value plus up to 3 preview levels so the player can see
      // the full trajectory, not just the immediate next step.
      const projSteps = [];
      for(let step = 1; step <= 3; step++){
        const previewLvl = lvl + step;
        if(previewLvl > u.max) break;
        projSteps.push({ lvl: previewLvl, val: u.val(previewLvl) });
      }
      // Build a small "ladder" string: "→ v1 → v2 → v3"
      const ladderHTML = projSteps
        .map((s, i) => {
          const isNext = i === 0;
          const color  = isNext ? 'var(--yellow)' : '#8891d8';
          return `<span style="color:${color};font-weight:${isNext?'bold':'normal'}">${s.val}</span>`;
        })
        .join('<span style="color:var(--muted)"> → </span>');

      const pips = Array.from({length:u.max}, (_,i)=>`<div class="pip${i<lvl?' on':''}"></div>`).join('');

      // Daily deal badge styling injected inline so it works without a CSS edit.
      const dealBadgeHTML = isDailyDeal
        ? `<div style="font-size:9px;font-weight:bold;color:#ff0;background:#500;padding:1px 5px;border-radius:2px;margin-bottom:3px;display:inline-block;">
             ⚡ DAILY DEAL −${Math.round(dealDiscount*100)}%
           </div><br>`
        : '';
      const capBadgeHTML = capOut
        ? `<div style="font-size:9px;font-weight:bold;color:#ff8a8a;background:#3a1010;padding:1px 5px;border-radius:2px;margin-bottom:3px;display:inline-block;" title="Fish Co. is out of deliveries for today — fly again, or buy Cargo Crate for a bigger allowance.">
             \u{1F4E6} NO DELIVERIES LEFT TODAY
           </div><br>`
        : '';

      card.innerHTML = `
        <div class="upg-head"><span class="upg-icon">${u.icon}</span><span class="upg-name">${u.name}</span></div>
        ${dealBadgeHTML}${capBadgeHTML}
        <div class="upg-desc">${u.desc}</div>
        <div class="upg-stat">${u.val(lvl)}${ladderHTML ? `<span style="color:var(--muted)"> → </span>${ladderHTML}` : ''}</div>
        <div class="pips">${pips}</div>
        <button ${(capOut || state.money<cost)?'disabled':''}>${isDailyDeal ? `Deal — ${fmtCash(cost)}` : `Buy — ${fmtCash(cost)}`}${isDailyDeal && baseCost !== cost ? ` <s style="color:var(--muted);font-size:9px">${fmtCash(baseCost)}</s>` : ''}</button>`;
      card.querySelector('button').addEventListener('click', () => {
        if(state.money < cost || capRemaining() <= 0) return;
        state.money -= cost;
        if(u.oneTime) state.perm[u.id] = true;
        else state.lvl[u.id]++;
        registerPurchase();
        econLog?.logBuy({ name: u.name, id: u.id, cost, lvl: u.oneTime ? 'owned' : state.lvl[u.id] });
        SFX.buy();
        save();
        renderShop();
        recompute();   // live-preview taller ramp behind the shop
      });
      shopGrid.appendChild(card);
    }
  }

  return { renderShop, drawEditor };
}
