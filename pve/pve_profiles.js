// Convert progression into a spatial preset. No reverse writes to saves.
const pveProfiles = (() => {
    const moves = spatialData.enemyMoves;
    function create(enemyId, enemyData) {
        if (!moves[enemyId]) throw new Error(`Missing spatial moves: ${enemyId}`);
        const C = JSON.parse(JSON.stringify(spatialData.training)), stats = player.getStats(), ai = enemyData.ai || {};
        const clamp = spatialCombat.clamp;
        C.formal = true; C.enemyName = enemyData.name;
        Object.assign(C.player, { maxHp: stats.maxHp, hp: clamp(state.player.currentHp, 0, stats.maxHp), def: stats.def });
        Object.assign(C.enemy, { maxHp: enemyData.hp, hp: enemyData.hp, def: enemyData.def });
        C.apMax = Math.max(1, Math.floor(player.getApMax()));
        C.apRegen = 1000 / combatResolver.apRecoveryMs(Math.max(.1, stats.spd));
        C.enemyApMax = Math.max(1, ai.apMax || 5);
        C.enemyApRegen = 1000 / combatResolver.apRecoveryMs(ai.spd || 10);
        C.fullCharge = 2;
        C.chargeThreshold = clamp(player.getChargeThresholdMs() / 1000, 0, 1.9);
        C.parryWindow = clamp(player.getParryWindowBaseMs() * player.getJudgmentMultiplier() / 1000, 0, 1);
        C.blockMultiplier = clamp(.4 * player.getGuardDamageMultiplier(), 0, 1);
        C.critChance = clamp(player.getCritChance(), 0, 1);
        C.guardThorns = Math.max(0, player.getGuardThorns());
        C.parryDamage = Math.max(1, Math.round(stats.atk * .5));
        C.light.damage = Math.max(1, Math.round(stats.atk * .3));
        C.heavy.damage = stats.atk * .3; C.heavy.chargeBonus = stats.atk * .8;
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
