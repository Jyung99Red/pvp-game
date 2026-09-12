// Convert progression into a spatial preset. No reverse writes to saves.
const pveProfiles = (() => {
    const moves = spatialData.enemyMoves;
    function create(enemyId, enemyData) {
        if (!moves[enemyId]) throw new Error(`Missing spatial moves: ${enemyId}`);
        const C = JSON.parse(JSON.stringify(spatialData.training)), stats = spatialProfiles.local(), ai = enemyData.ai || {};
        C.formal = true; C.skillMode = 'pve'; C.skillOverrides = {};
        C.enemyName = enemyData.name;
        C.width = 510; C.height = 566;
        C.camera = { ...spatialData.camera };
        C.player.x += 75; C.player.y += 83;
        C.enemy.x += 75; C.enemy.y += 83;
        spatialProfiles.apply(C, stats, state.player.currentHp);
        Object.assign(C.enemy, { maxHp: enemyData.hp, hp: enemyData.hp, def: enemyData.def });
        C.enemyApMax = Math.max(1, ai.apMax || 5);
        C.enemyApRegen = 1000 / combatResolver.apRecoveryMs(ai.spd || 10);
        C.actions = moves[enemyId].map((move, i) => ({ ...move, label: enemyData.acts?.[`act${i + 1}`]?.name || '攻击', damage: Math.max(1, Math.round(enemyData.atk * move.multiplier)) }));
        Object.assign(C.ai, {
            comboChance: ai.comboChance || 0, comboMax: ai.comboMax || 0,
            comboDelay: (ai.comboDelayMs?.[0] || 200) / 1000,
            enrageThreshold: ai.enrageThreshold || 0,
            enrageAtkMult: ai.enrageAtkMult || 1.3, enrageSpdMult: ai.enrageSpdMult || 1.2
        });
        spatialEngine.validate(C);
        return C;
    }
    return { create, enemyIds: Object.keys(moves) };
})();
