# AGENTS.md

Browser 3D action RPG in blocky style, landscape only, played on phones.
No bundler: plain global-scope `<script>` tags loaded in manifest order by
`core/client_boot.js`; views are fetch-loaded HTML partials. Serve over http
(`file://` breaks `fetch` and `import()`): `python -m http.server 8422` or
`Run-Game.bat`.

The one exception to "no modules": three.js. `client-assets.json` lists it
under `modules`; the boot loader `import()`s it first and exposes it as the
global `THREE`. It is vendored in `vendor/three/` (0.186.1, bundled and
minified into one file with esbuild, MIT licence alongside). Only `render/`
uses `THREE`.

- `core/` simulation and maths with no DOM and no three.js: coordinates,
  matrices and box tests, rig and forward kinematics, terrain, the fixed-step
  loop, fight rules and hit tests, the player fighter, the training dummy,
  monsters and their AI, input maths. Node tests and the PVP host run it.
  Also the boot loader.
- `models/` model data: skeletons, boxes, equipment, key poses, palette.
- `render/` three.js drawing only; reads the simulation, never writes it.
- `ui/` DOM: input layer, app start-up, HUD, procedural sound.
- `vendor/` third-party files, unmodified apart from bundling.
- `index.html`, `style.css`, `partials/` stay at root (fetch paths are document-relative)

The code, `game_config.js` and the tests are the description of current
behaviour. Design in progress lives in `docs/tasks/` (Chinese); the rebuild
order is `docs/tasks/rebuild-plan.md`. The 2D version is tag `v1-2d`
(commit `2a313c4`).
This file only changes when project setup changes.

## Rules

- Tunable numbers live only in `game_config.js`. When they change, update
  `docs/tasks/combat-parameter-inventory.md` to match. Model shapes and key
  poses are data in `models/`, not tunables.
- What is drawn is what is judged: poses that change a body's volume are a
  pure function of simulation state (`core/player_anim.js`); `render/` adds
  only drawn-only motion (breathing, leaning).
- Done = `node --test "tests/*.test.cjs"` passes. If a change alters what a test
  asserts, update the test and say why. `tests/browser-smoke.test.cjs` runs
  when Playwright is installed and skips otherwise; on Windows, install
  `playwright-core` anywhere and set `PLAYWRIGHT_MODULE` to it and
  `PLAYWRIGHT_CHANNEL=chrome`.
- New script or partial: register it in `client-assets.json`; a partial also
  needs `#mount-<id>` in `index.html`.
- Code comments and `AGENTS.md` in English; `README.md`, UI text and
  `docs/tasks/` in Chinese.
