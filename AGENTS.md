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
registries, save, tick, the shared combat resolver), `ui/` (shared non-battle
UI: base view, fx, icons), `pve/` (PVE engine + its battle UI), `pvp/` (PVP
engine, network, room flow, its battle UI). `index.html`, `style.css`,
`partials/`, and `icons/` stay at the repo root — `fetch()` calls for partials
and icon SVGs resolve relative to the document, not the script file, so they
are unaffected by which subfolder a `.js` file lives in.

### Script load order (client-assets.json)

`core/data.js` → `core/effects.js` → `core/save.js` → `core/player.js` →
`core/tick.js` → `ui/fx.js` → `core/combat_resolver.js` →
`core/arena_effects.js` → `ui/icons.js` → `ui/ui.js` → `core/spatial_combat.js` → `core/combat_gestures.js` →
`pve/spatial_data.js` → `pve/spatial_engine.js` → `pve/pve_profiles.js` →
`core/combat_settings.js` → `ui/combat_input.js` → `ui/ui_spatial_battle.js` → `pve/ui_pve.js` → `pve/pve_logic.js` → peerjs (CDN) → `pvp/pvp_logic.js` → `pvp/pvp_net.js` →
`pvp/pvp_room.js` → `pvp/ui_pvp.js`

### Core systems

- **`core/data.js`** — all state + static config. `state` (live game state) and
  `content` (items / materials / recipes / enemies / floorPools / bossRotation /
  buildings / shopPrices / slotMeta). `state.progress.checkpointFloor` is
  permanent dungeon progress (saved); `state.world` is transient in-run position
  (not saved), including `world.runGold` — gold earned this run, at risk until
  banked (see run-gold below).
- **`core/combat_resolver.js`** — pure exchange core for PVP; formal PVE profiles reuse its AP recovery helper:
  `pvpConfig` timing constants, side-state factory (`_makeSideState(maxHp, apMax)`),
  charge-damage lerp (threshold→2000ms, 0.3x→1.1x atk), defense reduction, parry
  window, and the exchange judgment. The five built-in judgments (clash /
  parry / block / interrupt / hit) are **registered rules** — `resolveExchange`
  walks a priority-ordered rule list (clash 400 > parry 300 > block 200 >
  interrupt 100 > hit 0, the always-true fallback) and applies the first match;
  a new mechanic is one `registerExchangeRule({name, priority, when, resolve})`
  call, and its result travels over the PVP `result` message unchanged. Per-side
  profiles carry `earlyReleaseMs` / `parryWindowBaseMs` (per-item charge
  threshold / parry window), plus `critChance` (rolled on clean hits/
  interrupts → `critMult` damage), `guardThorns` (reflect a share of blocked
  damage), and `apMax` (action-point cap). `resolveExchange` is pure and returns
  a `crit` flag; the caller applies HP/stun/log.
- **`core/arena_effects.js`** — battlefield-effect registry + per-battle
  runner, pure logic. Effects change the environment over time rather than
  either side: built-ins are `ap_surge` (past `atMs` both sides' AP recharges
  `apRateMult`× faster) and `burning_ground` (from `startMs`, every
  `intervalMs` both sides take `pct` of own maxHp). Wired into PVE only:
  `content.enemies[key].arena = ['key' | {key, ...opts}]` (currently the two
  bosses), instantiated per-fight via `arenaEffects.create()`, driven by
  `arenaEffects.tick()` in `pve_logic._loop`, which applies the returned
  log/damage events itself (same death priority as exchanges).
- **`pve/pve_logic.js`** — formal spatial dungeon lifecycle: floor pools, boss
  checkpoints, rewards, runGold and skill points. `state.pveBattle.spatial` owns
  combat HP and time; `player`/`enemy` reference its actors. Fixed 10ms substeps
  drive the shared engine and arena adapter (seconds to milliseconds only here).
  Defeat wins simultaneous deaths; settled/ended guards prevent duplicate rewards.
- **`pve/spatial_engine.js`** — shared training/formal engine. Inject preset and
  RNG with `create(config, random)`. Formal profiles add defense, crit, thorns,
  charge thresholds, AP regen and skills; training keeps its baseline parameters.
- **`pve/spatial_data.js` / `pve/pve_profiles.js`** — explicit action templates
  for every enemy and stat/equipment adapters. Never use legacy dmgMult for timing.
- **`ui/combat_input.js` / `ui/ui_spatial_battle.js`** — shared input capture and
  read-only view. Formal DOM IDs use `pve-s-`; training uses unprefixed IDs.
- Formal PVE has one implementation; the legacy fallback and its URL selector were
  removed after user acceptance. PVP protocol remains unchanged.
- **`pvp/pvp_logic.js`** — WebRTC PVP on the same core. Host is the sole judgment
  authority; Guest mirrors state from broadcast `result` messages. Clash/parry
  windows deliberately use local wall-clock, not network-corrected time.
- **`core/player.js`** — stat aggregation from equipment via `STAT_REGISTRY` /
  `EFFECT_REGISTRY` (defined in `effects.js`), equip/craft/buy actions, and
  derived combat getters that feed the profiles: `getChargeThresholdMs` /
  `getParryWindowBaseMs` (first equipped item in slot order wins), `getCritChance`
  (luck 1%/pt + `crit_chance` effects), `getGuardThorns`, `getApMax`. **Weapon
  enhancement**: `enhanceItem(itemId)` spends gold for +1..+5 on weapons/shields
  (+10% atk/def per level); levels live in `state.inventory.enhance[itemId]`
  (shared across all copies) and fold into `getStats()`.
- **`core/effects.js`** — registries. Adding a new item effect type = one entry
  here (display `label`, plus `apply` only for multiplicative buffs);
  combat-timing / stat-flag effects (crit_chance, guard_thorns, ap_max_bonus,
  charge_threshold_ms, parry_window_ms) are read directly by the `player.js`
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
  reusing `#modal-overlay`), `pve/ui_pve.js` (formal spatial adapter) / `pvp/ui_pvp.js` (original
  per-frame PVP renderer); both read their own battle state, `ui/fx.js` (CSS-class animation triggers + battle log lines,
  incl. `pvpChargeFlash`), `ui/icons.js` (inline SVG icons).

### Testing notes

- Run `node --test tests/training.test.cjs tests/pve-spatial.test.cjs` for focused
  training and formal PVE regressions. Browser and real-device QA complement them.
- Background/hidden tabs pause `requestAnimationFrame`, freezing battle loops
  in automated preview environments. Workaround: monkey-patch rAF to
  setTimeout at runtime (`window.requestAnimationFrame = cb =>
  setTimeout(() => cb(performance.now()), 16)`) before starting a fight, then
  drive real time with waits.
- The dev http server sends no cache headers, and the browser aggressively
  caches JS/partials — after editing files, verify the browser actually loaded
  the new version (fetch with `cache:'no-store'` and compare) before debugging
  "bugs" that are just stale scripts.


## Spatial training extraction (M1, 2026-09-09)

`training.html` is an isolated entry, sharing no saves or battle state with the
formal PVE/PVP. It loads `core/spatial_combat.js` → `core/combat_gestures.js` →
`pve/spatial_data.js` → `pve/spatial_engine.js` → `ui/combat_input.js` →
`ui/ui_spatial_battle.js` → `pve/training.js`. The engine owns combat, the gesture
recognizer emits semantic commands, the input adapter owns pointer capture, and
the view owns text and effects. The unused `trainingLogic` alias has been removed. Run `node --test tests/training.test.cjs` for focused regression checks.
Formal PVE uses this engine with profiles. PVP retains `combat_resolver` exchange
judgments; formal profiles reuse only its AP recovery helper. See `pve/SPATIAL_MIGRATION.md` for current rules. See `pve/TRAINING.md` for interfaces and QA limits.

## Spatial controls update (2026-09-11)

Formal PVE and training use independent left movement/light and right heavy/guard
pads (heavy below-left of guard). Left drag moves; right drag only turns. Heavy
press charges immediately at 70% move/turn speed; outside-center release attacks,
center release cancels. Left movement works while charging or guarding. Weapon
geometry stays fixed size; only its swing angle and the range preview change.
`spatialEngine.heavyShape` is shared by preview and hit snapshots.
Equipment feeds `player.getSpatialMotion()` into profiles; temporary modifiers
use `spatialEngine.setMotionBuff`. One latest command is buffered during
attack/recovery/stun; queued skills spend SP only when executed.
See `pve/COMBAT_CONTROLS.md` for configuration and cancellation semantics.
The user requested no tests for this revision; previous passing test counts
are historical, and old gesture expectations need updating on the next test pass.

## Operation preferences and four-way skills (2026-09-11)

Movement uses a dynamic left touch area: locate the hidden pad at each pointerdown,
reset/hide on release, cancellation and resize. Four-way skill pad: up heal, right
haste, down full, left parry. Require >24 CSS px drag and outside the 24px center
before selection; about 7-degree direction hysteresis. Center cancellation defaults
on (heavy + skills); off retains the current gesture's last selected skill, never
casts an unselected tap. The engine returns the selected skill from release; the
page adapter retains SP/queue ownership. Training allows free skill practice.
`core/combat_settings.js` binds pause/settings and persists cancelAtCenter/autoFace
outside progression saves. Default autoFace=false: movement turns toward its vector,
idle retains facing, light and guard startup do not snap to the enemy. The renderer
remains read-only. Guard startup/guard use 30% move and 50% turn speed. Charge turn
remains 70% (5.6 rad/s baseline), heavy windup/recovery remain .18/.48 seconds.
Monster HP loss adds impact sparks, ring and floating damage using simulation time.
`pve/combat_controls.css` supplies shared controls after the page-specific stylesheet.
This revision only received syntax/diff checks; regression and device QA remain pending.

## Mobile lifecycle and layout follow-up (2026-09-11)

A direct hit now clears only right-hand input and the queued command. The engine
keeps the held move gesture with suppressTap=true; actionInputVersion clears only
right-hand pointer capture in adapters. Stun still stops physical movement; holding
resumes after stun, releasing during stun stops it. Pause/blur/cancel/resize/end
continue to clear all pointers. Do not convert a held movement pointer into a tap.

Foreground, BFCache and Canvas context restoration refresh the view and present
pause for an unfinished fight without recreating battle state or rewards. Zero-size
canvas observations are ignored. Training retains its listeners across pagehide
and restarts its frame loop on pageshow instead of forcing location.reload().

Both entry shells use core/client_boot.js and client-assets.json. The loader fetches
local styles, ordered scripts and formal partials with cache:no-store before opening
the game, preventing a cached shell from combining stale combat assets with a fresh
partial. Update the manifest when adding/removing a script, stylesheet or formal view.
Local scripts are still global classic script tags; there are no modules or bundler.

The right-hand controls share a 2x2 grid: guard upper-left, skill upper-right, attack
lower-left, lower-right reserved. Move touch area is lower. Formal AP/SP, recent
battle log and enemy readout overlay below HP; the full-width world starts at HP level.
User manually confirmed previous operation feel. Latest follow-up only has static
checks; exact mobile background/rotation/base-to-battle reproduction remains pending.

## Latest tuning (2026-09-11, third mobile feedback)

Supersedes prior 70% charge-turn and .18/.48 heavy timings: chargeTurnMultiplier=.65
(5.2 rad/s baseline), heavy windup=.22 and recovery=.60. Charge move remains .7.
Heal costs 2 SP and rejects full HP both before queueing and at execution, with no
SP charge or queue replacement. Haste costs 2 SP, lasts 10 simulation seconds and
retains 1.5x charge progress; motion() additionally applies 1.10 move in all stances
and 1.05 turn only outside charging. Refresh does not stack. Guard multipliers unchanged.
Combat events go only to recent logs, not duplicated into operation notice. Monster
impact ring/sparks last .18s while damage numbers remain .55s; player stun has orange
phase-bound tint/ring/marks. Shared controls have 128px move pad, larger touch area,
compact right grid, translucent HP, and a compact landscape layout (<=540px high).
Static checks only; current gesture regressions and real-device QA remain pending.

Latest user authorization: parry costs 3 SP. Commit and push current work first,
then run tests; this supersedes the earlier no-tests restriction.

Latest validation: focused training/PVE suite updated to current gestures and tuning;
38 tests passed, 0 failed. Includes held movement through stun, four-way skill cancel,
haste motion, heal safeguards, parry 3 SP and foreground lifecycle/reward protection.
Real-device layout/background/context-loss QA remains pending.

## Handoff status (2026-09-11)

User confirmed preliminary playtesting complete. PVE spatial migration is closed
as this phase; 38 focused tests pass. Next conversation will migrate spatial combat
to PVP (not implemented yet). Read docs/tasks/spatial-combat-migration.md for the
consolidated current rules, delivered changes, residual QA limits and PVP handoff.
Older no-tests/pending-playtest statements above are historical, not current blockers.


## PVP spatial migration, stage one (2026-09-12)

Supersedes the earlier statements that PVP uses the old exchange engine/protocol.
User authorized current four skills unchanged; spatial clash is explicitly deferred
and required in stage two. See `pvp/SPATIAL_MIGRATION.md` for current PVP rules.
`core/spatial_profiles.js` now shares player stat mapping with PVE. `spatialEngine.advanceActor`
reuses human actions/input for both players; `pvp/spatial_duel.js` collects simultaneous
strikes before resolving either, owns per-side SP/buffs and draws on double KO.
`pvp/pvp_logic.js` owns protocol v2, host 10ms simulation, 50ms snapshots, guest local
prediction/reconciliation, event deduplication, readiness and rematch. Guest HP is
only authoritative snapshot data. Old combatResolver remains for AP recovery, not
PVP exchanges. Shared view/styles support both human fighters and both formal shells.
PVP starts full HP/AP, 0 SP; no progression writes, passive healing or dungeon rewards.
Settings do not pause; hidden/pagehide/context-loss/disconnect/timeouts abort the match.
Run all three suites including `tests/pvp-spatial.test.cjs`; browser QA fixture is
`tests/pvp-browser.html` (isolated progression; its hidden-tab workaround is test-only).

Latest stage-one validation: all 53 tests pass (38 PVE/training + 15 PVP).
Two browser contexts completed real WebRTC room-code connection, guest hit/HP sync,
surrender and rematch. The isolated fixture also passed 60ms one-way simulated
latency, real pointer tap, HP/SP convergence and portrait/landscape resize checks.
Two-device mobile/network playtesting remains pending. Spatial clash is stage two.


## PVP follow camera and outline fix (2026-09-12)

PVP arena is now 510x566 (about twice the old area), with symmetric spawns
(255,373)/(255,193). Protocol v3 supersedes v2 because clients must agree on bounds.
Collision separation uses configured bounds. PVP config.camera selects a 396x440
view, local-player follow smoothing and velocity lookahead (.16s, capped at 24).
The shared renderer owns camera state; PVP supplies presentation dt, independent of
snapshot time corrections. Camera never changes world inputs, damage, or snapshots.
PVE/training retain their full-world view. Guard arcs and swing trails isolate Canvas
state; fighters explicitly set outline width so opponent guard cannot thicken self.
User explicitly requested no tests for this revision. Prior 53 passing tests and
browser QA are historical, not validation of these camera/arena/rendering changes.


## PVE camera / PVP perspective / heavy timing (2026-09-12)

Latest user correction sets player heavy windup to exactly .45 seconds (recovery .60),
shared by PVE, PVP and training. PVP protocol is now v4 to exclude older timing rules.
Formal PVE now uses the same 510x566 arena and 396x440 follow camera as PVP;
its original spawn positions are translated by (75,83), preserving encounter distance.
Training arena stays 360x400. PVE supplies presentation dt to the shared camera.
PVP guest view rotates the world 180 degrees so each side starts below its opponent.
Guest move/action/guard input vectors are rotated back before prediction/networking;
skill directions stay screen-relative. Pad knobs convert world gestures back to screen
coordinates; actor labels and floating damage remain upright. World rules and snapshots
remain in canonical coordinates. Perspective is fixed per side, not changed when circling.
User requested direct push; no tests or browser QA were run for this revision.
