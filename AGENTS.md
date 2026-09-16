# AGENTS.md

## Architecture

Browser vanilla-JS idle/action RPG. No bundler, no modules — plain global-scope
`<script>` tags loaded in manifest order by `core/client_boot.js`; views are
fetch-loaded HTML partials mounted at startup. Serve over http (partials use
`fetch`, `file://` won't work): `python -m http.server 8422`.

Files are grouped by domain, not by layer:
- `core/` — shared state, stat/effect registries, save, tick, shared combat rules
- `ui/` — shared non-battle UI (base view, fx, icons)
- `pve/` — PVE engine + its battle UI
- `pvp/` — PVP engine, network, room flow, its battle UI

`index.html`, `style.css`, `partials/`, and `icons/` stay at repo root —
`fetch()` for partials and icon SVGs resolves relative to the document.

## Core systems

- **`game_config.js`** — the single editable source for gameplay/balance values
  (growth, combat resources/damage, input, skills, arenas, enemy moves,
  equipment, content tables). Comments document units/overrides. **All tunable
  numbers live here only.**

- **`core/data.js`** — live state + mutable runtime copy of configured content.
  `state.progress` (saved): `currentRegionId`, `unlockedRegions`, `defeatedBosses`.
  `state.world` (transient, not saved): view state; `world.arrivalFrom` records
  the region just left for arrival placement. Rewards bank on victory.

- **`core/combat_rules.js`** — shared weapon thresholds, default AP/parry window,
  focus-based AP/SP recovery. Spatial engines own damage and simultaneous-attack
  judgment.

- **`core/arena_effects.js`** — battlefield-effect registry + per-battle runner
  (pure logic). Effects change the environment over time: `ap_surge`,
  `burning_ground`. Wired into PVE only via `content.enemies[key].arena`.

- **`pve/pve_logic.js`** — adventure lifecycle: region travel/exit gating
  (`requiresBoss`), encounter start, rewards, skill points.
  `state.pveBattle.spatial` owns combat HP and time. Fixed 10ms substeps.
  Boss clear writes `defeatedBosses` + `unlockedRegions` and saves immediately.
  `_beginFight` enlists into live region space when `adventureWorld.isActive()`,
  otherwise falls back to legacy arena. Enlisted fights carry `home`/`leash`/
  `alertRange`; `advance` ends with `_onDisengage` when past leash. **`advance`
  ends by calling `_present`** — nothing else may call it; `_loop` is the only
  loop `_beginFight` may start for the scene-less path.
  **A fight ends with no result screen but defeat**: `_onVictory` banks rewards,
  writes the summary into `adventureWorld.notice` and calls `_returnToRegion`
  itself; flee and disengage use that same path, which hands the fight's final
  player position back to the region (without it the walk resumes where the
  encounter started). There is no `waitingChoice` state and no `safeRetreat`.

- **`pve/adventure_world.js`** — walkable region simulation (no DOM, no combat
  rules). Player is a spatial actor advanced with `spatialEngine.advanceActor` on
  a solo preset. Monsters patrol / chase / leash / encounter. Bosses have
  `boss: true` and `patrolRadius: 0`. `stepWorld` runs in both walking and
  fighting modes. Exits are physical portals; arrivals use gate facing
  (`portal.angle`) to land correctly. **Every exit needs a matching return exit
  in its target** — the region tests assert it, so a one-way gate is a bug.
  `enlist` builds fight at live monster position and sends other chasers home.
  `endCombat` / `resumeField` hand the region back cleanly. `worldLayer(ctx, view)`
  is the region drawer; draw structures AFTER gates (tests locate a gate chevron
  by the first point drawn near it) and never as a 12px arc (that is the player).

- **Buildings and interaction** — `map.structures` (kind/label/x/y, optional
  radius) become `scene.structures`; `stepWorld` picks the nearest one in reach
  (`adventure.structureRange`, released at `structureRelease`) into
  `scene.interaction`, or null while fighting. The drawer, the pad label and
  `pveLogic.interact` all read that one field; `interact` switches on `kind`
  explicitly (never a data-driven `ui[action]()`), and the region adapter turns a
  resting tap on the move pad into it via the engine's own `suppressTap`.

- **Monsters respawn** on the region clock (`adventure.monsterRespawnSeconds`
  after `completeEncounter`), at their post and never on top of the player.
  Bosses never do: `progress.defeatedBosses` is permanent.

- **`adventureWorld.notice(text, seconds)`** is the region's log line: it
  outranks `scene.hint` while it lives, and with a duration it expires. Both
  writers use a duration (a sealed gate, a fight summary) — an open-ended notice
  becomes the region's permanent description.

- **`pve/spatial_engine.js`** — shared training/formal engine. Inject preset +
  RNG via `create(config, random)`. Formal profiles add defense/crit/thorns/
  charge/AP/skills; training stays baseline. Solo presets (walking) skip enemy,
  never bank SP, never charge. A completed swing MUST end in `recover` for a solo
  actor too (`soloStrike`): ending the swing is what returns the player to
  `idle`, and a phase stuck in `attack` locks movement, attacks and guard for
  good. Overlapping bodies are auto-separated on create.

- **`pve/spatial_data.js` / `pve/pve_profiles.js`** — explicit action templates
  for every enemy + stat/equipment adapters. Never use legacy dmgMult for timing.
  `region(def)` builds solo walking preset; `enemy(...)` re-homes into a region.

- **`ui/combat_input.js` / `ui/ui_spatial_battle.js`** — shared input + read-only
  view. Prefixes: `adv-s-` (region), `pvp-s-` (PVP), none (training).
  Camera with `zoom` pins scale so walking/fighting share the same mapping.
  `useConfig(C)` swaps preset without touching DOM/camera.

- **`pve/ui_adventure.js`** — region page adapter, single owner of the region's
  rAF, view, input group, combat settings and DOM. One loop for both modes:
  ```
  uiAdventure._frame (one rAF)
    ├─ adventureWorld.stepWorld(dt)   always
    └─ fighting → pveLogic.advance(dt) → view.render(fight)
       walking  → uiAdventure.updateFrame() → view.render(solo)
  ```
  Entering combat is a config swap, not teardown. Camera is carried across.
  `updateFrame` runs AFTER `view.render`, which is what lets it override the
  resting pad label / notice with the interact prompt without fighting the view
  (a live gesture keeps the view's own wording).

- **The base IS the safe region** (`content.regions.a`). `#view-base` no longer
  exists: `ui.js`'s `VIEW_OF_TAB` points both `base` and `adventure` at
  `view-adventure`, `switchTab` mounts/unmounts the region adapter on that id,
  and `partials/base.html` now only hosts the dialogs (`#character-overlay` plus
  inventory/building/smithy/shop/modal) and the toast. Close a panel and the
  character data is written by the usual `ui.updateBase`/`updateEquip`, so every
  lookup in those two must stay null-safe — the tick loop calls them every
  second and `player.js` calls them mid-transaction.
  - Region `a` keeps `world.status === 'base'` (full hot-spring regen, training
    page allowed, encounters impossible). `ui.init` re-derives that status from
    the saved region, because the save stores the region but not the status.
  - Opening any `.camp-overlay` freezes the region session
    (`uiAdventure.setPaused`); closing the last one resumes it unless
    `pveLogic.isPaused()` says the pause overlay owns the pause.

- **`pvp/pvp_logic.js`** — WebRTC PVP on the same core. Host is sole judgment
  authority; Guest predicts + reconciles. Spatial clash still deferred.

- **`core/player.js`** — stat aggregation via `STAT_REGISTRY` / `EFFECT_REGISTRY`,
  equip/craft/buy, derived combat getters (`getChargeThresholdMs`,
  `getParryWindowBaseMs`, `getCritChance`, `getGuardThorns`, `getApMax`).
  Weapon enhancement: +1..+5 levels in `state.inventory.enhance`.

- **`core/effects.js`** — effect registries. New item effect type = one entry
  here. Combat-timing flags are read directly by player getters.

- **`core/save.js`** — localStorage. Saved: resources / inventory (incl. enhance)
  / base / player / progress. Never saved: world, pveBattle, pvpBattle.

- **`core/tick.js`** — 1s interval: game clock, passive/hot-spring HP regen.
  During active spatial PVE the engine owns regen.

- **UI** — `ui/ui.js` (base, modals, buildings, equip/backpack/shop/smithy),
  `pve/ui_adventure.js`, `pvp/ui_pvp.js`, `ui/fx.js`, `ui/icons.js`.
