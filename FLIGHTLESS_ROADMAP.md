# Flightless Roadmap

Flightless is a Learn-to-Fly-style launch game at `pages/flightless.html`. The
sim is split into ES-module factories under `assets/js/flightless-*.js`, wired
together by the orchestrator in the HTML. This doc is both a **backlog** of
discrete jobs and a **per-component improvement charter** so a swarm of agents —
one per module — can each own a file and improve it in parallel without
colliding.

> **This revision (rewrite):** corrected the P0 diagnoses against the actual
> code, merged the Wall bugs that are really one problem, added a
> **Shared invariants** contract every parallel agent must honor, and added a
> **per-component charter** (§B) that maps every module to a concrete,
> self-contained slate of work. The original cross-cutting backlog is preserved
> and tightened in §C.

## Module map (know this before picking a job)

| Module | Owns |
|---|---|
| `assets/js/flightless-save.js` | Save schema, load/sanitize, persist |
| `assets/js/flightless-sound.js` | Web Audio synth (SFX) |
| `assets/js/flightless-data.js` | Upgrade/gear/medal/contract/landmark/bonus-shop tables |
| `assets/js/flightless-store.js` | Shop screen UI (tabs, ramp designer) |
| `assets/js/flightless-physics.js` | Ramp geometry, upgrade→stat derivation, ramp/flight/slide integrators |
| `assets/js/flightless-world.js` | Collectibles, obstacles, boost rings, landmark damage |
| `assets/js/flightless-render.js` | Canvas renderer, particles, popups |
| `assets/js/flightless-hud-input.js` | HUD readout, keyboard/touch input |
| `assets/js/flightless-results.js` | End-of-flight scoring, results screen |
| `pages/flightless.html` | Orchestrator: the shared `sim` object, module wiring, boot, main loop |

---

## Shared invariants — READ FIRST, every agent honors these

These are the contracts that let ten agents edit ten files at once without
breaking each other. **Do not violate them even if your file's job seems to
want to.**

1. **Factory signatures are frozen.** Every module is a `createXxx(deps)` that
   returns an object. You may *add* new methods/exports to your return object,
   but never rename or remove an existing one, and never change what `deps`
   fields you consume without the orchestrator agent also wiring them. Read
   `flightless-store.js` first — it's the cleanest example of the pattern.
2. **`sim.*` is shared mutable sim state** (`phase`/`run`/`ramp`/`st`/
   `particles`/`speedLines`/`timeSim`/`W`/`Hpx`/`DPR`). Read/write through
   `sim.x`; never take a local copy. You may **add new properties** to `sim`
   (see the reserved list below) but never rename existing ones.
3. **`state` is the save object.** Mutate in place (`state.foo = x`), never
   reassign the variable — every module holds its own reference from
   construction. **Only `flightless-save.js` may add fields to `defaultState()`.**
   Every other module that wants a new persistent field must read it
   defensively (`state.foo ?? fallback`) so it works on saves written before
   the field existed.
4. **The `run` object is owned by `flightless-physics.js`** (`newRun()`).
   Only physics adds fields to it. Other modules read `sim.run.*`. If
   `flightless-data.js` wants a new contract, it must be expressible from an
   **existing** `run` field (see the list in §B-data).
5. **New cross-module calls go through the `bridge`/`call()` mechanism** in the
   HTML the same way `popup`/`burst`/`finishRun` do — don't invent a second
   wiring pattern. If your job needs a genuinely new cross-module function, it's
   a **coordinated** job (flag it; the orchestrator agent wires it).
6. **Reserved shared properties** (agents may rely on these existing; whoever
   writes one, the others read defensively):
   - `sim.paused` (boolean) — set by hud-input, honored by the HTML main loop.
   - `state.musicMuted`, `state.settings`, `state.ngPlus` — added to defaults by
     save.js; consumed defensively elsewhere.
7. **Determinism stays deterministic.** Anything placed along the flight path
   (collectibles/obstacles/rings/weather) uses `hash01(cellIndex…)`, never
   `Math.random()`, so it's identical every run at a given distance/day.
   `Math.random()` is fine for transient VFX only.
8. **The fixed-timestep sim must stay deterministic and allocation-light.** No
   per-step heap churn in `stepFlight`/`stepRamp`; VFX allocations belong in the
   render/particle layer.
9. **Playtest your change.** Open `pages/flightless.html`, launch a flight, and
   confirm you didn't throw a console error or break the boot sequence.

---

## A. Critical fixes (P0 — do these first, they gate the fun)

1. **The Wall is effectively a one-hit-per-flight grind (merges old P0 #1+#2).**
   `checkLandmarks()` (`world.js`) *does* damage the Wall whenever the penguin
   is below `LANDMARKS.wall.h` (1300 m) inside its x-band — a glide descends
   through that fine. The real problem is the **knockback**: every hit sets
   `run.x = face-1` and reverses `vx`, ejecting the player from the band, so
   only one hit lands per flight against 12 000 HP (≈6+ flights to kill even
   maxed). **Fix:** rework landmark resolution so a fast, well-built pass can
   deal sustained/multiple damage — e.g. soften knockback to a speed-scaled
   *slow* instead of a reversal, or make it a "ram-through" HP-vs-speed
   resolution where enough speed punches through and keeps going. Playtest that
   a maxed rocket+plating build can bring the Wall down in **1–2 skilled
   flights**, not six. **(file: `world.js`; balance numbers may pair with
   `data.js`)** — **M**
2. **Rebalance the late-game cash curve.** `MILESTONES` ends
   `[35000, 100000]` and `cashDist = 6 + 2·dist^0.9` already pays ~100k+ for a
   single 35 km flight after sponsor×airtime multipliers — so the tree maxes in
   one or two flights the moment the rocket unlocks. Spread the final payout
   across more, smaller milestones and/or gate the big reward behind actually
   *destroying* the Wall rather than reaching its distance. **(file: `data.js`)**
   — **S**
3. **Add a "why didn't that work" signal.** When a pass crosses the Wall's
   x-band without dealing damage (already destroyed, or — post-fix — glanced
   off), give a popup + SFX cue so the player can course-correct instead of
   being silently confused. Land this *after* #1 so the guidance matches the
   real mechanic. **(file: `world.js`)** — **S**
4. **Kill the dead `WIN_DIST` export or make it load-bearing.** `WIN_DIST`
   (`data.js`) is exported and destructured but never used — the win condition
   is `state.lmHP.wall<=0`. Either remove it or route the victory/2×-distance
   check through it so there's one source of truth. **(file: `data.js`)** — **S**

---

## B. Per-component charters (the swarm assignment)

Each charter is a **self-contained slate for one agent owning one file.** Every
item here is achievable without editing another module (touchpoints are limited
to the reserved shared properties in the invariants). Pick the highest-impact
items first; ship incrementally.

### B-save — `flightless-save.js`
- **Save-schema versioning (was #51).** Add an explicit `state.version` and a
  migration-function chain, replacing the ad-hoc field-by-field patching. Future
  schema changes append a migration instead of another special case.
- **Seed forward-looking defaults** so other agents can consume them defensively:
  add `musicMuted:false`, `settings:{reduceMotion:false, sfxVol:1, musicVol:1}`,
  `ngPlus:0` to `defaultState()` and sanitize them on load.
- **Save export/import as pure functions (was #42, core half).** Export
  `exportSave()` → a base64/JSON string and `importSave(str)` → validated state
  (or throws). The store agent wires the buttons; keep these dependency-free.
- Harden sanitization (clamp numeric fields, drop unknown keys) so a hand-edited
  or truncated save can't crash boot.

### B-sound — `flightless-sound.js`
- **Richer SFX layering (was #37).** Add an engine-hum layer that pitches with
  speed (drive it from a `setEngine(speed)` method physics/HUD can call via the
  existing thrust path), impact-variety by type, and a wing-flap tick. Keep all
  existing named cues (`ding/tick/thump/boom/launch/buy/blip/setThrust`).
- **Background music (was #35).** A lightweight looping synth bed with its own
  gain, exposed as `startMusic()/stopMusic()/setMusicVolume(v)`, gated on
  `state.musicMuted` (read defensively) independently of the SFX mute.
- **Penguin bark cues (was #38).** Short procedural one-shots (`cheer()`,
  `oof()`) for the results/milestone agents to call. Add methods only.

### B-data — `flightless-data.js` (numbers & tables only — no behavior)
- Owns P0 #2 and #4 above.
- **Upgrade cost-curve pass (was #11).** All lines share `base·1.55^level`.
  Spreadsheet cost-vs-payout per line and tune outliers so progression stays
  meaningful after the rocket.
- **Expand medals (was #49)** and **style-based contracts (was #10)** using
  **existing** `run` fields only — available today: `maxCombo`, `bounceCount`,
  `gunKills`, `obHits`, `skimT`, `maxAlt`, `maxSpd`, `coinCount`, `starCount`,
  `ringCount`, `dist`. (No new `run` fields — that's physics's call.)
- **Daily deal + daily modifier tables (was #6 data half, #25).** A new
  deterministic-per-day table (reuse the `contractsFor()` hashing pattern) plus
  a pure `dailyModFor(day)` / `dailyDealFor(day)` helper. Physics/store consume
  them defensively; ship the table + helper here regardless.
- Landmark HP/reward tuning to make P0 #1 winnable in 1–2 flights.

### B-store — `flightless-store.js` (shop UI)
- **Ramp designer presets (was #34).** One-click "steep launch / long glide /
  trick ramp" buttons that set `state.rampShape` and `recompute()`.
- **Shop stat projections (was #41).** Show projected distance/top-speed across
  the next 2–3 upgrade levels, not just the immediate next — the `val()`
  previews already exist; render a mini 2–3-step ladder.
- **Bonus-shop respec (was #26)** and **save export/import UI (was #42 UI).**
  Wire buttons to `save.exportSave/importSave` **if present** (`typeof` guard so
  it degrades gracefully before the save agent lands).
- **Rotating daily deal UI (was #25).** If `dailyDealFor` exists, show the
  discounted upgrade with a badge.

### B-physics — `flightless-physics.js` (the sim)
- **Fuel/energy risk-reward (was #12).** An overheat penalty for sustained
  afterburner-style thrust, and/or a "coast on fumes" bonus for landing at ~0
  fuel. Keep it readable from the fixed-step integrator.
- **Daily-modifier hook (was #6 sim half).** In `stepFlight`, read an optional
  `state.dailyMod`/wind term defensively and fold it into the force sum — a
  no-op when absent.
- **Feel/balance pass** that smooths rocket dominance from the *derivation*
  side (`derive()` curves) to complement data's cost pass — e.g. diminishing
  thrust returns at high levels.
- **New `run` tracking fields** for future style contracts (e.g.
  `run.slideless`, `run.lowAltTime`) — add them in `newRun()` and maintain them;
  data can adopt them next revision. Additive only.

### B-world — `flightless-world.js` (highest impact: owns P0 #1 & #3)
- **Landmark multi-hit rework (P0 #1)** and **"flew over / glanced off" feedback
  (P0 #3).**
- **Combo unification (was #8).** Feed obstacle gun-kills and landmark hits into
  the same `combo`/`comboT` chain so a hot streak feels connected. Raise or
  retune the ×3 cap if it helps.
- **Fuel/boost pickups (was #15).** Balloon-style pickups on the deterministic
  cell grid that refill fuel or grant a short speed boost. Placement logic here;
  the render agent draws them from your exported `*Pos()` + cell constants (add
  them to the return object so render can pick them up next revision).
- **Drafting bonus (was #14).** Flying just behind a bird flock grants a
  drag-reduction window instead of only being a hazard (expose it as a factor on
  `sim.run` physics reads defensively).

### B-render — `flightless-render.js` (canvas; large but isolated)
- **Speed/afterburner screen effects (was #29)**, **day/night lighting tied to
  `state.day` (was #30)**, **multi-stage landmark destruction debris (was #28)**,
  **ramp/launch-site variety by day (was #32)**, **animated shop background
  (was #33)**.
- **Weather particle layers (was #27)** as a reusable extension of the particle
  system (snow drift / aurora), drawn defensively off any `state.dailyMod`.
- **Reduced-motion (was #46 render half).** Respect
  `matchMedia('(prefers-reduced-motion)')` **and** `state.settings.reduceMotion`
  (read defensively) to damp camera shake and particle density.

### B-hud-input — `flightless-hud-input.js`
- **Pause (was #44).** A dedicated key/button that toggles `sim.paused`; the
  HTML loop honors it (coordinated via the reserved property — you set it, they
  read it).
- **Fix touch/keyboard hint mismatch.** The hint text names SPACE/C even on
  touch devices — branch on `matchMedia('(pointer:coarse)')`.
- **Mobile refinement (was #45).** Optional drag-to-steer gesture and haptics
  (`navigator.vibrate`) on landings/impacts.
- **Contextual onboarding hints (was #40).** First pull-up / first stall / first
  bounce call-outs, driven off `sim.run` state you already read.

### B-results — `flightless-results.js`
- **Expand headline flavor (was #54).** The 5 tiers repeat fast; add variety per
  tier (pick deterministically by `state.day` so a given day reads consistently).
- **Real stakes / sponsor-patience meter (was #7, results half).** A meter that
  drops on weak flights and pays a bonus when kept full — pure scoring + a
  results row; persist via a `state.*` field you read defensively (save agent
  seeds it).
- Call the new sound barks (`SFX.cheer/oof`) on records/medals **if present**.

### B-html — `pages/flightless.html` (orchestrator)
- **Honor `sim.paused`** in the main loop (freeze stepping without losing state).
- **Post-Wall endgame / NG+ (was #19).** After the Wall falls, offer a second
  harder wall at 2× distance or a New Game+ (`state.ngPlus`, seeded by save) with
  tougher obstacles and better rewards, so there's a reason to keep flying.
- **Settings panel (was #39).** New `#settings` panel matching the existing panel
  pattern; volume sliders + reduce-motion toggle writing to `state.settings`.
- **Wire any newly-added cross-module functions** through `bridge`/`call()` as
  other agents surface them.

---

## C. Larger feature backlog (multi-session / cross-cutting)

These are bigger than a single-file charter and need coordination — schedule
them *after* the swarm's first pass, one owner at a time.

- **Weather system (was #5)** — new `flightless-weather.js`; wind term injected
  into `stepFlight`. Pairs with the data-side daily modifier table. **L, new file**
- **Biome progression (was #13)** — segment the 35 km into Ice/Ocean/Cloud/
  Stratosphere zones with per-zone backdrop (render) and force modifiers
  (physics) + a "pressure suit" upgrade. **XL, shared**
- **Weekly boss flight (was #9)** — one-per-week modifier set + large reward,
  tracked in save. **L, new file**
- **Mk2 upgrade tier (was #21)** / **branching talents (was #24)** — extend
  `UPGRADES` with `next` pointers / mutually-exclusive paths. **L, data.js**
- **Cosmetic unlocks (was #22, #31)** — `COSMETICS` table + shop picker +
  `drawPenguin`/`drawGlider` reading the equipped skin. **L, shared**
- **New gear (was #23)** — Parachute / Radar / GPS Compass. **M each, per-module**
- **New landmark bosses (was #18)** — moving iceberg, penguin-rival wave. **L**
- **Ghost replay (was #20)** — record `run.trail`, render a translucent ghost. **M**
- **Night flights (was #17)** — every Nth day, reduced draw distance + glowing
  collectibles. **M, shared**
- **Cargo/passenger mode (was #16)** — pre-launch toggle, cash × for tighter
  g-limits. **M**
- **Local leaderboard / stat card (was #47)**, **challenge seed codes (was #48)**,
  **flight history panel (was #43)**, **lore collectibles + journal (was #55)**,
  **rival banter (was #56)**. Meta/replayability; mostly new panels.
- **Colorblind-safe palette audit (was #46 CSS half).** **S, HTML CSS**

## D. Technical / architecture

- **Unit tests for the pure physics functions (was #50)** — `derive()`,
  `buildRamp()`, `rampExitEst()`, `sampleShape()` are pure and test-friendly.
  Pick Vitest, wire `npm test`. **M, new**
- **Build/bundle step (was #52)** — esbuild/vite for minify+sourcemaps once the
  module count grows. **L, new; coordinate**
- **Performance pass (was #53)** — `draw()` allocation audit. Note: the
  cloud/ridge/collectible/obstacle loops *already* cull by screen bounds;
  landmark draw culls by x. Verify particle/trail loops and profile on mid-tier
  mobile. **M**

---

## Suggested swarm (per-component, parallel-safe)

Run **one agent per file**, all at once — the charters in §B are scoped so no
two agents touch the same file. Priority order if capacity is limited:

1. **`world.js`** — owns P0 #1 & #3 (the biggest fun-blocker). Start first.
2. **`data.js`** — P0 #2 & #4 + rebalance (pairs with world's numbers).
3. **`save.js`** — versioning + forward-looking default fields *unblocks*
   store/results/sound/render/html consuming new `state.*` fields.
4. **`physics.js`, `render.js`, `sound.js`, `store.js`, `hud-input.js`,
   `results.js`, `flightless.html`** — independent §B slates, any order.

The only cross-file touchpoints are the **reserved shared properties** in the
invariants (`sim.paused`, `state.musicMuted/settings/ngPlus`); everyone reads
them defensively, so ordering doesn't matter for correctness.
