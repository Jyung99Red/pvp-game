// Fixed training preset. Combat times are seconds; gestures use CSS pixels.
const spatialData = (() => {
    const training = {
        width: 360, height: 400,
        fullCharge: 1.6, playerSpeed: 115,
        playerTurn: 8, chargeMoveMultiplier: .7, chargeTurnMultiplier: .65,
        guardMoveMultiplier: .3, guardTurnMultiplier: .5,
        motion: { move: 1, turn: 1, chargeMove: 1, chargeTurn: 1 },
        player: { x: 180, y: 275, radius: 12, facing: -Math.PI / 2, hp: 120, maxHp: 120 },
        enemy: { x: 180, y: 160, radius: 23, facing: Math.PI / 2, hp: 360, maxHp: 360 },
        ai: { initialDelay: .8, delay: .45, speed: 47, stopDistance: 88, attackDistance: 150, turn: 3, trackingTurn: 1.6 },
        stagger: { threshold: 3, duration: 1.5, heavy: 2, parry: 1 },
        apRegen: .7, guardTurn: 8, moveRamp: 32, hitStun: .35,
        blockMultiplier: .25, parryDamage: 10, parryCost: .5,
        guardStartup: .16, parryWindow: .18, apMax: 5,
        light: { kind: 'sector', range: 82, arc: Math.PI * .56, damage: 18, windup: .10, recovery: .28 },
        heavy: { kind: 'sector', minRange: 60, range: 103, minArc: Math.PI * .28, arc: Math.PI * .68, damage: 28, chargeBonus: 30, windup: .45, recovery: .6 },
        sweep: { kind: 'sector', range: 145, arc: Math.PI * .64, windup: 1.25, lock: .45, active: .16, recovery: 1.15, damage: 25 },
        stomp: { kind: 'circle', range: 110, windup: 1.4, lock: .55, active: .16, recovery: 1.3, damage: 30 }
    };
    // Every enemy has explicit geometry/timing. Old dmgMult never sets timing.
    const sector = (range, arc, windup, lock, recovery, multiplier) => ({ kind: 'sector', range, arc: Math.PI * arc, windup, lock, active: .16, recovery, multiplier, damage: 0 });
    const circle = (range, windup, lock, recovery, multiplier) => ({ kind: 'circle', range, windup, lock, active: .16, recovery, multiplier, damage: 0 });
    const moves = {
        test_combat: [sector(90, .6, 1.2, .4, .8, .6), circle(85, 1.5, .5, 1, 1)],
        goblin: [sector(90, .65, 1.2, .4, .7, .6), sector(120, .4, 1.5, .5, 1, .9)],
        wolf: [sector(85, .45, .95, .3, .6, .6), sector(125, .35, 1.3, .45, .8, .9)],
        orc: [sector(115, .65, 1.35, .45, .9, .7), circle(105, 1.65, .55, 1.2, 1.1)],
        young_dragon: [sector(110, .65, 1.15, .4, .8, .7), sector(170, .4, 1.65, .55, 1.1, 1.1)],
        skeleton_warrior: [sector(100, .55, 1.1, .4, .8, .7), sector(135, .7, 1.5, .5, 1, 1.1)],
        shadow_assassin: [sector(100, .35, .8, .3, .55, .6), sector(155, .25, 1.2, .4, .9, 1.1)],
        stone_golem: [sector(135, .65, 1.5, .5, 1.1, .7), circle(120, 1.8, .65, 1.4, 1.1)],
        elder_dragon: [sector(140, .65, 1.1, .4, .85, .7), sector(185, .5, 1.65, .55, 1.2, 1.1)],
        abyss_lord: [sector(145, .6, 1.05, .4, .8, .7), circle(130, 1.6, .55, 1.2, 1.1)]
    };
    function freeze(value) { Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(value); }
    return { training: freeze(training), enemyMoves: freeze(moves) };
})();
