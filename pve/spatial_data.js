// Fixed training preset. Combat times are seconds; gestures use CSS pixels.
const spatialData = (() => {
    // One definition feeds the pads, availability checks and both formal
    // execution paths.  Mode-specific overrides are deliberately data-only so
    // future PVE upgrades cannot leak into PVP.
    const skillDefinitions = {
        heal: { id: 'heal', name: '治疗', direction: 'up', cost: 2, healRatio: .3 },
        haste: { id: 'haste', name: '疾速', direction: 'right', cost: 2, duration: 10, chargeRate: 1.5, moveMultiplier: 1.1, turnMultiplier: 1.05 },
        full: { id: 'full', name: '满蓄', direction: 'down', cost: 2 },
        parry: { id: 'parry', name: '弹反', direction: 'left', cost: 3 }
    };
    const skillCosts = Object.fromEntries(Object.entries(skillDefinitions).map(([id, skill]) => [id, skill.cost]));
    const camera = Object.freeze({ width: 350, height: 390, followRate: 12, leadRate: 8, leadSeconds: .16, maxLead: 24 });
    const pvpArena = {
        width: 570, height: 630, layoutId: 'pvp-l-v1', version: 1,
        walls: [
            { id: 'left-vertical', x: 135, y: 200, width: 24, height: 130 },
            { id: 'left-horizontal', x: 135, y: 306, width: 110, height: 24 },
            { id: 'right-vertical', x: 411, y: 300, width: 24, height: 130 },
            { id: 'right-horizontal', x: 325, y: 300, width: 110, height: 24 }
        ]
    };
    const training = {
        width: 360, height: 400,
        fullCharge: 1.6, playerSpeed: 115,
        playerTurn: 8, chargeMoveMultiplier: .6, chargeTurnMultiplier: .65,
        guardMoveMultiplier: .3, guardTurnMultiplier: .5,
        motion: { move: 1, turn: 1, chargeMove: 1, chargeTurn: 1 },
        player: { x: 180, y: 275, radius: 12, facing: -Math.PI / 2, hp: 120, maxHp: 120 },
        enemy: { x: 180, y: 160, radius: 23, facing: Math.PI / 2, hp: 360, maxHp: 360 },
        ai: { initialDelay: .8, delay: .45, speed: 47, stopDistance: 88, attackDistance: 150, turn: 3, trackingTurn: 1.6 },
        stagger: { threshold: 3, duration: 1.5, heavy: 1, parry: 1 },
        apRegen: .7, moveRamp: 32, hitStun: .35,
        blockMultiplier: .25, parryDamage: 10, parryCost: .5,
        guardStartup: .16, parryWindow: .18, apMax: 5,
        skillPointMax: 3, spRegen: 1 / 3,
        light: { kind: 'sector', range: 69, arc: Math.PI * .52, damage: 18, windup: .10, recovery: .28 },
        heavy: { kind: 'sector', minRange: 60, range: 103, minArc: Math.PI * .28, arc: Math.PI * .68, damage: 28, chargeBonus: 30, windup: .45, recovery: .6 },
        sweep: { kind: 'sector', range: 145, arc: Math.PI * .64, windup: 1.35, lock: .45, active: .16, recovery: 1.3, damage: 25 },
        stomp: { kind: 'circle', range: 110, windup: 1.5, lock: .55, active: .16, recovery: 1.45, damage: 30 }
    };
    // Every enemy has explicit geometry/timing. Old dmgMult never sets timing.
    const enemyWindupBonus = .1, enemyRecoveryBonus = .15;
    const enemyTiming = (windup, recovery) => ({ windup: windup + enemyWindupBonus, recovery: recovery + enemyRecoveryBonus });
    const sector = (range, arc, windup, lock, recovery, multiplier) => ({ kind: 'sector', range, arc: Math.PI * arc, ...enemyTiming(windup, recovery), lock, active: .16, multiplier, damage: 0 });
    const circle = (range, windup, lock, recovery, multiplier) => ({ kind: 'circle', range, ...enemyTiming(windup, recovery), lock, active: .16, multiplier, damage: 0 });
    const dash = (windup, lock, recovery, multiplier, distance, speed, width) => ({
        kind: 'dash', range: distance, width, ...enemyTiming(windup, recovery), lock, active: 0, multiplier, damage: 0,
        dash: { distance, speed, width }
    });
    const moves = {
        test_combat: [sector(90, .6, 1.2, .4, .8, .6), circle(85, 1.5, .5, 1, 1)],
        goblin: [sector(90, .65, 1.2, .4, .7, .6), sector(120, .4, 1.5, .5, 1, .9)],
        wolf: [sector(85, .45, .95, .3, .6, .6), dash(1.05, .35, 1.2, .9, 150, 280, 18)],
        orc: [sector(115, .65, 1.35, .45, .9, .7), circle(105, 1.65, .55, 1.2, 1.1)],
        young_dragon: [sector(110, .65, 1.15, .4, .8, .7), sector(170, .4, 1.65, .55, 1.1, 1.1)],
        skeleton_warrior: [sector(100, .55, 1.1, .4, .8, .7), sector(135, .7, 1.5, .5, 1, 1.1)],
        shadow_assassin: [sector(100, .35, .8, .3, .55, .6), dash(.55, .25, .9, 1.1, 180, 450, 12)],
        stone_golem: [sector(135, .65, 1.5, .5, 1.1, .7), circle(120, 1.8, .65, 1.4, 1.1)],
        elder_dragon: [sector(140, .65, 1.1, .4, .85, .7), sector(185, .5, 1.65, .55, 1.2, 1.1)],
        abyss_lord: [sector(145, .6, 1.05, .4, .8, .7), circle(130, 1.6, .55, 1.2, 1.1)]
    };
    function freeze(value) { Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(value); }
    function skillRules(mode = 'pve', overrides = {}) {
        const rules = {};
        for (const [id, definition] of Object.entries(skillDefinitions)) {
            // The first PVP ruleset intentionally matches the base values.  A
            // different ruleset gets a new protocol version before changing it.
            const modeOverride = overrides?.[mode]?.[id] || {};
            const directOverride = overrides?.[id] || {};
            rules[id] = { ...definition, ...modeOverride, ...directOverride };
        }
        return rules;
    }
    return { training: freeze(training), enemyMoves: freeze(moves), skills: freeze(skillDefinitions), skillCosts: Object.freeze(skillCosts), camera, pvpArena: freeze(pvpArena), skillRules };
})();
