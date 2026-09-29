# AGENTS.md

Browser vanilla-JS idle/action RPG. No bundler, no modules: plain global-scope
`<script>` tags loaded in manifest order by `core/client_boot.js`; views are
fetch-loaded HTML partials. Serve over http (`file://` breaks `fetch`):
`python -m http.server 8422` or `Run-Game.bat`.

- `core/` shared state, stat/effect registries, save, tick, shared combat rules
- `ui/` shared non-battle UI
- `pve/` PVE engine + battle UI
- `pvp/` PVP engine, network, room flow, battle UI
- `index.html`, `style.css`, `partials/`, `icons/` stay at root (fetch paths are document-relative)

`SYSTEMS.md` holds the module map, current state, combat rules and settled
decisions. Read it before changing behaviour; update it when that changes.
This file only changes when project setup changes.

## Rules

- Tunable numbers live only in `game_config.js`. When they change, update
  `docs/tasks/combat-parameter-inventory.md` to match.
- Done = `node --test "tests/*.test.cjs"` passes. If a change alters what a test
  asserts, update the test and say why.
- New script or partial: register it in `client-assets.json`; a partial also
  needs `#mount-<id>` in `index.html`.
- Code comments, `AGENTS.md`, `SYSTEMS.md` in English; `README.md` and UI text in Chinese.
