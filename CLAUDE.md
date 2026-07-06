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

### Script load order (index.html)

`data.js` → `effects.js` → `save.js` → `player.js` → `tick.js` → `fx.js` →
`combat_resolver.js` → `icons.js` → `ui.js` → `ui_pve.js` → `pve_logic.js` →
peerjs (CDN) → `pvp_logic.js` → `pvp_net.js` → `pvp_room.js` → `ui_pvp.js`

### Core systems

- **`data.js`** — all state + static config. `state` (live game state) and
  `content` (items / materials / recipes / enemies / floorPools / buildings /
  shopPrices / slotMeta). `state.progress.checkpointFloor` is permanent dungeon
  progress (saved); `state.world` is transient in-run position (not saved).
- **`combat_resolver.js`** — shared pure combat core for PVP and PVE:
  `pvpConfig` timing constants, side-state factory, charge-damage lerp
  (threshold→3000ms, 0.3x→1.1x atk), defense reduction, parry window, and the
  five-way exchange judgment (clash / parry / block / interrupt / hit).
  Per-side profiles carry `earlyReleaseMs` / `parryWindowBaseMs` so equipment
  can vary charge thresholds and parry windows per item.
- **`pve_logic.js`** — PVE engine on the shared core. Roguelike floor dungeon:
  `enterDungeon()` resumes from the checkpoint floor, `continueNext()` descends;
  every 9th floor is a boss floor (clearing it advances the checkpoint), other
  floors draw from tiered `content.floorPools`, stats scale 8%/floor. Enemy is
  driven by an AI state machine (`_aiThink`) with a boss toolkit — feints
  (fake charges, visually identical to real ones), combo chains, enrage at an
  HP threshold — all off by default, enabled per-enemy via
  `content.enemies[key].ai` overrides (currently only `elder_dragon`).
  Gold drops from victories (60% of floor-scaled exp).
- **`pvp_logic.js`** — WebRTC PVP on the same core. Host is the sole judgment
  authority; Guest mirrors state from broadcast `result` messages. Clash/parry
  windows deliberately use local wall-clock, not network-corrected time.
- **`player.js`** — stat aggregation from equipment via `STAT_REGISTRY` /
  `EFFECT_REGISTRY` (defined in `effects.js`), equip/craft/buy actions,
  combat-timing getters (`getChargeThresholdMs` / `getParryWindowBaseMs`:
  first equipped item in slot order wins).
- **`effects.js`** — registries. Adding a new item effect type = one entry here
  (gameplay `apply` + display `label`), no edits elsewhere.
- **`save.js`** — localStorage persistence. Saved: resources / inventory /
  base / player / progress. Never saved: world, pveBattle, pvpBattle.
- **`tick.js`** — 1s interval: game clock, passive/hot-spring HP regen.
  Building production is generic over `content.buildings[*].baseProduce`
  (currently none produce anything — gold comes from combat).
- **UI** — `ui.js` (base view, modals, buildings, shop, smithy), `ui_pve.js` /
  `ui_pvp.js` (per-frame battle renderers, pure readers of their state
  objects), `fx.js` (CSS-class animation triggers + battle log lines),
  `icons.js` (inline SVG icons).

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
