# STATUS.md

## Directory & load order

**Layout** (by domain):
- `core/` — shared state, registries, save, tick, combat rules
- `ui/` — base UI, fx, icons
- `pve/` — PVE engine + battle UI
- `pvp/` — PVP engine, network, room, battle UI
- Root: `index.html`, `style.css`, `partials/`, `icons/`

**Script load order** (`client-assets.json`):

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

## Current state

- PVE spatial migration is **closed**. PVP runs on the same shared engine
  (`pve/spatial_engine.js` + `core/spatial_profiles.js`). No legacy exchange /
  side-state / rule registry remains.
- PVP has protocol version + rule version + versioned arena layout. Any balance
  change that both clients must agree on needs a version bump.
- Training (`training.html`) is isolated: own arena/baseline, shares neither
  saves nor battle state with formal modes. Its page is a full-bleed battlefield
  with the topbar as the only in-flow row; vitals / feedback / pads float over
  it (`--train-topbar` / `--train-controls` must track the matching pad height in
  `pve/combat_controls.css`).
- All tunable numbers live in `game_config.js` only. This document does not
  repeat values.

### Region view (current implementation)

A region fight happens **inside** the region rather than replacing it.
`#view-adventure` is the only place the world is drawn. `uiAdventure` owns the
single rAF / view / input group / combat settings for the whole region session:

```
uiAdventure._frame (one rAF)
  ├─ adventureWorld.stepWorld(dt)   always
  └─ fighting → pveLogic.advance(dt) → view.render(fight)
     walking  → uiAdventure.updateFrame() → view.render(solo)
```

Entering combat is a config swap (`view.useConfig`), not a teardown. Camera is
carried across both presets. Key constraints while this design holds:

- Walk uses `advanceActor` on a `solo` preset (never `step`).
- Solo never charges and never banks SP, and a completed swing still has to end
  in `recover` (`soloStrike`) or the walker is `locked` in `attack` for good.
- The 3 pads are the only movement control in both modes. While walking with a
  building in reach, a resting TAP on the move pad is the interact key (the
  engine's `suppressTap`, no new engine surface); dragging still walks.
- `pveLogic._loop` is scene-less dev/test fallback only.
- PVP and training share view components but keep their own roots/prefixes/lifecycles.

HUD layout: the map fills the view (`body.region-view .content-area` loses its
gutter) and everything else floats — `.region-plate` and `.hud-buttons` while
walking, `.vitals`/`.legend`/`.arena-top` while fighting, switched by the single
`#view-adventure.walking` root class (`walk-only` / `fight-only`). The walking
hint is a translucent log line over the map, not a block under it.

The base has no page of its own any more: region `a` IS the base, its facilities
are `map.structures` you walk up to, and the old base panel's parts live in
`#character-overlay` plus the existing dialogs. There is no 基地 nav button —
getting home is the portals (`回城传送门 · 曙光据点` in c/d, unlocked with the
dragon, plus the gates already there).

## Settled decisions (do not re-litigate)

Confirmed by user — change only when explicitly asked:

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
