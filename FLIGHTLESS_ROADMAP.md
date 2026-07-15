# Flightless Roadmap

Flightless is a Learn-to-Fly-style launch game at `pages/flightless.html`. The
sim is split into ES modules under `assets/js/flightless-*.js`. This doc is a
backlog of discrete, independently-startable jobs — bug fixes, rebalancing,
and new content — organized so a swarm of agents can each pick one up without
stepping on each other.

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

**Working conventions:**
- Each module is a `createXxx(deps)` factory — read `flightless-store.js` first, it's the cleanest example of the pattern.
- `sim.phase`/`sim.run`/`sim.ramp`/`sim.st`/`sim.particles`/`sim.speedLines`/`sim.timeSim`/`sim.W`/`sim.Hpx` are the shared mutable simulation state — read/write through `sim.x`, never take a local copy.
- `state` is the save-data object — always mutate it in place (`state.foo = x`), never reassign the variable, since every module holds its own reference from construction time.
- If a job needs a NEW cross-module function that doesn't exist yet, wire it through `pages/flightless.html`'s `bridge`/`call()` mechanism the same way `popup`/`burst`/`finishRun` are — don't invent a second wiring pattern.
- Jobs marked **(file: new)** create their own module — low collision risk, safe to parallelize aggressively.
- Jobs marked **(file: shared)** touch a file another job might also touch — coordinate or take them sequentially.

Size guide: **S** = an hour or two, **M** = a focused session, **L** = multi-session, **XL** = its own mini-project.

---

## P0 — Critical fixes (do these first)

1. **Fix the Wall's unwinnable hitbox.** `LANDMARKS.wall.h = 1300` in `flightless-data.js`, but altitude-farming (`cashAlt = maxAlt*0.3` in `flightless-results.js`) actively rewards climbing well past that, and a maxed rocket (`flightless-physics.js` `derive()`, `thrust: 10+8*L.rocket`) blows through 1300m almost immediately off the ramp. Endgame flight paths never intersect the Wall's collision band. Fix by raising the collision height substantially (or rethinking the check in `checkLandmarks()` in `flightless-world.js` to not gate on altitude at all — e.g. treat it as a full-height barrier), and playtest that a well-upgraded flight can actually connect. **(file: shared — data.js + world.js)** — **S/M**
2. **Let one flight deal more than one hit.** `checkLandmarks()` knocks the player backward out of the landmark's x-band on every hit, so realistically only one hit connects per flight against a 12,000 HP wall. Either soften the knockback so skilled players can grind multiple hits in one pass, or rework landmark damage into a "ram it and take an HP-vs-your-speed comparison" resolution instead of the current bounce-off. **(file: `flightless-world.js`)** — **M**
3. **Rebalance the late-game cash curve.** The final milestone (`MILESTONES` in `flightless-data.js`, `[35000, 100000]`) pays out enough to max the whole upgrade tree in a couple of flights, which is why the game "solves itself" the moment the rocket unlocks. Spread this payout across more/smaller milestones, or gate it behind actually destroying the Wall instead of just reaching its distance. **(file: `flightless-data.js`)** — **S**
4. **Add a "why didn't that work" signal.** When a flight passes near/through the Wall's x-band without dealing damage (wrong altitude, already destroyed, etc.), there's no feedback — it just silently does nothing. Add a popup/SFX cue ("flew over the Wall — dive lower!") so players can course-correct instead of being confused. Depends on job 1 landing first so the guidance matches the real mechanic. **(file: `flightless-world.js`)** — **S**

---

## Gameplay mechanics & balance

5. **Weather system.** Daily wind (headwind/tailwind/crosswind) that shifts the effective glide angle and drag; visualize with streaked cloud motion. New `flightless-weather.js` module, hooked into `stepFlight()` via an injected wind-force term. **(file: new)** — **L**
6. **Daily modifiers.** Each day rolls a flavor modifier shown in the shop ("Ice Day: −20% ramp friction", "Gusty: obstacles drift sideways", "Bounty Day: ×2 obstacle cash"). Reuses the existing deterministic-per-day hashing already used for contracts (`contractsFor()` in `flightless-data.js`) — same pattern, new table. **(file: `flightless-data.js` + `flightless-physics.js` hook)** — **M**
7. **Real stakes / a fail state.** Right now every flight "succeeds," just with less money — there's no tension. Consider a light risk mechanic: a "sponsor patience" meter that drops on bad flights and unlocks a bonus if kept full, or a hard-mode toggle where big obstacle hits cost cash instead of just a speed penalty. **(file: `flightless-results.js` + `flightless-world.js`)** — **M**
8. **Multi-hit combo unification.** Fish/star/ring combos currently share one `combo`/`comboT` counter in `flightless-world.js`; extend the combo chain to also count obstacle kills and landmark hits so a single "flow state" run feels more connected. **(file: `flightless-world.js`)** — **S**
9. **Weekly boss flight event.** A special one-per-week flight with a unique modifier set and a large one-time reward, tracked in save state (`state.lastBossWeek` or similar). Good candidate for a fully new module. **(file: new)** — **L**
10. **Style-based contracts.** Extend `CONTRACT_POOL` in `flightless-data.js` beyond quantity targets ("catch 5 fish") to style targets ("land 3 bounces in a row without sliding", "stay under 50m altitude for the whole flight"). Needs new tracking fields on `run` in `flightless-physics.js`'s `newRun()`. **(file: `flightless-data.js` + `flightless-physics.js`)** — **M**
11. **Rebalance pass on upgrade cost curves.** All upgrades currently use the same `base * mul^level` shape (`upgCost()` in `flightless-data.js`) with `mul` mostly 1.55 — a full economic pass (spreadsheet the cost-vs-payout curve for each upgrade line, tune outliers) would smooth out the "everything trivial after rocket" problem more holistically than any single numeric tweak. **(file: `flightless-data.js`)** — **M**
12. **Fuel/energy risk-reward.** Currently fuel just runs out and stops thrust. Consider an overheat mechanic for sustained afterburner-style play, or a "coast on fumes" bonus for landing with exactly 0 fuel. **(file: `flightless-physics.js`)** — **S**

---

## New mechanics

13. **Biome progression.** Segment the 35km flight into visually and mechanically distinct zones — Ice Sheet (0–2.5km) → Open Ocean (2.5–10km, water hazards/sharks) → Cloud Layer (10–20km, turbulence) → Stratosphere (20–35km, thin air, needs a new "pressure suit" upgrade to avoid a speed/control penalty). Touches `flightless-render.js` (backdrop per zone) and `flightless-physics.js` (per-zone force modifiers). **(file: shared — render.js + physics.js + new data)** — **XL**
14. **Drafting/formation flying.** Flying close behind a flock of birds (existing obstacle type) gives a drag-reduction bonus instead of just being a collision hazard — rewards precision flying instead of only avoidance. **(file: `flightless-world.js` + `flightless-physics.js`)** — **M**
15. **Fuel/boost pickups.** Floating balloon-like pickups (reuse the existing ring visual language) that refill fuel or grant a temporary speed boost, placed with the same deterministic-cell trick as coins/stars. **(file: `flightless-world.js` + `flightless-render.js`)** — **M**
16. **Cargo/passenger mode.** An optional "carry a chick" toggle before launch — bonus cash multiplier, but g-limit and stall margins are tighter. Adds a build-around choice, not just power creep. **(file: `flightless-physics.js` + `flightless-store.js`)** — **M**
17. **Night flights.** Every Nth day is a night flight — reduced draw distance, aurora backdrop, glow-in-the-dark collectibles worth more. Mostly a `flightless-render.js` reskin plus a small `flightless-world.js` value tweak. **(file: shared)** — **M**
18. **New landmark bosses.** The Wall is currently the only "real" boss; add 2–3 more with unique mechanics beyond "fly into it" — e.g. a moving iceberg that drifts along the x-axis, or a wave of penguin rivals you have to out-glide. Extend `LANDMARKS` and `checkLandmarks()`. **(file: `flightless-data.js` + `flightless-world.js`)** — **L**
19. **Post-Wall endgame content.** Right now beating the Wall just shows a "keep flying" screen. Add a second, harder wall/void at 2× distance, or a New Game+ with permanently harder obstacles and better rewards, so there's a reason to keep playing after the current win condition. **(file: `flightless-data.js` + `pages/flightless.html` victory flow)** — **L**
20. **Ghost replay.** Record your best flight's trail (`run.trail` already exists in `flightless-physics.js`) and render a translucent ghost penguin following that exact path on your next attempt, for a tight feedback loop on improving a line. **(file: `flightless-render.js` + `flightless-save.js`)** — **M**

---

## Upgrades & progression content

21. **Mk2 upgrade tier.** Once a player maxes an upgrade line, unlock a "Mk2" version with a new effect curve, gated behind a prestige resource (spend BP or a new currency). Extends `UPGRADES` in `flightless-data.js` with a `next` pointer to a follow-on upgrade definition. **(file: `flightless-data.js`)** — **L**
22. **Cosmetic-only unlocks.** Penguin skins/hats, ramp skins, trail colors — unlocked by medals, zero power effect, pure collection goal. New `COSMETICS` table plus a picker UI in the shop. **(file: `flightless-data.js` + `flightless-store.js` + `flightless-render.js`)** — **L**
23. **New gear items.** Parachute (guarantees a soft landing once per flight), Radar (obstacles render before they're normally visible), GPS Compass (shows distance-to-next-milestone in the HUD). Extends `GEAR` in `flightless-data.js`. **(file: `flightless-data.js` + relevant module per item)** — **M each**
24. **Branching talent choice.** At a few key unlock points, let the player choose between two mutually exclusive upgrade paths (e.g. "Speed Demon" vs "High Flyer" wing variants) instead of one linear line — adds replay variety across resets. **(file: `flightless-data.js`)** — **L**
25. **Rotating daily shop deal.** One random upgrade is discounted each day, using the same per-day deterministic hash already used elsewhere. Small, high-value addition to the shop's "reason to check in daily" loop. **(file: `flightless-data.js` + `flightless-store.js`)** — **S**
26. **Bonus-shop respec.** Let players refund bonus-shop levels for a partial BP refund, in case they want to try a different permanent build. **(file: `flightless-store.js`)** — **S**

---

## Graphics & VFX

27. **Weather particle layers** (snow drift, rain streaks, aurora ribbons) reusing/extending the existing particle system in `flightless-render.js`. **(file: `flightless-render.js`)** — **M**
28. **Landmark destruction VFX.** Currently a landmark death is one burst; give it multi-stage debris (chunks with their own simple gravity/tumble) for a real "boss kill" payoff. **(file: `flightless-render.js`)** — **M**
29. **Speed-based screen effects.** Motion blur / chromatic aberration ramping in at very high velocity or during afterburner use, purely as canvas post-processing in `draw()`. **(file: `flightless-render.js`)** — **S/M**
30. **Day/night lighting cycle** tied to `state.day`, shifting `skyColor()`'s palette gradually instead of the current fixed gradient. **(file: `flightless-render.js`)** — **S**
31. **Penguin customization rendering.** Once cosmetics exist (#22), `drawPenguin()`/`drawGlider()` need to read the equipped skin and vary the draw. **(file: `flightless-render.js`)** — **M** (depends on #22)
32. **Ramp/launch-site visual variety per biome/day modifier.** `drawRamp()` currently has one look; branch its palette/decoration off day count or biome. **(file: `flightless-render.js`)** — **S**
33. **Animated shop background.** The shop screen is static UI over a frozen camera view; add subtle ambient motion (waddling background penguins, drifting clouds) behind the panel. **(file: `flightless-render.js` + `flightless-store.js`)** — **S**
34. **Ramp designer visual upgrade.** The ramp-shape editor pop-over (`flightless-store.js`) is functional but bare — add shape presets (steep launch / long glide / trick ramp) as one-click buttons alongside manual dragging. **(file: `flightless-store.js`)** — **S**

---

## Audio & music

35. **Background music track(s)**, looping, with a separate music volume/mute control from the existing SFX mute. New lightweight synth loop or a licensed/CC track. **(file: `flightless-sound.js` + HTML controls)** — **M**
36. **Biome-specific ambience** (wind howl intensity, underwater-muffled tone near open water) layered under the music. **(file: `flightless-sound.js`)** — **M** (depends on #13)
37. **Richer SFX layering.** Current SFX is minimal procedural blips; add an engine-hum layer that pitches with speed, a distinct wing-flap sound tied to `drawPenguin()`'s flap animation, and impact variety by obstacle type. **(file: `flightless-sound.js`)** — **M**
38. **Penguin bark lines.** Short procedural or pre-recorded one-liners on milestones/crashes/medal pickups, toggled with SFX. **(file: `flightless-sound.js` + `flightless-results.js`)** — **S**

---

## UI/UX & accessibility

39. **Settings panel.** Volume sliders (SFX/music separately once #35 lands), reduced-motion toggle (disables camera shake/particle density), control remap for keyboard. New `#settings` panel matching the existing panel pattern in `pages/flightless.html`. **(file: shared — new panel + hud-input.js)** — **M**
40. **Onboarding pass.** The current intro is a single static screen; consider a short interactive first-flight tutorial that calls out controls contextually (first time pulling up, first stall, first bounce). **(file: `flightless-hud-input.js` + `pages/flightless.html`)** — **M**
41. **Shop stat projections.** Show a small graph/preview of projected distance or top speed vs. the next 2–3 upgrade levels, not just the immediate next level, so purchases feel more informed. **(file: `flightless-store.js`)** — **M**
42. **Save export/import.** The save is pure `localStorage` with no backup path — add a "copy save to clipboard" / "paste save" flow in the shop's reset area. **(file: `flightless-save.js` + `flightless-store.js`)** — **S**
43. **Flight history / stats page.** A new panel showing best runs over time, medals timeline, and simple charts (distance per day) — pure save-data visualization, no new gameplay. **(file: new panel + `flightless-save.js` read)** — **M**
44. **Pause menu.** There's currently no way to pause mid-flight; add one (space is already thrust, so probably a dedicated key/button) that freezes `sim.phase` stepping without losing state. **(file: `pages/flightless.html` main loop + `flightless-hud-input.js`)** — **S**
45. **Mobile touch control refinement.** Current touch controls are a bare four-button layout; consider a drag-to-steer gesture as an alternative, plus haptic feedback on supported devices for landings/impacts. **(file: `flightless-hud-input.js`)** — **M**
46. **Colorblind-safe palette audit + reduced-motion mode.** Check the existing navy/yellow/red palette against common colorblindness types, and ensure `--reduce-motion` respects `prefers-reduced-motion` for camera shake/particles. **(file: `pages/flightless.html` CSS + `flightless-render.js`)** — **S**

---

## Meta / replayability / social

47. **Local leaderboard / personal-best gallery.** Snapshot the top N flights (distance/speed/altitude) with a shareable stat card (canvas-rendered image) players can download. **(file: new)** — **M**
48. **Seasonal/rotating challenge codes.** A shop text field to enter a "seed" that regenerates a specific day's contracts/obstacles deterministically (the hashing is already seeded by day number, so this is mostly UI + a seed override). Lets players compare identical runs. **(file: `flightless-data.js` + `flightless-store.js`)** — **M**
49. **Achievement expansion.** `MEDALS` in `flightless-data.js` currently covers ~17 medals; there's a lot of headroom for more (biome-specific, weather-specific, style-run medals) once other systems land. **(file: `flightless-data.js`)** — **S, ongoing**

---

## Technical / architecture

50. **Unit tests for the pure physics functions.** `derive()`, `buildRamp()`, `rampExitEst()` etc. in `flightless-physics.js` are now isolated pure(-ish) functions — a great, low-risk first target for an actual test suite (no test infra exists yet; this job includes picking one — Vitest is a reasonable default — and wiring a `npm test` script). **(file: new test setup)** — **M**
51. **Save schema versioning.** `flightless-save.js`'s sanitization is currently ad hoc field-by-field patching; formalize with an explicit `state.version` and a migration function chain so future saves don't need more special-cased patch code appended forever. **(file: `flightless-save.js`)** — **M**
52. **Build/bundle step.** Currently raw ES modules with no bundler — fine for now, but a `esbuild`/`vite` step (minify + sourcemaps, kept as a build artifact checked into `pages/`) would help once the module count grows further. Coordinate with whoever's touching the most files, since it changes the dev workflow. **(file: new build config)** — **L**
53. **Performance pass.** Audit `draw()` in `flightless-render.js` for unnecessary per-frame allocations and off-screen draw calls (the cloud/ridge/collectible loops already cull by screen bounds — verify obstacle/landmark draws do too), profile on a mid-tier mobile device. **(file: `flightless-render.js`)** — **M**

---

## Narrative & flavor

54. **Expand milestone/headline flavor text.** `finishRun()`'s headline text in `flightless-results.js` currently has 5 tiers; add more variety per tier so repeat flights don't feel as repetitive. **(file: `flightless-results.js`)** — **S**
55. **Lore collectibles.** Rare, non-cash pickups along the flight path (reuse the golden-fish rarity pattern) that unlock short flavor snippets in a new "journal" panel — worldbuilding without any power effect. **(file: `flightless-world.js` + new panel)** — **M**
56. **Rival penguin banter.** If a rival/formation mechanic (#14) or race mode ships, give the rival penguin a few contextual lines (falling behind / overtaking you). **(file: `flightless-sound.js` + `flightless-world.js`)** — **S** (depends on a rival mechanic existing)

---

## Suggested first wave (if you want a starting slice)

A good initial swarm split, minimizing file collisions:
- Agent A: **P0 #1–4** (wall fix + feedback) — small, sequential, high impact, do this first regardless of what else runs in parallel.
- Agent B: **#5 Weather system** (new file)
- Agent C: **#27–30 render/VFX polish** (same file, one agent to avoid conflicts)
- Agent D: **#35–38 audio pass** (same file, one agent)
- Agent E: **#39, #43, #44 UI/UX additions** (new panels, low collision with gameplay work)
- Agent F: **#50 test infra** (fully new, zero collision risk, unblocks safer iteration on everything else)
