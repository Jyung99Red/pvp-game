// Every tunable number of the game, and nothing else. Units: world units
// (40 to a block) for positions, distances and speeds; seconds for time;
// radians for angles; CSS pixels for anything on the touch layer.
// docs/tasks/combat-parameter-inventory.md mirrors this file.
const gameConfig = (() => {
    const freeze = value => {
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
        // collision. Running: after `runAfter` seconds of unbroken walking
        // with the stick pushed at least `runStick` of the way, speed eases up
        // to speed * runMultiplier over runRampSeconds, and back down the same
        // way once the walk is broken (stick eased off or released, a wall).
        player: { speed: 115, turnRate: 8, radius: 12, runAfter: 2, runMultiplier: 2.2, runRampSeconds: 0.3, runStick: 0.9 },

        // 3. Animation. blendSeconds: idle <-> walk cross-fade.
        animation: { blendSeconds: 0.1 },

        // 4. Sizes that will decide hits (3d-migration-concept.md 4.3). The
        // body boxes themselves are model data in models/; these scale it.
        // playerScale multiplies the whole character; swordBladeLength is in
        // blocks.
        models: { playerScale: 1, swordBladeLength: 0.92 },

        // 4b. Fighting rules shared by every fight (training, PVE, PVP).
        // fighters: stats until equipment and growth come back (M6).
        // hitStun: a hit that is not guarded freezes the one struck's
        // controls this long. weaponPad: weapon boxes grow by this much on
        // every side for hit tests only (3d-migration-concept.md 4.6).
        // Damage = max(1, round(raw * (1 - DEF / (DEF + defenseConstant)))).
        // A blocked hit does blockMultiplier of that; a perfect parry hits
        // back for atk * parryAtkRatio. Impact: on contact both fighters'
        // clocks stop for `hitstop`; then the one struck is pushed
        // `knockback` units over knockbackSeconds. Player moves carry their
        // own knockback in the combo table; these are for hits on the
        // player, blocks and parries. Stagger: points from moves (and
        // `parry`) fill to `threshold`, then the target reels `duration`.
        combat: {
            fighters: { player: { maxHp: 360, atk: 30, def: 8 } },
            hitStun: 0.35, weaponPad: 8,
            damage: { defenseConstant: 17.5, blockMultiplier: 0.4, parryAtkRatio: 0.5 },
            impact: { hitstop: { hit: 0.06, block: 0.04, parry: 0.08 }, knockback: { hit: 10, block: 5, parry: 8 }, knockbackSeconds: 0.12 },
            stagger: { threshold: 3, duration: 1.5, parry: 1 },
            // The opening B: held past its windup it charges. Charge time
            // counts from the press; damage grows from `threshold` to `full`
            // seconds. While charging the body walks and turns slower.
            charge: { threshold: 0.3, full: 2.3, moveMultiplier: 0.6, turnMultiplier: 0.65 },
            // The shield: `startup` from press to up; a hit within
            // parryWindow of the shield coming up is a perfect parry. Only
            // hits from within frontAngle of facing are blocked.
            guard: { startup: 0.16, parryWindow: 0.18, moveMultiplier: 0.3, turnMultiplier: 0.5, frontAngle: Math.PI / 2 },
            // Guard bar (points). Raising costs raiseCost, holding drains
            // holdDrain a second, a blocked hit costs
            // raw / maxHp * blockCostScale * max (a parry parryCostRatio of
            // that). Down, it refills in refillSeconds; emptied, the shield
            // stays locked until it is back to unlockRatio.
            guardBar: { max: 100, raiseCost: 10, holdDrain: 10, blockCostScale: 6, parryCostRatio: 0.5, refillSeconds: 3, unlockRatio: 0.4 }
        },

        // 4c. Player move tree (first version, shared by every weapon;
        // combat-combo-concept.md). Each move: windup -> swing -> recovery,
        // seconds. Only the swing hits. `derive`, counted from the swing's
        // end, is when a buffered next input cuts the recovery short; a
        // finisher has none. `next` maps the next input -- A, B, or A after a
        // pause -- to the move it derives; an input with no entry starts
        // over from `root`. ratio: damage per ATK; stagger: stagger points;
        // knockback: world units the target is pushed; step: how far the
        // body lunges forward during the swing. The charged move grows
        // ratio by chargeRatio and step by chargeStep with its charge.
        // Shapes and reach come from the move's key poses (models/).
        // pauseAfterRecovery: the pause line after a recovery ends;
        // windowAfterRecovery: the chain resets this long after;
        // bufferSeconds: an input pressed ahead that has not run within this
        // long is dropped. recoveryTurnMultiplier: in a recovery the stick
        // only turns the body, at this share of player.turnRate.
        combo: {
            root: { a: 'slash', b: 'charged' },
            pauseAfterRecovery: 0.2, windowAfterRecovery: 0.7, bufferSeconds: 0.4, recoveryTurnMultiplier: 0.5,
            moves: {
                slash: { name: '横扫', windup: 0.10, swing: 0.08, recovery: 0.30, derive: 0.12, ratio: 0.30, stagger: 0, knockback: 0, step: 3, next: { a: 'backslash', b: 'rising' } },
                backslash: { name: '回扫', windup: 0.10, swing: 0.08, recovery: 0.36, derive: 0.14, ratio: 0.32, stagger: 0, knockback: 0, step: 3, next: { a: 'spin', b: 'cleave', pause: 'thrust' } },
                spin: { name: '回旋斩', windup: 0.16, swing: 0.18, recovery: 0.60, ratio: 0.55, stagger: 0, knockback: 0, step: 0 },
                thrust: { name: '连刺', windup: 0.12, swing: 0.06, recovery: 0.55, ratio: 0.60, stagger: 0, knockback: 0, step: 14 },
                rising: { name: '上挑', windup: 0.30, swing: 0.10, recovery: 0.60, ratio: 0.70, stagger: 1.5, knockback: 15, step: 4 },
                cleave: { name: '下劈', windup: 0.30, swing: 0.08, recovery: 0.65, ratio: 0.80, stagger: 1.5, knockback: 15, step: 7 },
                charged: { name: '蓄力斩', windup: 0.45, swing: 0.12, recovery: 0.60, derive: 0.25, ratio: 0.30, chargeRatio: 0.80, stagger: 1, knockback: 18, step: 4, chargeStep: 13, charge: true, next: { a: 'follow' } },
                follow: { name: '追斩', windup: 0.10, swing: 0.08, recovery: 0.45, ratio: 0.40, stagger: 0, knockback: 0, step: 3 }
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

        // 5. Fixed oblique camera (3d-migration-concept.md 7). yaw 0 keeps
        // screen-up on -z; pitch is the angle down from the horizon;
        // distance and lookHeight are blocks; fov is vertical, in degrees.
        camera: { yaw: 0, pitch: 0.96, distance: 10.5, fov: 34, lookHeight: 0.8 },

        // 6. Rendering cost. Shadow map size by screen class (short side
        // under 700 CSS px is small); shadowExtent is the half-width in
        // blocks of the shadowed area around the player.
        graphics: { pixelRatioMax: 2, shadowMapSmall: 1024, shadowMapLarge: 2048, shadowExtent: 12 },

        // 7. Touch and keyboard. deadZone and ramp: stick offset (CSS px)
        // below which nothing moves, and beyond which speed reaches full
        // over `ramp` more pixels. stickRadius: knob travel. maxTouches:
        // two thumbs (controls-landscape-concept.md 4.5).
        input: {
            deadZone: 12, ramp: 32, stickRadius: 52, maxTouches: 2,
            keys: {
                up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
                left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
                a: ['KeyJ'], b: ['KeyK'], offhand: ['KeyL'], interact: ['KeyE']
            }
        },

        // 8. Button layout (controls-landscape-concept.md 3). Each button's
        // centre is `x` from its `side` edge and `y` from the bottom edge,
        // both inside the safe area; `size` is the diameter. The stick
        // appears wherever the bottom-left zone (zoneWidth x zoneHeight from
        // the safe area's corner, out to the screen edges) is pressed, and
        // rests faintly at (restX, restY) from the bottom-left.
        controlsLayout: {
            minGap: 10,
            buttons: {
                a: { side: 'right', x: 78, y: 72, size: 84 },
                b: { side: 'right', x: 70, y: 162, size: 72 },
                offhand: { side: 'right', x: 176, y: 56, size: 72 },
                interact: { side: 'left', x: 64, y: 196, size: 56 }
            },
            stick: { zoneWidth: 250, zoneHeight: 190, restX: 120, restY: 96 }
        },

        // 9. Maps. One character per block: `.` grass, `:` path, `1`-`9`
        // stone wall of that many blocks, `T` tree, `@` grass where the
        // player starts, `D` grass with the training dummy on it (facing
        // `dummyFacing`, radians). Rows run north (screen top) to south.
        maps: {
            clearing: {
                dummyFacing: Math.PI,
                rows: [
                    '..T....T....T......T....T.....T...',
                    'T....T....T....T.T....T....T......',
                    '..T...T.T...T.....T..T...T.T..T.T.',
                    '.T..22221222222122222222122222..T.',
                    '.T..2.....................:..2....',
                    '....1.....................:..2.T..',
                    '..T.2...1.................:..1....',
                    '....1.....................:..2..T.',
                    '.T..2.............@...D..::..1....',
                    '....1..................::....2.T..',
                    '..T.2...............:::......1....',
                    '....1.........1....::........2..T.',
                    '.T..2..............:.........1....',
                    '....1..............:.........2.T..',
                    '....21111211112111112111121112..T.',
                    '..................................',
                    '..................................',
                    '..................................'
                ]
            }
        }
    });
})();
