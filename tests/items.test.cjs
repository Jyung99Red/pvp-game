// Items and the offhand (design.md 7): gear stats on top of the base
// stats, putting gear on and off, the shop and the smithy, weapon length
// deciding reach, a potion (drinking, spilling, waiting for a free moment),
// a torch (lighting it, burning thickets away for good), and the dark cave.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const g = load();
const { worldSim: W, inventoryKit: K, saveKit, interactKit, terrainKit: T, rigKit: R, playerAnim, combatKit, space, gameConfig, playerModel, equipmentModels, dummyKit } = g;
const I = gameConfig.items, F = gameConfig.combat, MOVES = gameConfig.combo.moves, U = gameConfig.world.unitsPerBlock;
const plain = value => JSON.parse(JSON.stringify(value));
const step = (sim, seconds) => { for (let i = 0; i < Math.round(seconds / 0.01); i++) W.step(sim, 0.01); };
const press = (sim, b) => W.command(sim, { type: 'press', button: b });
const release = (sim, b) => W.command(sim, { type: 'release', button: b });
const tap = (sim, b = 'a') => { press(sim, b); release(sim, b); };
const events = (sim, type) => W.drain(sim).filter(e => e.type === type);
const fresh = () => saveKit.fresh();
const put = (body, x, y, facing) => { body.x = x; body.y = y; if (facing !== undefined) body.facing = facing; };

// ---- stats and gear ----
test('stats are the base plus the gear worn; the starter gear makes 360 HP, 30 ATK, 8 DEF', () => {
    assert.deepEqual(plain(K.statsOf(K.starter())), { maxHp: 360, atk: 30, def: 8 });
    assert.deepEqual(plain(K.statsOf({ main: 'iron_sword', offhand: 'iron_shield', armor: 'iron_armor', accessory: 'chief_charm' })),
        { maxHp: 340 + 40 + 50, atk: 22 + 16, def: 4 + 6 + 7 });
    assert.deepEqual(plain(K.statsOf({ main: 'wooden_sword', offhand: null, armor: null, accessory: null })), { maxHp: 340, atk: 30, def: 4 });
    // Every piece of gear has a slot, stats or an offhand use, and a model.
    for (const [id, item] of Object.entries(I)) {
        if (item.kind !== 'gear' && item.kind !== 'supply') continue;
        assert.ok(K.SLOTS.includes(item.slot), `${id} slot`);
        assert.ok(item.stats || item.offhand, `${id} does something`);
        assert.doesNotThrow(() => equipmentModels.forLoadout({ main: 'wooden_sword', [item.slot]: id }), id);
        if (item.slot === 'main') assert.ok(item.blade > 0, `${id} has a blade`);
    }
    // A world wears what the save says, and its fighter has those stats.
    const save = fresh();
    save.inventory.items.iron_armor = 1; save.loadout.armor = 'iron_armor';
    const sim = W.create({ region: 'base', progress: save });
    assert.deepEqual([sim.player.maxHp, sim.player.hp, sim.player.def], [380, 380, 13]);
    const plates = sim.rigs.fighters.player.parts.filter(p => p.owner === 'iron_armor');
    assert.ok(plates.length >= 3 && plates.every(p => p.kind === 'deco'), 'iron armor plates are drawn only: the body under them is what is hit');
    assert.deepEqual(plain(equipmentModels.lookOf(save.loadout)), { tunic: 'ironTunic', tunicTrim: 'steelDark' });
    // A duel ignores the save: both in the starter gear.
    const duel = W.create({ map: gameConfig.maps.arena, duel: true, progress: save });
    assert.ok(duel.fighters.every(f => f.def === 8 && f.loadout.armor === 'cloth_armor'));
});

test('gear goes on only if owned and in its own slot; the main hand is never empty; potions may sit there with none left', () => {
    const p = fresh();
    assert.equal(K.equip(p, 'main', 'iron_sword'), '还没有');
    p.inventory.items.iron_sword = 1;
    assert.equal(K.equip(p, 'offhand', 'iron_sword'), '放不进这一栏');
    assert.equal(K.equip(p, 'main', 'iron_sword'), '');
    assert.equal(p.loadout.main, 'iron_sword');
    assert.equal(K.equip(p, 'main', null), '主手不能空着');
    assert.equal(K.equip(p, 'offhand', null), '');
    assert.equal(p.loadout.offhand, null);
    assert.equal(K.equip(p, 'offhand', 'torch'), '还没有');
    assert.equal(K.equip(p, 'offhand', 'potion'), '', 'a potion slot may be empty: the key greys out');
    assert.equal(K.equip(p, 'ring', 'chief_charm'), '没有这个装备栏');
    assert.deepEqual(plain(K.gearFor('offhand')), ['potion', 'torch', 'wooden_shield', 'iron_shield']);
});

test('the shop sells potions (five at most) and a torch, and buys materials, one or all', () => {
    const p = fresh();
    assert.equal(K.buy(p, 'potion'), '金币不够');
    p.inventory.gold = 200;
    for (let i = 0; i < 5; i++) assert.equal(K.buy(p, 'potion'), '');
    assert.equal(K.buy(p, 'potion'), '最多带 5 个');
    assert.equal(K.buy(p, 'torch'), '');
    assert.equal(K.buy(p, 'torch'), '已经有了');
    assert.equal(K.buy(p, 'iron_sword'), '不卖这个');
    assert.equal(p.inventory.gold, 200 - 5 * I.potion.price - I.torch.price);
    p.inventory.items.goblin_ear = 3; p.inventory.items.wolf_pelt = 2;
    assert.equal(K.sell(p, 'goblin_ear'), '');
    assert.equal(K.count(p, 'goblin_ear'), 2);
    assert.equal(K.sell(p, 'wolf_pelt', Infinity), '');
    assert.equal(K.count(p, 'wolf_pelt'), 0);
    assert.equal('wolf_pelt' in p.inventory.items, false, 'none left: the entry goes');
    assert.equal(K.sell(p, 'wolf_pelt'), '没有可卖的');
    assert.equal(K.sell(p, 'wooden_sword'), '不收这个');
    assert.equal(p.inventory.gold, 200 - 5 * I.potion.price - I.torch.price + I.goblin_ear.sell + 2 * I.wolf_pelt.sell);
    assert.deepEqual(plain(K.forSale()), ['potion', 'torch']);
    assert.deepEqual(plain(K.wanted()), ['goblin_ear', 'wolf_pelt', 'chief_tusk', 'king_fang']);
});

test('the smithy makes gear from materials and gold, once each', () => {
    const p = fresh(), r = I.iron_armor.recipe;
    assert.equal(K.canCraft(p, 'iron_armor'), '材料不够');
    assert.deepEqual(plain(K.needs(p, 'iron_armor')), [{ id: 'gold', need: r.gold, have: 0 }, ...Object.entries(r.materials).map(([id, need]) => ({ id, need, have: 0 }))]);
    p.inventory.gold = r.gold + 7;
    for (const [id, n] of Object.entries(r.materials)) p.inventory.items[id] = n + 1;
    assert.equal(K.craft(p, 'iron_armor'), '');
    assert.equal(K.count(p, 'iron_armor'), 1);
    assert.equal(p.inventory.gold, 7);
    for (const id of Object.keys(r.materials)) assert.equal(K.count(p, id), 1);
    assert.equal(K.craft(p, 'iron_armor'), '已经有了');
    assert.equal(K.craft(p, 'wooden_sword'), '打造不了这个', 'starter gear is not made');
    assert.ok(K.recipes().includes('chief_charm') && K.recipes().every(id => I[id].kind === 'gear'));
    // The boss trophies go into the accessories.
    assert.equal(I.chief_charm.recipe.materials.chief_tusk, 1);
    assert.equal(I.fang_necklace.recipe.materials.king_fang, 1);
});

// ---- reach comes from the blade ----
test('a weapon\'s length decides its reach: the dagger must stand closer, the iron sword reaches a little further', () => {
    const dummy = dummyKit.rig(), still = { gait: 0, moveBlend: 0, runBlend: 0, guardBlend: 0, stun: 0 };
    const rigFor = main => R.build(playerModel, { equipment: equipmentModels.forLoadout({ ...gameConfig.gear.starter, main }) });
    const lands = (rig, move, dist) => {
        const swingAt = u => R.solve(rig, playerAnim.pose(rig, { ...still, act: { move, phase: 'swing', t: u * MOVES[move].swing, from: null } }), [0, 0, 0], space.yawOf(0));
        const boxes = combatKit.hurtboxes(dummy, R.solve(dummy, dummyKit.pose({ phase: 'idle', t: 0, move: 0, flinch: 0 }), space.toBlocks(dist, 0, 0), space.yawOf(Math.PI)));
        const n = Math.ceil(MOVES[move].swing / 0.01);
        for (let i = 0; i < n; i++) if (combatKit.sweep(rig, swingAt, i / n, (i + 1) / n, [{ id: 't', boxes }])) return true;
        return false;
    };
    const dagger = rigFor('assassin_dagger'), sword = rigFor('wooden_sword'), iron = rigFor('iron_sword');
    const of = type => Object.keys(MOVES).filter(id => MOVES[id].weapon === type);
    // Each weapon plays its own type's moves (design.md 4.2).
    for (const move of of('dagger')) {
        assert.ok(lands(dagger, move, gameConfig.combo.weapons.dagger.standard), `the dagger's ${move} lands at its standard distance`);
        assert.ok(!lands(dagger, move, 80), `the dagger's ${move} does not reach 80`);
    }
    for (const move of of('sword')) {
        assert.ok(lands(sword, move, 80), `${move}: at 80 the wooden sword lands`);
        assert.ok(lands(iron, move, 88) && !lands(sword, move, 92), `${move}: the iron sword reaches past the wooden one`);
    }
    assert.ok(Math.abs(I.assassin_dagger.blade / I.wooden_sword.blade - 0.65) < 0.02, 'the dagger blade is about 65% of the sword');
});

// ---- the potion ----
function drinker({ potions = 3, region = 'field' } = {}) {
    const save = fresh();
    save.inventory.items.potion = potions; save.loadout.offhand = 'potion';
    const sim = W.create({ region, progress: save });
    sim.monsters = [];
    return { sim, p: sim.player };
}
test('a potion: a press drinks one over 0.8 s, slowly walking, and heals 30% of max HP at the end', () => {
    const { sim, p } = drinker(), P = F.potion;
    p.hp = 100;
    W.command(sim, { type: 'move', x: 1, y: 0 });
    const x0 = p.x;
    tap(sim, 'offhand');
    assert.equal(p.drink.phase, 'drink');
    step(sim, P.seconds / 2);
    assert.ok(Math.abs(p.x - x0 - gameConfig.player.speed * P.moveMultiplier * P.seconds / 2) < 2, `walks slowly: ${p.x - x0}`);
    tap(sim, 'a');
    assert.equal(p.act, null, 'no swinging with the flask up');
    assert.equal(p.hp, 100, 'nothing yet');
    step(sim, P.seconds / 2 + 0.02);
    assert.equal(p.hp, 100 + Math.round(p.maxHp * P.heal));
    assert.equal(p.drink, null);
    assert.equal(sim.progress.inventory.items.potion, 2);
    const ev = events(sim, 'drink');
    assert.equal(ev.length, 1);
    assert.deepEqual([ev[0].healed, ev[0].left], [Math.round(p.maxHp * P.heal), 2]);
    // Never past max HP.
    p.hp = p.maxHp - 5; tap(sim, 'offhand'); step(sim, P.seconds + 0.02);
    assert.equal(p.hp, p.maxHp);
});

test('a blow that gets through spills the drink and the potion is kept; with none left the key does nothing', () => {
    const { sim, p } = drinker({ potions: 1, region: 'clearing' }), d = sim.dummy;
    put(p, d.x - 60, d.y, 0);
    d.phase = 'windup'; d.move = 0; d.t = gameConfig.dummy.moves[0].windup - 0.1;
    p.hp = 200;
    tap(sim, 'offhand');
    step(sim, 0.4);
    assert.equal(sim.stats.hurt, 1);
    assert.equal(p.drink, null);
    assert.equal(sim.progress.inventory.items.potion, 1, 'kept');
    assert.equal(events(sim, 'drink_spilled').length, 1);
    d.wait = 1e9; d.phase = 'idle';
    step(sim, 1);
    tap(sim, 'offhand'); step(sim, F.potion.seconds + 0.02);
    assert.ok(!sim.progress.inventory.items.potion, 'the last one drunk');
    tap(sim, 'offhand');
    assert.equal(p.drink, null);
    assert.equal(events(sim, 'potion_empty').length, 1);
});

test('pressed in the middle of a move, the drink waits for the move to end', () => {
    const { sim, p } = drinker();
    p.hp = 100;
    tap(sim, 'a');
    step(sim, 0.05);
    tap(sim, 'offhand');
    assert.equal(p.drink.phase, 'wait');
    tap(sim, 'a');
    const slash = MOVES.slash;
    step(sim, slash.windup + slash.swing + slash.recovery - 0.05 + 0.03);
    assert.equal(sim.stats.attacks, 1, 'the A pressed while waiting did not chain');
    assert.ok(p.drink && p.drink.phase === 'drink', 'drinking once the move is over');
    step(sim, F.potion.seconds + 0.01);
    assert.equal(p.hp, 100 + Math.round(p.maxHp * F.potion.heal));
    // A second press calls a waiting drink off.
    tap(sim, 'a'); step(sim, 0.02);
    tap(sim, 'offhand'); assert.equal(p.drink.phase, 'wait');
    tap(sim, 'offhand'); assert.equal(p.drink, null);
});

// ---- the torch, thickets and the dark ----
function torchBearer(region = 'cave') {
    const save = fresh();
    save.inventory.items.torch = 1; save.loadout.offhand = 'torch';
    const sim = W.create({ region, progress: save });
    sim.monsters = [];
    return { sim, p: sim.player, save };
}
test('a torch is lit and put out with the offhand key; it does not block', () => {
    const { sim, p } = torchBearer();
    assert.equal(p.lit, false);
    tap(sim, 'offhand');
    assert.equal(p.lit, true);
    assert.equal(p.guard.state, 'down');
    assert.equal(events(sim, 'torch_lit').length, 1);
    tap(sim, 'offhand');
    assert.equal(p.lit, false);
    assert.equal(events(sim, 'torch_out').length, 1);
});

test('a lit torch sets a thicket alight; the fire spreads along it and burns it away for good', () => {
    const { sim, p, save } = torchBearer(), t = sim.terrain;
    const hedge = sim.entities.filter(e => e.type === 'brush');
    assert.equal(hedge.length, 3);
    const chest = sim.entities.find(e => e.type === 'chest'), start = t.spawn;
    // Shut in: the chest cannot be walked up to until the thicket is gone.
    const walk = () => {
        const seen = new Set([`${start.col},${start.row}`]), todo = [[start.col, start.row]];
        while (todo.length) {
            const [c, r] = todo.pop();
            for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${c + dc},${r + dr}`; if (!seen.has(k) && !T.solidAt(t, c + dc, r + dr)) { seen.add(k); todo.push([c + dc, r + dr]); } }
        }
        return seen.has(`${Math.floor(chest.x / U)},${Math.floor(chest.y / U) + 1}`);
    };
    assert.equal(walk(), false);
    const mid = hedge[1];
    put(p, mid.x, mid.y + 36, -Math.PI / 2);
    step(sim, 0.02);
    assert.equal(p.focus, mid.id);
    assert.deepEqual(plain(interactKit.target(sim, p).offer), { verb: '点燃', name: '枯木丛', hold: 0, ready: false, why: '先点燃火把' });
    tap(sim, 'offhand');
    step(sim, 0.01);
    tap(sim, 'interact');
    assert.equal(mid.burning >= 0, true);
    step(sim, gameConfig.props.burnSpread + 0.02);
    assert.ok(hedge.every(e => e.burning >= 0), 'the fire spread to both neighbours');
    step(sim, gameConfig.props.burnSeconds);
    assert.equal(sim.entities.filter(e => e.type === 'brush').length, 0);
    assert.ok(hedge.every(e => T.kindAt(t, e.col, e.row) === T.KIND.path));
    assert.equal(walk(), true, 'the way to the chest is open');
    // Burnt stays burnt: the save keeps the terrain edits.
    const after = saveKit.merge(save, sim);
    assert.equal(after.edits.cave.length, 3);
    const again = W.create({ region: 'cave', progress: after });
    assert.equal(again.entities.filter(e => e.type === 'brush').length, 0);
    // Without a torch the key cannot light it.
    const bare = W.create({ region: 'cave' }), b = bare.entities.find(e => e.type === 'brush');
    put(bare.player, b.x, b.y + 36, -Math.PI / 2); bare.monsters = []; step(bare, 0.02);
    assert.equal(interactKit.target(bare, bare.player).offer.why, '要用火把点燃');
});

test('the dark cave hangs off the valley, and the valley is reached only past the goblin chief', () => {
    const cave = gameConfig.maps.cave;
    assert.equal(cave.dark, true);
    assert.deepEqual(plain(cave.portals.map(p => p.to)), ['valley']);
    assert.ok(gameConfig.maps.valley.portals.some(p => p.to === 'cave'));
    const sim = W.create({ region: 'cave', arrival: 'valley' });
    assert.equal(T.kindAt(sim.terrain, Math.floor(sim.monsters[0].x / U), Math.floor(sim.monsters[0].y / U)), T.KIND.gravel, 'monsters stand on the cave floor');
});
