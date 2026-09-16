# SYSTEMS.md

**The one living document.** Module map, current state, combat rules, boot
behaviour and the decisions that are settled — everything that moves when the
code moves. A code change means an edit here and nowhere else: `AGENTS.md` is
deliberately fixed, `README.md` is the Chinese entry point for a human.

Load order and the partial/script manifest live in `client-assets.json`, and
each test file lists the sources it loads — a new module is registered in both.

## Layout & load order

Files are grouped by domain, not by layer: `core/` (shared state, registries,
save, tick, rules), `ui/` (shared non-battle UI, fx, icons, the shared spatial
view), `pve/` (PVE engine + its battle UI), `pvp/` (PVP engine, network, room,
battle UI). `index.html`, `training.html`, `style.css`, `partials/` and `icons/`
stay at repo root so `fetch()` resolves relative to the document.

Script order (`client-assets.json`):

```
game_config.js
→ core/data.js → core/effects.js → core/save.js → core/player.js → core/tick.js
→ ui/fx.js → core/combat_rules.js → core/arena_effects.js → ui/icons.js → ui/ui.js
→ core/spatial_combat.js → core/combat_gestures.js
→ pve/spatial_data.js → pve/spatial_engine.js → core/spatial_profiles.js → pve/pve_profiles.js
→ core/combat_settings.js → ui/combat_input.js → ui/ui_spatial_battle.js
→ pve/ui_adventure.js → pve/adventure_world.js → pve/pve_logic.js
→ core/client_dependencies.js (lazy PeerJS)
→ pvp/spatial_duel.js → pvp/pvp_logic.js → pvp/pvp_net.js → pvp/pvp_room.js → pvp/ui_pvp.js
```

## Boot & asset loading

`index.html` / `training.html` ship a load shell independent of the game CSS.
`core/client_boot.js` reads `client-assets.json` and fetches styles, scripts and
formal-page partials in parallel — 12s per request, one retry, `cache:no-store`.
When the local assets are in: styles are applied, partials mounted, scripts run
in manifest order. Styles must produce a usable CSSOM with an applicable trailing
marker, and the page is only revealed on success — an empty response, HTML where
CSS was expected, an unapplied style or a script error all keep the retry shell
up. Returning from the background / BFCache repairs missing styles without
rebuilding or re-initialising the game.

PeerJS is not in the first-paint path. `core/client_dependencies.js` loads the
pinned 1.5.4 when a room is created or joined, coalesces concurrent requests,
times out after 10s and can be retried. A load result that arrives after the
connect was cancelled must not create a room.

## Module map

- **`game_config.js`** — the single editable source for gameplay/balance values
  (growth, combat resources/damage, input, skills, arenas, enemy moves,
  equipment, content tables, region content). Comments document units/overrides.
  **All tunable numbers live here only.**

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

- **`core/spatial_combat.js`** — circles, sectors, paths, walls, collision
  separation and visibility geometry. Input vectors are CSS pixels.

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
  `endCombat` / `resumeField` / `returnFromCombat` hand the region back cleanly.
  `worldLayer(ctx, view)` is the region drawer; draw structures AFTER gates
  (tests locate a gate chevron by the first point drawn near it) and never as a
  12px arc (that is the player body).

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

- **`core/player.js` / `core/spatial_profiles.js`** — stat aggregation via
  `STAT_REGISTRY` / `EFFECT_REGISTRY`, equip/craft/buy, derived combat getters
  (`getChargeThresholdMs`, `getParryWindowBaseMs`, `getCritChance`,
  `getGuardThorns`, `getApMax`); fair profile and the per-battle character config.
  Weapon enhancement: +1..+5 levels in `state.inventory.enhance`.

- **`core/effects.js`** — effect registries. New item effect type = one entry
  here. Combat-timing flags are read directly by player getters.

- **`core/combat_gestures.js` / `ui/combat_input.js`** — semantic gestures and
  pointer capture; combat stays in the engine, inputs are CSS pixels.

- **`ui/ui_spatial_battle.js`** — the shared read-only view. Prefixes: `adv-s-`
  (region), `pvp-s-` (PVP), none (training). Camera with `zoom` pins scale so
  walking/fighting share the same mapping. `useConfig(C)` swaps preset without
  touching DOM/camera. `resize()` only rewrites the canvas backing store when it
  actually changed — a config swap with an unchanged window must not clear the
  frame. One visibility polygon per frame is shared by the clip and the shading.

- **`pve/ui_adventure.js`** — region page adapter, single owner of the region's
  rAF, view, input group, combat settings and DOM. Entering combat is a config
  swap, not teardown; the camera is carried across. `updateFrame` runs AFTER
  `view.render`, which is what lets it override the resting pad label / notice
  with the interact prompt without fighting the view (a live gesture keeps the
  view's own wording).

- **`ui/ui.js`** — dialogs and panels (character, bag, equipment, building,
  smithy, shop), tab and view switching, the camp toast. Opening any
  `.camp-overlay` freezes the region session (`uiAdventure.setPaused`); closing
  the last one resumes it unless `pveLogic.isPaused()` says the pause overlay
  owns the pause.

- **`core/save.js`** — localStorage. Saved: resources / inventory (incl. enhance)
  / base / player / progress. Never saved: world, pveBattle, pvpBattle.

- **`core/tick.js`** — 1s interval: game clock, passive/hot-spring HP regen.
  During active spatial PVE the engine owns regen. Hot-spring healing only
  reaches the base: `world.status === 'base'` full, `'fighting'` minus the
  penalty, anything else nothing.

- **`pvp/spatial_duel.js`** — two human actors: synchronised actions, geometric
  hits, simultaneous attacks, double-KO draw.

- **`pvp/pvp_logic.js`** — WebRTC PVP on the same core. Host is sole judgment
  authority; Guest predicts + reconciles. Spatial clash still deferred.

- **`pvp/pvp_net.js` / `pvp/pvp_room.js`** — WebRTC transport, room lifecycle,
  protocol/rule version and mode matching.

- **`ui/fx.js` / `ui/icons.js`** — presentation triggers and the SVG icon set.

## Region view and the base

A region fight happens **inside** the region rather than replacing it, and
`#view-adventure` is the only place the world is drawn. One loop drives both
modes:

```
uiAdventure._frame (one rAF)
  ├─ adventureWorld.stepWorld(dt)   always
  └─ fighting → pveLogic.advance(dt) → view.render(fight)
     walking  → uiAdventure.updateFrame() → view.render(solo)
```

Key constraints while this design holds:

- Walk uses `advanceActor` on a `solo` preset (never `step`).
- Solo never charges and never banks SP, and a completed swing still has to end
  in `recover` (`soloStrike`) or the walker is `locked` in `attack` for good.
- The 3 pads are the only movement control in both modes. While walking with a
  building in reach, a resting TAP on the move pad is the interact key (the
  engine's `suppressTap`, no new engine surface); dragging still walks.
- `pveLogic._loop` is scene-less dev/test fallback only.
- PVP and training share view components but keep their own roots/prefixes/lifecycles.
- The HUD is two halves switched by the single `#view-adventure.walking` root
  class (`walk-only` / `fight-only`): the map fills the view
  (`body.region-view .content-area` loses its gutter) and everything else floats
  over it — `.region-plate` and `.hud-buttons` while walking,
  `.vitals`/`.legend`/`.arena-top` while fighting. The walking hint is a
  translucent log line over the map, not a block under it.

**The base is the safe region** (`content.regions.a`). `#view-base` no longer
exists: `ui.js`'s `VIEW_OF_TAB` points both `base` and `adventure` at
`view-adventure`, `switchTab` mounts/unmounts the region adapter on that id, and
`partials/base.html` only hosts the dialogs (`#character-overlay` plus
inventory/building/smithy/shop/modal) and the toast. Closing a panel has the
character data written by the usual `ui.updateBase`/`updateEquip`, so every
lookup in those two must stay null-safe — the tick loop calls them every second
and `player.js` calls them mid-transaction.

- Region `a` keeps `world.status === 'base'` (full hot-spring regen, training
  page allowed, encounters impossible). `ui.init` re-derives that status from the
  saved region, because the save stores the region but not the status.
- No 基地 nav button: getting home is the portals (`回城传送门 · 曙光据点` in c/d,
  unlocked with the dragon, plus the gates already there).

## Training page

`training.html` + `pve/training.css` are a separate entry point: own arena and
baseline, shares neither saves nor battle state with the formal modes. Its layout
is a full-bleed battlefield with the topbar as the only in-flow row —
`--train-topbar` and `--train-controls` in `pve/training.css` must track the
matching pad height in `pve/combat_controls.css`.

## Current combat rules

- Formal PVE/PVP heavy damage starts charging at a per-weapon threshold:
  basic/heavy/light 300/350/280ms, then a fixed 2s to full charge; light ≈0.3×atk,
  heavy ≈0.3–1.1×atk. Windup .45s, recovery .60s. Training keeps its own preset.
- AP costs 20/focus seconds per point and only regenerates while idle, recovering
  or stunned; SP costs 30/focus seconds per point, regenerates in every living
  stance, caps at 3, and is no longer awarded for hits or parries.
- Defense mitigation is `min(raw×0.2, def×0.15)`; blocking multiplies again.
  Insight adjusts the parry window; the auto-parry skill spends SP while a manual
  parry spends AP.
- A dash telegraph is a path hint. The real sweep half-width is the path
  half-width plus the monster radius, and contact adds the player radius; the
  narrow line stays so the player can judge with body volume. The telegraph
  shortens as the remaining distance does; collision or a hit ends the dash, and
  a stagger is not overwritten by an ordinary recovery.
- PVP: the host judges on a 10ms step and snapshots roughly every 50ms. The guest
  predicts and corrects smoothly; HP and the result come from the host; both
  sides' attacks are collected before either resolves. Spatial clash is still not
  implemented.
- PVP v9 / rule v5; fair and progression are matched into separate rooms, and
  fair mode reads no progression. 570×630 L-wall arena; PVE 510×566; training
  360×400. Formal camera 350×390; the guest view is flipped 180° and skill
  directions stay in screen coordinates.
- Region fights have no result screen but defeat: a win banks its rewards and
  hands the walk straight back, with the report as one expiring log line over the
  map. Flee and disengage take the same hand-back path and return the character
  to where the fight actually ended. Only death returns you to the stronghold.
- A PVE pause keeps the fight and offers to continue on resume; PVP settings
  never stop a match — hiding, disconnecting or timing out ends it. PVP writes no
  progression.

## Settled decisions (do not re-litigate)

Confirmed by the user — change only when explicitly asked:

- Four skills fixed: heal (up), haste (right), full charge (down), parry (left).
  Values live in `gameConfig.skills` + `skillOverrides`.
- Manual parry spends AP; parry *skill* spends SP. Independent.
- Player attack timings and guard/charge movement multipliers are settled;
  treat `gameConfig.training` as current values.
- Defaults: `controls.cancelAtCenter = true`, `controls.autoFace = false`.
  Idle keeps facing; movement turns to its own vector; light/guard startup
  never snaps toward enemy.
- Held movement pointer must never become a tap. Direct hit clears only
  right-hand input + queued command; stun stops movement but keeps the held
  gesture (resumes after stun).
- Camera follows by translation only; never changes world inputs/damage/snapshots.
  PVP guest 180° view is presentation only — input vectors are rotated back
  before prediction/networking; skill directions stay screen-relative.
- PVP never writes progression, passive healing or adventure rewards. Fair mode
  reads no equipment effects.
- Every enemy action template owns its own timing (`pve/spatial_data.js`).
  Never reintroduce legacy dmgMult timing path.
- Weapon charge timing is data-driven: one `chargeOffsetMs` per weapon in
  `game_config.js`, resolved by `combatRules.weaponChargeThresholdMs()`.

## Verification

`node --test "tests/*.test.cjs"` (Node expands the glob, so a new test file
needs no edit here).

Boot tests cover asset retry, the CSS-applied gate, style repair and the online
dependency's timeout/retry/cancel. Combat tests cover input, damage, skills,
lifecycle and network sync; `adventure-world` covers walking, gate facing and
arrival placement and the structure reach test, `region-combat` covers the fight
hand-off (engage, disengage, victory), monster respawn and interaction dispatch.
Rendering and network feel on a real phone still need a device. The browser
fixtures use an isolated save: `tests/base-browser.html` and
`tests/pvp-browser.html`; training reads no progression save at all.
