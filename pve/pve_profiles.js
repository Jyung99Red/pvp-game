// Convert progression into a spatial preset. No reverse writes to saves.
const pveProfiles = (() => {
    const moves = spatialData.enemyMoves;
    // The walking half of a region session: one actor, region-sized bounds, no
    // enemy and nothing to settle against. Stepped with spatialEngine.advanceActor,
    // which never ticks skill points, so walking to a fight cannot bank SP.
    // Position is deliberately left at the preset's default -- the region scene
    // owns where the player actually stands.
    function region(def) {
        const C = JSON.parse(JSON.stringify(spatialData.baseCombatPreset));
        C.formal = true; C.solo = true; C.skillMode = 'pve'; C.skillOverrides = {};
        C.width = def.map.width; C.height = def.map.height;
        C.camera = { ...gameConfig.adventure.camera };
        spatialProfiles.apply(C, spatialProfiles.local(), state.player.currentHp);
        spatialEngine.validate(C);
        return C;
    }
    // The enemy half of a region fight: the same build the legacy arena path
    // uses, re-homed into the region and carrying the monster's authored contact
    // radius and speed instead of the arena defaults they were never tuned for.
    // The caller overwrites both actors' positions with live world coordinates.
    function enemy(def, enemyId, enemyData, { radius, speed } = {}) {
        const C = create(enemyId, enemyData);
        C.width = def.map.width; C.height = def.map.height;
        C.camera = { ...gameConfig.adventure.camera };
        if (radius != null) C.enemy.radius = radius;
        if (speed != null) C.ai.speed = speed;
        spatialEngine.validate(C);
        return C;
    }
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
        const hp = Math.round(enemyData.hp * gameConfig.balance.hpScale);
        Object.assign(C.enemy, { maxHp: hp, hp, def: enemyData.def });
        C.enemyApMax = Math.max(1, ai.apMax ?? defaults.apMax);
        C.enemyApRegen = 1000 / combatRules.enemyApRecoveryMs(ai.focus ?? defaults.focus);
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
    return { create, region, enemy, enemyIds: Object.keys(moves) };
})();
