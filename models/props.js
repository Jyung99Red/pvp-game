// Models of the world's props (rebuild-plan.md M5): the chest (a rig with a
// hinged lid), the shapes of things lying on the ground, the roof colour of
// each building, and the colours of a portal's opening. Data only; the
// renderer builds them.
const propModels = Object.freeze({
    // About 0.8 x 0.75 blocks; faces +z. The lid hinges at the back.
    chest: {
        bones: [
            { name: 'base', parent: null, at: [0, 0, 0] },
            { name: 'lid', parent: 'base', at: [0, 0.5, -0.3] }
        ],
        parts: [
            { bone: 'base', size: [0.8, 0.5, 0.6], at: [0, 0.25, 0], color: 'chestWood' },
            { bone: 'base', size: [0.84, 0.08, 0.64], at: [0, 0.06, 0], color: 'chestDark', kind: 'deco' },
            { bone: 'base', size: [0.1, 0.52, 0.64], at: [-0.26, 0.26, 0], color: 'gold', kind: 'deco' },
            { bone: 'base', size: [0.1, 0.52, 0.64], at: [0.26, 0.26, 0], color: 'gold', kind: 'deco' },
            { bone: 'lid', size: [0.84, 0.22, 0.64], at: [0, 0.11, 0.3], color: 'chestWood' },
            { bone: 'lid', size: [0.1, 0.24, 0.66], at: [-0.26, 0.11, 0.3], color: 'gold', kind: 'deco' },
            { bone: 'lid', size: [0.1, 0.24, 0.66], at: [0.26, 0.11, 0.3], color: 'gold', kind: 'deco' },
            { bone: 'lid', size: [0.14, 0.14, 0.04], at: [0, 0.0, 0.63], color: 'gold', kind: 'deco' }
        ],
        mounts: {},
        // Fully open, the lid swings back this far.
        open: { lid: { rx: -1.9 } }
    },
    // Loot on the ground: a small box per item, in blocks.
    drops: {
        gold: { size: [0.2, 0.14, 0.2], color: 'gold' },
        goblin_ear: { size: [0.22, 0.1, 0.14], color: 'earItem' },
        wolf_pelt: { size: [0.3, 0.06, 0.24], color: 'peltItem' },
        chief_tusk: { size: [0.1, 0.1, 0.3], color: 'tuskItem' },
        king_fang: { size: [0.08, 0.08, 0.26], color: 'fangItem' }
    },
    // Roof colour by building kind (multiplies the roof tile).
    roofs: { hotSpring: 'roofSpring', smithy: 'roofSmithy', shop: 'roofShop', storage: 'roofStorage' },
    // A portal's opening: open, or waiting on a boss.
    portal: { open: 'portalGlow', locked: 'portalLocked' }
});
