// Adapt immutable tuning data into the existing spatial interfaces.
const spatialData = (() => {
    const skillDefinitions = gameConfig.skills;
    const skillCosts = Object.fromEntries(Object.entries(skillDefinitions).map(([id, skill]) => [id, skill.cost]));
    const moves = Object.fromEntries(Object.entries(gameConfig.enemyMoves).map(([id, actions]) => [id, actions.map(move => {
        const action = { ...move, windup: move.windup + gameConfig.enemyTiming.windupBonus,
            recovery: move.recovery + gameConfig.enemyTiming.recoveryBonus,
            active: gameConfig.enemyTiming.active, damage: 0 };
        if (move.kind === 'sector') action.arc = Math.PI * move.arc;
        if (move.kind === 'dash') {
            action.range = move.distance; action.active = 0;
            action.dash = { distance: move.distance, speed: move.speed, width: move.width };
            delete action.distance; delete action.speed;
        }
        return action;
    })]));
    function freeze(value) { Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(value); }
    function skillRules(mode = 'pve', overrides = {}) {
        const rules = {};
        for (const [id, definition] of Object.entries(skillDefinitions)) {
            // The first PVP ruleset intentionally matches the base values.  A
            // different ruleset gets a new protocol version before changing it.
            const modeDefault = gameConfig.skillOverrides[mode]?.[id] || {};
            const modeOverride = overrides?.[mode]?.[id] || {};
            const directOverride = overrides?.[id] || {};
            rules[id] = { ...definition, ...modeDefault, ...modeOverride, ...directOverride };
        }
        return rules;
    }
    return { baseCombatPreset: gameConfig.training, enemyMoves: freeze(moves), skills: freeze(skillDefinitions), skillCosts: Object.freeze(skillCosts), camera: gameConfig.camera, pvpArena: gameConfig.pvpArena, skillRules };
})();
