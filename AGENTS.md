# AGENTS.md

Browser vanilla-JS idle/action RPG. No bundler, no modules — plain global-scope
`<script>` tags loaded in manifest order by `core/client_boot.js`; views are
fetch-loaded HTML partials mounted at startup. Serve over http (partials use
`fetch`, `file://` won't work): `python -m http.server 8422`, or `Run-Game.bat`.

Files are grouped by domain, not by layer:

- `core/` — shared state, stat/effect registries, save, tick, shared combat rules
- `ui/` — shared non-battle UI (fx, icons, the shared spatial view)
- `pve/` — PVE engine + its battle UI
- `pvp/` — PVP engine, network, room flow, its battle UI

`index.html`, `style.css`, `partials/`, and `icons/` stay at repo root —
`fetch()` for partials and icon SVGs resolves relative to the document.

This file is deliberately short and stable: it describes how the project is set
up and the rules that hold regardless of which module you are in. **A module
change should not require editing it.**

## Where to look

| File | Holds |
|---|---|
| `SYSTEMS.md` | Everything that moves with the code: module map, current state, combat rules, boot behaviour, and the settled decisions — **the one file to update**. |
| `README.md` | What the game is, how to run and play it (Chinese). |
| `docs/tasks/combat-parameter-inventory.md` | The parameter tables (Chinese) — a mirror of `game_config.js` for design work. Keep it in step when numbers move. |
| `pve/COMBAT_CONTROLS.md` | Dated gesture/skill tuning notes. |
| `pvp/SPATIAL_MIGRATION.md` | Dated PVP spatial design record. |

## Rules

- **All tunable numbers live in `game_config.js` only.** Nothing else holds a
  balance value.
- **The whole suite must be green** before calling a change done:
  `node --test "tests/*.test.cjs"` (Node expands the glob, so a new test file
  needs no edit here).
- New code belongs in the file that already owns that job — `SYSTEMS.md` names it.
- A new script or partial must be registered in `client-assets.json`; a partial
  also needs a matching `#mount-<id>` in `index.html`.
- Code comments and the agent-facing docs (`AGENTS.md`, `SYSTEMS.md`) are
  English; `README.md` and UI copy are Chinese.
- Settled decisions and the module map live in `SYSTEMS.md` — check it before
  changing behaviour it calls settled.
- Behaviour the tests pin is not negotiable by accident: if a change moves what a
  test asserts, the test is updated deliberately and the reason is stated.
