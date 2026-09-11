# AGENTS.md

## Line endings

Line endings are enforced by `.gitattributes` (`* text=auto eol=lf`): the repo
stores LF and checks out LF everywhere, Windows included. No manual handling is
needed — edit files normally (full-file rewrites included). Git normalizes to
LF on commit, so a whole-file CRLF/LF flip can never sneak into the diff.

## Architecture

Browser vanilla-JS idle/action RPG. No bundler, no modules — plain global-scope
`<script>` tags loaded in order by `index.html`; views are fetch-loaded HTML
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

### Script load order (index.html)

`core/data.js` → `core/effects.js` → `core/save.js` → `core/player.js` →
`core/tick.js` → `ui/fx.js` → `core/combat_resolver.js` →
`core/arena_effects.js` → `ui/icons.js` → `ui/ui.js` → `core/spatial_combat.js` → `core/combat_gestures.js` →
`pve/spatial_data.js` → `pve/spatial_engine.js` → `pve/pve_profiles.js` →
`ui/combat_input.js` → `ui/ui_spatial_battle.js` → `pve/ui_pve.js` → `pve/pve_logic.js` → peerjs (CDN) → `pvp/pvp_logic.js` → `pvp/pvp_net.js` →
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
