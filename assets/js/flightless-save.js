// Flightless — save/progress state module.
//
// Owns the shape of a save file, loading + sanitizing whatever's in
// localStorage, and persisting it back. No game logic lives here — just
// the schema and its defaults, so it can evolve (new fields, migrations)
// independently of the sim and UI that read/write it.
//
// Schema versioning: state.version is an integer.  Any save without a version
// field is treated as version 0. MIGRATIONS is an ordered array; entry [i]
// upgrades a version-i save to version-(i+1). Add a new function to the end
// whenever the schema changes — never edit an existing migration.
//
// Export surface (public API — signatures are frozen):
//   defaultState()            → plain state object at current schema version
//   loadState()               → loads/sanitizes from localStorage
//   saveState(state)          → persists to localStorage
//   exportSave()              → base64 JSON string (dependency-free)
//   importSave(str)           → validated state object, or throws

const SAVE_KEY    = 'flightless-save-v1';
const SCHEMA_VER  = 1;   // increment each time a migration is appended

// ─── helpers ────────────────────────────────────────────────────────────────

function clamp(v, lo, hi){ return Math.min(Math.max(v, lo), hi); }
function finite(v, fallback){ return (typeof v === 'number' && isFinite(v)) ? v : fallback; }
function bool(v, fallback){ return typeof v === 'boolean' ? v : fallback; }

// ─── schema ─────────────────────────────────────────────────────────────────

export function defaultState(){
  return {
    version: SCHEMA_VER,
    money: 0, day: 1,
    lvl: { ramp:0, aero:0, wings:0, rocket:0, fuel:0, sling:0, bounce:0, sponsor:0, gun:0, struts:0, plating:0, cargo:0 },
    perm: { speedo:false, alti:false, burner:false, tank:false },
    best: { dist:0, alt:0, spd:0 },
    claimed: [], won: false, muted: false, started: false,
    // new forward-looking fields (consumed defensively by sound/render/html)
    musicMuted: false,
    settings: { reduceMotion:false, sfxVol:1, musicVol:1 },
    ngPlus: 0,
    sponsorPatience: 100,
    // landmark hit points (persist between days), medals earned, bonus points,
    // and permanent bonus-shop levels (these three survive a progress reset)
    // NOTE: these MUST match the `hp` values in flightless-data.js's LANDMARKS
    // table — lmHP is the persisted *current* HP, seeded to each landmark's max.
    lmHP: { snowman:350, iceberg:2000, wall:8000 },
    medals: [], bp: 0, bonus: { aero:0, cash:0, skull:0 },
    // ramp spline control points in unit shape space (gate → lip); the last
    // point IS the lip. Upgrades buy track length; this is the shape of it.
    rampShape: [{x:0.03,y:0.95},{x:0.16,y:0.32},{x:0.72,y:0.02},{x:1,y:0.10}],
  };
}

// ─── migrations ─────────────────────────────────────────────────────────────
// Each entry upgrades from version N → N+1.
// MIGRATIONS[0] upgrades a version-0 save (legacy, no version field) to v1.

const MIGRATIONS = [
  // v0 → v1: seed forward-looking fields that were absent in legacy saves.
  function migrateV0toV1(s){
    if(typeof s.musicMuted !== 'boolean') s.musicMuted = false;
    if(!s.settings || typeof s.settings !== 'object') s.settings = {};
    if(typeof s.settings.reduceMotion !== 'boolean') s.settings.reduceMotion = false;
    if(typeof s.settings.sfxVol   !== 'number') s.settings.sfxVol   = 1;
    if(typeof s.settings.musicVol !== 'number') s.settings.musicVol = 1;
    if(typeof s.ngPlus !== 'number') s.ngPlus = 0;
    if(typeof s.sponsorPatience !== 'number') s.sponsorPatience = 100;
    s.version = 1;
    return s;
  },
  // Future: append migrateV1toV2, etc. here.
];

/** Apply all pending migrations to a raw parsed object. */
function applyMigrations(s){
  const from = (typeof s.version === 'number' && isFinite(s.version))
    ? Math.max(0, Math.floor(s.version))
    : 0;
  for(let v = from; v < MIGRATIONS.length; v++){
    s = MIGRATIONS[v](s);
  }
  return s;
}

// ─── sanitization ───────────────────────────────────────────────────────────
// Called after migrations so every field is in its post-migration shape.

const KNOWN_LVL_KEYS   = new Set(['ramp','aero','wings','rocket','fuel','sling','bounce','sponsor','gun','struts','plating','cargo']);
const KNOWN_PERM_KEYS  = new Set(['speedo','alti','burner','tank']);
const KNOWN_BEST_KEYS  = new Set(['dist','alt','spd']);
const KNOWN_LMHP_KEYS  = new Set(['snowman','iceberg','wall']);
const KNOWN_BONUS_KEYS = new Set(['aero','cash','skull']);
const KNOWN_SETTINGS_KEYS = new Set(['reduceMotion','sfxVol','musicVol']);

// Top-level keys that belong in a saved state.
const KNOWN_TOP_KEYS = new Set([
  'version','money','day','lvl','perm','best','claimed','won','muted',
  'started','musicMuted','settings','ngPlus','sponsorPatience',
  'lmHP','medals','bp','bonus','rampShape',
]);

function sanitize(state){
  const d = defaultState();

  // Drop unknown top-level keys.
  for(const k of Object.keys(state)){
    if(!KNOWN_TOP_KEYS.has(k)) delete state[k];
  }

  // Scalars
  state.version        = SCHEMA_VER;
  state.money          = clamp(finite(state.money,          0), 0, 1e12);
  state.day            = clamp(finite(state.day,            1), 1, 1e6);
  state.bp             = clamp(finite(state.bp,             0), 0, 1e9);
  state.ngPlus         = clamp(finite(state.ngPlus,         0), 0, 999);
  state.sponsorPatience= clamp(finite(state.sponsorPatience,100), 0, 100);
  state.won            = bool(state.won,     false);
  state.muted          = bool(state.muted,   false);
  state.musicMuted     = bool(state.musicMuted, false);
  state.started        = bool(state.started, false);

  // Arrays
  if(!Array.isArray(state.claimed)) state.claimed = [];
  if(!Array.isArray(state.medals))  state.medals  = [];

  // Sub-objects: keep known keys only, clamp/coerce values.
  state.lvl = Object.fromEntries(
    Array.from(KNOWN_LVL_KEYS).map(k => [k, clamp(finite(state.lvl?.[k], 0), 0, 100)])
  );
  state.perm = Object.fromEntries(
    Array.from(KNOWN_PERM_KEYS).map(k => [k, bool(state.perm?.[k], false)])
  );
  state.best = Object.fromEntries(
    Array.from(KNOWN_BEST_KEYS).map(k => [k, clamp(finite(state.best?.[k], 0), 0, 1e9)])
  );
  state.lmHP = Object.fromEntries(
    Array.from(KNOWN_LMHP_KEYS).map(k => [k, clamp(finite(state.lmHP?.[k], d.lmHP[k]), 0, 1e7)])
  );
  state.bonus = Object.fromEntries(
    Array.from(KNOWN_BONUS_KEYS).map(k => [k, clamp(finite(state.bonus?.[k], 0), 0, 1e6)])
  );

  // Settings sub-object
  if(!state.settings || typeof state.settings !== 'object') state.settings = {};
  state.settings = Object.fromEntries(
    Array.from(KNOWN_SETTINGS_KEYS).map(k => {
      if(k === 'reduceMotion') return [k, bool(state.settings[k], false)];
      return [k, clamp(finite(state.settings[k], 1), 0, 1)];
    })
  );

  // rampShape: legacy 3-point saves get the missing lip appended.
  if(Array.isArray(state.rampShape) && state.rampShape.length === 3)
    state.rampShape = [...state.rampShape, {x:1, y:0.10}];
  if(
    !Array.isArray(state.rampShape) ||
    state.rampShape.length !== 4 ||
    state.rampShape.some(p => !p || typeof p.x !== 'number' || typeof p.y !== 'number' ||
                              !isFinite(p.x) || !isFinite(p.y))
  ){
    state.rampShape = d.rampShape;
  } else {
    state.rampShape = state.rampShape.map(p => ({
      x: clamp(p.x, 0, 1),
      y: clamp(p.y, 0.02, 1),
    }));
  }

  // pre-gear saves: skip the intro if they've clearly played before.
  state.started = state.started || state.day > 1 || state.best.dist > 0;

  return state;
}

// ─── public API ─────────────────────────────────────────────────────────────

export function loadState(){
  let state = defaultState();
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && typeof parsed === 'object'){
        const migrated = applyMigrations(parsed);
        state = sanitize(Object.assign(defaultState(), migrated));
      }
    }
  }catch(e){ /* corrupted save → fresh start */ }
  return state;
}

export function saveState(state){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }catch(e){}
}

/**
 * exportSave() → base64-encoded JSON string of the current save.
 * Dependency-free; works in any browser context. The store wires a button
 * to this; call saveState() first so the export reflects the latest state.
 */
export function exportSave(){
  const raw = localStorage.getItem(SAVE_KEY) ?? JSON.stringify(defaultState());
  return btoa(unescape(encodeURIComponent(raw)));
}

/**
 * importSave(str) → validated state object.
 * Throws a descriptive Error if the string is not valid base64 JSON or fails
 * schema validation. The caller (store UI) is responsible for writing the
 * returned state back via saveState() and re-loading the page.
 */
export function importSave(str){
  if(typeof str !== 'string' || !str.trim())
    throw new Error('importSave: empty input');
  let json;
  try{
    json = decodeURIComponent(escape(atob(str.trim())));
  }catch(e){
    throw new Error('importSave: invalid base64');
  }
  let parsed;
  try{
    parsed = JSON.parse(json);
  }catch(e){
    throw new Error('importSave: invalid JSON');
  }
  if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('importSave: root must be an object');
  const migrated  = applyMigrations(parsed);
  const validated = sanitize(Object.assign(defaultState(), migrated));
  return validated;
}
