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
        currentHp: Math.round(gameConfig.progression.baseStats.maxHp * gameConfig.balance.hpScale),
        equip: { ...gameConfig.progression.startingEquipment }
    },
    // Persistent authored-world progress. Region location, discoveries and
    // defeated bosses survive reloads; `world` only controls the live view.
    progress: {
        currentRegionId: 'a',
        unlockedRegions: { a: true, b: true, c: true },
        defeatedBosses: {}
    },
    world: {
        status: 'base',
        currentTab: 'base',
        // Region the player last travelled from. The adventure scene builder
        // consumes it once to drop the player next to the portal that leads
        // back, instead of the region's default spawn. Transient, never saved.
        arrivalFrom: null
    },
    pveBattle: null   // created at runtime by pveLogic.startEncounter (transient, never saved)
};

// Runtime content is copied so game/test overrides cannot mutate tuning templates.
const content = JSON.parse(JSON.stringify(gameConfig.content));
