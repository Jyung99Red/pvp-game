# Spatial combat training (M1)

Open `training.html` over HTTP, or use the base screen's 走位训练场 button.
This is an isolated portrait PVE experiment with fixed stats, no progression,
no save writes and no connection to the original PVE/PVP battle state.

## Controls

- Action pad: release a short tap to light attack; drag beyond 12 CSS pixels
  to move immediately. A movement gesture stays movement until released.
- Hold within the dead zone for 240ms to enter stationary charge. Charge is
  measured from initial press and caps at 1.6s without auto-firing.
- Once charging, drag upward at least 32 CSS pixels within a 90-degree upward
  cone and release to heavy attack. Release in place, sideways or downward
  to cancel without spending AP. Returning to the touch origin disarms a
  prepared heavy attack. Screen-up is the gesture; the attack faces the enemy.
- Guard pad: hold to guard in place; drag relative to the initial contact to
  turn. Guard starts after 160ms, with a 180ms parry window. Only attacks from
  the front half-plane are blocked. Turning never refreshes that window.
- Guard overrides an existing movement gesture, which cannot resume until
  re-pressed. Charge/attack/recovery cannot be cancelled into guard.
- Pointer cancellation, lost capture, blur and backgrounding cannot fire an
  attack. Backgrounding pauses the fight and requires explicit resume.

## Combat and boundaries

The fixed 360 × 400 world is letterboxed into the responsive canvas. Render
scaling never changes collision or reach. Player and enemy are disk colliders;
attacks use disk/sector or disk/circle intersection and resolve once at their
active edge. Attack damage, windup and recovery are independent values.

The enemy alternates two frontal sweeps and a circular stomp. It tracks during
early windup, locks facing before release and leaves a recovery opening.
Light hits do not interrupt it. Heavy hits add two stagger points; parries add
one. Three points interrupt into a 1.5s opening. No rolls, obstacles or pathfinding.

Both player attacks cost one AP. Normal blocks cost one AP and take 25% damage;
parries cost half an AP and counter for 10 damage. AP regenerates while idle,
moving, recovering or stunned, but not while charging or guarding.
On a same-step lethal player hit, victory is settled before updating the enemy.

## Files and checks

- `core/spatial_combat.js`: pure geometry, turning and bounded movement.
- `core/combat_gestures.js`: pure gesture recognition, fixed CSS input thresholds;
  emits charge/light/heavy/cancel commands, without deciding AP or damage.
- `pve/spatial_data.js`: immutable fixed preset, actor spawns, action damage and
  timings, AI and stagger parameters. No equipment/save reads.
- `pve/spatial_engine.js`: sole combat implementation, validates commands,
  advances the simulation and emits semantic events. No text, colors or effects.
- `ui/combat_input.js`: one pointer per channel, capture/cancel and disposal.
- `ui/ui_spatial_battle.js`: root-scoped canvas/HUD renderer, event text mapping
  and transient effects; destroy disconnects its resize observer and removes AP dots.
- `pve/training.js`: page composition, pause/resume, retry, result overlay and one
  animation loop. Input invalidation releases browser capture in the same frame.
- `pve/training.css`: isolated responsive portrait layout (unchanged).

Script order: geometry → gestures → data → engine → input → view → training.
The main `index.html` now loads these same components for the formal dungeon,
using `pveProfiles` and prefixed DOM IDs; this page keeps the fixed training preset.

## Engine contract

`spatialEngine.create()` returns an independent training instance. `start`,
`pause`, `cancelInputs`, `press/drag/release`, `dispatch` and `step(b, seconds)`
are the only mutation entry points used by the page. Read the instance for
rendering; call `drainEvents` once after advancing and pass those events to the
view. The queue contains attack_started, strike (world geometry), hit, miss,
block, parry, stagger, hp_changed, charge_cancelled, ap_insufficient and finished.
Each event carries simulation time; finished is emitted once. Presentation
must not write the instance. `inputVersion` changes when all input is invalidated,
so the page can clear pointer capture after a hit, pause or finish.

The preset is frozen recursively. Profile/config validation is implemented; `create(config, random)` supports formal
profiles, with events and actor state isolated per instance.
The engine still clamps each step to 50ms and settles player damage before AI,
as in the original training implementation. It performs no offline catch-up.

Run `node --test tests/training.test.cjs` for gesture, geometry, guard and
resolution regressions. Browser QA should also cover actual two-finger input
on a phone, leaving a pad while captured, screen locking and resuming.

## Migration status / 2026-09-09

M1 extraction implemented. Original 11 regressions retained against the new
engine; additional coverage checks command rejection, events, input invalidation,
independent instances, two channels/third pointer, capture loss and disposal.
Browser smoke checks cover start/light hit, defeat/retry, pause/resume and portrait
layout. Actual phone multi-touch, long-hold/swipe and screen-lock QA remain manual.
Formal PVE now uses the same engine, including progression profiles and skills.
PVP keeps its original path. See `SPATIAL_MIGRATION.md` for implemented M2–M4 rules.
