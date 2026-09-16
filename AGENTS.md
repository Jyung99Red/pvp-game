# AGENTS.md

## Line endings

Line endings are enforced by `.gitattributes` (`* text=auto eol=lf`): the repo
stores LF and checks out LF everywhere, Windows included. No manual handling is
needed — edit files normally (full-file rewrites included). Git normalizes to
LF on commit, so a whole-file CRLF/LF flip can never sneak into the diff.

## Architecture

Browser vanilla-JS idle/action RPG. No bundler, no modules — plain global-scope
`<script>` tags loaded in manifest order by `core/client_boot.js`; views are fetch-loaded HTML
partials mounted at startup. Serve over http (partials use `fetch`, `file://`
won't work): `python -m http.server 8422`.

### Directory layout

Files are grouped by domain, not by layer — `core/` (shared state, stat/effect
registries, save, tick, shared combat rules), `ui/` (shared non-battle
UI: base view, fx, icons), `pve/` (PVE engine + its battle UI), `pvp/` (PVP
engine, network, room flow, its battle UI). `index.html`, `style.css`,
`partials/`, and `icons/` stay at the repo root — `fetch()` calls for partials
and icon SVGs resolve relative to the document, not the script file, so they
are unaffected by which subfolder a `.js` file lives in.

### Script load order (client-assets.json)

`game_config.js` → `core/data.js` → `core/effects.js` → `core/save.js` → `core/player.js` →
`core/tick.js` → `ui/fx.js` → `core/combat_rules.js` →
`core/arena_effects.js` → `ui/icons.js` → `ui/ui.js` → `core/spatial_combat.js` → `core/combat_gestures.js` →
`pve/spatial_data.js` → `pve/spatial_engine.js` → `core/spatial_profiles.js` → `pve/pve_profiles.js` →
`core/combat_settings.js` → `ui/combat_input.js` → `ui/ui_spatial_battle.js` → `pve/ui_adventure.js` → `pve/adventure_world.js` → `pve/pve_logic.js` → `core/client_dependencies.js` (lazy PeerJS) → `pvp/spatial_duel.js` → `pvp/pvp_logic.js` → `pvp/pvp_net.js` →
`pvp/pvp_room.js` → `pvp/ui_pvp.js`

### Core systems

- **`game_config.js`** — the single editable source for gameplay/balance values,
  including growth, combat resources/damage, input, skills, arenas, enemy moves,
  equipment and content tables. Comments are English and document units/overrides.
- **`core/data.js`** — live state plus a mutable runtime copy of configured content.
  `state.progress` is permanent world progress (saved): `currentRegionId`,
  `unlockedRegions` and `defeatedBosses`, which is what keeps a defeated boss dead.
  `state.world` is transient view state (not saved); `world.arrivalFrom` records the
  region just left so the next scene build can land the player beside the way back.
  Rewards bank on victory — there is no at-risk run purse any more.
- **`core/combat_rules.js`** — shared weapon thresholds, default AP/parry window and focus-based AP/SP recovery. Spatial engines own damage and simultaneous-attack judgment.
- **`core/arena_effects.js`** — battlefield-effect registry + per-battle
  runner, pure logic. Effects change the environment over time rather than
  either side: built-ins are `ap_surge` (past `atMs` both sides' AP recharges
  `apRateMult`× faster) and `burning_ground` (from `startMs`, every
  `intervalMs` both sides take `pct` of own maxHp). Wired into PVE only:
  `content.enemies[key].arena = ['key' | {key, ...opts}]` (currently the two
  bosses), instantiated per-fight via `arenaEffects.create()`, driven by
  `arenaEffects.tick()` in `pve_logic._loop`, which applies the returned
  log/damage events itself (same death priority as attacks).
- **`pve/pve_logic.js`** — adventure lifecycle: region travel and exit gating
  (`requiresBoss`), encounter start, rewards and skill points.
  `state.pveBattle.spatial` owns combat HP and time; `player`/`enemy` reference its
  actors. Fixed 10ms substeps drive the shared engine and arena adapter (seconds to
  milliseconds only here). Defeat wins simultaneous deaths; settled/ended guards
  prevent duplicate rewards. A boss clear writes `defeatedBosses` + `unlockedRegions`
  and saves immediately, which is what opens the next region. `enterDungeon()`
  survives only as a dev/test shortcut that starts one B-area encounter.
  `_beginFight` forks on `adventureWorld.isActive()`: with a live region scene the
  fight is enlisted in region space at the monster's own position, otherwise the
  legacy arena stands in unchanged. An enlisted fight carries `home`/`leash`/
  `alertRange`, and `advance` ends it with `_onDisengage` when the enemy is past
  its leash and out of alert range — no rewards, no overlay, `world.status` back
  to `exploring` (miss that and every later encounter stays blocked). The rule
  mirrors adventure_world's own so territory feels the same on both sides.
  **`advance` ends by calling `_present`**, so both drivers render — the page
  adapter's single rAF and the scene-less fallback loop in `_loop`; nothing else
  may call `_present`, and `_loop` is the ONLY loop `_beginFight` may start. An
  enlisted fight is handed back with `_returnToField`, which swaps the shared view
  back to the walking preset instead of switching tabs.
- **`pve/adventure_world.js`** — the walkable region simulation, owning no DOM and
  no combat rules: it steps a body, moves monsters, and turns a physical overlap
  into a `pveLogic` request. The player IS a spatial actor (`scene.field.player`),
  advanced with `spatialEngine.advanceActor` on the solo region preset, so walking
  uses the same movement, gear motion multipliers and gestures a fight does; a solo
  preset never banks SP and never converts a resting thumb into a charge.
  Monsters patrol inside `patrolRadius`, chase inside `alertRange`, disengage past
  `leash`, and trigger a fight only at `encounterRange`; a boss is just a monster
  with `boss: true` and `patrolRadius: 0`. `stepWorld` runs in BOTH modes — the
  world stays alive under a fight — so `_updateMonsters` carries the
  `state.pveBattle.active` guard that stops a second engagement, while exits are
  skipped because it is the walking body that triggers them.
  Exits are physical portals, and arrivals spawn `ARRIVAL_OFFSET` from the portal
  leading back.
  Gates and the player both carry a facing (`portal.angle`, `playerSpawn.facing`,
  radians, 0 = +x). A gate's `angle` is the direction it leads — its `in` — drawn as
  an arrow at its mouth, and an unauthored gate is assumed to lead out of the region.
  That one number drives both the arrow and where arrivals land: a return trip
  emerges on the far side of the gate leading back, facing the reverse of that gate's
  `angle`. Taking the reverse is what keeps an outward-facing gate from spawning
  arrivals off the map edge; a gate authored facing inward falls back to the outward
  bearing so the arrival never lands on its own trigger. The facing tests read the
  heading straight off the drawn geometry, so the fake ctx implements a real
  transform stack.
  `enlist(enemyId, mapEntityId)` builds a fight at the monster's live position and
  sends every other chaser home, so nothing hovers at `encounterRange` and chains
  a second fight the moment the first ends; `endCombat` hands the region back,
  walking a disengaged monster home from where the fight actually left it, and
  `resumeField` rebuilds the walking engine at wherever the fight left the player
  rather than reusing one parked mid-charge. `worldLayer(ctx, view)` is the region
  drawer the shared view calls instead of its default arena; it works in absolute
  world coordinates and the view supplies the transform. `scene()` is a read-only
  view for the adapter and tests.
- **`pve/spatial_engine.js`** — shared training/formal engine. Inject preset and
  RNG with `create(config, random)`. Formal profiles add defense, crit, thorns,
  charge thresholds, AP regen and skills; training keeps its baseline parameters.
  A preset marked `solo` carries no enemy: `validate` and `create` skip the enemy
  body, `step` advances the player and returns, `advanceActor` swallows the strike
  callback, and SP never accrues — walking must not bank skill points.
  Overlapping bodies are NOT an error: `create` pushes them apart on its own clone
  with `spatialCombat.separate`, and only throws when the arena cannot hold both.
  That keeps `validate` free of the side effect of moving a caller's actors.
- **`pve/spatial_data.js` / `pve/pve_profiles.js`** — explicit action templates
  for every enemy and stat/equipment adapters. Never use legacy dmgMult for timing.
  `region(def)` builds the solo walking preset; `enemy(def, id, data, {radius,
  speed})` re-homes an enemy into a region. `create` keeps its legacy 510x566
  arena for the scene-less dev/test path.
- **`ui/combat_input.js` / `ui/ui_spatial_battle.js`** — shared input capture and
  read-only view. Region DOM IDs use `adv-s-`; PVP uses `pvp-s-`; training uses
  unprefixed IDs. `create(root, C, prefix, options)` takes `canvasId` and a `layer`
  world-drawer; `canvasId` is a full, UNPREFIXED id (`adventure-world`), unlike
  every other lookup.
  A camera carrying `zoom` (world units per CSS pixel) pins the scale and derives
  the visible window from it, so walking and fighting share one world-to-screen
  mapping and entering combat cannot zoom; without it the fixed window is fitted
  as before, which is what PVP and training still do. A camera may also state its
  own window insets (`top`/`bottom`/`inset`), which is how a region view paints the
  whole canvas instead of inheriting the fullscreen HUD strip — and why
  `#view-adventure` must NOT carry `spatial-fullscreen`, since that class would
  otherwise derive `worldTop` from `.vitals`, which is hidden while walking.
  `useConfig(C)` swaps which preset the view reads (walking preset, then the fight
  preset) without touching the DOM or the camera. A solo snapshot renders with the
  enemy half of the HUD and the offscreen hint simply absent.
- **`pve/ui_adventure.js`** — region page adapter and the single owner of the
  region's rAF, view, input group, combat settings and DOM. Per frame it steps the
  world, then either advances the fight or presents the walk — one loop for both
  modes, which is what removes the cut. `mount`/`unmount` are per region session
  and re-entry reuses the scene, so `combatInput.attach` happens once and never per
  fight (it has no handled flag; a second live group would double-dispatch every
  gesture). See the merge section below.
- Formal PVE has one implementation; the legacy fallback and its URL selector were
  removed after user acceptance.
- **`pvp/pvp_logic.js`** — WebRTC PVP on the same core. Host is the sole judgment
  authority; Guest predicts local input and reconciles authoritative snapshots.
  `spatial_duel` resolves simultaneous spatial attacks using simulation time;
  spatial clash remains deferred.
- **`core/player.js`** — stat aggregation from equipment via `STAT_REGISTRY` /
  `EFFECT_REGISTRY` (defined in `effects.js`), equip/craft/buy actions, and
  derived combat getters that feed the profiles: `getChargeThresholdMs`
  (`gameConfig.resources.chargeThresholdMs` + the equipped weapon's own
  `chargeOffsetMs`, clamped; no discrete light/heavy template) /
  `getParryWindowBaseMs` (first equipped shield wins), `getCritChance`
  (luck 1%/pt + `crit_chance` effects), `getGuardThorns`, `getApMax`. **Weapon
  enhancement**: `enhanceItem(itemId)` spends gold for +1..+5 on weapons/shields
  (+10% atk/def per level); levels live in `state.inventory.enhance[itemId]`
  (shared across all copies) and fold into `getStats()`.
- **`core/effects.js`** — registries. Adding a new item effect type = one entry
  here (display `label`, plus `apply` only for multiplicative buffs);
  combat-timing / stat-flag effects (crit_chance, guard_thorns, ap_max_bonus,
  parry_window_ms) are read directly by the `player.js`
  getters above.
- **`core/save.js`** — localStorage persistence. Saved: resources / inventory
  (incl. `enhance`) / base / player / progress. Never saved: world, pveBattle,
  pvpBattle.
- **`core/tick.js`** — 1s interval: game clock, passive/hot-spring HP regen.
  During active spatial PVE, the engine owns regen; tick heals only base/choice states.
  Building production is generic over `content.buildings[*].baseProduce`
  (currently none produce anything — gold comes from combat).
- **UI** — `ui/ui.js` (base view, modals, buildings, and the base item UIs:
  equip slots — an empty slot opens the backpack — the backpack grid, which
  lists currently-equipped items first tagged 已装备, and the shop/smithy as
  4-col grids of materials/equipment whose cells open a detail/buy/craft popup
  reusing `#modal-overlay`), `pve/ui_adventure.js` (region session adapter) / `pvp/ui_pvp.js` (original
  per-frame PVP renderer); both read their own battle state, `ui/fx.js` (CSS-class animation triggers + battle log lines,
  incl. `pvpChargeFlash`), `ui/icons.js` (inline SVG icons).

### The region view: walking and fighting are one view

A region fight happens INSIDE the region rather than replacing it. `#view-adventure`
is the only place the world is drawn, and `uiAdventure` owns the single rAF, the
single `uiSpatialBattle` instance, the single `combatInput` group and the single
`combatSettings` handle for the whole region session:

```
uiAdventure._frame (one rAF)
  ├─ adventureWorld.stepWorld(dt)   always: patrols keep moving under a fight
  └─ fighting → pveLogic.advance(dt)        → view.render(fight engine)
     walking  → uiAdventure.updateFrame()   → view.render(solo engine)
```

Entering combat is a config swap, not a teardown: `enlist` builds the fight at the
monster's live position, `view.useConfig(fightConfig)` retargets the same canvas,
camera and pads, and a `walking` class on the root hides the fight-only HUD group
(`.vitals`, `.legend`, enemy state, clock). Leaving a fight is the same swap back
plus `adventureWorld.resumeField()`. The camera is deliberately carried across —
both presets carry `gameConfig.adventure.camera`, and the player body does not move
at the swap, so there is nothing to jump.

The consequences to keep in mind when editing any of it:

- The walk is stepped with `advanceActor` on a `solo` preset, never `step`: `step`
  would resolve a pad tap against a null enemy. Solo also never charges and never
  banks SP.
- The 3 pads are the ONLY movement control in both modes; the canvas is not an
  input surface.
- `pveLogic._loop` is the scene-less dev/test fallback only. Two live loops would
  double-advance the same fight.
- PVP and training share `uiSpatialBattle` and `combat_controls.css` but keep their
  own roots, prefixes, fixed positioning and per-frame lifecycles — nothing here
  changes them. `pve/training.css` is loaded only by `training.html`, but
  `combat_controls.css` is loaded by both, so its `.training`-prefixed rules are
  shared and the training-page-only ones are scoped with `body >`.

### Testing notes

- Run `node --test tests/spatial-engine.test.cjs tests/pve-spatial.test.cjs
  tests/adventure-world.test.cjs tests/region-combat.test.cjs` for focused training
  and formal PVE regressions. Browser and real-device QA complement them.
  `region-combat` drives the merged loop by hand (the adapter is stubbed out), so
  each of its frames steps the world and then advances any live fight — the same
  order the real adapter uses. `adventure-world` drives `stepWorld` directly and
  renders through the REAL shared view, because its facing tests read a heading off
  drawn geometry and only the real transform tells the truth.
- Background/hidden tabs pause `requestAnimationFrame`, freezing battle loops
  in automated preview environments. Workaround: monkey-patch rAF to
  setTimeout at runtime (`window.requestAnimationFrame = cb =>
  setTimeout(() => cb(performance.now()), 16)`) before starting a fight, then
  drive real time with waits.
- The dev http server sends no cache headers, and the browser aggressively
  caches JS/partials — after editing files, verify the browser actually loaded
  the new version (fetch with `cache:'no-store'` and compare) before debugging
  "bugs" that are just stale scripts.
- `node --test <files>` spawns child processes; where a sandbox blocks that
  (`spawn EPERM`), run each file directly (`node tests/pve-spatial.test.cjs`) —
  same tests, same counts.


## Current state

- PVE spatial migration is closed and PVP runs on the same shared engine
  (`pve/spatial_engine.js` + `core/spatial_profiles.js`); no legacy exchange
  implementation, side-state or rule registry remains in the tree.
- PVP carries a protocol version and a rule version, and the arena layout is
  versioned too (`pvp/pvp_logic.js`, `gameConfig.pvpArena`). Any balance change
  that alters what both clients must agree on needs a version bump.
- Training is an isolated entry (`training.html`) with its own arena and baseline;
  it shares neither saves nor battle state with the formal modes.
- **Tunable numbers live in `game_config.js` only.** This file describes structure,
  ownership and intent on purpose: it does not repeat values, because duplicated
  numbers drift. Read the config or the owning module before quoting a value.

## Settled decisions (do not re-litigate)

Confirmed by the user directly — change them only when asked to:

- Four skills are fixed: heal (up), haste (right), full charge (down), parry (left).
  Costs, durations and multipliers live in `gameConfig.skills` + `skillOverrides`.
- Manual parry spends AP; the parry *skill* spends SP. The two are independent.
- The user settled the player attack timings and the guard/charge movement
  multipliers; treat `gameConfig.training` as their current values, not as a
  baseline to re-tune on your own.
- Defaults are `controls.cancelAtCenter = true` and `controls.autoFace = false`:
  idle keeps facing, movement turns toward its own vector, and light/guard startup
  never snap toward the enemy.
- A held movement pointer must never be converted into a tap. A direct hit clears
  only right-hand input and the queued command; stun stops movement without
  dropping the held move gesture, which resumes when stun ends.
- The camera follows by translation only and never changes world inputs, damage or
  snapshots. The PVP guest's fixed 180-degree view is presentation only, so guest
  input vectors are rotated back before prediction/networking while skill
  directions stay screen-relative.
- PVP never writes progression, passive healing or adventure rewards, and fair mode
  reads no equipment effects at all.
- Every enemy action template owns its own timing (`pve/spatial_data.js`); never
  reintroduce a legacy damage-multiplier timing path.
- Weapon charge timing is data-driven: one `chargeOffsetMs` per weapon in
  `game_config.js`, resolved by `combatRules.weaponChargeThresholdMs()`.

## Open work

- **Adventure world** — the dungeon→region conversion replaced floors and runGold, so
  old save fixtures still carry `checkpointFloor` only to prove the v1 migration drops
  it. Arrival points, gate facings and pad walking are covered by
  `tests/adventure-world.test.cjs`; the rest of the world layer is not, and region
  D has no boss or goal yet.
- **Fleeing next to a monster's home re-engages instantly.** `returnFromCombat`
  teleports the monster home on a flee, and a monster standing on its own home
  post re-aggros the player the moment the region resumes. Reachable in normal
  play (walk up to a patrolling monster, flee). Predates the merge; unchanged by
  it. Needs a decision — a post-flee grace window, or walking the monster home
  instead of teleporting it.
- **Spatial clash (stage C)** — explicitly deferred and still required: PVP
  resolves simultaneous attacks, but clashing weapons are not resolved yet.
- **Real-device QA** — mobile foreground recovery, rotation and the rare
  device-specific CSS loss were never reproduced, and two-device mobile/network
  PVP playtesting is outstanding. Do not report these as verified.
- **Presentation leftovers** (no task doc anymore — track them in code): closer
  camera zoom, per-mode arenas, skill parameter separation for future PVE
  upgrades, simulation/render scheduling, guard-tapping stutter, side-held
  weapon/shield animation, offscreen hints.
- **Silver sword** — the charge-offset mechanism is ready, but the weapon is not
  in `content.items` because its attack value, effects and recipe were never
  chosen.
