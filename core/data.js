// ====== Active Data: current game state ======
const state = {
    time: { tick: 0, days: 1, hours: 6, minutes: 0, period: 'day' },
    resources: { gold: 0 },
    inventory: {
        exp: 0,
        items: {},
        materials: {},
        // Enhancement levels keyed by itemId. Items stack as counts (no
        // per-instance identity), so all copies of an item share one level.
        enhance: {}
    },
    base: { buildings: { hotSpring: 0, smithy: 0, shop: 0 } },
    player: {
        level: 1,
        baseStats: { ...gameConfig.progression.baseStats },
        currentHp: gameConfig.progression.baseStats.maxHp,
        equip: { ...gameConfig.progression.startingEquipment }
    },
    // Permanent dungeon progress -- unlike `world` below, this IS saved
    // (see save.js). checkpointFloor is where the next dungeon run starts;
    // it only advances when a boss floor (every 9th) is cleared.
    progress: { checkpointFloor: 1 },
    world: {
        status: 'base',
        currentTab: 'base',
        currentFloor: 0,  // 0 = not currently in a dungeon run
        // Gold earned this run, banked into resources only on making it
        // back alive (retreat/flee) -- lost entirely on death
        runGold: 0
    },
    pveBattle: null   // created at runtime by pveLogic.enterDungeon/continueNext (transient, never saved)
};

// Runtime content is copied so game/test overrides cannot mutate tuning templates.
const content = JSON.parse(JSON.stringify(gameConfig.content));
