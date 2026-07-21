// Flightless — store/shop module.
//
// Owns everything about the in-between-flights shop screen: the single
// unified upgrade tree (upgrades + one-time gear, all one grid now — no
// more tabs), the achievements grid (milestones + daily contracts +
// landmarks + medals, all one icon grid — no text goals list), and the
// ramp-shape designer pop-over. It has no physics
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
    contractsFor, fmtCash, fmtDist, save, SFX, defaultState,
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
  const achGrid = document.getElementById('ach-grid');

  // ── upgrade icons (inline SVG, Arctic Dusk palette) ──
  // Purely presentational, so they live here in the store module rather
  // than in the data tables — data.js keeps its emoji `icon` field as a
  // fallback for any node this map doesn't cover. No external image
  // requests: every icon is a hand-drawn inline SVG sharing one 48×48
  // grid, a faint glacial halo, and the theme's gold/teal/coral inks.
  const IC = { G:'#ffc857', T:'#5fd4e8', R:'#ff6b57', W:'#eef2ff' };
  const icon = inner =>
    `<svg viewBox="0 0 48 48" aria-hidden="true">` +
      `<circle cx="24" cy="24" r="21.5" fill="rgba(95,212,232,0.07)" stroke="rgba(148,164,224,0.3)" stroke-width="1"/>` +
      `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</g>` +
    `</svg>`;
  const UPG_ICONS = {
    // Ramp Track — descending track with support posts on the ice
    ramp: icon(
      `<line x1="9" y1="38" x2="39" y2="38" stroke="rgba(238,242,255,0.4)" stroke-width="2"/>`+
      `<line x1="17" y1="17" x2="17" y2="37" stroke="${IC.T}" stroke-width="2"/>`+
      `<line x1="27" y1="24" x2="27" y2="37" stroke="${IC.T}" stroke-width="2"/>`+
      `<path d="M8 13 C 17 15, 28 23, 39 36" stroke="${IC.G}" stroke-width="2.8"/>`),
    // Speedometer — gauge arc, ticks, needle
    speedo: icon(
      `<path d="M10 31 A 14.5 14.5 0 1 1 38 31" stroke="${IC.T}" stroke-width="2.4"/>`+
      `<line x1="24" y1="9" x2="24" y2="13" stroke="${IC.T}" stroke-width="2"/>`+
      `<line x1="13" y1="17.5" x2="16" y2="20" stroke="${IC.T}" stroke-width="2"/>`+
      `<line x1="35" y1="17.5" x2="32" y2="20" stroke="${IC.T}" stroke-width="2"/>`+
      `<line x1="24" y1="31" x2="33" y2="20" stroke="${IC.G}" stroke-width="2.6"/>`+
      `<circle cx="24" cy="31" r="2.6" fill="${IC.G}"/>`),
    // Glider Wings — delta wing with hang strut
    wings: icon(
      `<path d="M6 22 Q 24 8, 42 22 L 24 30 Z" fill="rgba(95,212,232,0.16)" stroke="${IC.T}" stroke-width="2.2"/>`+
      `<line x1="24" y1="16" x2="24" y2="35" stroke="${IC.G}" stroke-width="2.5"/>`+
      `<circle cx="24" cy="36.5" r="2.5" fill="${IC.G}"/>`),
    // Cargo Crate — strapped shipping box
    cargo: icon(
      `<rect x="11" y="15" width="26" height="22" rx="2.5" stroke="${IC.G}" stroke-width="2.5"/>`+
      `<line x1="11" y1="22" x2="37" y2="22" stroke="${IC.G}" stroke-width="2"/>`+
      `<line x1="24" y1="22" x2="24" y2="37" stroke="${IC.T}" stroke-width="2"/>`+
      `<line x1="11" y1="29.5" x2="37" y2="29.5" stroke="${IC.T}" stroke-width="2"/>`),
    // Altimeter — height scale beside a climbing arrow
    alti: icon(
      `<line x1="15" y1="10" x2="15" y2="38" stroke="${IC.T}" stroke-width="2.4"/>`+
      `<line x1="15" y1="12" x2="19" y2="12" stroke="${IC.T}" stroke-width="2"/>`+
      `<line x1="15" y1="19" x2="19" y2="19" stroke="${IC.T}" stroke-width="2"/>`+
      `<line x1="15" y1="26" x2="19" y2="26" stroke="${IC.T}" stroke-width="2"/>`+
      `<line x1="15" y1="33" x2="19" y2="33" stroke="${IC.T}" stroke-width="2"/>`+
      `<line x1="31" y1="38" x2="31" y2="13" stroke="${IC.G}" stroke-width="2.6"/>`+
      `<path d="M25 19 L 31 11 L 37 19" stroke="${IC.G}" stroke-width="2.6"/>`),
    // Slick Suit — streamlined airfoil with speed lines
    aero: icon(
      `<line x1="4" y1="17" x2="10" y2="17" stroke="${IC.G}" stroke-width="2"/>`+
      `<line x1="3" y1="24" x2="8" y2="24" stroke="${IC.G}" stroke-width="2"/>`+
      `<line x1="4" y1="31" x2="10" y2="31" stroke="${IC.G}" stroke-width="2"/>`+
      `<path d="M11 24 Q 14 15 23 14 Q 35 13 42 24 Q 35 35 23 34 Q 14 33 11 24 Z" fill="rgba(95,212,232,0.14)" stroke="${IC.T}" stroke-width="2.2"/>`),
    // Rubber Belly — ball on a dashed bounce arc
    bounce: icon(
      `<line x1="8" y1="38" x2="40" y2="38" stroke="rgba(238,242,255,0.4)" stroke-width="2"/>`+
      `<path d="M8 37 Q 16 16 24 37" stroke="${IC.T}" stroke-width="2" stroke-dasharray="3 3.5"/>`+
      `<path d="M24 37 Q 30 24 36 37" stroke="${IC.T}" stroke-width="2" stroke-dasharray="3 3.5"/>`+
      `<circle cx="16" cy="26.5" r="5" fill="rgba(255,200,87,0.25)" stroke="${IC.G}" stroke-width="2.4"/>`),
    // Wing Struts — spar rails with X trusses
    struts: icon(
      `<line x1="8" y1="15" x2="40" y2="15" stroke="${IC.G}" stroke-width="2.6"/>`+
      `<line x1="11" y1="33" x2="37" y2="33" stroke="${IC.G}" stroke-width="2.6"/>`+
      `<path d="M13 15 L 21 33 M21 15 L 13 33 M27 15 L 35 33 M35 15 L 27 33" stroke="${IC.T}" stroke-width="2"/>`),
    // Catapult — slingshot frame with drawn band
    sling: icon(
      `<path d="M24 41 L 24 27 M24 27 L 13 13 M24 27 L 35 13" stroke="${IC.G}" stroke-width="2.6"/>`+
      `<path d="M13 13 Q 24 22 35 13" stroke="${IC.T}" stroke-width="2.2"/>`+
      `<circle cx="24" cy="17.5" r="2.8" fill="${IC.T}"/>`),
    // Rocket — booster with fins, porthole, flame
    rocket: icon(
      `<path d="M19.5 22 L 13 30 L 19.5 30 Z M28.5 22 L 35 30 L 28.5 30 Z" fill="rgba(95,212,232,0.2)" stroke="${IC.T}" stroke-width="2"/>`+
      `<path d="M24 5.5 C 29 10.5, 30.5 19, 28.5 28.5 L 19.5 28.5 C 17.5 19, 19 10.5, 24 5.5 Z" fill="rgba(238,242,255,0.1)" stroke="${IC.G}" stroke-width="2.3"/>`+
      `<circle cx="24" cy="16.5" r="3" stroke="${IC.T}" stroke-width="2"/>`+
      `<path d="M20.5 31.5 C 21.5 36, 22.5 38, 24 41.5 C 25.5 38, 26.5 36, 27.5 31.5" fill="rgba(255,107,87,0.25)" stroke="${IC.R}" stroke-width="2"/>`),
    // Sponsor Deal — fish-company coin
    sponsor: icon(
      `<circle cx="24" cy="24" r="14" stroke="${IC.G}" stroke-width="2.5"/>`+
      `<circle cx="24" cy="24" r="10.5" stroke="rgba(95,212,232,0.55)" stroke-width="1.6" stroke-dasharray="3 3"/>`+
      `<text x="24" y="30" text-anchor="middle" font-size="17" font-weight="800" fill="${IC.G}" stroke="none">$</text>`),
    // Fuel Tank — jerry can with a teal drop
    fuel: icon(
      `<path d="M18 15 V 9 H 30 V 15" stroke="${IC.G}" stroke-width="2.2"/>`+
      `<rect x="14" y="15" width="20" height="25" rx="3" stroke="${IC.G}" stroke-width="2.5"/>`+
      `<path d="M24 21 C 21.5 25.5, 20 27.5, 20 30 A 4 4 0 0 0 28 30 C 28 27.5, 26.5 25.5, 24 21 Z" fill="${IC.T}" stroke="none"/>`),
    // Afterburner — double flame burst
    burner: icon(
      `<path d="M24 7 C 29 14, 35 19, 35 28 A 11 11 0 0 1 13 28 C 13 19, 19 14, 24 7 Z" fill="rgba(255,200,87,0.12)" stroke="${IC.G}" stroke-width="2.3"/>`+
      `<path d="M24 21 C 26.5 25, 29 27, 29 31 A 5 5 0 0 1 19 31 C 19 27, 21.5 25, 24 21 Z" fill="rgba(255,107,87,0.85)" stroke="none"/>`),
    // Ram Plating — riveted shield with chevrons
    plating: icon(
      `<path d="M24 6 L 39 12 V 24 C 39 33, 32.5 39, 24 42 C 15.5 39, 9 33, 9 24 V 12 Z" fill="rgba(255,200,87,0.07)" stroke="${IC.G}" stroke-width="2.5"/>`+
      `<path d="M16 17 L 24 23 L 32 17" stroke="${IC.T}" stroke-width="2.2"/>`+
      `<path d="M16 25 L 24 31 L 32 25" stroke="${IC.T}" stroke-width="2.2"/>`),
    // Sky Cannon — angled barrel, mount, muzzle flash
    gun: icon(
      `<path d="M12 30 L 28 12 L 34 17.5 L 18 35 Z" fill="rgba(255,200,87,0.1)" stroke="${IC.G}" stroke-width="2.2"/>`+
      `<circle cx="15" cy="35" r="5.5" stroke="${IC.T}" stroke-width="2.2"/>`+
      `<path d="M33.5 9.5 L 37 6 M37.5 14 L 42 12 M35.5 11.5 L 39.5 8.5" stroke="${IC.R}" stroke-width="2"/>`),
    // Fuel Regen — circular arrows around a fuel drop
    regen: icon(
      `<path d="M12.7 17.5 A 13 13 0 0 1 35.3 17.5" stroke="${IC.T}" stroke-width="2.4"/>`+
      `<path d="M35.3 13.5 L 38.8 19 L 31.6 19.7 Z" fill="${IC.T}" stroke="none"/>`+
      `<path d="M35.3 30.5 A 13 13 0 0 1 12.7 30.5" stroke="${IC.T}" stroke-width="2.4"/>`+
      `<path d="M12.7 34.5 L 9.2 29 L 16.4 28.3 Z" fill="${IC.T}" stroke="none"/>`+
      `<path d="M24 18 C 22 21.5, 20.8 23.2, 20.8 25.2 A 3.2 3.2 0 0 0 27.2 25.2 C 27.2 23.2, 26 21.5, 24 18 Z" fill="${IC.G}" stroke="none"/>`),
    // Reserve Tank — horizontal cylinder with seams and valve
    tank: icon(
      `<line x1="24" y1="17" x2="24" y2="12" stroke="${IC.T}" stroke-width="2"/>`+
      `<circle cx="24" cy="10.5" r="2" stroke="${IC.T}" stroke-width="1.8"/>`+
      `<rect x="9" y="17" width="30" height="15" rx="7.5" fill="rgba(255,200,87,0.06)" stroke="${IC.G}" stroke-width="2.5"/>`+
      `<line x1="18" y1="17.5" x2="18" y2="31.5" stroke="${IC.T}" stroke-width="1.8"/>`+
      `<line x1="30" y1="17.5" x2="30" y2="31.5" stroke="${IC.T}" stroke-width="1.8"/>`+
      `<line x1="15" y1="32" x2="15" y2="38" stroke="${IC.G}" stroke-width="2.2"/>`+
      `<line x1="33" y1="32" x2="33" y2="38" stroke="${IC.G}" stroke-width="2.2"/>`),
  };

  // ── tree layout ──
  // Every upgrade gets its own dedicated row (lane) — never shared with
  // another upgrade — because each of its LEVELS is its own individual
  // grid cell/node, laid out one per column along that lane: level i of
  // an upgrade sits at column `startCol+i`. That's what makes it read as
  // a path (a chain of level-nodes strung left→right) rather than a
  // cluster. `startCol` is 1 + the deepest prerequisite's own startCol
  // (so a path only ever begins strictly right of every upgrade whose
  // level-1 node unlocks it — matching the actual gate, which only needs
  // level ≥ 1, not a maxed prerequisite), i.e. the same tiers the old
  // upgDepth() scheme used. Rows are ordered so branches fan both above
  // and below the wings/aero/rocket hub, not in one flat stack — that's
  // the "all four directions" part; the horizontal path itself always
  // runs left→right, and only the connector between a prerequisite's
  // first node and its dependent's first node bends up or down.
  const TREE_LAYOUT = {
    speedo:  { col:1, row:1 },
    alti:    { col:2, row:2 },
    ramp:    { col:1, row:3 },
    bounce:  { col:2, row:4 },
    sling:   { col:3, row:5 },
    sponsor: { col:3, row:6 },
    wings:   { col:1, row:7 },
    aero:    { col:2, row:8 },
    struts:  { col:3, row:9 },
    rocket:  { col:3, row:10 },
    fuel:    { col:4, row:11 },
    regen:   { col:5, row:12 },
    tank:    { col:6, row:13 },
    burner:  { col:4, row:14 },
    plating: { col:4, row:15 },
    gun:     { col:5, row:16 },
    cargo:   { col:1, row:17 },
  };

  // Connector redraw hook — renderShop() swaps in a closure over the
  // current node set. renderShop() runs while #shop is still display:none
  // (the host page adds .show right after), so rects are all zero at build
  // time; the ResizeObserver fires when the grid actually gets laid out
  // (0 → real size), and again on any wrap/resize.
  let redrawConnectors = null;
  window.addEventListener('resize', () => redrawConnectors && redrawConnectors());
  if(typeof ResizeObserver === 'function'){
    new ResizeObserver(() => redrawConnectors && redrawConnectors()).observe(shopGrid);
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

    // achievements — milestones, landmark bosses, daily contracts, and
    // medals all render as one flat icon grid: no text list, ever. Each
    // badge is on/off (plus a transitional next/partial/contract state);
    // name, reward, and progress detail live in the hover tooltip only.
    achGrid.innerHTML = '';
    function addBadge(icon, title, cls, pct){
      const b = document.createElement('div');
      b.className = 'ach ' + cls;
      b.title = title;
      b.textContent = icon;
      if(pct != null){
        const p = document.createElement('span');
        p.className = 'ach-pct';
        p.textContent = pct + '%';
        b.appendChild(p);
      }
      achGrid.appendChild(b);
    }
    // distance milestones — the next unclaimed one gets a "next" highlight
    let nextMarked = false;
    for(const [dist, cash] of MILESTONES){
      const done = state.claimed.includes(dist);
      let cls = done ? 'on' : 'off';
      let title = `${fmtDist(dist)} — ${fmtCash(cash)}${done ? ' (claimed)' : ''}`;
      if(!done && !nextMarked){ cls = 'next'; title = '▶ Next: ' + title; nextMarked = true; }
      addBadge('\u{1F6A9}', title, cls);
    }
    // today's contracts — previewed, not tracked (judged at flight's end)
    for(const c of contractsFor(state.day)){
      addBadge('\u{1F4CB}', `${c.text} — +${fmtCash(c.reward)}`, 'contract');
    }
    // landmark bosses — pct shown is damage dealt so far, 0–100%
    for(const lm of LANDMARKS){
      const hp = state.lmHP[lm.id];
      const down = hp <= 0;
      const dmgPct = Math.min(100, Math.max(0, 100 - Math.ceil(hp/lm.hp*100)));
      addBadge('\u{1F3AF}',
        down ? `${lm.name} — destroyed (+${fmtCash(lm.reward)})` : `${lm.name} @ ${fmtDist(lm.x)} — ${dmgPct}% damaged`,
        down ? 'on' : (dmgPct > 0 ? 'partial' : 'off'),
        down || dmgPct === 0 ? null : dmgPct);
    }
    // permanent medals — earned bright, unearned greyed
    for(const m of MEDALS){
      const got = state.medals.includes(m.id);
      addBadge(m.icon, `${m.name}${m.cash > 0 ? ' (+'+fmtCash(m.cash)+')' : ''} — ${m.desc}`, got ? 'on' : 'off');
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
    //
    // Layout: a real 2-D tree on TREE_LAYOUT's grid — every node sits at
    // its hand-placed (col, row), branching above and below its roots as
    // well as left-to-right by tier, with an SVG underlay drawing a
    // connector from each visible prerequisite node to its dependent (a
    // two-parent node gets two lines in). Each node itself is still the
    // flat row of per-level icons: only the level right after the owned
    // count is buyable, later levels show their price greyed out, and
    // name/per-level effect/price only ever show in the hover tooltip.
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
    const capOut = capRemaining() <= 0;

    const svgNS = 'http://www.w3.org/2000/svg';
    const treeSvg = document.createElementNS(svgNS, 'svg');
    treeSvg.setAttribute('class', 'tree-svg');
    treeSvg.setAttribute('preserveAspectRatio', 'none');
    shopGrid.appendChild(treeSvg);

    // firstNodeEls: upgrade id → its level-1 cell (the branch point other
    // upgrades' prerequisite lines connect to, and where its own path
    // starts). lastNodeEls: upgrade id → its furthest-right rendered cell
    // (where the path's own rail line ends). nodeAffordable: upgrade id →
    // true if its next buyable level is affordable right now (colors both
    // the rail and any dependent's incoming connector gold).
    const firstNodeEls = {};
    const lastNodeEls = {};
    const nodeAffordable = {};

    for(const u of upgAvail){
      const lvl = ownedLevel(u);
      const levels = u.oneTime ? 1 : u.max;
      const pos = TREE_LAYOUT[u.id] || { col:1, row:1 };
      let lastCell = null;

      for(let i=0; i<levels; i++){
        const owned = i < lvl;
        const isNext = i === lvl;
        const rawCost = u.oneTime ? u.base : Math.round(u.base * Math.pow(u.mul, i));

        // Daily deal discount only ever applies to the next buyable level.
        const isDailyDeal = isNext && todaysDeal && todaysDeal.id === u.id;
        const dealDiscount = isDailyDeal && typeof todaysDeal.discount === 'number'
          ? clamp(todaysDeal.discount, 0, 0.9) : 0;
        const cost = isDailyDeal ? Math.max(1, Math.round(rawCost * (1 - dealDiscount))) : rawCost;
        const affordable = isNext && !capOut && state.money >= cost;
        if(affordable) nodeAffordable[u.id] = true;

        const cell = document.createElement('div');
        cell.className = 'lvl-icon' +
          (owned ? ' owned' : isNext ? ' next' : ' locked') +
          (affordable ? ' affordable' : '') + (isDailyDeal ? ' daily-deal' : '');
        cell.style.gridColumn = pos.col + i;
        cell.style.gridRow = pos.row;

        const effect = u.oneTime ? u.desc : u.val(i + 1);
        const statusLine = owned ? 'owned'
          : isNext && capOut ? 'no deliveries left today'
          : isDailyDeal ? `${fmtCash(cost)} (deal, was ${fmtCash(rawCost)})`
          : fmtCash(cost);
        const tipLabel = levels > 1 ? `${u.name} · Lv.${i+1}` : u.name;

        cell.innerHTML = `
          <div class="lvl-art">${UPG_ICONS[u.id] || `<span style="font-size:28px">${u.icon}</span>`}</div>
          <div class="lvl-price">${owned ? '✓' : fmtCash(cost)}</div>
          <div class="lvl-tip"><b>${tipLabel}</b>${effect}<br>${statusLine}</div>`;

        if(isNext){
          cell.tabIndex = 0;
          cell.addEventListener('click', () => {
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
        }
        shopGrid.appendChild(cell);
        if(i === 0) firstNodeEls[u.id] = cell;
        lastCell = cell;
      }
      lastNodeEls[u.id] = lastCell;
    }

    // ── connector pass ──
    // Two kinds of line, both drawn from real DOM rects so they're correct
    // regardless of how far a lane wanders up or down:
    //  1. a path rail — a plain line strung through every level-node of one
    //     upgrade, first to last, so its levels read as one chain rather
    //     than loose dots;
    //  2. a prerequisite branch — a bezier from a prerequisite's level-1
    //     node (the actual unlock point: `requires` only ever needs level
    //     ≥ 1) to its dependent's level-1 node. A prerequisite that's
    //     maxed out and no longer rendered simply contributes no line.
    // Either kind glows dusk-gold when the destination upgrade's next level
    // is affordable right now; otherwise it stays glacial blue.
    function drawConnectors(){
      while(treeSvg.firstChild) treeSvg.removeChild(treeSvg.firstChild);
      const g = shopGrid.getBoundingClientRect();
      if(g.width < 2 || g.height < 2) return;   // shop hidden — retry on observe
      treeSvg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);

      function line(x1, y1, x2, y2, gold, dashed){
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', gold ? 'rgba(255,200,87,0.55)' : 'rgba(148,164,224,0.35)');
        path.setAttribute('stroke-width', dashed ? '3' : '2');
        if(dashed) path.setAttribute('stroke-linecap', 'round');
        treeSvg.appendChild(path);
      }
      function curve(x1, y1, x2, y2, gold){
        const bend = Math.max(16, (x2 - x1) * 0.5);
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', gold ? 'rgba(255,200,87,0.6)' : 'rgba(148,164,224,0.45)');
        path.setAttribute('stroke-width', '2');
        treeSvg.appendChild(path);
        for(const [cx, cy] of [[x1, y1], [x2, y2]]){
          const dot = document.createElementNS(svgNS, 'circle');
          dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
          dot.setAttribute('r', '2.6');
          dot.setAttribute('fill', gold ? 'rgba(255,200,87,0.85)' : 'rgba(148,164,224,0.65)');
          treeSvg.appendChild(dot);
        }
      }

      for(const u of upgAvail){
        const gold = !!nodeAffordable[u.id];
        // 1. this upgrade's own path rail (skip single-level upgrades)
        const first = firstNodeEls[u.id], last = lastNodeEls[u.id];
        if(first && last && first !== last){
          const fr = first.getBoundingClientRect(), lr = last.getBoundingClientRect();
          line(fr.left + fr.width/2 - g.left, fr.top + fr.height/2 - g.top,
               lr.left + lr.width/2 - g.left, lr.top + lr.height/2 - g.top, gold, true);
        }
        // 2. branch curves in from every visible prerequisite
        for(const rid of (u.requires || [])){
          const parent = firstNodeEls[rid];
          const node = firstNodeEls[u.id];
          if(!parent || !node) continue;
          const nr = node.getBoundingClientRect();
          const pr = parent.getBoundingClientRect();
          curve(pr.right - g.left, pr.top + pr.height/2 - g.top,
                nr.left - g.left, nr.top + nr.height/2 - g.top, gold);
        }
      }
    }
    redrawConnectors = drawConnectors;
    requestAnimationFrame(drawConnectors);
  }

  return { renderShop, drawEditor };
}
