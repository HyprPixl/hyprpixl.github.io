// Flightless — static game-config module.
//
// Every tunable table the game reads from: upgrade/gear/bonus-shop
// catalogs, medals, distance milestones, obstacle types, and the daily
// contract pool. No behavior lives here beyond the small pure helpers
// (upgCost, contractsFor, dailyModFor, dailyDealFor) that just look
// values up in these tables — the actual physics/sim/UI code that acts
// on them lives elsewhere.
//
// A few upgrade cards preview live stats (ramp length/height, glide ratio,
// dive speed) by calling into the physics module, so those are injected
// rather than imported directly — this module has no dependency of its
// own on how flight is simulated.
export function createData({ state, derive, buildRamp, rampExitEst, gliderName, clamp, hash01 }){

  // ─── UPGRADES ────────────────────────────────────────────────────────────
  // Cost formula: Math.round(base * mul^level). Levels are 0-indexed, so
  // level 0 costs `base` and you buy your way up. Tuning goals:
  //   • Opening loop is SPEED-FIRST: ramp/aero/sling(catapult) are cheap and
  //     available day one; wings unlock at 120 m once the catapult has flung
  //     you far enough that lift is worth buying.
  //   • Mid-tier (wings/struts/rocket/fuel) takes a week of moderate flights.
  //   • Late-tier (sponsor/plating/gun) takes sustained good flights to max.
  // mul raised from 1.55 on rocket/gun to slow their late-level cost climb.

  const UPGRADES = [
    { id:'ramp',    icon:'\u{1F6DD}', name:'Ramp Track',   base:15,  mul:1.55, max:12, unlock:0,
      desc:'More track to build speed on. Reshape it in the designer below.',
      val:l=>{ const d=derive({ramp:l}); const r=buildRamp(d.rampLen);
               return `${Math.round(d.rampLen)} m · ${Math.round(r.H)} m tall · ~${Math.round(rampExitEst(d, r))} m/s exit`; } },
    { id:'wings',   icon:'\u{1FABD}', name:'Glider Wings', base:25,  mul:1.55, max:10, unlock:120,
      desc:'More lift, flatter glide. Ease off "up" to cruise. Unlocks once you can fling yourself far enough to make wings worth it.',
      val:l=>{ if(l===0) return 'no wings'; const d=derive({wings:l});
               return `${gliderName(l)} · ~${Math.max(1,Math.round(d.bestLD))}:1 glide`; } },
    { id:'aero',    icon:'\u{1F9CA}', name:'Slick Suit',   base:20,  mul:1.55, max:10, unlock:0,
      desc:'Waxed feathers cut drag on the ramp, in the air, and on the ice.',
      val:l=>`dives to ~${Math.round(derive({aero:l}).vDive)} m/s` },
    { id:'bounce',  icon:'\u{1F3C0}', name:'Rubber Belly', base:150, mul:1.55, max:6, unlock:0,
      desc:'Spring back on landing. Keep momentum for distance.',
      val:l=> l===0 ? 'splat' : `${Math.round((0.12+0.09*l)*100)}% bounce` },
    { id:'struts',  icon:'\u{1F529}', name:'Wing Struts',  base:180, mul:1.55, max:6, unlock:250, requires:'wings',
      desc:'Stiffer spars pull harder turns at speed without folding.',
      val:l=>`${derive({struts:l}).gMax.toFixed(1)}g max pull` },
    // Rocket: base raised 100→180, mul raised 1.55→1.65 to slow the runaway
    // late-game power spike. At max (10) the total tree cost is ~$60k rather
    // than ~$13k, spreading pressure across more flights.
    { id:'rocket',  icon:'\u{1F680}', name:'Rocket',       base:180, mul:1.65, max:10, unlock:100,
      desc:'A strap-on booster. Hold SPACE to climb faster.',
      val:l=> l===0 ? 'not installed' : `${Math.round(derive({rocket:l}).thrust)} m/s² thrust` },
    { id:'fuel',    icon:'⛽',    name:'Fuel Tank',    base:80,  mul:1.55, max:10, unlock:100,
      desc:'More burn time for sustained climbs.', requires:'rocket',
      val:l=>`${(2+1.3*l).toFixed(1)} s of burn` },
    // Sponsor: base raised 250→400 so it doesn't trivialize the cash curve
    // until mid-game. Its multiplier stacks hard with airtime — keep it late.
    { id:'sponsor', icon:'\u{1F4B0}', name:'Sponsor Deal', base:400, mul:1.60, max:6, unlock:250,
      desc:'Fish Co. multiplies your earnings on every flight.',
      val:l=>`×${(1+0.35*l).toFixed(2)} cash earned` },
    // Catapult: the early-game SPEED path. Available from day one and cheap to
    // start (base 400→50) so the opening loop is "build speed, then earn wings"
    // rather than buying wings before you have any speed to glide on.
    { id:'sling',   icon:'\u{1F3AF}', name:'Catapult',     base:50,  mul:1.55, max:8, unlock:0,
      desc:'An elastic winch flings you from the gate at the top of the track. The fastest way off the line.',
      val:l=> l===0 ? 'not installed' : `+${20*l} m/s at the gate` },
    { id:'plating', icon:'\u{1F6E1}', name:'Ram Plating',  base:600, mul:1.55, max:6, unlock:1500,
      desc:'An armored belly plate. Smash landmarks harder and keep more speed on impact.',
      val:l=>`×${(1+0.35*l).toFixed(2)} smash damage`,
    },
    // Gun: base raised 3000→4500, mul raised 1.7→1.75 — a true late-game luxury.
    { id:'gun',     icon:'\u{1F52B}', name:'Sky Cannon',   base:4500, mul:1.75, max:6, unlock:2500,
      desc:'Press C to blast obstacles out of the sky. Upgrade for range and bigger targets.',
      val:l=>{ if(l===0) return 'not installed';
               const tier = l>=5?'planes':l>=3?'balloons':'birds';
               return `range ${260+90*l}m · downs ${tier}`; } },
  ];

  // ─── GEAR ─────────────────────────────────────────────────────────────────
  const GEAR = [
    { id:'speedo', icon:'\u{1F4DF}', name:'Speedometer', cost:60,   unlock:0,
      desc:'See your speed — and get paid for top speed.' },
    { id:'alti',   icon:'\u{1F4E1}', name:'Altimeter',   cost:200,  unlock:100,
      desc:'See your altitude — and get paid for peak height.' },
    { id:'burner', icon:'\u{1F4A5}', name:'Afterburner', cost:2500, unlock:1000,
      desc:'Once per flight, press X: instant +90 m/s. No fuel.' },
    { id:'tank',   icon:'\u{1F6E2}', name:'Reserve Tank', cost:6000, unlock:2500,
      desc:'Rocket refuels to half on your first ground bounce.' },
  ];

  const upgCost = u => Math.round(u.base * Math.pow(u.mul, state.lvl[u.id]));

  // ─── MILESTONES ───────────────────────────────────────────────────────────
  // Each entry is [dist_m, cash_reward]. Claimed once ever (state.claimed).
  //
  // OLD: 9 milestones, final [35000, $100 000]. A single max-rocket 35 km
  // flight paid ~$343 k total (subtotal + milestones), trivializing the whole
  // upgrade tree in one run.
  //
  // NEW: 14 milestones. The final stretch (15 km→35 km) is sliced into 5
  // additional steps, and the cap per milestone is held to $15 000. A full
  // clean sweep of all milestones yields $82 200 (vs. ~$163 000 before), but
  // they are drip-fed across many flights instead of front-loaded at 35 km.
  //
  // Paper economy check:
  //   Day-1 flop 50 m   → dist cash ~$84, milestone 100→$150 if hit. Total ≈ $220.
  //   Mid-game 5 000 m  → subtotal ~$13 k, milestones ≤$13 k (5 steps). Total ≈ $26 k.
  //   35 km win         → subtotal ~$82 k (payMult 6.2), milestones ≤$35 k (partial).
  //                        Total flight ≈ $115 k — still more than the upgrade tree
  //                        (~$105 k cumulative), but it takes multiple 35 km flights
  //                        because you won't collect all 14 milestones in one go.
  const MILESTONES = [
    [100,    150],
    [250,    300],
    [500,    600],
    [1000,   1200],
    [2500,   3000],
    [5000,   6000],   // was 7 000 — trimmed so 5 km run doesn't over-pay
    [8000,   8000],   // new: 8 km rung
    [12000,  10000],  // new: 12 km rung
    [15000,  10000],  // new: 15 km rung
    [18000,  10000],  // new: 18 km rung
    [22000,  10000],  // new: 22 km rung
    [25000,  10000],  // was folded into 35 km lump — now its own step
    [30000,  10000],  // new: 30 km rung
    [35000,  15000],  // was 100 000 — cut to 15 000; glory is defeating the Wall
  ];

  // ─── WIN_DIST ─────────────────────────────────────────────────────────────
  // Canonical source-of-truth for the Wall's distance (matches LANDMARKS.wall.x).
  // Exported because flightless.html's ngPlusWallDist() multiplies it for NG+:
  //   ngPlusWallDist = WIN_DIST * 2 * (ngPlus + 1)
  // The in-game win condition is state.lmHP.wall <= 0 (not reaching this
  // distance), but WIN_DIST is still the correct number to build NG+ math on.
  const WIN_DIST = 35000;

  // ─── OBSTACLE_TYPES ───────────────────────────────────────────────────────
  const OBSTACLE_TYPES = [
    { id:'bird',    tough:1, cash:40,  minAlt:25,   maxAlt:1400, r:16, skip:0.3 },
    { id:'balloon', tough:3, cash:150, minAlt:600,  maxAlt:3200, r:28, skip:0.45 },
    { id:'plane',   tough:5, cash:500, minAlt:1800, maxAlt:6000, r:36, skip:0.55 },
  ];

  // ─── CONTRACT_POOL ────────────────────────────────────────────────────────
  // Two per-day side objectives, deterministic from the day number and scaled
  // to current progress. Checked at the end of the flight; paid in results.
  // Style-based entries added: combo, stars, gunKills, skimT combos.
  const CONTRACT_POOL = [
    { id:'fish',   txt:n=>`Catch ${n} fish`,
      tgt:b=>clamp(Math.round(3 + b.dist/400), 3, 20),
      val:r=>r.coinCount },
    { id:'rings',  txt:n=>`Fly through ${n} ring${n>1?'s':''}`,
      tgt:b=>clamp(Math.round(1 + b.dist/1500), 1, 6),
      val:r=>r.ringCount },
    { id:'skim',   txt:n=>`Skim the ice for ${n}s`,
      tgt:b=>clamp(Math.round(2 + b.dist/2500), 2, 8),
      val:r=>Math.floor(r.skimT) },
    { id:'spd',    txt:n=>`Hit ${n} m/s`,
      tgt:b=>Math.round(clamp(b.spd*1.1 + 5, 30, 400)),
      val:r=>Math.round(r.maxSpd) },
    { id:'alt',    txt:n=>`Reach ${n} m altitude`,
      tgt:b=>Math.round(clamp(b.alt*1.15 + 10, 30, 8000)),
      val:r=>Math.round(r.maxAlt) },
    { id:'bounce', txt:n=>`Bounce ${n} times`,
      tgt:b=>clamp(2 + Math.floor(b.dist/3000), 2, 6),
      val:r=>r.bounceCount },
    // Style contracts — uses existing run fields only
    { id:'combo',  txt:n=>`Build a ×${n} combo`,
      tgt:b=>clamp(2 + Math.floor(b.dist/4000), 2, 8),
      val:r=>r.maxCombo },
    { id:'stars',  txt:n=>`Collect ${n} star${n>1?'s':''}`,
      tgt:b=>clamp(Math.round(1 + b.dist/3000), 1, 8),
      val:r=>r.starCount },
    { id:'gun',    txt:n=>`Down ${n} target${n>1?'s':''} with the cannon`,
      tgt:b=>clamp(1 + Math.floor(b.dist/5000), 1, 6),
      val:r=>r.gunKills },
    { id:'smash',  txt:n=>`Smash through ${n} obstacle${n>1?'s':''}`,
      tgt:b=>clamp(2 + Math.floor(b.dist/4000), 2, 6),
      val:r=>r.obHits },
    { id:'lowfly', txt:n=>`Skim for ${n}s AND catch 3 fish`,
      tgt:b=>clamp(Math.round(3 + b.dist/3000), 3, 10),
      val:r=>Math.min(Math.floor(r.skimT), r.coinCount >= 3 ? 999 : 0) },
  ];

  function contractsFor(day){
    const b = state.best;
    const a = Math.floor(hash01(day*13+3)*CONTRACT_POOL.length);
    const c2 = (a + 1 + Math.floor(hash01(day*29+11)*(CONTRACT_POOL.length-1))) % CONTRACT_POOL.length;
    const reward = Math.round(clamp(100 + b.dist*0.25, 100, 5000)/10)*10;
    return [a, c2].map(idx => {
      const c = CONTRACT_POOL[idx];
      const target = c.tgt(b);
      return { id:c.id, text:c.txt(target), target, val:c.val, reward };
    });
  }

  // ─── LANDMARKS ────────────────────────────────────────────────────────────
  // Physical bosses standing on the ice. Fly into one to damage it — the hurt
  // persists between days — and bring it down for a payout. The Wall is the
  // real victory condition. You CAN fly over them, but they won't forget you.
  //
  // HP retuned so a skilled maxed build can down the Wall in 1–2 flights
  // (world.js rework converts knockback to a slowdown, allowing sustained
  // damage per pass). Damage per pass at max plating+skull ≈ 1000–1500 hp,
  // so 8 000 hp means 5–8 hits total across 1–2 good flights.
  // Rewards trimmed to fit the new milestone economy (no more $30 k lump).
  //
  //   OLD: snowman hp:400/$2000 · iceberg hp:2500/$8000 · wall hp:12000/$30000
  //   NEW: snowman hp:350/$1500 · iceberg hp:2000/$6000 · wall hp:8000/$20000
  const LANDMARKS = [
    { id:'snowman', x:2500,  w:34, h:75,   hp:350,  reward:1500,  name:'Giant Snowman', color:'#ffffff' },
    { id:'iceberg', x:10000, w:70, h:300,  hp:2000, reward:6000,  name:'The Iceberg',   color:'#bfe6ff' },
    { id:'wall',    x:35000, w:46, h:1300, hp:8000, reward:20000, name:'THE WALL',      color:'#c9b8a0' },
  ];

  // ─── MEDALS ───────────────────────────────────────────────────────────────
  // Permanent achievements worth Bonus Points; BP buys bonus-shop levels.
  // All three survive a progress reset — the prestige loop.
  // New medals added for style play (combo chains, stars, endurance, accuracy).
  const MEDALS = [
    { id:'first',    bp:1, icon:'\u{1F423}', name:'Leap of Faith',
      desc:'Complete your first flight',               chk:r=>true },
    { id:'century',  bp:1, icon:'\u{1F4CF}', name:'Century',
      desc:'Fly 100 m',                                chk:r=>r.dist>=100 },
    { id:'kmclub',   bp:1, icon:'\u{1F6E3}', name:'Kilometre Club',
      desc:'Fly 1 km',                                 chk:r=>r.dist>=1000 },
    { id:'fivek',    bp:2, icon:'\u{1F680}', name:'Frequent Flyer',
      desc:'Fly 5 km',                                 chk:r=>r.dist>=5000 },
    { id:'tenk',     bp:2, icon:'\u{1F30D}', name:'Ten-K',
      desc:'Fly 10 km',                                chk:r=>r.dist>=10000 },
    { id:'twentyk',  bp:3, icon:'\u{1F30C}', name:'Horizon Chaser',
      desc:'Fly 20 km',                                chk:r=>r.dist>=20000 },
    { id:'stratos',  bp:2, icon:'\u{1F30C}', name:'Stratospheric',
      desc:'Reach 3,000 m altitude',                   chk:r=>r.maxAlt>=3000 },
    { id:'ionosphere',bp:3,icon:'\u{2728}',  name:'Ionospheric',
      desc:'Reach 6,000 m altitude',                   chk:r=>r.maxAlt>=6000 },
    { id:'mach',     bp:2, icon:'\u{1F4A8}', name:'Mach Penguin',
      desc:'Hit 200 m/s',                              chk:r=>r.maxSpd>=200 },
    { id:'hypersonic',bp:3,icon:'\u{1F525}', name:'Hypersonic',
      desc:'Hit 350 m/s',                              chk:r=>r.maxSpd>=350 },
    { id:'fish10',   bp:1, icon:'\u{1F41F}', name:'Fish Magnet',
      desc:'Catch 10 fish in one flight',              chk:r=>r.coinCount>=10 },
    { id:'fish20',   bp:2, icon:'\u{1F420}', name:'Shoal Surfer',
      desc:'Catch 20 fish in one flight',              chk:r=>r.coinCount>=20 },
    { id:'combo5',   bp:2, icon:'\u{1F517}', name:'Chain Reaction',
      desc:'Reach a ×5 combo',                         chk:r=>r.maxCombo>=5 },
    { id:'combo10',  bp:3, icon:'\u{26D3}',  name:'Unbreakable',
      desc:'Reach a ×10 combo',                        chk:r=>r.maxCombo>=10 },
    { id:'ring5',    bp:2, icon:'\u{2B55}',  name:'Ring Master',
      desc:'Thread 5 rings in one flight',             chk:r=>r.ringCount>=5 },
    { id:'ring8',    bp:3, icon:'\u{1F4CD}', name:'Ring Lord',
      desc:'Thread 8 rings in one flight',             chk:r=>r.ringCount>=8 },
    { id:'skim10',   bp:2, icon:'\u{2744}',  name:'Belly Surfer',
      desc:'Skim the ice for 10 s in one flight',      chk:r=>r.skimT>=10 },
    { id:'skim20',   bp:3, icon:'\u{1F9CA}', name:'Ice Dancer',
      desc:'Skim the ice for 20 s in one flight',      chk:r=>r.skimT>=20 },
    { id:'bounce6',  bp:1, icon:'\u{1F3C0}', name:'Superball',
      desc:'Bounce 6 times in one flight',             chk:r=>r.bounceCount>=6 },
    { id:'ace',      bp:2, icon:'\u{1F3AF}', name:'Sky Ace',
      desc:'Down 5 targets in one flight',             chk:r=>r.gunKills>=5 },
    { id:'topgun',   bp:3, icon:'\u{1F52B}', name:'Top Gun',
      desc:'Down 10 targets in one flight',            chk:r=>r.gunKills>=10 },
    { id:'ouch',     bp:1, icon:'\u{1F915}', name:'Crash Test Penguin',
      desc:'Hit 3 obstacles in one flight',            chk:r=>r.obHits>=3 },
    { id:'stars5',   bp:2, icon:'\u{2B50}',  name:'Star Collector',
      desc:'Collect 5 stars in one flight',            chk:r=>r.starCount>=5 },
    { id:'kit',      bp:2, icon:'\u{1F9F0}', name:'Fully Loaded',
      desc:'Own every piece of permanent gear',        chk:()=>Object.values(state.perm).every(v=>v) },
    { id:'snowman',  bp:2, icon:'\u{26C4}',  name:"Frosty's Bane",
      desc:'Demolish the Giant Snowman',               chk:()=>state.lmHP.snowman<=0 },
    { id:'iceberg',  bp:3, icon:'\u{1F9CA}', name:'Cold Revenge',
      desc:'Shatter the Iceberg',                      chk:()=>state.lmHP.iceberg<=0 },
    { id:'wall',     bp:5, icon:'\u{1F9F1}', name:'Another Brick',
      desc:'Bring down The Wall',                      chk:()=>state.lmHP.wall<=0 },
  ];

  // ─── BONUS_SHOP ───────────────────────────────────────────────────────────
  const BONUS_SHOP = [
    { id:'aero',  icon:'\u{1FAB6}', name:'Penguin Physique', max:3, cost:[2,4,6],
      desc:'Molted down to racing feathers: −7% drag per level. Permanent — survives resets.' },
    { id:'cash',  icon:'\u{1F3E6}', name:'Merch Empire',     max:3, cost:[2,4,6],
      desc:'Plush penguins in every store: +12% earnings per level. Permanent.' },
    { id:'skull', icon:'\u{1FA96}', name:'Hardened Skull',   max:3, cost:[2,4,6],
      desc:'Pure bone. +40% smash damage per level. Permanent.' },
  ];

  // ─── DAILY MODIFIER TABLE ─────────────────────────────────────────────────
  // Each entry is a descriptor that physics/world can read defensively from
  // state.dailyMod (seeded by calling dailyModFor(state.day) at launch).
  // The `id` is unique; `label` is display text; numeric fields are multipliers
  // or additive offsets the physics module applies to its force sum when present.
  //
  // Only safe-to-ignore fields — consumers check for their own known ids and
  // fall back to neutral values. Adding new entries here is backward-safe.
  const DAILY_MOD_TABLE = [
    { id:'calm',      label:'Calm Day',       windX:0,    windY:0,    dragMul:1.00, cashMul:1.00 },
    { id:'tailwind',  label:'Tailwind',       windX:4,    windY:0,    dragMul:0.92, cashMul:1.00 },
    { id:'headwind',  label:'Headwind',       windX:-5,   windY:0,    dragMul:1.10, cashMul:1.20 },
    { id:'updraft',   label:'Updraft',        windX:0,    windY:3,    dragMul:0.95, cashMul:1.00 },
    { id:'downdraft', label:'Downdraft',      windX:0,    windY:-4,   dragMul:1.05, cashMul:1.15 },
    { id:'slippery',  label:'Icy Runway',     windX:0,    windY:0,    dragMul:0.85, cashMul:1.00 },
    { id:'dense',     label:'Dense Air',      windX:0,    windY:0,    dragMul:1.20, cashMul:1.25 },
    { id:'bonusday',  label:'Sponsor\'s Day', windX:0,    windY:0,    dragMul:1.00, cashMul:1.50 },
    { id:'gusty',     label:'Gusty Winds',    windX:3,    windY:2,    dragMul:1.08, cashMul:1.10 },
  ];

  // ─── DAILY DEAL TABLE ─────────────────────────────────────────────────────
  // Each entry names an upgrade id and a discount fraction (0.3 = 30% off).
  // dailyDealFor(day) picks one deterministically; store.js renders it with a
  // badge if it detects the export. Consumers apply cost * (1 - deal.discount).
  const DAILY_DEAL_TABLE = [
    { upgradeId:'ramp',    discount:0.30 },
    { upgradeId:'wings',   discount:0.25 },
    { upgradeId:'aero',    discount:0.25 },
    { upgradeId:'bounce',  discount:0.20 },
    { upgradeId:'struts',  discount:0.20 },
    { upgradeId:'rocket',  discount:0.35 },
    { upgradeId:'fuel',    discount:0.25 },
    { upgradeId:'sponsor', discount:0.20 },
    { upgradeId:'sling',   discount:0.20 },
    { upgradeId:'plating', discount:0.20 },
    { upgradeId:'gun',     discount:0.30 },
  ];

  // ─── DAILY HELPERS ────────────────────────────────────────────────────────
  // Both functions reuse the hash01-based pattern from contractsFor() so the
  // results are deterministic for a given day and never call Math.random().

  /**
   * dailyModFor(day) → one entry from DAILY_MOD_TABLE.
   * Physics/world read it as state.dailyMod (set defensively at launch):
   *   const mod = dailyModFor(state.day);
   *   // in stepFlight: vx += mod.windX * dt;  vy += mod.windY * dt; etc.
   */
  function dailyModFor(day){
    const idx = Math.floor(hash01(day * 17 + 7) * DAILY_MOD_TABLE.length);
    return DAILY_MOD_TABLE[idx];
  }

  /**
   * dailyDealFor(day) → one entry from DAILY_DEAL_TABLE, or null on calm days.
   * Store reads it defensively:
   *   const deal = typeof dailyDealFor==='function' ? dailyDealFor(state.day) : null;
   *   if(deal) applyCostBadge(deal.upgradeId, deal.discount);
   * There is no deal on ~2 in 9 days (calm/bonusday) to keep it meaningful.
   */
  function dailyDealFor(day){
    const mod = dailyModFor(day);
    // No deal on calm or bonus-cash days — they already have other advantages.
    if(mod.id === 'calm' || mod.id === 'bonusday') return null;
    const idx = Math.floor(hash01(day * 23 + 5) * DAILY_DEAL_TABLE.length);
    return DAILY_DEAL_TABLE[idx];
  }

  // ─── EXPORTS ──────────────────────────────────────────────────────────────
  return {
    UPGRADES, GEAR, upgCost, MILESTONES, WIN_DIST, OBSTACLE_TYPES,
    CONTRACT_POOL, contractsFor, LANDMARKS, MEDALS, BONUS_SHOP,
    // New exports — consumed defensively (typeof guard) by other modules:
    DAILY_MOD_TABLE, dailyModFor,
    DAILY_DEAL_TABLE, dailyDealFor,
  };
}
