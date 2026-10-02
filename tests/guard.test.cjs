// The offhand key with a shield (design.md 3.4) and the
// guard bar (design.md 4.5), carried over from the 2D version
// and played against the training dummy's real attacks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { worldSim: W, gameConfig, fighterKit, inventoryKit } = load();
const G = gameConfig.combat.guardBar, GU = gameConfig.combat.guard, D = gameConfig.dummy, F = gameConfig.combat;
// The player's stats: the base plus the starter gear (core/inventory.js).
const S = inventoryKit.statsOf(inventoryKit.starter());

// Player 60 units in front of the dummy, facing it; the dummy swipes at once.
function setup({ facingAway = false, loadout } = {}) {
    const sim = W.create(loadout ? { loadout } : {}), d = sim.dummy;
    sim.player.x = d.x - 60; sim.player.y = d.y; sim.player.facing = facingAway ? Math.PI : 0;
    d.wait = 0;
    return sim;
}
const step = (sim, seconds) => { for (let i = 0; i < Math.round(seconds / 0.01); i++) W.step(sim, 0.01); };
const press = (sim, b) => W.command(sim, { type: 'press', button: b });
const release = (sim, b) => W.command(sim, { type: 'release', button: b });
// When the dummy's first swipe lands on an unguarded player.
const impactTime = (() => {
    const sim = setup();
    for (let i = 0; i < 400; i++) { W.step(sim, 0.01); if (sim.stats.hurt) return sim.time; }
    throw new Error('the dummy never reached the player');
})();
const swipeRaw = D.atk * D.moves[0].ratio, cost = parry => swipeRaw / S.maxHp * G.blockCostScale * G.max * (parry ? G.parryCostRatio : 1);
// Run to `t`, raise the shield then, and run through the impact.
function guardAt(sim, t) {
    step(sim, t - sim.time); press(sim, 'offhand');
    step(sim, impactTime + 0.05 - sim.time);
    return sim;
}

test('the dummy attacks in reach, its swipe lands during its swing, and an unguarded hit stuns', () => {
    // setup() has the dummy start at once, so the hit falls inside its first swing.
    assert.ok(impactTime > D.moves[0].windup && impactTime <= D.moves[0].windup + D.moves[0].swing + 0.011, `hit at ${impactTime}`);
    const sim = setup();
    while (sim.time < impactTime - 0.015) W.step(sim, 0.01);
    const hp = sim.player.hp;
    step(sim, 0.02);
    assert.equal(sim.player.hp, hp - Math.max(1, Math.round(swipeRaw * (1 - S.def / (S.def + F.damage.defenseConstant)))));
    assert.ok(sim.player.stun > 0 && sim.player.act === null && sim.player.chain === null, 'a hit stuns and ends the combo');
    // An A pressed during the stun runs once it is over.
    press(sim, 'a'); release(sim, 'a'); assert.equal(sim.player.act, null);
    step(sim, F.hitStun + 0.05); assert.equal(sim.player.act?.move, 'slash');
    // Out of reach, the dummy does not even start.
    const far = setup(); far.player.x -= D.engageRange; step(far, 2);
    assert.equal(far.dummy.phase, 'idle');
});

test('raising costs a little, holding drains, a block costs more than a parry of the same hit', () => {
    const sim = setup(); sim.dummy.wait = 1e9; press(sim, 'offhand');
    assert.equal(sim.player.guard.bar, G.max - G.raiseCost);
    step(sim, 0.5); assert.ok(Math.abs(sim.player.guard.bar - (G.max - G.raiseCost - G.holdDrain * 0.5)) < 1e-6);
    // Raised long before: a block.
    const block = guardAt(setup(), impactTime - 0.8);
    assert.equal(block.stats.blocks, 1); assert.equal(block.stats.parries, 0);
    assert.ok(Math.abs(G.max - block.player.guard.bar - G.raiseCost - G.holdDrain * (block.time - (impactTime - 0.8)) - cost(false)) < 0.2);
    // Up just before the hit: a perfect parry, which costs half and hits back.
    const parry = guardAt(setup(), impactTime - GU.startup - 0.05);
    assert.equal(parry.stats.parries, 1);
    assert.ok(Math.abs(G.max - parry.player.guard.bar - G.raiseCost - G.holdDrain * (parry.time - (impactTime - GU.startup - 0.05)) - cost(true)) < 0.2);
    assert.ok(parry.dummy.hp < parry.dummy.maxHp, 'the parry hits back');
    assert.equal(parry.dummy.stagger, F.stagger.parry);
    // The bar refills only with the shield down.
    release(parry, 'offhand'); const low = parry.player.guard.bar; step(parry, 0.3);
    assert.ok(Math.abs(parry.player.guard.bar - low - G.max / G.refillSeconds * 0.3) < 1e-6);
});

test('a blocked hit does a share of the damage and no stun; from behind the shield does nothing', () => {
    const block = guardAt(setup(), impactTime - 0.8);
    assert.ok(block.player.hp < block.player.maxHp && block.player.maxHp - block.player.hp <= Math.ceil(swipeRaw * F.damage.blockMultiplier));
    assert.equal(block.player.stun, 0);
    const behind = guardAt(setup({ facingAway: true }), impactTime - 0.8);
    assert.equal(behind.stats.blocks, 0); assert.equal(behind.stats.hurt, 1);
    assert.ok(behind.player.stun > 0);
});

test('an empty bar drops the shield and locks it until the bar is back to the unlock ratio', () => {
    const sim = setup(); sim.dummy.wait = 1e9; sim.player.guard.bar = 15; press(sim, 'offhand');
    for (let i = 0; i < 100 && !sim.player.guard.locked; i++) W.step(sim, 0.01);
    assert.ok(Math.abs(sim.time - (15 - G.raiseCost) / G.holdDrain) < 0.011, 'the hold drains the last 5 points in 0.5 s');
    assert.equal(sim.player.guard.state, 'down');
    assert.ok(W.drain(sim).some(e => e.type === 'guard_broken'));
    release(sim, 'offhand'); press(sim, 'offhand');
    assert.equal(sim.player.guard.state, 'down', 'locked: no shield, so no parry either');
    release(sim, 'offhand');
    step(sim, G.refillSeconds * G.unlockRatio - 0.05); assert.equal(sim.player.guard.locked, true);
    step(sim, 0.06); assert.equal(sim.player.guard.locked, false);
    press(sim, 'offhand'); assert.equal(sim.player.guard.state, 'raising');
    // The block that empties the bar still counts as a block.
    const last = setup(); step(last, impactTime - 0.8); press(last, 'offhand'); step(last, 0.6); last.player.guard.bar = 5;
    step(last, impactTime + 0.05 - last.time);
    assert.equal(last.stats.blocks, 1); assert.equal(last.player.guard.locked, true); assert.equal(last.player.stun, 0);
});

test('a move plays out whole before the shield goes up; a charge is dropped at once', () => {
    // User, 2026-10-01: the shield no longer cuts a recovery. The dummy is
    // moved off so no hitstop shifts the times.
    const quiet = () => { const s = setup(); s.dummy.wait = 1e9; s.dummy.x += 400; return s; };
    const M = gameConfig.combo.moves;
    for (const at of [0.05, 0.15, 0.25]) { // windup, swing, recovery
        const sim = quiet(); press(sim, 'a'); release(sim, 'a'); step(sim, at);
        press(sim, 'offhand'); assert.equal(sim.player.guard.queued, true); assert.notEqual(sim.player.act, null);
        let upAt = null;
        for (let i = 0; i < 100 && upAt == null; i++) { W.step(sim, 0.01); if (sim.player.guard.state !== 'down') upAt = sim.time; }
        assert.ok(Math.abs(upAt - (M.slash.windup + M.slash.swing + M.slash.recovery)) < 0.011, `pressed at ${at}: up at ${upAt}, when the recovery ends`);
        assert.equal(sim.player.act, null); assert.equal(sim.player.chain, null); assert.equal(sim.stats.attacks, 1);
    }
    // A or B pressed while the shield waits do nothing, so the move cannot chain on.
    const waiting = quiet(); press(waiting, 'a'); release(waiting, 'a'); step(waiting, 0.15);
    press(waiting, 'offhand'); press(waiting, 'a'); release(waiting, 'a'); step(waiting, 0.6);
    assert.equal(waiting.stats.attacks, 1); assert.notEqual(waiting.player.guard.state, 'down');
    // Let go before the move ends: nothing goes up.
    const changed = quiet(); press(changed, 'a'); release(changed, 'a'); step(changed, 0.15);
    press(changed, 'offhand'); step(changed, 0.1); release(changed, 'offhand'); step(changed, 0.5);
    assert.equal(changed.player.guard.state, 'down'); assert.equal(changed.player.guard.bar, G.max);
    // Pressed in the charged windup with B still held, it drops the charge when the windup ends.
    const held = quiet(); press(held, 'b'); step(held, 0.2); press(held, 'offhand');
    step(held, gameConfig.combo.moves.charged.windup - 0.2 + 0.02);
    assert.equal(held.player.act, null); assert.equal(held.player.guard.state, 'raising');
    release(held, 'b'); step(held, 0.5); assert.equal(held.stats.attacks, 1, 'the charge never cut');
    const charge = quiet(); press(charge, 'b'); step(charge, 0.6); assert.equal(charge.player.act.phase, 'charge');
    press(charge, 'offhand'); release(charge, 'b'); step(charge, 1);
    assert.equal(charge.player.act, null); assert.equal(charge.stats.attacks, 1, 'the charge is dropped, not fired');
});

test('with the shield up A and B do nothing; the offhand key needs something in the offhand', () => {
    const sim = setup(); sim.dummy.wait = 1e9; press(sim, 'offhand'); step(sim, 0.3);
    press(sim, 'a'); release(sim, 'a'); press(sim, 'b'); release(sim, 'b'); step(sim, 0.5);
    assert.equal(sim.stats.attacks, 0);
    release(sim, 'offhand'); press(sim, 'a'); assert.equal(sim.player.act.move, 'slash');
    const empty = setup({ loadout: { main: 'wooden_sword', offhand: null } }); empty.dummy.wait = 1e9;
    press(empty, 'offhand'); step(empty, 0.3);
    assert.equal(empty.player.guard.state, 'down'); assert.equal(empty.player.guard.bar, G.max);
    assert.equal(fighterKit.OFFHAND.shield.press.length, 2, 'press(sim, fighter)');
});

test('training is deathless: a fall refills the player', () => {
    const sim = setup(); sim.player.hp = 1;
    step(sim, impactTime + 0.05);
    assert.equal(sim.player.hp, sim.player.maxHp);
    assert.ok(W.drain(sim).some(e => e.type === 'refilled' && e.side === 'player'));
});

test('an A pressed during the hitstop of a block runs once the hitstop is over', () => {
    const sim = setup(); step(sim, impactTime - 0.8); press(sim, 'offhand');
    for (let i = 0; i < 200 && !sim.stats.blocks; i++) W.step(sim, 0.01);
    assert.ok(sim.player.freeze > 0, 'held by the block');
    release(sim, 'offhand'); press(sim, 'a'); release(sim, 'a');
    step(sim, 0.1);
    assert.equal(sim.stats.attacks, 1); assert.equal(sim.player.act?.move, 'slash');
});
