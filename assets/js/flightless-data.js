// Flightless — static game-config module.
//
// Every tunable table the game reads from: upgrade/gear/bonus-shop
// catalogs, medals, distance milestones, obstacle types, and the daily
// contract pool. No behavior lives here beyond the small pure helpers
// (upgCost, contractsFor) that just look values up in these tables —
// the actual physics/sim/UI code that acts on them lives elsewhere.
//
// A few upgrade cards preview live stats (ramp length/height, glide ratio,
// dive speed) by calling into the physics module, so those are injected
// rather than imported directly — this module has no dependency of its
// own on how flight is simulated.
export function createData({ state, derive, buildRamp, rampExitEst, gliderName, clamp, hash01 }){
  const UPGRADES = [
    { id:'ramp',    icon:'\u{1F6DD}', name:'Ramp Track',   base:15,  mul:1.55, max:12, unlock:0,
      desc:'More track to build speed on. Reshape it in the designer below.',
      val:l=>{ const d=derive({ramp:l}); const r=buildRamp(d.rampLen);
               return `${Math.round(d.rampLen)} m · ${Math.round(r.H)} m tall · ~${Math.round(rampExitEst(d, r))} m/s exit`; } },
    { id:'wings',   icon:'\u{1FABD}', name:'Glider Wings', base:25,  mul:1.55, max:10, unlock:0,
      desc:'More lift, flatter glide. Ease off "up" to cruise. New rig every couple of levels.',
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
    { id:'rocket',  icon:'\u{1F680}', name:'Rocket',       base:100, mul:1.55, max:10, unlock:100,
      desc:'A strap-on booster. Hold SPACE to climb faster.',
      val:l=> l===0 ? 'not installed' : `${10+8*l} m/s² thrust` },
    { id:'fuel',    icon:'⛽',    name:'Fuel Tank',    base:60,  mul:1.55, max:10, unlock:100,
      desc:'More burn time for sustained climbs.', requires:'rocket',
      val:l=>`${(2+1.3*l).toFixed(1)} s of burn` },
    { id:'sponsor', icon:'\u{1F4B0}', name:'Sponsor Deal', base:250, mul:1.55, max:6, unlock:250,
      desc:'Fish Co. multiplies your earnings on every flight.',
      val:l=>`×${(1+0.35*l).toFixed(2)} cash earned` },
    { id:'sling',   icon:'\u{1F3AF}', name:'Catapult',     base:400, mul:1.55, max:8, unlock:500,
      desc:'An elastic winch flings you from the gate at the top of the track.',
      val:l=> l===0 ? 'not installed' : `+${20*l} m/s at the gate` },
    { id:'plating', icon:'\u{1F6E1}', name:'Ram Plating',  base:600, mul:1.55, max:6, unlock:1500,
      desc:'An armored belly plate. Smash landmarks harder and keep more speed on impact.',
      val:l=>`×${(1+0.35*l).toFixed(2)} smash damage`,
    },
    { id:'gun',     icon:'\u{1F52B}', name:'Sky Cannon',   base:3000, mul:1.7,  max:6, unlock:2500,
      desc:'Press C to blast obstacles out of the sky. Upgrade for range and bigger targets.',
      val:l=>{ if(l===0) return 'not installed';
               const tier = l>=5?'planes':l>=3?'balloons':'birds';
               return `range ${260+90*l}m · downs ${tier}`; } },
  ];
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

  const MILESTONES = [
    [100,150],[250,300],[500,600],[1000,1200],[2500,3000],
    [5000,7000],[10000,15000],[20000,35000],[35000,100000],
  ];
  const WIN_DIST = 35000;

  // Birds, balloons and planes share one x-cell grid; each cell deterministically
  // rolls a type then an existence chance, same trick as the coin/star fields.
  const OBSTACLE_TYPES = [
    { id:'bird',    tough:1, cash:40,  minAlt:25,   maxAlt:1400, r:16, skip:0.3 },
    { id:'balloon', tough:3, cash:150, minAlt:600,  maxAlt:3200, r:28, skip:0.45 },
    { id:'plane',   tough:5, cash:500, minAlt:1800, maxAlt:6000, r:36, skip:0.55 },
  ];

  // Two per-day side objectives, deterministic from the day number and scaled
  // to current progress. Checked at the end of the flight; paid in results.
  const CONTRACT_POOL = [
    { id:'fish',  txt:n=>`Catch ${n} fish`,            tgt:b=>clamp(Math.round(3 + b.dist/400), 3, 20),  val:r=>r.coinCount },
    { id:'rings', txt:n=>`Fly through ${n} ring${n>1?'s':''}`, tgt:b=>clamp(Math.round(1 + b.dist/1500), 1, 6), val:r=>r.ringCount },
    { id:'skim',  txt:n=>`Skim the ice for ${n}s`,     tgt:b=>clamp(Math.round(2 + b.dist/2500), 2, 8),  val:r=>Math.floor(r.skimT) },
    { id:'spd',   txt:n=>`Hit ${n} m/s`,               tgt:b=>Math.round(clamp(b.spd*1.1 + 5, 30, 400)), val:r=>Math.round(r.maxSpd) },
    { id:'alt',   txt:n=>`Reach ${n} m altitude`,      tgt:b=>Math.round(clamp(b.alt*1.15 + 10, 30, 8000)), val:r=>Math.round(r.maxAlt) },
    { id:'bounce',txt:n=>`Bounce ${n} times`,          tgt:b=>clamp(2 + Math.floor(b.dist/3000), 2, 6),  val:r=>r.bounceCount },
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

  // Physical bosses standing on the ice. Fly into one to damage it — the hurt
  // persists between days — and bring it down for a payout. The Wall is the
  // real victory condition. You CAN fly over them, but they won't forget you.
  const LANDMARKS = [
    { id:'snowman', x:2500,  w:34, h:75,   hp:400,   reward:2000,  name:'Giant Snowman', color:'#ffffff' },
    { id:'iceberg', x:10000, w:70, h:300,  hp:2500,  reward:8000,  name:'The Iceberg',   color:'#bfe6ff' },
    { id:'wall',    x:35000, w:46, h:1300, hp:12000, reward:30000, name:'THE WALL',      color:'#c9b8a0' },
  ];

  // Medals are permanent achievements worth Bonus Points; BP buys permanent
  // bonus-shop levels. All three survive a progress reset — the prestige loop.
  const MEDALS = [
    { id:'first',   bp:1, icon:'\u{1F423}', name:'Leap of Faith',      desc:'Complete your first flight',        chk:r=>true },
    { id:'century', bp:1, icon:'\u{1F4CF}', name:'Century',            desc:'Fly 100 m',                         chk:r=>r.dist>=100 },
    { id:'kmclub',  bp:1, icon:'\u{1F6E3}', name:'Kilometre Club',     desc:'Fly 1 km',                          chk:r=>r.dist>=1000 },
    { id:'fivek',   bp:2, icon:'\u{1F680}', name:'Frequent Flyer',     desc:'Fly 5 km',                          chk:r=>r.dist>=5000 },
    { id:'stratos', bp:2, icon:'\u{1F30C}', name:'Stratospheric',      desc:'Reach 3,000 m altitude',            chk:r=>r.maxAlt>=3000 },
    { id:'mach',    bp:2, icon:'\u{1F4A8}', name:'Mach Penguin',       desc:'Hit 200 m/s',                       chk:r=>r.maxSpd>=200 },
    { id:'fish10',  bp:1, icon:'\u{1F41F}', name:'Fish Magnet',        desc:'Catch 10 fish in one flight',       chk:r=>r.coinCount>=10 },
    { id:'combo5',  bp:2, icon:'\u{1F517}', name:'Chain Reaction',     desc:'Reach a ×5 combo',             chk:r=>r.maxCombo>=5 },
    { id:'ring5',   bp:2, icon:'\u{2B55}',  name:'Ring Master',        desc:'Thread 5 rings in one flight',      chk:r=>r.ringCount>=5 },
    { id:'skim10',  bp:2, icon:'\u{2744}',  name:'Belly Surfer',       desc:'Skim the ice for 10 s in one flight', chk:r=>r.skimT>=10 },
    { id:'bounce6', bp:1, icon:'\u{1F3C0}', name:'Superball',          desc:'Bounce 6 times in one flight',      chk:r=>r.bounceCount>=6 },
    { id:'ace',     bp:2, icon:'\u{1F3AF}', name:'Sky Ace',            desc:'Down 5 targets in one flight',      chk:r=>r.gunKills>=5 },
    { id:'ouch',    bp:1, icon:'\u{1F915}', name:'Crash Test Penguin', desc:'Hit 3 obstacles in one flight',     chk:r=>r.obHits>=3 },
    { id:'kit',     bp:2, icon:'\u{1F9F0}', name:'Fully Loaded',       desc:'Own every piece of permanent gear', chk:()=>Object.values(state.perm).every(v=>v) },
    { id:'snowman', bp:2, icon:'\u{26C4}',  name:"Frosty's Bane",      desc:'Demolish the Giant Snowman',        chk:()=>state.lmHP.snowman<=0 },
    { id:'iceberg', bp:3, icon:'\u{1F9CA}', name:'Cold Revenge',       desc:'Shatter the Iceberg',               chk:()=>state.lmHP.iceberg<=0 },
    { id:'wall',    bp:5, icon:'\u{1F9F1}', name:'Another Brick',      desc:'Bring down The Wall',               chk:()=>state.lmHP.wall<=0 },
  ];
  const BONUS_SHOP = [
    { id:'aero',  icon:'\u{1FAB6}', name:'Penguin Physique', max:3, cost:[2,4,6],
      desc:'Molted down to racing feathers: −7% drag per level. Permanent — survives resets.' },
    { id:'cash',  icon:'\u{1F3E6}', name:'Merch Empire',     max:3, cost:[2,4,6],
      desc:'Plush penguins in every store: +12% earnings per level. Permanent.' },
    { id:'skull', icon:'\u{1FA96}', name:'Hardened Skull',   max:3, cost:[2,4,6],
      desc:'Pure bone. +40% smash damage per level. Permanent.' },
  ];

  return {
    UPGRADES, GEAR, upgCost, MILESTONES, WIN_DIST, OBSTACLE_TYPES,
    CONTRACT_POOL, contractsFor, LANDMARKS, MEDALS, BONUS_SHOP,
  };
}
