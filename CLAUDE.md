# Hardpoint

A MechWarrior II–inspired mech combat game for the browser: heavy, deliberate mechs, torso twist, heat management, hit locations, flat-shaded low-poly worlds. Modern additions: a mechlab for loadouts, mixed enemy types (mechs, tanks, aircraft, boats) and large battlefields.
Stack: **Three.js + TypeScript (strict) + Vite**, deployed to **GitHub Pages** at `/hardpoint/`. The local folder is `mechwar/`, but the repo and game are named `hardpoint`.

> This file is the cross-session memory. Read it first, keep it accurate, and update "Current state" and "Milestones" at the end of each milestone or session (delegate that to the `state-keeper` agent).

## Product decisions (from the user, 2026-10-19)
- **IP:** original mechs and names that pay homage to the classics, e.g. a reverse-joint heavy "Timberwolf-like" mech. **Never use BattleTech names or close replicas.**
- **Models:** procedural, built in TypeScript from primitives. A glTF loader with a node-naming convention comes later, so Blender models can replace the procedural ones.
- **Controls: modern scheme only.**
  - WASD moves relative to the legs.
  - The mouse aims the torso, which twists within limits.
  - The legs turn toward the aim at a limited turn rate.
  - Keys are rebindable (`src/core/input.ts`); gamepad support comes later.
- **Multiplayer: maybe later.** Single-player first, with a strict split between sim and render and serialisable state, so networking stays possible.
- **Art direction:** flat-shaded, chunky low-poly; vertex colours or a shared palette; strong silhouettes; atmospheric fog and a sky gradient; light bloom. Every model should read clearly at 300 m.

### Concept-art reference (user-supplied, 2026-10-19; a guide, not a strict rule)
The user loved the hills. The reference shows:
- **Lighting:** golden-hour sunset. A low sun near the horizon, an orange-to-purple sky with streaky clouds, and strong warm haze that fades distant layers.
- **Terrain:** a sandy basin ringed by tall rust-red canyon walls and stepped, flat-topped buttes with faceted near-vertical cliffs. Scattered boulders, olive low-poly shrubs, a winding dirt track.
- **Set dressing (later):** an outpost with a lattice radio tower, a radar dish and boxy buildings; low-poly dust puffs and smoke; missile trails.
- **Mechs:** chunky, boxy, olive drab with unit numbers ("01"); shoulder missile boxes; ~4 m wide.
- **HUD** (green #9dff9d-ish, translucent dark panels):
  - Top left: the game title and mission info. Top centre: a compass strip with heading.
  - Top right: an objectives checklist.
  - Bottom left: a damage diagram with per-location bars (HEAD/TORSO/L-R ARM/L-R LEG).
  - Bottom right: a weapon list with group number, name, ammo and cooldown bars, plus a speed readout and a vertical HEAT bar.
  - Red target brackets showing name and range.
- Palette tokens live in `src/world/desert/palette.ts` (`DESERT`).

## Architecture map
| Path | Role |
|---|---|
| `src/sim/` | Authoritative game logic. **No `three`, DOM or render imports** (ESLint enforces this). Fixed 60 Hz steps, seeded `Rng`, plain serialisable state. |
| `src/data/` | Data definitions: chassis, weapons, vehicles. Same no-`three` rule. |
| `src/world/` | Battlefield builders (terrain, biomes, props). Each returns a `Battlefield` (`src/world/types.ts`): `heightAt`, `spawn`, `radius`, `update`. |
| `src/render/` | Three.js side: `Stage` (renderer/scene/camera), camera rigs, procedural model builders, effects. Mirrors sim entities and interpolates between ticks. |
| `src/ui/` | HTML/CSS overlays: HUD, menus, later the mechlab. |
| `src/core/` | Shared plumbing: `FixedStepLoop`, `Input` (rebindable actions with latched presses), `params` (URL params). |
| `src/game.ts` | Wires world, stage, input, loop and camera rig. |
| `src/debug.ts` | `window.__game` test surface (`ready`, `errors`, `frames()`, `litFraction()`, `game`). |

### Mech model conventions (M2+)
- A hierarchy of rigid parts with **no skinning**: pelvis → legs (thigh, shin, foot; normal or reverse-joint) → `torso_twist` → torso → arms or pods → cockpit.
- Each part's pivot sits at its joint.
- Hardpoint nodes are named `hp_<location>_<n>`, e.g. `hp_ra_1`, `hp_lt_1`.
- Hit locations: `head, ct, lt, rt, la, ra, ll, rl`. Each owns its part nodes plus a bounding box for hit tests.
- Walking is code-driven: phase-based gait, foot planting, two-joint leg IK to the terrain, body bob.

## URL params (dev, tests, screenshots)
`?scene=desert|test|viewer&seed=<int>&mech=ironclaw|warden&cam=cockpit|chase|orbit|free&t=<seconds>&walk=<-1..1>&turn=<rad/s>&fire=<group mask>&mode=instant|range|none&pos=x,y,z&look=x,y,z&debug=1`
- `t` fast-forwards the sim **and the gait** to that time, then freezes, giving deterministic screenshots of walking poses.
- `walk`, `turn` and `fire` are a debug autopilot for the player. `fire=7` holds groups 1–3 and auto-aims at the nearest enemy, e.g. `scene=desert&fire=7&t=4` for a frozen firefight.
- `mode`: `instant` (Instant Action waves, the desert default), `range` (static/patrolling dummies, the test default), or `none` (the viewer default).
- `scene=viewer&mech=<id>` shows a model turntable on flat ground; the orbit camera starts at the mech's front-left.
- `pos` and `look` frame a free camera; y is the height above the terrain at that x,z. Useful views:
  - toward the sun: `pos=100,6,100&look=-600,30,-700`
  - aerial: `pos=-200,250,300&look=400,0,-200`
- Controls (full list in `DEFAULT_BINDINGS`, `src/core/input.ts`):
  - Click to lock the pointer. WASD moves, the mouse aims.
  - Fire groups: LMB/1 = group 1, RMB/2 = group 2, MMB/Q/3 = group 3, 4–5 = groups 4–5. F = alpha strike.
  - Mouse wheel selects a group; T toggles chain fire for it; Tab opens group config (arrows + 1–5).
  - E = target, O = override, C = coolant, R = redeploy after death, M = mute.
  - V = cockpit/chase view (cockpit is the default), F1 = free camera (F1 again returns to the last piloting view), F3 = stats.

## Commands
- `npm run dev`: dev server at http://localhost:5173/
- `npm run verify`: type-check, lint, unit tests (Vitest), build, e2e smoke test (Playwright). **This must pass before saying work is done.**
- `npm run shot -- --view "scene=desert&cam=orbit&t=3" [--view ...] --name foo`: saves PNGs to `shots/`. Read them to judge visuals.
- `npm run e2e`: Playwright smoke test against `vite preview` (base `/hardpoint/`).
- Individual steps: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Claude workflow
- **Hooks** (`.claude/settings.json`):
  - `PostToolUse`: `tsc` after every `.ts` edit. Errors block until fixed.
  - `Stop`: `npm run verify` if sources changed since the last green run (hash stored in `.claude/.verify-hash`). If it's still failing on the second stop, report the failure honestly.
- **Agents** (`.claude/agents/`). Delegate routine, well-specified work to save tokens:
  - `test-runner` (Haiku): runs checks and summarises failures.
  - `state-keeper` (Haiku): updates this file's state and checklist sections.
  - `model-builder` (Sonnet): builds a procedural model from a precise spec and checks it with screenshots.
  - `visual-qa` (Sonnet): screenshot review against a spec.
  - Keep architecture, the sim core, controls feel and gameplay tuning in the main (Opus) session.
- **Visual iteration:** never guess how something looks. Take a shot and read the PNG.
- Headless WebGL uses the system Chromium (`/usr/bin/chromium`; override with `CHROMIUM_PATH`) with SwiftShader (`scripts/browser.ts`). CI uses Playwright's bundled Chromium. `SHOT_GPU=1` tries hardware GL.

## Conventions
- Units: metres, seconds, radians. +Y is up. A mech's forward is −Z in local space.
- Strict TypeScript, ES modules, no default exports, `import type` for types.
- Sim code: no `Math.random()`. Use `Rng` / `world.rng.fork(salt)`.
- Reuse geometry and materials (shared palette) and instance repeated props.
- Unit-test sim logic (damage, heat, IK, terrain sampling) in `tests/unit/`.

## Milestones
- [x] **M0 Scaffold & workflow:** Vite/TS/Three; ESLint, Vitest, Playwright smoke test; shot tool; hooks; agents; CI and Pages workflow
- [x] **M1 Desert world:** chunked noise terrain (dunes, mesas, canyons), instanced rocks, sky, fog, lighting, bloom, free camera
- [x] **M2 Player mech:** builder, two chassis (reverse-joint heavy, standard medium), IK walking, modern controls, cockpit and chase cameras, basic HUD
- [x] **M3 Combat:** lasers, PPC-style weapon, autocannon, SRM/LRM; weapon groups; heat and shutdown; ammo; hit locations and armour; damage visuals; limb loss
- [x] **M4a AI & Instant Action:** combat AI for mechs, nav grid with A*, Instant Action waves, objectives panel, radar
- [ ] **M4b Vehicles:** tanks and turrets (needs a generalised unit model), more mission types
- [ ] **Jets (after M4, user-requested 2026-10-19):** boost jets for bursts of speed; jump jets for jumping and short flight. They feed the heat system.
- [ ] **M5 Urban map:** procedural city, destructible buildings, close-quarters AI
- [ ] **M6 Air & sea:** VTOLs, planes, hovercraft, boats, water
- [ ] **M7 Mechlab:** loadouts with tonnage, slot and heat checks, saved locally; more chassis
- [ ] **M8 Polish & scale:** procedural Web Audio sound, gamepad, settings, LOD and terrain streaming, AI update rates for distant units

## Current state
- M0–M3 and M4a are done. `npm run verify` is green: 76 unit tests and 5 e2e tests.
- **AI** (`src/sim/ai/mechBrain.ts`): deterministic and issues normal `MechCommand`s (no cheating).
  - Picks the nearest enemy (radar knowledge) with sticky targeting.
  - Closes to a loadout-derived preferred range (`preferredRange`), then circle-strafes; backs off when too close.
  - Leads projectiles, with aim error by skill that shrinks while tracking.
  - Fires only with line of sight and the torso on target. Respects its heat limit and uses coolant.
  - Pilot ranks: `PILOTS` green / regular / veteran.
- **Navigation** (`src/sim/nav/navGrid.ts`): a 10 m grid of per-cell grades, built lazily via `world.nav`; A* with no corner cutting; string-pulled paths. The AI steers straight when the next 25 m is clear, otherwise follows a path to a goal on its preferred-range ring.
- **Mission** (`src/sim/mission/instantAction.ts`): escalating `WAVES`, then repeating with veterans and growing. Spawns are 550–800 m away on flat open ground; 10 s between waves; fails when the player dies (R reloads).
- **HUD:** objectives panel at top right (concept-art style), radar at bottom centre (rotates with the view; shows the legs heading), mission-failed screen. The FPS counter moved under the title.
- **Performance:** mech paint is baked into vertex colours (`mergeByMaterial` in `kit.ts`): one mesh per joint plus emissive parts. That's about 40% fewer draw calls (a single mech went from 97 to 51).
- **Fix:** mech movement measures climbable grade over a 4 m look-ahead (`LOOKAHEAD` in `mech.ts`), so mechs step over small bumps instead of sticking on them.
- **Cockpit-first:** the cockpit is the default view (user request). F1 and respawn return to the last piloting view (`pilotMode` in `game.ts`).
- **Giant gait** (`src/render/mechs/gait.ts`): cadence-driven. Feet alternate on a beat of `stride / speed` (clamped to `minInterval..maxInterval`). A planted foot stays down only while the body passes within ±`reach` of it, so at speed each swing outlasts the beat and the mech bounds with a flight phase (Ironclaw at 64 km/h: a footfall every 0.68 s, 12 m strides, ~32% airborne; it was 0.36 s steps). The body arcs (peak mid-flight, trough mid-stance, tuned by `leap`), and a slow landing spring (`impact`) compresses it. `MechView.maxHipY` lowers the pelvis so a planted leg can always reach its foot, eased so it never jumps (the cockpit rides on it). Swing motion uses a Hermite curve that lifts off at body speed and lands at zero velocity. A planted foot is forced to lift once it trails by its reach, and swings in flight re-time to the current speed; without this, accelerating from a walk left a leg 7 m behind and the body squatted to reach it (`tests/unit/mechView.test.ts` guards it).
- **Hit reaction ("reel")** is in the sim (`Mech.hitReaction`, `MechKinematics.reel*`/`knock*`, `HIT_REACTION` in `combat.ts`). Each hit adds a torso jolt on an underdamped spring (pitch back, twist on side-torso hits, lean away) plus knockback, scaled by damage, delivery type and 50/tonnage. Missiles slam (large per-damage impulse, all at once), shells and PPC bolts knock, beams push steadily over the burn. The reel offsets the aim ray and torso cone, for the AI too. Render: torso nodes apply the reel and the cockpit camera inherits it. Screen shake now comes only from missile, shell and MG impacts, not lasers.
- **Repo:** https://github.com/staudt/hardpoint (public, branch `main`). **Live build:** https://staudt.github.io/hardpoint/, deployed by `.github/workflows/deploy.yml` on every push to `main` after CI passes. The user approved committing and pushing on 2026-10-20; still confirm before force-pushes or other destructive git operations.

## Next steps
1. **Get the user's feedback** on the new giant gait (cadence, leap height, landing jolt), hit reel strength, and the cockpit-first view; then AI difficulty and wave pacing.
2. **M4b vehicles:**
   - Generalise the unit model: per-chassis location sets, `movement: 'legs' | 'tracked' | 'static'`, 360° turrets. Then tanks (hull/turret/track locations; tracks destroyed = immobile) and turrets (static, for outpost defence).
   - Vehicle AI (hull-down, kiting); mixed waves.
3. **Mission variety:** an outpost assault (destroy the ammo depot, reach extraction, as in the concept-art objectives) using set dressing such as a radio tower and radar dish.
4. **Backlog:**
   - Jets milestone.
   - Heavy kinetic weapons and melee (`docs/design/ideas.md`).
   - Climbable paths up buttes; unit decals.
   - Arm pitch, cockpit interior (now the main view, so higher priority), footfall dust.
   - Removing old wrecks after a while (perf in long sessions).

## Known issues
- CI notice: the actions/checkout, setup-node and upload-artifact v4 actions target Node 20, which GitHub now forces onto Node 24. They still work; bump the action major versions when convenient.
- `vite build` warns that the chunk is about 580 kB (Three.js). Acceptable for now.
- Distant canyon wall tops are still slightly jagged from LOD aliasing. Max-filtered sampling for coarse LODs would fix it if needed.
- Draw calls: one mesh per chunk LOD. Merge them if performance requires.
- Shrubs read very dark when backlit by the low sun.
- Project subagents (`.claude/agents/`) load only at session start. Mid-session, a `general-purpose` agent with `model: sonnet` plus "read `.claude/agents/<name>.md` first" in the prompt works as a stand-in (that's how the Warden was built).
- Software WebGL in headless Chromium runs at 1–5 FPS; ignore its FPS numbers. Real-GPU performance is still unmeasured.

## Decisions log
- 2026-10-19: TypeScript pinned to ~6.0 because typescript-eslint supports <6.1 and TS 7 isn't supported yet.
- 2026-10-19: no physics engine at first. Custom heightfield, spatial hash and raycasts; Rapier may come later for debris only.
- 2026-10-19: `PCFSoftShadowMap` was removed in three r186, so we use `PCFShadowMap`.
- 2026-10-19: the smoke test checks pixels via `Stage.litFraction()` (synchronous `readPixels` after render), because canvas `drawImage` is blank without `preserveDrawingBuffer`.
- 2026-10-19: terrain heights live in `src/sim` because gameplay needs them; render only builds meshes from them.
- 2026-10-19: discrete plateau levels instead of continuous terracing. This guarantees flat butte tops; the continuous version produced spires.
- 2026-10-19: modern controls in practice: the chase camera follows the *desired* aim while the torso lags at its twist rate; the HUD shows both the crosshair (aim) and the torso reticle (where the weapons actually point). The cockpit camera is rigidly attached to the torso.
- 2026-10-19: the gait is render-only (visual). The sim never depends on foot positions, which keeps it deterministic and network-friendly.
- 2026-10-19: the user approved the combat design (`docs/design/combat.md`): energy costs heat, ballistics and missiles cost ammo; shutdown override; coolant built in for now (later a mech part); no mid-mission resupply; BattleTech-scale numbers.
- 2026-10-19: hit detection uses chassis-data boxes (torso and legs frames), not render meshes, which keeps the sim deterministic and headless.
- 2026-10-19: visual effects use `Math.random` (render-only); the sim always uses `world.rng`.
- 2026-10-19: third-person aiming casts the aim ray from the **camera** (`src/controls/aim.ts`, `aimFromCamera`) and points the mech's eye at the hit point. The torso reticle is a raycast along the real torso facing. This fixed crosshair/reticle parallax the user reported; `tests/unit/aim.test.ts` guards it. The cockpit uses the look angles directly, since the camera is at the eye.
- 2026-10-19: missile heat lowered at the user's request (ammo is their cost): SRM-6 4→2, LRM-15 5→2.
- 2026-10-20: AI pathfinding uses a coarse nav grid plus A* (`NavGrid`) rather than local wall-following, which dithered at butte faces. It's reusable for tanks and urban maps.
- 2026-10-20: game modes via the `mode` URL param (`instant`, `range`, `none`), replacing `dummies`.
- 2026-10-24: the cockpit is the default view (user: prioritise the cabin view over external).
- 2026-10-24: the user wants giant, leaping strides at the same speed: a cadence gait with a flight phase, slower steps, heavier landings. Gait tuning per chassis: `reach`, `stride`, `minInterval`/`maxInterval`, `stepHeight`/`leapHeight`, `bob`/`leap`, `sway`.
- 2026-10-24: hit reactions live in the sim (deterministic, they affect aim) rather than being camera-only: missiles reel you back like an explosion, lasers push gently.
