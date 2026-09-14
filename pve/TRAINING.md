# Spatial combat training (M1)

Open `training.html` over HTTP, or use the base screen's 走位训练场 button.
This is an isolated PVE experiment with fixed stats, no progression,
no save writes and no connection to the original PVE/PVP battle state.

## Controls

- Central fixed pad: short tap releases a light attack along actual facing.
  Drag beyond 12 CSS pixels first to latch ordinary movement until release.
  Returning to the landing point never starts a charge during that gesture.
- Hold at the landing point for .25s to enter charge, then drag to move and turn.
  Charge time starts after this recognition delay. Release outside a 24px radius
  of the landing point to heavy attack, or inside to cancel (configurable).
  Attack direction is actual facing at release, including queued releases.
- Guard is upper-left, four-way skills upper-right. Guard can turn independently
  while the central pad moves. Charging excludes guard/skill pointer presses.
- At most two pointers, one per pad. Charge movement is 60%, turn 65%; a rapid
  reversal does not snap the attack to the drag target. Auto-face is idle-only
  and turn-rate-limited; attack/guard startup never snaps to the enemy.
- Movement pauses during attack/recovery/stun and resumes if still held;
  the next combat command is replaceable. Hits cancel charge and secondary input,
  but retain held movement with no tap/charge rearming; pause/cancel clears all.
- Weapon geometry stays fixed size; its swing angle follows the attack sector.
  The sector still grows with charge and is snapshotted for hit resolution.

## Combat and boundaries

The fixed 360 × 400 world is letterboxed into the responsive canvas. Render
scaling never changes collision or reach. Player and enemy are disk colliders;
attacks use disk/sector or disk/circle intersection and resolve once at their
active edge. Attack damage, windup and recovery are independent values.

The enemy alternates two frontal sweeps and a circular stomp. It tracks during
early windup, locks facing before release and leaves a recovery opening.
Light hits do not interrupt it. Heavy hits add one stagger point; parries add
one. Three points interrupt into a 1.5s opening. No rolls, obstacles or pathfinding.

Both player attacks cost one AP. Normal blocks cost one AP and take 25% damage;
parries cost half an AP and counter for 10 damage. AP regenerates while idle,
moving, recovering or stunned, but not while charging or guarding.
On a same-step lethal player hit, victory is settled before updating the enemy.

## Files and checks

- `core/spatial_combat.js`: pure geometry, turning and bounded movement.
- `core/combat_gestures.js`: pure gesture recognition, fixed CSS input thresholds;
  emits charge/light/heavy/cancel commands, without deciding AP or damage.
- `pve/spatial_data.js`: immutable `baseCombatPreset`, actor spawns, action damage and
  timings, AI and stagger parameters. No equipment/save reads.
- `pve/spatial_engine.js`: sole combat implementation, validates commands,
  advances the simulation and emits semantic events. No text, colors or effects.
- `ui/combat_input.js`: one pointer per channel, capture/cancel and disposal.
- `ui/ui_spatial_battle.js`: root-scoped canvas/HUD renderer, event text mapping
  and transient effects; destroy disconnects its resize observer and removes AP dots.
- `pve/training.js`: page composition, pause/resume, retry, result overlay and one
  animation loop. Input invalidation releases browser capture in the same frame.
- `pve/training.css` and `pve/combat_controls.css`: responsive layout and fixed
  feedback rows so attack logs never resize the canvas.

Script order: geometry → gestures → data → engine → settings → input → view → training.
The main `index.html` now loads these same components for the formal dungeon,
using `pveProfiles` and prefixed DOM IDs; this page uses `baseCombatPreset` directly.

## Engine contract

`spatialEngine.create()` returns an independent combat instance using
`baseCombatPreset` by default. `start`,
`pause`, `cancelInputs`, `press/drag/release`, `dispatch` and `step(b, seconds)`
are the only mutation entry points used by the page. Read the instance for
rendering; call `drainEvents` once after advancing and pass those events to the
view. The queue contains attack_started, strike (world geometry), hit, miss,
block, parry, stagger, hp_changed, charge_cancelled, ap_insufficient and finished.
Each event carries simulation time; finished is emitted once. Presentation
must not write the instance. `inputVersion` changes when all input is invalidated,
so the page can clear pointer capture after pause or finish. Hits increment
`actionInputVersion` to clear only secondary pointers.

The preset is frozen recursively. Profile/config validation is implemented; `create(config, random)` supports formal
profiles, with events and actor state isolated per instance.
The adapter advances fixed 10ms steps, processing skill-ready events at each step,
and renders once per display frame with explicit frameDt. Shield raising follows
guard startup progress; lowering follows frameDt. Resize redraws never advance
the pose. The engine still clamps each step to 50ms and settles player damage
before AI, with no offline catch-up.

Run `node --test tests/spatial-engine.test.cjs` for shared gesture, geometry, guard and
resolution regressions. Browser QA should also cover actual two-finger input
on a phone, leaving a pad while captured, screen locking and resuming.

## Migration status / 2026-09-09

M1 extraction implemented. Original 11 regressions retained against the new
engine; additional coverage checks command rejection, events, input invalidation,
independent instances, two channels/third pointer, capture loss and disposal.
Browser smoke checks cover start/light hit, defeat/retry, pause/resume and portrait
layout. Actual phone multi-touch, long-hold/swipe and screen-lock QA remain manual.
Formal PVE now uses the same engine, including progression profiles and skills.
PVP now shares human actor actions through spatialDuel. See `SPATIAL_MIGRATION.md`.
## Controls update / 2026-09-11

See `COMBAT_CONTROLS.md` for motion hooks, command buffering and animation timing.
The 2026-09-11 no-tests note is historical. The 2026-09-13 combined controls update
includes current gesture, turn-limit, cancellation, snapshot and shield-pose regressions.
