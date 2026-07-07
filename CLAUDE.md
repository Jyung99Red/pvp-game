# CLAUDE.md

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
`core/tick.js` → `ui/fx.js` → `core/combat_resolver.js` → `ui/icons.js` →
`ui/ui.js` → `pve/ui_pve.js` → `pve/pve_logic.js` → peerjs (CDN) →
`pvp/pvp_logic.js` → `pvp/pvp_net.js` → `pvp/pvp_room.js` → `pvp/ui_pvp.js`

### Core systems

- **`core/data.js`** — all state + static config. `state` (live game state) and
  `content` (items / materials / recipes / enemies / floorPools / bossRotation /
  buildings / shopPrices / slotMeta). `state.progress.checkpointFloor` is
  permanent dungeon progress (saved); `state.world` is transient in-run position
  (not saved), including `world.runGold` — gold earned this run, at risk until
  banked (see run-gold below).
- **`core/combat_resolver.js`** — shared pure combat core for PVP and PVE:
  `pvpConfig` timing constants, side-state factory (`_makeSideState(maxHp, apMax)`),
  charge-damage lerp (threshold→3000ms, 0.3x→1.1x atk), defense reduction, parry
  window, and the five-way exchange judgment (clash / parry / block / interrupt /
  hit). Per-side profiles carry `earlyReleaseMs` / `parryWindowBaseMs` (per-item
  charge threshold / parry window), plus `critChance` (rolled on clean hits/
  interrupts → `critMult` damage), `guardThorns` (reflect a share of blocked
  damage), and `apMax` (action-point cap). `resolveExchange` is pure and returns
  a `crit` flag; the caller applies HP/stun/log.
- **`pve/pve_logic.js`** — PVE engine on the shared core. Roguelike floor dungeon:
  `enterDungeon()` resumes from the checkpoint floor, `continueNext()` descends;
  every 9th floor is a boss floor (clearing it advances the checkpoint), boss
  identity rotates through `content.bossRotation`. Non-boss floors draw from
  `content.floorPools` keyed by **absolute** floor number (floors past the last
  tier keep drawing from it), stats scale 8%/floor. Enemy AI state machine
  (`_aiThink`) has a boss toolkit — feints (fake charges, visually identical to
  real ones), combo chains, enrage at an HP threshold — all off by default,
  enabled per-enemy via `content.enemies[key].ai` overrides (`elder_dragon`,
  `abyss_lord`, and light touches on the deep-floor mobs). Player skills
  (`useSkill(kind)`): heal / haste (faster charge fill) / instant-full-charge /
  auto-parry, driven by `state.pveBattle.buffs`. **Run-gold**: victory gold
  accumulates into `world.runGold`, banked into `resources.gold` only in
  `endFight` when leaving alive (retreat/flee), lost entirely on death.
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
  Building production is generic over `content.buildings[*].baseProduce`
  (currently none produce anything — gold comes from combat).
- **UI** — `ui/ui.js` (base view, modals, buildings, shop, smithy),
  `pve/ui_pve.js` / `pvp/ui_pvp.js` (per-frame battle renderers, pure readers
  of their state objects), `ui/fx.js` (CSS-class animation triggers + battle
  log lines), `ui/icons.js` (inline SVG icons).

### Testing notes

- No test suite; verification is manual in the browser (preview tools).
- Background/hidden tabs pause `requestAnimationFrame`, freezing battle loops
  in automated preview environments. Workaround: monkey-patch rAF to
  setTimeout at runtime (`window.requestAnimationFrame = cb =>
  setTimeout(() => cb(performance.now()), 16)`) before starting a fight, then
  drive real time with waits.
- The dev http server sends no cache headers, and the browser aggressively
  caches JS/partials — after editing files, verify the browser actually loaded
  the new version (fetch with `cache:'no-store'` and compare) before debugging
  "bugs" that are just stale scripts.
