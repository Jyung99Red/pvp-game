// Every tunable number of the game, and nothing else. Units: world units
// (40 to a block) for positions, distances and speeds; seconds for time;
// radians for angles; CSS pixels for anything on the touch layer.
// docs/tasks/parameters.md mirrors this file.
const gameConfig = (() => {
    // The move tuner (tune.html) changes move timing live, so its page asks
    // for the table unfrozen; the game and the tests always freeze it.
    const freeze = value => {
        if (globalThis.unfrozenConfig === true) return value;
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    };
    return freeze({
        // 1. Scale. A block is 40 world units; the simulation keeps world
        // units so distances read the same as in the 2D version.
        world: { unitsPerBlock: 40 },

        // 2. The main character on foot.
        // speed: walking, world units/second at full stick. turnRate:
        // radians/second while turning towards the stick. radius: wall
        // collision. startSeconds: from a standstill to full walking speed.
        // turnSlow: walking straight away from the facing is this share
        // slower (easing with the angle) until the body has turned.
        // Running: after `runAfter` seconds of unbroken walking
        // with the stick pushed at least `runStick` of the way, speed eases up
        // to runSpeed over runRampSeconds (set apart from the walk, user
        // 2026-10-02: changing one leaves the other), and back down the same
        // way once the walk is broken (stick eased off or released, a wall).
        // sightAngle: the body sees only what lies within this of where it
        // faces (75 degrees either side: the front 150), and not past
        // blocks at least eye high; the rest of the ground is shaded, with
        // the blocks and plants on it (user, 2026-10-05), and a monster or
        // a rival there is not drawn (user, 2026-10-04: the same in the
        // adventure and in a duel). sightNear: world units round the body
        // it sees whichever way it faces, a little behind it too (user,
        // 2026-10-05: two blocks; it was one and a half); walls hide there
        // as well.
        player: { speed: 122, turnRate: 8, radius: 12, runAfter: 1.5, runSpeed: 252, runRampSeconds: 0.3, runStick: 0.9, startSeconds: 0.12, turnSlow: 0.5, sightAngle: Math.PI * 5 / 12, sightNear: 80 },

        // 3. Animation. blendSeconds: idle <-> walk cross-fade.
        animation: { blendSeconds: 0.1 },

        // 4. Sizes that will decide hits (design.md 4.3). The
        // body boxes themselves are model data in models/; these scale it.
        // playerScale multiplies the whole character. Blade lengths are on
        // the weapons (`items`, blocks).
        models: { playerScale: 1 },

        // 4b. Fighting rules shared by every fight (training, PVE, PVP).
        // fighters.base: the main character's stats before equipment (no
        // levels: equipment is the only growth, design.md 7.1); each
        // item worn adds its own (`items`). The starter gear makes 360 HP,
        // 30 ATK, 8 DEF; a duel is always fought in it.
        // hitStun: a hit that is not guarded freezes the one struck's
        // controls this long. weaponPad: weapon boxes grow by this much on
        // every side for hit tests only (design.md 4.3).
        // Damage = max(1, round(raw * (1 - DEF / (DEF + defenseConstant)))).
        // A blocked hit does the guard's blockMultiplier of that (`guard`);
        // a perfect parry hits back for atk * parryAtkRatio. Impact: on contact both fighters'
        // clocks stop for `hitstop`; then the one struck is pushed
        // `knockback` units over knockbackSeconds. Player moves carry their
        // own knockback in the combo table; these are for hits on the
        // player, blocks and parries. Stagger: points from moves (and
        // `parry`) fill to `threshold`, then the target reels `duration`.
        combat: {
            fighters: { base: { maxHp: 340, atk: 22, def: 4 } },
            hitStun: 0.35, weaponPad: 8,
            damage: { defenseConstant: 17.5, parryAtkRatio: 0.5 },
            impact: { hitstop: { hit: 0.06, block: 0.04, parry: 0.08 }, knockback: { hit: 10, block: 5, parry: 8 }, knockbackSeconds: 0.12 },
            stagger: { threshold: 3, duration: 1.5, parry: 1 },
            // The opening B: held past its windup it charges. Charge time
            // counts from the press; damage grows from `threshold` to `full`
            // seconds. While charging the body walks and turns slower.
            charge: { threshold: 0.3, full: 2.3, moveMultiplier: 0.6, turnMultiplier: 0.65 },
            // The guard key: guarding is the defence, there is no dodge
            // (user, 2026-10-03). `startup` from press to up; only hits from
            // within frontAngle of facing are blocked (60 degrees either
            // side: the front 120; user, 2026-10-04, it was 180). What it guards with
            // decides the rest: the shield when one is carried, else the
            // weapon, weaker (user: shield 120, weapon 80 against the old
            // shield's 100). blockMultiplier: the share of the damage a
            // block lets through; blockCostScale: what a block costs of the
            // guard bar; a hit within parryWindow of the guard coming up is a
            // perfect parry. shove: a perfect parry pushes the shield (or
            // the weapon hand) forward, as if throwing the blow back (user,
            // 2026-10-05): out over `out` seconds once the hitstop is over,
            // held `stay`, back over `back`. A pose only: it locks nothing,
            // and goes with the guard as soon as the guard is lowered.
            guard: {
                startup: 0.16, moveMultiplier: 0.3, turnMultiplier: 0.5, frontAngle: Math.PI / 3,
                shove: { out: 0.07, stay: 0.12, back: 0.25 },
                shield: { blockMultiplier: 0.2, blockCostScale: 2, parryWindow: 0.22 },
                weapon: { blockMultiplier: 0.3, blockCostScale: 3, parryWindow: 0.15 }
            },
            // Guard bar (points). Raising costs raiseCost, holding drains
            // holdDrain a second, a blocked hit costs
            // raw / maxHp * blockCostScale * max (a parry parryCostRatio of
            // that). Down, it refills in refillSeconds; emptied, the guard
            // stays locked until it is back to unlockRatio.
            guardBar: { max: 100, raiseCost: 10, holdDrain: 10, parryCostRatio: 0.5, refillSeconds: 3, unlockRatio: 0.4 },
            // A potion in the offhand, drunk with the offhand key: a drink takes
            // `seconds`, walking and turning slowed meanwhile, and heals
            // `heal` of max HP at the end; a blow that gets through spills
            // it (the potion is kept). Pressed in a move or a stun, it waits
            // for that to be over.
            potion: { seconds: 0.8, heal: 0.3, moveMultiplier: 0.3, turnMultiplier: 0.5 }
        },

        // 4c. Player moves (design.md 4.1, 4.2). Every weapon belongs to a
        // weapon type (`items.*.weapon`), and the type has its own move tree:
        // `weapons.<type>.root` is what A and B start out of a combo, and
        // `standard` the distance (centre to centre, world units) every move
        // of the type must land at (tests). `moves` holds the moves of every
        // type, each naming its `weapon`; ids are unique across types.
        // Each move: windup -> swing -> recovery, seconds. Only the swing
        // hits. `derive`, counted from the swing's end, is when a buffered
        // input that `next` derives cuts the recovery short; a finisher has
        // none, and an input with no entry starts over from the root once
        // the recovery is over. `next` maps the next input -- A, B, or A
        // after a pause -- to the move it derives. ratio: damage per ATK;
        // stagger: stagger points (whole numbers, user 2026-10-02);
        // knockback: world units the target is pushed; step: how far the
        // body moves along its facing during the swing (negative: back). A
        // `charge` move grows ratio by chargeRatio and step by chargeStep
        // with its charge. Shapes and reach come from the key poses
        // (models/player_moves.js).
        // weapons.<type>.pauseAfterRecovery: the pause line after a
        // recovery ends (the sword's a little sooner, user 2026-10-02);
        // windowAfterRecovery: the chain resets this long after;
        // bufferSeconds: an input pressed ahead that has not run within this
        // long is dropped. holdSeconds: one attack key gives A and B (user,
        // 2026-10-03): let go sooner it is an A, held this long a B; a move
        // that starts at once begins that far into its windup, so telling
        // them apart costs no time. windupTurnMultiplier: in a windup the
        // stick turns the body at this share of player.turnRate; the swing
        // locks the facing and the recovery does not turn (user,
        // 2026-10-02).
        combo: {
            windowAfterRecovery: 0.7, bufferSeconds: 0.5, holdSeconds: 0.2, windupTurnMultiplier: 1 / 3,
            weapons: {
                // Heavy and far-reaching: everything a beat slower than the dagger.
                sword: { name: '剑', root: { a: 'slash', b: 'charged' }, standard: 60, pauseAfterRecovery: 0.15 },
                // Quick and close: chains up to six moves; B inside a combo flicks and goes on.
                dagger: { name: '短刃', root: { a: 'cut', b: 'lunge' }, standard: 48, pauseAfterRecovery: 0.2 }
            },
            moves: {
                slash: { weapon: 'sword', name: '斜斩', windup: 0.13, swing: 0.10, recovery: 0.32, derive: 0.15, ratio: 0.36, stagger: 0, knockback: 0, step: 3, next: { a: 'backslash', b: 'rising' } },
                backslash: { weapon: 'sword', name: '回扫', windup: 0.13, swing: 0.10, recovery: 0.39, derive: 0.17, ratio: 0.38, stagger: 0, knockback: 0, step: 3, next: { a: 'smite', b: 'cleave', pause: 'thrust' } },
                smite: { weapon: 'sword', name: '重斩', windup: 0.22, swing: 0.23, recovery: 0.55, ratio: 0.52, stagger: 0, knockback: 0, step: 0 },
                thrust: { weapon: 'sword', name: '连刺', windup: 0.30, swing: 0.08, recovery: 0.56, ratio: 0.61, stagger: 0, knockback: 0, step: 15 },
                rising: { weapon: 'sword', name: '上挑', windup: 0.38, swing: 0.12, recovery: 0.57, ratio: 0.74, stagger: 2, knockback: 16, step: 3 },
                cleave: { weapon: 'sword', name: '下劈', windup: 0.38, swing: 0.10, recovery: 0.59, ratio: 0.80, stagger: 2, knockback: 16, step: 5 },
                charged: { weapon: 'sword', name: '蓄力斩', windup: 0.54, swing: 0.14, recovery: 0.63, derive: 0.30, ratio: 0.36, chargeRatio: 0.96, stagger: 2, knockback: 20, step: 4, chargeStep: 13, charge: true, next: { a: 'follow' } },
                follow: { weapon: 'sword', name: '追斩', windup: 0.13, swing: 0.10, recovery: 0.51, ratio: 0.48, stagger: 0, knockback: 0, step: 3 },
                cut: { weapon: 'dagger', name: '斜切', windup: 0.10, swing: 0.08, recovery: 0.30, derive: 0.12, ratio: 0.26, stagger: 0, knockback: 0, step: 4, next: { a: 'recut', b: 'flick' } },
                recut: { weapon: 'dagger', name: '反切', windup: 0.10, swing: 0.08, recovery: 0.32, derive: 0.12, ratio: 0.26, stagger: 0, knockback: 0, step: 4, next: { a: 'stab', b: 'flick', pause: 'retreat' } },
                stab: { weapon: 'dagger', name: '直刺', windup: 0.10, swing: 0.06, recovery: 0.34, derive: 0.13, ratio: 0.30, stagger: 0, knockback: 0, step: 10, next: { a: 'whirl', b: 'flick' } },
                whirl: { weapon: 'dagger', name: '旋刃', windup: 0.14, swing: 0.16, recovery: 0.40, derive: 0.16, ratio: 0.36, stagger: 0, knockback: 0, step: 2, next: { a: 'drop' } },
                drop: { weapon: 'dagger', name: '落刃', windup: 0.22, swing: 0.10, recovery: 0.60, ratio: 0.70, stagger: 1, knockback: 14, step: 8 },
                flick: { weapon: 'dagger', name: '挑刃', windup: 0.16, swing: 0.08, recovery: 0.36, derive: 0.14, ratio: 0.42, stagger: 1, knockback: 10, step: 4, next: { a: 'whirl' } },
                lunge: { weapon: 'dagger', name: '突刺', windup: 0.18, swing: 0.10, recovery: 0.45, derive: 0.16, ratio: 0.48, stagger: 1, knockback: 10, step: 30, next: { a: 'recut' } },
                retreat: { weapon: 'dagger', name: '退步斩', windup: 0.08, swing: 0.08, recovery: 0.40, ratio: 0.40, stagger: 0, knockback: 0, step: -26 }
            }
        },

        // 4d. Training dummy: anchored where the map puts it, never walks,
        // turns or gets pushed. It attacks its moves in turn, `delay` apart,
        // while the player is within engageRange. radius: body collision.
        // clubLength: blocks. flinchSeconds: how long a hit jolts it back.
        // Move times are seconds, ratio is per ATK.
        dummy: {
            name: '训练木桩', maxHp: 600, atk: 24, def: 1, radius: 14, engageRange: 120, firstDelay: 0.8, delay: 0.45, clubLength: 0.9, flinchSeconds: 0.22,
            moves: [
                { id: 'swipe', name: '快斩', windup: 1.3, swing: 0.16, recovery: 0.95, ratio: 0.6 },
                { id: 'smash', name: '重击', windup: 1.6, swing: 0.16, recovery: 1.15, ratio: 1.0 }
            ]
        },

        // 4e. Monsters (design.md 5): patrol from waypoint to waypoint
        // patrolRadius round home at patrolSpeed, resting patrolRest at
        // each; notice the player within alertRange and in sight (no block
        // two high between) and stand alert for alertSeconds; then fight
        // (design.md 5.2), turning at turnRate, walking round walls in the
        // way (`radius` decides what gap it fits through).
        // Free again (firstDelay after the alert, `delay` after a move or a
        // reel) it decides: a player more than turnFirst off its facing
        // first gets turned to; then by distance, `near` (within the reach
        // of any move of its near table, not counting its lunge), `mid`
        // (else within the reach of any move of its mid table, lunge and
        // all) or far. Far, it closes in at `speed`; near or mid it rolls
        // that band's table (move: weight), leaving out moves that do not
        // reach the player that way or are cooling down (`cooldown` seconds
        // from the windup). Light moves are quick and leave a short gap, heavy
        // ones slow with a long one (user, 2026-10-03: a wider range); every
        // gap still holds a combo, and every windup leaves time to guard.
        // `approach` walks at `speed` for up to approachSeconds or until
        // the player is near, then decides again. In the gap after a move it faces the player and
        // creeps at patrolSpeed to standOff of its near band's edge. A
        // move's reach comes from its key poses (core/monster.js), never
        // from here. During a windup the body keeps turning to the player
        // at trackTurn until `lock` seconds before the swing (a bite only
        // the last moment: it follows a step aside). Past `leash`
        // from home with the player out of alertRange it walks back home.
        // At enrage.threshold of its HP it enrages for good: damage times
        // enrage.atk, its whole clock (cooldowns too) times enrage.tempo.
        // HP is the old value times the old hpScale 3, and so is ATK, to
        // keep the old danger (the 2D version). Moves, by name (the key
        // poses of the same name, or of `pose`): seconds; ratio per ATK;
        // step: world units lunged during the swing; ram: the body itself
        // is the weapon (the wolf's leap). reactSeconds: how soon a player
        // is taken to react to a warning; only the tests read it (every
        // blow can be guarded, the guard pressed this long after the
        // warning shows: user 2026-10-03, no dodge). corpseSeconds: a
        // fallen monster lies this long, then sinks away. loot: the table
        // rolled when it falls (`loot` below). stagger: points that make it
        // reel (else combat.stagger.threshold; bosses take 10, user
        // 2026-10-02). A monster that gets home after giving up a chase is
        // whole again. pack: at most this many of the kind are in a move at
        // once (windup to recovery; user, 2026-10-03: two wolves); the
        // others wait their turn, packStandOff of their near band's edge
        // from the player. No `pack`: no limit.
        // Bosses (design.md 5): `model` is the skeleton they are
        // built on, `scale` how much bigger, `look` their colours
        // (models/); a boss down stays down and opens what waits on it.
        monsters: {
            corpseSeconds: 2.5, approachSeconds: 0.8, turnFirst: Math.PI / 4, reactSeconds: 0.35, packStandOff: 1.5,
            goblin: {
                name: '哥布林', loot: 'goblin', maxHp: 105, atk: 36, def: 3, radius: 12, speed: 54, turnRate: 3, trackTurn: 1.6,
                patrolRadius: 60, patrolSpeed: 16, patrolRest: 1.4, alertRange: 150, alertSeconds: 0.5, leash: 260, standOff: 0.85,
                firstDelay: 0.3, delay: 0.45, flinchSeconds: 0.22, enrage: { threshold: 0.3, atk: 1.3, tempo: 1.2 },
                moves: {
                    flail: { name: '乱挥', windup: 0.85, lock: 0.35, swing: 0.16, recovery: 1.45, ratio: 0.6, step: 8 },
                    pounce: { name: '猛扑', windup: 1.35, lock: 0.4, swing: 0.2, recovery: 2.0, ratio: 0.9, step: 36, cooldown: 5 }
                },
                near: { flail: 1 },
                mid: { pounce: 1, approach: 2 }
            },
            wolf: {
                name: '野狼', loot: 'wolf', maxHp: 90, atk: 54, def: 2, radius: 16, speed: 78, turnRate: 3, trackTurn: 1.6,
                patrolRadius: 80, patrolSpeed: 22, patrolRest: 1.0, alertRange: 180, alertSeconds: 0.4, leash: 300, standOff: 0.85, pack: 2,
                firstDelay: 0.3, delay: 0.45, flinchSeconds: 0.22, enrage: { threshold: 0.3, atk: 1.3, tempo: 1.2 },
                moves: {
                    bite: { name: '撕咬', windup: 0.72, lock: 0.17, swing: 0.16, recovery: 1.1, ratio: 0.6, step: 35 },
                    leap: { name: '扑击', windup: 1.25, lock: 0.35, swing: 0.54, recovery: 2.2, ratio: 0.9, step: 150, ram: true, cooldown: 6 }
                },
                near: { bite: 1 },
                mid: { leap: 1, approach: 2 }
            },
            goblinChief: {
                name: '哥布林头目', model: 'goblin', scale: 1.45, look: 'chief', boss: true, loot: 'goblinChief', stagger: 10,
                maxHp: 450, atk: 48, def: 5, radius: 18, speed: 50, turnRate: 2.6, trackTurn: 1.4,
                patrolRadius: 0, patrolSpeed: 16, patrolRest: 2, alertRange: 190, alertSeconds: 0.7, leash: 360, standOff: 0.85,
                firstDelay: 0.5, delay: 0.6, flinchSeconds: 0.18, enrage: { threshold: 0.5, atk: 1.25, tempo: 1.2 },
                moves: {
                    flail: { name: '横扫', windup: 0.8, lock: 0.3, swing: 0.2, recovery: 1.2, ratio: 0.6, step: 10 },
                    slam: { name: '震地', windup: 1.5, lock: 0.4, swing: 0.18, recovery: 2.4, ratio: 1.0, step: 6, cooldown: 4 },
                    pounce: { name: '猛扑', windup: 1.25, lock: 0.35, swing: 0.24, recovery: 2.2, ratio: 0.85, step: 60, cooldown: 6 }
                },
                near: { flail: 3, slam: 2 },
                mid: { pounce: 1, approach: 2 }
            },
            wolfKing: {
                name: '狼王', model: 'wolf', scale: 1.4, look: 'king', boss: true, loot: 'wolfKing', stagger: 10,
                maxHp: 420, atk: 60, def: 4, radius: 22, speed: 88, turnRate: 3, trackTurn: 1.8,
                patrolRadius: 0, patrolSpeed: 22, patrolRest: 2, alertRange: 210, alertSeconds: 0.6, leash: 380, standOff: 0.85,
                firstDelay: 0.4, delay: 0.5, flinchSeconds: 0.18, enrage: { threshold: 0.5, atk: 1.25, tempo: 1.25 },
                moves: {
                    bite: { name: '撕咬', windup: 0.85, lock: 0.12, swing: 0.16, recovery: 1.1, ratio: 0.6, step: 58 },
                    // The same bite, sooner and with a longer recovery.
                    quickBite: { name: '快咬', pose: 'bite', windup: 0.65, lock: 0.12, swing: 0.16, recovery: 1.3, ratio: 0.6, step: 58 },
                    leap: { name: '扑击', windup: 1.15, lock: 0.3, swing: 0.6, recovery: 2.3, ratio: 0.9, step: 190, ram: true, cooldown: 5 }
                },
                near: { bite: 1, quickBite: 1 },
                mid: { leap: 1, approach: 2 }
            }
        },

        // 4f. Items and loot (design.md 6.4, 7). items: everything that
        // can be carried, with its name, icon and line for the screens.
        // kind: gold | material | gear | supply. Gear goes in a `slot`
        // (main, offhand, armor, accessory) and adds its `stats`; a weapon's
        // `blade` (blocks) decides its reach (the two swords share one size,
        // only their colours differ: user 2026-10-02); an offhand item's
        // `offhand` is what it is for: a shield is what the guard key guards
        // with (the weapon guards without one), a torch or a potion is used
        // with the offhand key. `max`:
        // how many can be owned. `price`: what the shop sells it for;
        // `sell`: what it pays for one. `recipe`: what the smithy wants for
        // it (gold and materials). Gear is never lost; potions are used up.
        items: {
            gold: { kind: 'gold', name: '金币', icon: '🪙', desc: '打怪和开宝箱得来，在商店和铁匠铺花。' },
            goblin_ear: { kind: 'material', name: '哥布林耳', icon: '👂', sell: 4, desc: '哥布林掉的。铁匠铺打造要用，商店也收。' },
            wolf_pelt: { kind: 'material', name: '狼皮', icon: '🐺', sell: 6, desc: '野狼掉的。铁匠铺打造要用，商店也收。' },
            chief_tusk: { kind: 'material', name: '头目獠牙', icon: '🦷', sell: 30, desc: '哥布林头目的獠牙。能打成护符。' },
            king_fang: { kind: 'material', name: '狼王之牙', icon: '🦴', sell: 40, desc: '狼王的牙。能打成项链。' },
            iron_ore: { kind: 'material', name: '铁矿石', icon: '🪨', sell: 3, desc: '原野和山谷的铁矿石块里采来的。铁匠铺打造铁器要用。' },
            crystal: { kind: 'material', name: '晶石', icon: '💎', sell: 10, desc: '千柱窟里采来的晶石。能镶在饰品上。' },
            herb: { kind: 'material', name: '草药', icon: '🌿', sell: 2, desc: '野外的草药丛采来的。能编进护符，商店也收。' },
            potion: { kind: 'supply', slot: 'offhand', offhand: 'potion', name: '药水', icon: '🧪', price: 15, max: 5, desc: '放在副手。按副手键喝一口，回复三成生命；挨打会洒掉这一口（药水还在）。' },
            torch: { kind: 'gear', slot: 'offhand', offhand: 'torch', name: '火把', icon: '🔥', price: 30, max: 1, desc: '放在副手。按副手键点燃或熄灭，照亮暗处；带着它对枯木丛按交互键就能烧掉。拿着火把时只能用武器挡，也不能拿火把打。' },
            wooden_sword: { kind: 'gear', slot: 'main', weapon: 'sword', name: '木剑', icon: '🗡️', stats: { atk: 8 }, blade: 0.92, max: 1, desc: '开局带着的剑。' },
            assassin_dagger: { kind: 'gear', slot: 'main', weapon: 'dagger', name: '刺客短刃', icon: '🔪', stats: { atk: 11 }, blade: 0.6, max: 1, recipe: { gold: 40, materials: { wolf_pelt: 2, iron_ore: 2 } }, desc: '短刃。比剑短，要贴得更近；出招快，连段最长六段，起手 B 是往前冲的突刺。' },
            iron_sword: { kind: 'gear', slot: 'main', weapon: 'sword', name: '铁剑', icon: '⚔️', stats: { atk: 16 }, blade: 0.92, max: 1, recipe: { gold: 80, materials: { iron_ore: 5, goblin_ear: 2 } }, desc: '和木剑一样长，铁打的刃，攻击高得多。' },
            wooden_shield: { kind: 'gear', slot: 'offhand', offhand: 'shield', name: '木盾', icon: '🛡️', stats: { def: 2 }, max: 1, desc: '开局带着的盾。按住格挡键用盾挡，比用武器挡更稳。' },
            iron_shield: { kind: 'gear', slot: 'offhand', offhand: 'shield', name: '铁盾', icon: '🔰', stats: { def: 6 }, max: 1, recipe: { gold: 80, materials: { iron_ore: 4, wolf_pelt: 2 } }, desc: '更结实的盾。' },
            cloth_armor: { kind: 'gear', slot: 'armor', name: '布甲', icon: '👕', stats: { def: 2, maxHp: 20 }, max: 1, desc: '开局穿着的衣服。' },
            iron_armor: { kind: 'gear', slot: 'armor', name: '铁甲', icon: '🥋', stats: { def: 7, maxHp: 40 }, max: 1, recipe: { gold: 100, materials: { iron_ore: 6, wolf_pelt: 3 } }, desc: '加了肩甲和胸甲。' },
            chief_charm: { kind: 'gear', slot: 'accessory', name: '头目护符', icon: '📿', stats: { maxHp: 50 }, max: 1, recipe: { gold: 60, materials: { chief_tusk: 1, herb: 3 } }, desc: '用头目的獠牙打的护符。' },
            fang_necklace: { kind: 'gear', slot: 'accessory', name: '狼牙项链', icon: '🦷', stats: { atk: 4 }, max: 1, recipe: { gold: 60, materials: { king_fang: 1, crystal: 2 } }, desc: '用狼王的牙和晶石穿的项链。' }
        },
        // What a new game starts with, worn (a duel is fought in this too).
        gear: { starter: { main: 'wooden_sword', offhand: 'wooden_shield', armor: 'cloth_armor', accessory: null } },
        loot: {
            goblin: [{ item: 'gold', chance: 1, amount: [2, 5] }, { item: 'goblin_ear', chance: 0.85, amount: [1, 2] }],
            wolf: [{ item: 'gold', chance: 1, amount: [2, 4] }, { item: 'wolf_pelt', chance: 0.9, amount: [1, 2] }],
            goblinChief: [{ item: 'gold', chance: 1, amount: [20, 30] }, { item: 'chief_tusk', chance: 1, amount: [1, 1] }],
            wolfKing: [{ item: 'gold', chance: 1, amount: [25, 35] }, { item: 'king_fang', chance: 1, amount: [1, 1] }],
            chiefChest: [{ item: 'gold', chance: 1, amount: [40, 60] }, { item: 'goblin_ear', chance: 1, amount: [2, 4] }, { item: 'wolf_pelt', chance: 1, amount: [1, 2] }],
            kingChest: [{ item: 'gold', chance: 1, amount: [60, 90] }, { item: 'wolf_pelt', chance: 1, amount: [3, 5] }],
            caveChest: [{ item: 'gold', chance: 1, amount: [50, 80] }, { item: 'crystal', chance: 1, amount: [2, 3] }, { item: 'wolf_pelt', chance: 1, amount: [2, 3] }],
            ironOre: [{ item: 'iron_ore', chance: 1, amount: [1, 2] }],
            crystal: [{ item: 'crystal', chance: 1, amount: [1, 1] }],
            herb: [{ item: 'herb', chance: 1, amount: [1, 2] }]
        },
        // Loot on the ground (world units, seconds). It pops out at
        // popSpeed[0..1] and up to popHeight over popSeconds, lies still,
        // and once restSeconds old flies to a fighter within pickupRange at
        // pullSpeed (lifting to pullHeight), picked up within
        // collectDistance. radius: wall collision while it pops.
        drops: { radius: 4, popSeconds: 0.45, popHeight: 24, popSpeed: [30, 80], restSeconds: 0.5, pickupRange: 64, pullSpeed: 280, pullHeight: 14, collectDistance: 10 },

        // 4g. The interact key (design.md 3.5). A target
        // is picked within `reach` of the fighter (world units), scored by
        // distance plus facingWeight per radian off the facing; the target
        // already picked keeps it out to `release` and scores holdBonus
        // better. chestHold: seconds the key is held to open a chest.
        // hand: the left hand goes a little forward to interact (user,
        // 2026-10-04): out over `out` seconds, kept out while a hold fills
        // and `stay` seconds after a use, back over `back`.
        interact: { reach: 56, release: 72, facingWeight: 18, holdBonus: 10, chestHold: 0.6, hand: { out: 0.12, stay: 0.3, back: 0.2 } },
        // Props: chestRadius (a chest is solid); arriveDistance, how far
        // in front of the portal back someone arriving stands. A thicket
        // set alight sets its neighbours alight after burnSpread seconds
        // and is gone after burnSeconds.
        props: { chestRadius: 14, arriveDistance: 64, burnSpread: 0.35, burnSeconds: 1.4 },
        // Resources (design.md 6.5): held `hold` seconds with the interact
        // key, each throws out its loot table and is gone until it grows
        // back: once regrowSeconds of play have passed, the next visit to
        // its region finds it again.
        gather: {
            regrowSeconds: 300,
            ore: { name: '铁矿', verb: '采矿', hold: 1.0, loot: 'ironOre' },
            crystal: { name: '晶石', verb: '采矿', hold: 1.2, loot: 'crystal' },
            herb: { name: '草药', verb: '采集', hold: 0.4, loot: 'herb' }
        },
        // Buildings of the base: name, the interact key's verb, and what it
        // does -- `rest` refills HP, `open` opens the building's panel.
        buildings: {
            hotSpring: { name: '温泉', verb: '泡温泉', action: 'rest' },
            smithy: { name: '铁匠铺', verb: '进入', action: 'open' },
            shop: { name: '商店', verb: '进入', action: 'open' },
            storage: { name: '仓库', verb: '进入', action: 'open' }
        },

        // 5. Fixed oblique camera (design.md 1). yaw 0 keeps
        // screen-up on -z; pitch is the angle down from the horizon;
        // distance and lookHeight are blocks (distance a little further
        // out, user 2026-10-02); fov is vertical, in degrees. zoom: the
        // distance multiplier each camera setting of the menu picks.
        camera: { yaw: 0, pitch: 0.96, distance: 11.5, fov: 34, lookHeight: 0.8, zoom: { near: 0.85, mid: 1, far: 1.15 } },

        // 6. Rendering cost. Shadow map size by screen class (short side
        // under 700 CSS px is small); shadowExtent is the half-width in
        // blocks of the shadowed area around the player. The menu's power
        // saver draws at saverPixelRatio and without sun shadows.
        graphics: { pixelRatioMax: 2, saverPixelRatio: 1, shadowMapSmall: 1024, shadowMapLarge: 2048, shadowExtent: 13 },

        // 7. Touch and keyboard. deadZone and ramp: stick offset (CSS px)
        // below which nothing moves, and beyond which speed reaches full
        // over `ramp` more pixels. stickRadius: knob travel. maxTouches:
        // two thumbs (design.md 3.2).
        input: {
            deadZone: 12, ramp: 32, stickRadius: 52, maxTouches: 2,
            keys: {
                up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
                left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
                attack: ['KeyJ'], offhand: ['KeyK'], guard: ['KeyL'], interact: ['KeyE']
            }
        },

        // 8. Button layout (design.md 3.2). Each button's
        // centre is `x` from its `side` edge and `y` from the bottom edge,
        // both inside the safe area; `size` is the diameter. The stick
        // appears wherever the bottom-left zone (zoneWidth x zoneHeight from
        // the safe area's corner, out to the screen edges) is pressed, and
        // rests faintly at (restX, restY) from the bottom-left.
        controlsLayout: {
            minGap: 10,
            buttons: {
                attack: { side: 'right', x: 78, y: 72, size: 84 },
                offhand: { side: 'right', x: 70, y: 162, size: 72 },
                guard: { side: 'right', x: 176, y: 56, size: 72 },
                interact: { side: 'left', x: 64, y: 196, size: 56 }
            },
            stick: { zoneWidth: 250, zoneHeight: 190, restX: 120, restY: 96 }
        },

        // 9. Maps (design.md 6.3: the base, two regions, the training
        // ground and the PVP arena). One character per block: `.` grass,
        // `:` path, `=` cobble, `;` gravel, `~` a pond (no body walks in;
        // it is seen across and struck across), `_` the drop beyond a
        // cliff's edge (the same, and nothing is drawn there), `+` a wooden
        // fence (1 high, seen over), `1`-`9` stone wall of that many
        // blocks, `T` tree, `H` a building's wall (3 high), `#` a portal's
        // pillar (3 high), `P` a portal's opening, `B` a dry thicket (2
        // high), `*` a hedge (1 high, seen over: a map's soft edge), `O` iron
        // ore and `X` crystal (1-high boulders), `h` a herb
        // (walked through), `C` a chest, `@` grass
        // where the player starts when not arriving through a portal (a
        // duel: the host on the first, the guest on the second, in reading
        // order), `D` the training dummy (facing `dummyFacing`, radians),
        // and monster homes: `g` goblin, `w` wolf, `G` the goblin chief, `K`
        // the wolf king; `B` a dry thicket (2 high, burnt away by a lit
        // torch). Rows run north (screen top) to south.
        // Next to the rows: `buildings` ({ kind, at: [col, row, width,
        // depth] over its H blocks, door: side, south by default}),
        // `portals` ({ at: [col, row] of its P, to: map, facing: the side
        // that leads into this map, requires: a boss to be down first }),
        // `chests` ({ at, loot, requires }). Someone arriving stands in front
        // of the portal that leads back. `training`: nobody falls there (an
        // emptied HP bar refills); elsewhere the player can fall. `safe`: no
        // monsters. `duel`: the map is for PVP only. `dark`: no daylight,
        // only a torch lights it (drawn). `floor`: the letter of the ground
        // the markers lie on (grass by default).
        maps: {
            // The base, a village (design.md 6.3): no monsters. Four
            // buildings; the north gate to the field, the east gate to the
            // training ground (the valley is reached through the field only:
            // user, 2026-10-04). Every portal goes
            // out by the side its map lies on, and comes in on the far map's
            // opposite side (user, 2026-10-04).
            base: {
                name: '曙光村', safe: true,
                rows: [
                    '.....TT........T.....T...T........',
                    '...TTT...............T.....T...T..',
                    'T................................T',
                    '...333333333333#P#3333333333333..T',
                    '.T.3............:.............3...',
                    '...3..HHHH......:....HHHH.....3...',
                    '.T.3..HHHH......:....HHHH.....3..T',
                    'T..3..HHHH......:....HHHH.....3..T',
                    'T..3....================......#...',
                    '...3....================::::::P...',
                    '...3....================......#...',
                    '...3....================HHHH..3...',
                    '...3....================HHHH..3...',
                    '...3....================HHHH..3...',
                    'T..3....================......3..T',
                    '...3........:.................3...',
                    '...3..HHHH..:...@.............3.TT',
                    '...3..HHHH..:.................3...',
                    '...3..HHHH..:.................3...',
                    '...3.....::::.................3...',
                    '.T.3222222222222222222222222223...',
                    '..................................',
                    '..................................',
                    '..................................'
                ],
                buildings: [
                    { kind: 'hotSpring', at: [6, 5, 4, 3] }, { kind: 'smithy', at: [21, 5, 4, 3] },
                    { kind: 'shop', at: [24, 11, 4, 3] }, { kind: 'storage', at: [6, 16, 4, 3] }
                ],
                portals: [
                    { at: [16, 3], to: 'field', facing: 'south' },
                    { at: [30, 9], to: 'clearing', facing: 'west' }
                ]
            },
            // The first region, wide and open (the second draft of the
            // redrawn map: user, 2026-10-04): a rocky ridge on the west and
            // north, a cliff on the east, a wooden fence on the south. A pond
            // west of the middle, the road from the south gate round its
            // south shore and up to the goblin chief's walled yard in the
            // north-east (the gate to the valley and a chest). Goblins along
            // the road, wolves off it.
            field: {
                name: '晨雾原野',
                rows: [
                    '45444544454445444544566545444544465445444766676667666766___',
                    '44343333334343433333455533333343445333333656555555656565___',
                    '44223223222222232232344332232222233322322544544544444445___',
                    '54211111111111111111333211111111123111111333333#P#333333___',
                    '4431................1131.........11......3.....:.......3___',
                    '4331..................1..............T...3.....:.....C.3___',
                    '4321...23O...............................3..1..:.......3___',
                    '5321....2...............T..............T.3.....:.......3___',
                    '4321.............w.......................3......G......3___',
                    '4321.....................................3.............3___',
                    '4321.....................................3.............3___',
                    '64421......T.................h..T........3.........1...3___',
                    '654321...................................3.............3___',
                    '54321....................................3.............3___',
                    '4321....................h...............333333..33333333___',
                    '5321...................................22.....::........___',
                    '4321...........~~~............................::........___',
                    '4331..........~~~~~...........................::.......____',
                    '4331.........~~~~~~~..........................::.......____',
                    '5321.........~~~~~~~....................::::::::........___',
                    '4421.........~~~~~~~..................::::::::::........___',
                    '55331........~~~~~~~................:::::.........g..1..___',
                    '664331........~~~~~.......g...1...:::::............O....___',
                    '5421...........~~~..........1...:::::...g........1..g...___',
                    '4431..........................:::::...g............1.2.____',
                    '4331..h.........:::::::::::::::::......................____',
                    '4321...........::::::::::::::::......................._____',
                    '5321.........:::::...................................._____',
                    '4321.......:::::.......................................____',
                    '54321......:::..........................................___',
                    '4321......::........................h..............O....___',
                    '5331......::..................g.................w......____',
                    '4321......::..h...1O.................................._____',
                    '4321......::.@...................................h...._____',
                    '4321......::...................1.......................____',
                    '5321......::................1....1......................___',
                    '4321++++2#P#2++++++++++++++++++++++++++++++++++++++++++____',
                    '4331...................................................____',
                    '4331.................................................._____',
                    '5321.................................................._____'
                ],
                portals: [
                    { at: [10, 36], to: 'base', facing: 'north' },
                    { at: [48, 3], to: 'valley', facing: 'south', requires: 'goblinChief' }
                ],
                chests: [{ at: [53, 5], loot: 'chiefChest', requires: 'goblinChief' }]
            },
            // The second region, the way from the field to the cave (the
            // second draft of the redrawn map: user, 2026-10-04; no gate to
            // the village): a gravel floor between stepped ridges, a brook
            // two blocks wide down it with two fords, the road up its west bank from
            // the field's gate to the cave's, and across the brook the wolf
            // pack and the wolf king's den of rock in the north-east. The
            // east road ends where the ridge has come down: a way on, some
            // day.
            valley: {
                name: '灰岩谷', floor: ';',
                rows: [
                    '45444544454445444544454445455544454445444544454445444544',
                    '44343333334343433333343433344343434333333434333333434344',
                    '44223223222222232232232232243222222322322322322322222235',
                    '54211111#P#111111111111111133111111111111111111111111244',
                    '4431;;;;;::;;;;;;;;;;;;;;;;11;;;;;;;;;2;;;;;;;;;;;;;1234',
                    '4331;;;;;::;;;;;;;;;;;;;;;;;;;;;;;;;;;3;;;;;;;;;;C;;1244',
                    '4321;;;;;::;;;;........;;;;;;;;;;;;;;;2;;;2;;;;;;;;;1235',
                    '5321;;;;;::;;;;..~~~~..;;;;;;;;T;;;;;;2;;;;;;;;;;;;;1234',
                    '4321;;;;;::;;;;..~~~~..2O;;;;;;;;;;;;;3;;;;;;;K;;;;;1334',
                    '4321;;;;;::;;;;...~~...;;;;;;;;;;;;;;;2;;;;;;;;;;;;;1234',
                    '4321;;;;;;::;;;...~~..;;;;;;2;;;;;;;;;2;;;;2;;;;;;;;1235',
                    '5331;;;;;;::;;;..~~...;;;;;;;;;;;;;;;;3;;;;;;;;;2;;;1334',
                    '4321;;;;;;::;;;..~~..;;;;;;;;;;;;;;;;;2;;;;;;1;;;;;;1244',
                    '4321;;;g;;::;;g..~~.h.;;;;1;;;;;;;;;;;3;;;::;;;;;;;;1234',
                    '4321;;;;;;::;;;...~~..;;;;;;;;;;;;;;;;333:::222222231345',
                    '5321;;;;;;::;;;;..~~...1;;;;;;;;;;;;;;;;;:::;;;;;;;;1234',
                    '43212O;1;;::;;;;...~~..;;;;;;;;;;;;;;;;;:::;;;;;;;;;1234',
                    '54421;;;;;;::;;;;..~~...;;;;;;;;;;;;;;;:::;;;O;1;;;;1334',
                    '54431;;;;;;::;;;;...~~..;;;;;;;;;;;;h;:::;;;;;;;;;;;1235',
                    '5321;;;;;;;:::::::::::::::::::::::::::::::::::::;1123456',
                    '4421;;;;;;;:::::::::::::::::::::::::::::::::::::12123556',
                    '4421;;;;;;;;::;;;;;..~~..;;;;;;;;;;;;;;;;;;;;;;;;;;;1244',
                    '4421;;;;;;;;::;;;;;..~~...;;;;;;;;;;;;;;;;;;;;;;;;;;1235',
                    '5421;;w;;;;;::;;;;;...~~..;21;;;;;;;w;;;;;;;;2;;;;;;1244',
                    '4431;;;;;;;;::;;T;;;..~~...;;;;;;w;;;;;;;;;;;;1;;;;;1234',
                    '4331;;;;;;;::;;;;;;;...~~..h;;;;;;;;;;;;1;;;;;;;;;;;1244',
                    '54321;;;;;;::;;;;;;;;..~~..;;;;;;;;;;;2;;;;;;;;;;;;;1235',
                    '5321;;;;2;;::;;;;;;;;..~~..;;;;;;;;;;;;;;;;;;;;;;;;;1234',
                    '4321;;1;;;;:::::::::::::::::::::;;;;;;;;;;;;;;;;2;;13445',
                    '4321;.....::::::::::::::::::::::;;;;;;;;;;;;;;;;;;;12345',
                    '4321;.....::.....;;;;;..~~..;;;;;;;1;;;;;;;;O2;;;;;;1235',
                    '5331;.....::.@.h.;;;;;..~~...;;;;;;;w;;;;;;1;;;;;;;;1334',
                    '4321;.....::.....;;;;;...~~.2O;;w;;;;;;;;;;;;;;;;;;;1244',
                    '4321;.....::.....;1;;;;..~~..;;;11;;;;;;;;;;;;;;;;;;1234',
                    '432111111#P#1111112111111~~11111221111111111111111111345',
                    '5322222222222222222222222~~22222222222222222222222222234',
                    '4322222222222222222222222~~22222222222222222222222222234',
                    '4332222222222222222222222~~22222222222222222222222222334'
                ],
                portals: [
                    { at: [10, 34], to: 'field', facing: 'north' },
                    { at: [9, 3], to: 'cave', facing: 'south' }
                ],
                chests: [{ at: [49, 5], loot: 'kingChest', requires: 'wolfKing' }]
            },
            // A dark cave off the valley (design.md 2.5): nothing to see
            // without a lit torch. Its treasure room is shut by a thicket the
            // torch burns away.
            cave: {
                name: '千柱窟', dark: true, floor: ';',
                rows: [
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;333333333333333333333333333333333333;;;',
                    ';;;33333;;;;33333;;;;;;;;;;;3;;;;;;;;;3;;;',
                    ';;;33333;;;;33333;;;2X;;;;;;3;;;;;;;;;3;;;',
                    ';;;33333;;;;33333;;;;;;;;;;;3;;;;;;C;;3;;;',
                    ';;;3;;;;;;;;33333;;;;;;;;;;;3;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;33333;;;w;;;;;;;3;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;;;;;;;;;;;;3;;;;;;;;X3;;;',
                    ';;;3;;;;g;;;;;;;;;;;;;;;;;;;3;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;333333;;;;;333BBB33333;;;',
                    ';;;3;;;;;;22X;;;;333333;;;;;;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;333333;;;;;;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;w;;333333;;;;;2;X;2;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;333333;3333;;;;;;;;;;3;;;',
                    ';;;3333333;;;;;;;;;;;;;;3333;;;;;;;;;;3;;;',
                    ';;;3333333;;;;;;;;;;;;;;3333;;;w;;;;;;3;;;',
                    ';;;3333333;;;;;;;;;;;;;;3333;;;;;333333;;;',
                    ';;;3333333;;;;;;;;;;;;;;3333;;;;;333333;;;',
                    ';;;3;;;;;;;33333;;;;;;;;3333;;;;;333333;;;',
                    ';;;3;;;;;;;33333;;;;;;;;3333;;g;;333333;;;',
                    ';;;3;;;;;;;33333;;;;;;;;3333;;;;;;;;;;3;;;',
                    ';;;3;;;;2O;;;;;;;;;;;2;;3333;;2;;;;;;;3;;;',
                    ';;;3;;;;;;;;@;;;;;;;;;;;;;;;;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;3;;;',
                    ';;;333333#P#333333333333333333333333333;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;'
                ],
                portals: [{ at: [10, 26], to: 'valley', facing: 'north' }],
                chests: [{ at: [35, 6], loot: 'caveChest' }]
            },
            clearing: {
                name: '训练场', training: true,
                dummyFacing: Math.PI,
                rows: [
                    '..T....T....T......T....T.....T...',
                    'T....T....T....T.T....T....T......',
                    '..T...T.T...T.....T..T...T.T..T.T.',
                    '.T..22221222222122222222122222..T.',
                    '.T..2.....................:..2....',
                    '....1.....................:..2.T..',
                    '..T.2...1.................:..1....',
                    '....#.....................:..2..T.',
                    '.T..P.............@...D..::..1....',
                    '....#..................::....2.T..',
                    '..T.2...............:::......1....',
                    '....1.........1....::........2..T.',
                    '.T..2..............:.........1....',
                    '....1..............:.........2.T..',
                    '....21111211112111112111121112..T.',
                    '..................................',
                    '..................................',
                    '..................................'
                ],
                portals: [{ at: [4, 8], to: 'base', facing: 'east' }]
            },
            // The PVP arena (design.md 8.3): 20 x 11 blocks inside a
            // wall, the same seen from either spawn (point symmetric). Walls
            // inside and to the south are 2 high, so they hide a fighter
            // without hiding one standing behind them from the camera.
            arena: {
                name: '竞技场', duel: true,
                rows: [
                    '.T.TT.......TTT....T.....T..',
                    '.T.T............T..TT......T',
                    '.T.......TT.....T.T.....T...',
                    '...3333333333333333333333...',
                    '...3....................3...',
                    '...3.1......1........1..3...',
                    '.T.3....222..22..22.....3.T.',
                    '...3....2....22..2......3.T.',
                    '.T.3........::::........3...',
                    '.T.3.::@::::::::::::@::.3.T.',
                    '.T.3........::::........3.T.',
                    '...3......2..22....2....3.T.',
                    '.T.3.....22..22..222....3.T.',
                    '...3..1........1......1.3...',
                    '.T.3....................3.T.',
                    '...2222222222222222222222...',
                    '............................',
                    '............................',
                    '............................',
                    '............................'
                ]
            }
        },

        // 10. PVP (design.md 8): one phone hosts and runs the duel,
        // the other sends its controls and draws the host's snapshots,
        // predicting its own moves in between. countdown: seconds from both
        // being ready to the fight. snapshotSeconds: host to guest state;
        // heartbeatSeconds: guest to host when it has nothing else to say;
        // timeoutSeconds: nothing heard for this long and the connection
        // counts as lost. awaySeconds: how long a phone in the background
        // is waited for, the fight held still (user, 2026-10-04).
        // replaySeconds: how far past a snapshot the guest
        // predicts at most; latencySeconds: cap on its one-way estimate.
        // steer: the share of the difference between the guest's time and
        // a snapshot's that each snapshot takes out (small: the network's
        // unevenness does not show in the moves); resyncSeconds: past this
        // difference the guest's time jumps instead.
        // historyEvents: events the host keeps until the guest has them.
        // connectSeconds: how long finding the other phone may take.
        // weapons: the main hands each side may pick before a duel (user
        // 2026-10-02: one of each weapon type); the rest is gear.starter.
        pvp: {
            countdown: 3, snapshotSeconds: 0.05, heartbeatSeconds: 0.25, timeoutSeconds: 5, awaySeconds: 60,
            replaySeconds: 0.25, latencySeconds: 0.15, steer: 0.1, resyncSeconds: 0.1, historyEvents: 128, connectSeconds: 12,
            weapons: ['wooden_sword', 'assassin_dagger']
        }
    });
})();
