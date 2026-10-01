// Equipment models, hung on a model's mount points (3d-migration-concept.md
// 14). Each part sits in the mount's frame; for a hand mount +z points along
// the held item. Items without a model of their own use these defaults.
const equipmentModels = (() => {
    function sword(bladeLength = gameConfig.models.swordBladeLength) {
        return {
            id: 'sword', mount: 'handR', parts: [
                { size: [0.07, 0.07, 0.26], at: [0, 0, 0], color: 'leather', kind: 'deco' },
                { size: [0.1, 0.1, 0.07], at: [0, 0, -0.16], color: 'gold', kind: 'deco' },
                { size: [0.36, 0.07, 0.08], at: [0, 0, 0.16], color: 'gold', kind: 'deco' },
                { size: [0.12, 0.05, bladeLength], at: [0, 0, 0.2 + bladeLength / 2], color: 'steel', kind: 'weapon' }
            ]
        };
    }
    // Carried on the outside of the left forearm, face outwards.
    function shield() {
        return {
            id: 'shield', mount: 'handL', parts: [
                { size: [0.07, 0.6, 0.5], at: [0.15, 0.18, 0.02], color: 'wood', kind: 'shield' },
                { size: [0.02, 0.6, 0.06], at: [0.195, 0.18, 0.02], color: 'steelDark', kind: 'deco' },
                { size: [0.02, 0.06, 0.5], at: [0.195, 0.18, 0.02], color: 'steelDark', kind: 'deco' },
                { size: [0.05, 0.14, 0.14], at: [0.205, 0.18, 0.02], color: 'steel', kind: 'deco' }
            ]
        };
    }
    const builders = { sword, shield };
    // Items a body carries, from an equipment record { main, offhand }.
    function forLoadout(loadout) {
        return [loadout.main, loadout.offhand].filter(Boolean).map(id => {
            if (!builders[id]) throw new Error(`No model for ${id}`);
            return builders[id]();
        });
    }
    return { sword, shield, forLoadout };
})();
