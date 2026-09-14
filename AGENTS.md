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
`core/combat_settings.js` → `ui/combat_input.js` → `ui/ui_spatial_battle.js` → `pve/ui_pve.js` → `pve/pve_logic.js` → `core/client_dependencies.js` (lazy PeerJS) → `pvp/spatial_duel.js` → `pvp/pvp_logic.js` → `pvp/pvp_net.js` →
`pvp/pvp_room.js` → `pvp/ui_pvp.js`

### Core systems

- **`game_config.js`** — the single editable source for gameplay/balance values,
  including growth, combat resources/damage, input, skills, arenas, enemy moves,
  equipment and content tables. Comments are English and document units/overrides.
- **`core/data.js`** — live state plus a mutable runtime copy of configured content.
  `state.progress.checkpointFloor` is
  permanent dungeon progress (saved); `state.world` is transient in-run position
  (not saved), including `world.runGold` — gold earned this run, at risk until
  banked into `state.resources` only on making it back to base alive (owned by `pve/pve_logic.js`).
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
  reusing `#modal-overlay`), `pve/ui_pve.js` (formal spatial adapter) / `pvp/ui_pvp.js` (original
  per-frame PVP renderer); both read their own battle state, `ui/fx.js` (CSS-class animation triggers + battle log lines,
  incl. `pvpChargeFlash`), `ui/icons.js` (inline SVG icons).

### Testing notes

- Run `node --test tests/spatial-engine.test.cjs tests/pve-spatial.test.cjs` for focused
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
- PVP never writes progression, passive healing or dungeon rewards, and fair mode
  reads no equipment effects at all.
- Every enemy action template owns its own timing (`pve/spatial_data.js`); never
  reintroduce a legacy damage-multiplier timing path.
- Weapon charge timing is data-driven: one `chargeOffsetMs` per weapon in
  `game_config.js`, resolved by `combatRules.weaponChargeThresholdMs()`.

## Open work

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
