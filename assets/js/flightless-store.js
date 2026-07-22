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

  // ── tree layout — one node PER LEVEL, branches scattered by rung ──
  // Every purchasable level is its own node on a 20×19 grid. Each upgrade
  // gets its own lane, and a child hangs off the EXACT rung of its parent
  // named in flightless-data.js's `requires` (aero off wings Lv.3, rocket
  // off aero Lv.2, gun off plating Lv.3, …) so the branch points are
  // scattered across the whole map instead of all clustered at level 1.
  // The ramp is a horizontal spine (row 10) with cargo streaming left; the
  // flight tech cascades up-and-right, one upgrade per row, so every wire is
  // a straight horizontal (level→level) or vertical (parent-rung→child)
  // segment. The ground game drops down off the ramp's Lv.4.
  //
  // LAYOUT maps `${id}:${level}` → {col,row} (1-indexed grid cells).
  const LAYOUT = {};
  const place = (id, startLvl, count, col, row, dCol, dRow) => {
    for(let i = 0; i < count; i++)
      LAYOUT[`${id}:${startLvl + i}`] = { col: col + dCol * i, row: row + dRow * i };
  };
  // ── ramp spine (row 10) + cargo tail (left) ──
  place('ramp',  1, 12, 6, 10,  1, 0);   // T1..T12 → col 6..17
  place('cargo', 1, 5,  5, 10, -1, 0);   // C1..C5  → left of T1
  // ── flight: one upgrade per row, cascading up-right; a child sits one
  //    row off the parent rung it needs, in that rung's column ──
  place('wings',   1, 10, 7, 9,  1, 0);  // G1..G10 (row 9, over T2)
  place('aero',    1, 10, 9, 8,  1, 0);  // A1..A10 (row 8, off wings L3=col9)
  place('struts',  1, 6, 12, 7,  1, 0);  // W1..W6  (row 7, off aero L4=col12)
  place('plating', 1, 6, 13, 6,  1, 0);  // L1..L6  (row 6, off struts L2=col13)
  place('gun',     1, 6, 15, 5,  1, 0);  // N1..N6  (row 5, off plating L3=col15)
  place('rocket',  1, 10, 10, 4, 1, 0);  // R1..R10 (row 4, off aero L2=col10)
  LAYOUT['burner:1'] = { col:13, row:5 }; // off rocket L4=col13
  place('fuel',    1, 10, 11, 3, 1, 0);  // F1..F10 (row 3, off rocket L2=col11)
  place('regen',   1, 5, 14, 2,  1, 0);  // E1..E5  (row 2, off fuel L4=col14)
  LAYOUT['tank:1'] = { col:15, row:1 };   // off regen L2=col15
  // ── instruments (down off ramp L3) ──
  LAYOUT['speedo:1'] = { col:8, row:11 };
  LAYOUT['alti:1']   = { col:8, row:12 };
  // ── ground game (down off ramp L4=col9) ──
  place('bounce',  1, 6, 9, 11, 0, 1);   // B1..B6 → down col 9
  place('sling',   1, 8, 10, 12, 0, 1);  // S1..S8 → down col 10 (off bounce L2)
  place('sponsor', 1, 6, 7, 14, 0, 1);   // P1..P6 → down col 7  (off bounce L4)
  const CENTER = { col:6, row:10 };       // fallback (ramp root)

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

  // Center the scroll viewport on the Ramp (the tree's root) the first time
  // the shop is laid out — the tree is bigger than the viewport and radiates
  // from the middle, so the player should open onto the centre and pan out,
  // not onto the top of the flight branch. Once done we leave scroll alone
  // so buying (which re-renders but never moves a node) doesn't yank the
  // view around.
  const shopScroll = document.querySelector('#shop .shop-scroll');
  let didCenterTree = false;
  function centerOnRoot(rootEl){
    if(didCenterTree || !rootEl || !shopScroll) return;
    const sr = shopScroll.getBoundingClientRect();
    if(sr.height < 2) return;                 // still hidden — try again later
    const rr = rootEl.getBoundingClientRect();
    shopScroll.scrollTop  += (rr.top  + rr.height/2) - (sr.top  + sr.height/2);
    shopScroll.scrollLeft += (rr.left + rr.width/2)  - (sr.left + sr.width/2);
    didCenterTree = true;
  }

  // ── click-drag to pan the tree ──
  // The scrollbars are hidden (CSS), so the tree pans by grabbing it. Mouse
  // only — touch already pans natively. We don't capture the pointer until it
  // actually moves past a small threshold, so a plain click still lands on a
  // node; once it's a real drag we swallow the trailing click so panning onto
  // a buyable node never accidentally buys it.
  (function enableDragPan(){
    if(!shopScroll) return;
    let down = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0, pid = null;
    shopScroll.addEventListener('pointerdown', e => {
      if(e.button !== 0 || e.pointerType !== 'mouse') return;
      down = true; moved = false; pid = e.pointerId;
      sx = e.clientX; sy = e.clientY;
      sl = shopScroll.scrollLeft; st = shopScroll.scrollTop;
    });
    shopScroll.addEventListener('pointermove', e => {
      if(!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if(!moved){
        if(Math.hypot(dx, dy) < 4) return;      // still a click, not a drag
        moved = true;
        shopScroll.classList.add('dragging');
        try { shopScroll.setPointerCapture(pid); } catch(_){}
      }
      shopScroll.scrollLeft = sl - dx;
      shopScroll.scrollTop  = st - dy;
    });
    const end = () => {
      if(!down) return;
      down = false;
      if(moved){
        shopScroll.classList.remove('dragging');
        try { shopScroll.releasePointerCapture(pid); } catch(_){}
        // eat the click that fires right after a drag so it can't buy a node
        shopScroll.addEventListener('click',
          ev => { ev.stopPropagation(); ev.preventDefault(); },
          { capture: true, once: true });
      }
    };
    shopScroll.addEventListener('pointerup', end);
    shopScroll.addEventListener('pointercancel', end);
  })();

  // ── ramp designer (slide-in side drawer) ──
  // The canvas lives in the #drawer-ramp drawer, toggled from the shop's
  // side rail (host page owns the open/close). All four control points drag,
  // including the lip, so the exit angle and kicker are fully the player's.
  // The world ramp rebuilds live behind the shop while dragging.
  const edCv = document.getElementById('ramp-editor');
  const edCtx = edCv.getContext('2d');
  const shapeInfo = document.getElementById('shape-info');
  const rampDrawer = document.getElementById('drawer-ramp');
  const ED_W=260, ED_H=120, ED_PAD=14, ED_TOP=12, ED_GROUND=ED_H-16;
  edCv.width = ED_W*2; edCv.height = ED_H*2; edCtx.setTransform(2,0,0,2,0,0);
  const edX = p => ED_PAD + p.x*(ED_W-2*ED_PAD);
  const edY = p => ED_GROUND - p.y*(ED_GROUND-ED_TOP);
  let edDrag = -1;

  function drawEditor(){
    const ramp = getRamp();
    if(!ramp) return;
    shapeInfo.textContent = `${Math.round(ramp.exitTh/RAD)}° nose · ${Math.round(ramp.H)} m tall`;
    if(rampDrawer && !rampDrawer.classList.contains('open')) return;
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
  document.getElementById('shape-reset').addEventListener('click', () => {
    state.rampShape = defaultState().rampShape;
    recompute();
    save();
    drawEditor();
  });

  // ── save export / import UI ──
  // Wire export/import buttons into the Settings panel's Save Data section.
  // The buttons are no-ops if save.exportSave/importSave are not provided —
  // guarded above at module top.
  (function buildSaveButtons(){
    const notesEl = document.getElementById('settings-save-buttons');
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

    // ── upgrade tree — one node per LEVEL ──
    // Every purchasable level of every upgrade is its own square icon on the
    // grid (positions in LAYOUT). No pips, no lock glyph, no price printed on
    // the node — the icon IS the upgrade. State reads purely off colour:
    //   • owned   — a level you've bought (bright, gold-rimmed)
    //   • buyable — the very next level, prerequisites met (normal; green rim
    //               if you can afford it, gold rim on a daily deal)
    //   • locked  — anything else (greyed out — no padlock)
    // Name / level / effect / price / any unmet requirement live in the hover
    // tooltip only. `oneTime` upgrades (speedo, alti, burner, tank) are a
    // single node backed by state.perm[id]; everything else by state.lvl[id].
    //
    // `requires` entries are 'id' (level ≥1 / owned) or { id, lvl } (level ≥
    // lvl). The FIRST requires entry is the node's tree parent (its wire);
    // any further entries (only Fuel Regen's Wings Lv.3) still gate buying
    // but aren't wired, to keep every connector a clean right angle.
    const reqId  = r => typeof r === 'string' ? r : r.id;
    const reqLvl = r => typeof r === 'string' ? 1 : (r.lvl || 1);
    function levelOf(id){
      const u = UPGRADES.find(x => x.id === id);
      if(!u) return 0;
      return u.oneTime ? (state.perm[id] ? 1 : 0) : (state.lvl[id] ?? 0);
    }
    const reqMet = r => levelOf(reqId(r)) >= reqLvl(r);
    const upgById = Object.fromEntries(UPGRADES.map(u => [u.id, u]));
    const capOut = capRemaining() <= 0;

    shopGrid.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    const treeSvg = document.createElementNS(svgNS, 'svg');
    treeSvg.setAttribute('class', 'tree-svg');
    treeSvg.setAttribute('preserveAspectRatio', 'none');
    shopGrid.appendChild(treeSvg);

    const nodeEls = {};          // 'id:lvl' → node element (for connector geometry)
    const artFor = u => UPG_ICONS[u.id] || `<span style="font-size:24px">${u.icon}</span>`;

    for(const u of UPGRADES){
      const max = u.oneTime ? 1 : u.max;
      const owned = u.oneTime ? (state.perm[u.id] ? 1 : 0) : (state.lvl[u.id] ?? 0);

      // upgrade-wide prerequisite state (same for every level of this upgrade)
      const unmet = (u.requires || []).filter(r => !reqMet(r));
      const distLocked = state.best.dist < (u.unlock || 0);
      const prereqOK = unmet.length === 0 && !distLocked;

      for(let lvl = 1; lvl <= max; lvl++){
        const pos = LAYOUT[`${u.id}:${lvl}`] || CENTER;
        const isOwned = lvl <= owned;
        // per-level gate — lets a single upgrade's rungs unlock at different
        // points so you can't buy them all in one visit (Cargo Crate levels
        // are gated behind deeper Ramp Track levels; see data.js `levelReq`).
        const lvlReq = (u.levelReq && u.levelReq[lvl]) || [];
        const lvlUnmet = lvlReq.filter(r => !reqMet(r));
        const gatedOK = prereqOK && lvlUnmet.length === 0;
        const isNext  = lvl === owned + 1 && gatedOK;    // the one buyable rung

        // price for THIS rung (going from lvl-1 → lvl), plus any daily deal
        const rawCost = u.oneTime ? u.base : Math.round(u.base * Math.pow(u.mul, lvl - 1));
        const isDailyDeal = isNext && todaysDeal && todaysDeal.id === u.id;
        const dealDiscount = isDailyDeal && typeof todaysDeal.discount === 'number'
          ? clamp(todaysDeal.discount, 0, 0.9) : 0;
        const cost = isDailyDeal ? Math.max(1, Math.round(rawCost * (1 - dealDiscount))) : rawCost;
        const affordable = isNext && !capOut && state.money >= cost;

        const status = isOwned ? 'owned' : isNext ? 'buyable' : 'locked';
        const node = document.createElement('div');
        node.className = 'upg-node ' + status +
          (affordable ? ' affordable' : '') + (isDailyDeal ? ' daily-deal' : '');
        node.style.gridColumn = pos.col;
        node.style.gridRow = pos.row;

        // hover tooltip
        const effect = u.oneTime ? u.desc : u.val(lvl);
        const lvlNote = u.oneTime ? 'one-time upgrade' : `Lv.${lvl} / ${max}`;
        // requirement note only on the rung that's blocked by a prerequisite
        const allUnmet = [...unmet, ...lvlUnmet];
        const reqNote = (!isOwned && lvl === owned + 1 && !gatedOK)
          ? (allUnmet.length
              ? `<span class="need">Needs ${allUnmet.map(r => {
                  const ru = upgById[reqId(r)]; const nm = ru ? ru.name : reqId(r);
                  return reqLvl(r) > 1 ? `${nm} Lv.${reqLvl(r)}` : nm;
                }).join(' + ')}</span>`
              : `<span class="need">Reach ${fmtDist(u.unlock)} first</span>`)
          : '';
        const ownedNote = isOwned ? '<span class="tip-owned">✓ owned</span>' : '';
        const buyNote = status === 'buyable'
          ? `<div class="tip-buy">Buy ${u.oneTime ? '' : 'Lv.' + lvl + ' — '}${fmtCash(cost)}${isDailyDeal ? ' ⚡deal' : ''}</div>`
          : '';

        node.innerHTML = `
          <div class="node-art">${artFor(u)}</div>
          <div class="node-tip">
            <b>${u.name}</b>
            <span class="tip-lvl">${lvlNote}</span>
            <span class="tip-effect">${effect}</span>
            ${ownedNote}${reqNote}${buyNote}
          </div>`;

        if(status === 'buyable'){
          node.tabIndex = 0;
          const buy = () => {
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
          };
          node.addEventListener('click', buy);
          node.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); buy(); } });
        }

        shopGrid.appendChild(node);
        nodeEls[`${u.id}:${lvl}`] = node;
      }
    }

    // ── connector pass ──
    // Every edge is axis-aligned by construction, so a straight segment
    // between two node centres already reads as a right-angled wire. Two
    // kinds: intra-upgrade (level n → n+1) and cross-upgrade (a level-1 node
    // to its tree parent = requires[0]). An edge is solid gold once its lower
    // end is owned, dim dashed while the route is still locked.
    function drawConnectors(){
      while(treeSvg.firstChild) treeSvg.removeChild(treeSvg.firstChild);
      const g = shopGrid.getBoundingClientRect();
      if(g.width < 2 || g.height < 2) return;   // shop hidden — retry on observe
      treeSvg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);

      const centre = key => {
        const el = nodeEls[key]; if(!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width/2 - g.left, y: r.top + r.height/2 - g.top };
      };
      const wire = (a, b, met) => {
        if(!a || !b) return;
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', `M ${a.x} ${a.y} L ${b.x} ${b.y}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', met ? 'rgba(255,200,87,0.55)' : 'rgba(120,134,190,0.34)');
        path.setAttribute('stroke-width', met ? '2.6' : '2');
        if(!met) path.setAttribute('stroke-dasharray', '5 5');
        path.setAttribute('stroke-linecap', 'round');
        treeSvg.appendChild(path);
      };

      for(const u of UPGRADES){
        // intra-upgrade rungs: n → n+1, lit once level n is owned
        if(!u.oneTime){
          const owned = state.lvl[u.id] ?? 0;
          for(let lvl = 1; lvl < u.max; lvl++)
            wire(centre(`${u.id}:${lvl}`), centre(`${u.id}:${lvl+1}`), owned >= lvl);
        }
        // cross-upgrade: this upgrade's level-1 node → its tree parent
        const r0 = (u.requires || [])[0];
        if(r0) wire(centre(`${reqId(r0)}:${reqLvl(r0)}`), centre(`${u.id}:1`), reqMet(r0));
      }
      centerOnRoot(nodeEls['ramp:1']);
    }
    redrawConnectors = drawConnectors;
    requestAnimationFrame(drawConnectors);
  }

  return { renderShop, drawEditor };
}
