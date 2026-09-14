// Convert progression into a spatial preset. No reverse writes to saves.
const pveProfiles = (() => {
    const moves = spatialData.enemyMoves;
    function create(enemyId, enemyData) {
        if (!moves[enemyId]) throw new Error(`Missing spatial moves: ${enemyId}`);
        const C = JSON.parse(JSON.stringify(spatialData.baseCombatPreset)), stats = spatialProfiles.local(), ai = enemyData.ai || {};
        C.formal = true; C.skillMode = 'pve'; C.skillOverrides = {};
        C.enemyName = enemyData.name;
        const arena = gameConfig.pveArena, defaults = gameConfig.enemyDefaults;
        C.width = arena.width; C.height = arena.height;
        C.camera = { ...spatialData.camera };
        C.player.x += arena.spawnOffsetX; C.player.y += arena.spawnOffsetY;
        C.enemy.x += arena.spawnOffsetX; C.enemy.y += arena.spawnOffsetY;
        spatialProfiles.apply(C, stats, state.player.currentHp);
        Object.assign(C.enemy, { maxHp: enemyData.hp, hp: enemyData.hp, def: enemyData.def });
        C.enemyApMax = Math.max(1, ai.apMax ?? defaults.apMax);
        C.enemyApRegen = 1000 / combatRules.apRecoveryMs(ai.focus ?? defaults.focus);
        C.actions = moves[enemyId].map((move, i) => ({ ...move, label: enemyData.acts?.[`act${i + 1}`]?.name || '攻击', damage: Math.max(1, Math.round(enemyData.atk * move.multiplier)) }));
        Object.assign(C.ai, {
            comboChance: ai.comboChance ?? defaults.comboChance, comboMax: ai.comboMax ?? defaults.comboMax,
            comboDelay: (ai.comboDelayMs?.[0] ?? defaults.comboDelayMs) / 1000,
            enrageThreshold: ai.enrageThreshold ?? defaults.enrageThreshold,
            enrageAtkMult: ai.enrageAtkMult ?? defaults.enrageAtkMult, enrageSpdMult: ai.enrageSpdMult ?? defaults.enrageSpdMult
        });
        spatialEngine.validate(C);
        return C;
    }
    return { create, enemyIds: Object.keys(moves) };
})();
