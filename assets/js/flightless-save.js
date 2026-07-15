// Flightless — save/progress state module.
//
// Owns the shape of a save file, loading + sanitizing whatever's in
// localStorage, and persisting it back. No game logic lives here — just
// the schema and its defaults, so it can evolve (new fields, migrations)
// independently of the sim and UI that read/write it.
const SAVE_KEY = 'flightless-save-v1';

export function defaultState(){
  return {
    money:0, day:1, lvl:{ramp:0,aero:0,wings:0,rocket:0,fuel:0,sling:0,bounce:0,sponsor:0,gun:0,struts:0,plating:0},
    perm:{speedo:false,alti:false,burner:false,tank:false},
    best:{dist:0,alt:0,spd:0}, claimed:[], won:false, muted:false, started:false,
    // landmark hit points (persist between days), medals earned, bonus points,
    // and permanent bonus-shop levels (these three survive a progress reset)
    lmHP:{snowman:400, iceberg:2500, wall:12000},
    medals:[], bp:0, bonus:{aero:0, cash:0, skull:0},
    // ramp spline control points in unit shape space (gate → lip); the last
    // point IS the lip. Upgrades buy track length; this is the shape of it.
    rampShape:[{x:0.03,y:0.95},{x:0.16,y:0.32},{x:0.72,y:0.02},{x:1,y:0.10}],
  };
}

export function loadState(){
  let state = defaultState();
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(raw){
      const s = JSON.parse(raw);
      state = Object.assign(defaultState(), s);
      state.lvl = Object.assign(defaultState().lvl, s.lvl||{});
      state.perm = Object.assign(defaultState().perm, s.perm||{});
      state.best = Object.assign(defaultState().best, s.best||{});
      state.lmHP = Object.assign(defaultState().lmHP, s.lmHP||{});
      state.bonus = Object.assign(defaultState().bonus, s.bonus||{});
      if(!Array.isArray(state.medals)) state.medals = [];
      if(typeof state.bp !== 'number' || !isFinite(state.bp)) state.bp = 0;
      // sanitize the ramp spline (older saves stored a nose angle, or a
      // 3-point shape with an implicit fixed lip — append the old lip)
      if(Array.isArray(state.rampShape) && state.rampShape.length===3)
        state.rampShape = [...state.rampShape, {x:1, y:0.10}];
      if(!Array.isArray(state.rampShape) || state.rampShape.length!==4 ||
         state.rampShape.some(p=>!p || typeof p.x!=='number' || typeof p.y!=='number' || !isFinite(p.x) || !isFinite(p.y)))
        state.rampShape = defaultState().rampShape;
      else state.rampShape = state.rampShape.map(p=>({ x:Math.min(Math.max(p.x,0),1), y:Math.min(Math.max(p.y,0.02),1) }));
      // pre-gear saves: skip the intro if they've clearly played before
      state.started = state.started || state.day>1 || state.best.dist>0;
    }
  }catch(e){ /* corrupted save -> fresh start */ }
  return state;
}

export function saveState(state){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }catch(e){}
}
