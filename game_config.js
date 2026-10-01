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
        // player starts. Rows run north (screen top) to south.
        maps: {
            clearing: {
                rows: [
                    '..T....T....T......T....T.....T...',
                    'T....T....T....T.T....T....T......',
                    '..T...T.T...T.....T..T...T.T..T.T.',
                    '.T..22221222222122222222122222..T.',
                    '.T..2.....................:..2....',
                    '....1.....................:..2.T..',
                    '..T.2...1.................:..1....',
                    '....1.....................:..2..T.',
                    '.T..2.............@......::..1....',
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
