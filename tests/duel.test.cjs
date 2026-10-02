// PVP (design.md 8): the duel rules in the simulation (two fighters,
// light hits trade, heavy hits break, the shield the same for both, same-step
// trades, no blows across walls), and the host/guest protocol of
// core/duel.js played end to end over an in-memory channel, carried over
// from the 2D version's tests (tag v1-2d, tests/pvp-spatial.test.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { worldSim: W, duelKit, terrainKit, gameConfig, inventoryKit } = load();
const F = gameConfig.combat, M = gameConfig.combo.moves, PV = gameConfig.pvp, U = gameConfig.world.unitsPerBlock;
const plain = value => JSON.parse(JSON.stringify(value));

// ---- the rules ----
const duel = () => W.create({ map: gameConfig.maps.arena, duel: true });
// Host and guest `gap` apart on open ground, face to face.
function facing(sim, gap = 60) {
    const [h, g] = sim.fighters;
    Object.assign(h, { x: 500, y: 380, facing: 0 });
    Object.assign(g, { x: 500 + gap, y: 380, facing: Math.PI });
    return sim;
}
const step = (sim, seconds, opts) => { for (let i = 0; i < Math.round(seconds / 0.01); i++) W.step(sim, 0.01, opts); };
const tap = (sim, who, button = 'a') => { W.command(sim, { type: 'press', button }, who); W.command(sim, { type: 'release', button }, who); };

test('a duel: two mortal fighters with the same stats, on the arena spawns, face to face, in sight', () => {
    const sim = duel(), [h, g] = sim.fighters, S = inventoryKit.statsOf(inventoryKit.starter());
    assert.deepEqual(plain(sim.fighters.map(f => f.id)), ['host', 'guest']);
    assert.equal(sim.player, h, 'sim.player is the first fighter');
    for (const f of sim.fighters) {
        assert.deepEqual([f.hp, f.maxHp, f.atk, f.def, f.endless], [S.maxHp, S.maxHp, S.atk, S.def, false]);
        assert.deepEqual(plain(f.loadout), plain(gameConfig.gear.starter), 'the starter gear: a fair fight');
        assert.deepEqual([S.maxHp, S.atk, S.def], [360, 30, 8]);
    }
    assert.ok(Math.abs(h.facing) < 1e-9 && Math.abs(Math.abs(g.facing) - Math.PI) < 1e-9);
    assert.ok(Math.hypot(g.x - h.x, g.y - h.y) >= 10 * U, 'they start well apart');
    assert.ok(terrainKit.lineClear(sim.terrain, h.x, h.y, g.x, g.y), 'and can see each other');
    assert.equal(sim.dummy, null); assert.equal(sim.monsters.length, 0);
    // The arena inside its wall looks the same from either spawn, and the
    // wall is closed and high enough to hide a fighter.
    const rows = gameConfig.maps.arena.rows, t = sim.terrain, wallRow = r => /[1-9]{4,}/.test(rows[r]);
    const y0 = rows.findIndex((_, r) => wallRow(r)), y1 = rows.length - 1 - [...rows].reverse().findIndex((_, r) => wallRow(rows.length - 1 - r));
    const x0 = rows[y0].search(/[1-9]/), x1 = rows[y0].length - 1 - [...rows[y0]].reverse().join('').search(/[1-9]/);
    for (let r = y0 + 1; r < y1; r++) for (let c = x0 + 1; c < x1; c++) assert.equal(rows[r][c], rows[y0 + y1 - r][x0 + x1 - c], `point symmetric at ${c},${r}`);
    for (let c = x0; c <= x1; c++) for (const r of [y0, y1]) assert.ok(terrainKit.levelAt(t, c, r) >= 2);
    for (let r = y0; r <= y1; r++) for (const c of [x0, x1]) assert.ok(terrainKit.levelAt(t, c, r) >= 2);
    for (let c = x0; c <= x1; c++) assert.ok(terrainKit.solidAt(t, c, y0) && terrainKit.solidAt(t, c, y1));
    for (let r = y0; r <= y1; r++) assert.ok(terrainKit.solidAt(t, x0, r) && terrainKit.solidAt(t, x1, r));
    assert.throws(() => W.create({ map: gameConfig.maps.clearing, duel: true }), /two spawns/);
});

test('a light (A) hit only hurts: no stun, no push, the struck fighter cuts back', () => {
    const sim = facing(duel()), [h, g] = sim.fighters;
    tap(sim, 0); step(sim, 0.05); tap(sim, 1);
    step(sim, 0.16);
    assert.ok(g.hp < g.maxHp, 'the host landed first');
    assert.equal(g.stun, 0); assert.equal(g.push, null);
    assert.equal(g.act?.move, 'slash', 'the guest is still in its own move');
    step(sim, 0.2);
    assert.ok(h.hp < h.maxHp, 'and its cut lands too');
    assert.equal(h.stun, 0);
    assert.equal(g.stats.hurt, 1); assert.equal(h.stats.hits, 1); assert.equal(g.stats.hits, 1);
});

test('a heavy hit breaks the combo, stuns and pushes by the move', () => {
    const sim = facing(duel()), [h, g] = sim.fighters;
    W.command(sim, { type: 'press', button: 'b' }, 0); W.command(sim, { type: 'release', button: 'b' }, 0);
    step(sim, M.charged.windup - 0.02); tap(sim, 1); const x0 = g.x;
    for (let i = 0; i < 40 && g.hp === g.maxHp; i++) W.step(sim, 0.01);
    assert.ok(g.hp < g.maxHp);
    assert.equal(g.act, null, 'its slash is cut off');
    assert.ok(g.stun > F.hitStun - 0.05);
    step(sim, F.impact.hitstop.hit + F.impact.knockbackSeconds + 0.02);
    assert.ok(Math.abs(g.x - x0 - M.charged.knockback) < 4, `pushed ${g.x - x0}`);
});

test('the shield blocks and parries the same for host and guest', () => {
    for (const defender of [0, 1]) for (const parry of [true, false]) {
        const sim = facing(duel()), d = sim.fighters[defender], a = sim.fighters[1 - defender];
        W.command(sim, { type: 'press', button: 'offhand' }, defender);
        step(sim, parry ? F.guard.startup + 0.01 - M.slash.windup - 0.04 : 0.5);
        tap(sim, 1 - defender);
        step(sim, 0.25);
        const raw = a.atk * M.slash.ratio;
        if (parry) {
            assert.equal(d.stats.parries, 1, `defender ${defender}`);
            assert.equal(d.hp, d.maxHp);
            assert.ok(a.hp < a.maxHp && a.stun > 0 || a.stats.hurt === 1, 'the attacker eats the counter');
        } else {
            assert.equal(d.stats.blocks, 1);
            assert.equal(d.hp, d.maxHp - Math.round(Math.max(1, Math.round(raw * (1 - d.def / (d.def + F.damage.defenseConstant)))) * F.damage.blockMultiplier));
            assert.equal(a.hp, a.maxHp);
        }
    }
});

test('a same-step trade lands both ways; both falling is a draw, once', () => {
    const sim = facing(duel()), [h, g] = sim.fighters;
    tap(sim, 0); tap(sim, 1);
    step(sim, 0.3);
    assert.equal(h.hp, g.hp, 'mirror cuts, mirror damage');
    const hits = W.drain(sim).filter(e => e.type === 'hit');
    assert.equal(hits.length, 2); assert.equal(hits[0].time, hits[1].time);
    const end = facing(duel());
    end.fighters.forEach(f => { f.hp = 1; });
    tap(end, 0); tap(end, 1); step(end, 0.4);
    assert.deepEqual(plain(end.result), { winner: null, at: end.result.at });
    assert.equal(W.outcome(end, 'host'), 'draw');
    assert.equal(W.drain(end).filter(e => e.type === 'result').length, 1);
    const win = facing(duel());
    win.fighters[1].hp = 1; tap(win, 0); step(win, 0.3);
    assert.equal(win.result.winner, 'host');
    assert.deepEqual([W.outcome(win, 'host'), W.outcome(win, 'guest')], ['win', 'lose']);
    assert.ok(win.fighters[1].down);
    const given = duel();
    assert.equal(W.concede(given, 'guest'), true); assert.equal(W.concede(given, 'host'), false);
    assert.equal(given.result.winner, 'host'); assert.equal(given.result.conceded, 'guest');
});

test('no blow lands across an arena wall', () => {
    const sim = duel(), [h, g] = sim.fighters, t = sim.terrain;
    // Either side of the north pillar (two blocks wide).
    const r = 6, c = [...gameConfig.maps.arena.rows[r]].findIndex((ch, i) => /[1-9]/.test(ch) && i > 11);
    assert.ok(terrainKit.solidAt(t, c, r) && terrainKit.solidAt(t, c + 1, r));
    Object.assign(h, { x: (c - 0.4) * U, y: (r + 0.5) * U, facing: 0 });
    Object.assign(g, { x: (c + 2.4) * U, y: (r + 0.5) * U, facing: Math.PI });
    for (let i = 0; i < 4; i++) { tap(sim, 0); tap(sim, 1); step(sim, 0.5); }
    assert.equal(h.hp, h.maxHp); assert.equal(g.hp, g.maxHp);
});

test('with judge off (the guest predicting) swings pass through and nothing is decided', () => {
    const judged = facing(duel()), guessed = facing(duel());
    for (const s of [judged, guessed]) { tap(s, 0); tap(s, 1); }
    step(guessed, 1, { judge: false });
    assert.ok(guessed.fighters.every(f => f.hp === f.maxHp && f.stun === 0 && f.freeze === 0));
    assert.ok(!W.drain(guessed).some(e => ['hit', 'miss', 'block', 'parry', 'result'].includes(e.type)));
    guessed.fighters.forEach(f => { f.hp = 1; });
    tap(guessed, 0); step(guessed, 1, { judge: false });
    assert.equal(guessed.result, null);
    // Up to the first contact, the predicted timeline is the judged one.
    step(judged, 0.1); const ahead = facing(duel()); tap(ahead, 0); tap(ahead, 1); step(ahead, 0.1, { judge: false });
    assert.equal(JSON.stringify(W.snapshot(ahead).fighters), JSON.stringify(W.snapshot(judged).fighters));
});

test('a duel snapshot restores into a fresh world and plays on the same', () => {
    const sim = facing(duel());
    W.command(sim, { type: 'press', button: 'b' }, 0); tap(sim, 1); step(sim, 0.13); W.command(sim, { type: 'press', button: 'offhand' }, 1);
    const copy = W.restore(duel(), plain(W.snapshot(sim)));
    assert.equal(duelKit.validSnapshot(copy, W.snapshot(sim)), true);
    for (const s of [sim, copy]) { step(s, 0.5); W.command(s, { type: 'release', button: 'b' }, 0); step(s, 1); }
    assert.equal(JSON.stringify(W.snapshot(copy)), JSON.stringify(W.snapshot(sim)));
    assert.equal(copy.player, copy.fighters[0]);
});

test('snapshot checks turn away broken or foreign state', () => {
    const sim = facing(duel()); tap(sim, 0); step(sim, 0.15);
    const good = W.snapshot(sim);
    assert.equal(duelKit.validSnapshot(sim, good), true);
    const bad = [
        s => { s.fighters[0].x = NaN; }, s => { s.fighters[1].hp = 1e6; }, s => { s.fighters[0].act.move = 'teleport'; },
        s => { s.fighters[1].guard.bar = 1e6; }, s => { s.fighters[0].atk = 999; }, s => { s.fighters.pop(); },
        s => { s.fighters[1].input.buttons.skill = { held: true, presses: 1 }; }, s => { s.result = { winner: 'nobody', at: 1 }; },
        s => { s.fighters[0].id = 'guest'; }, s => { s.entities.push({}); }, s => { s.fighters[0].x = -500; },
        s => { s.fighters[0].focus = 'p-base'; }, s => { s.region = 'field'; }
    ];
    for (const corrupt of bad) { const s = plain(good); corrupt(s); assert.equal(duelKit.validSnapshot(sim, s), false, String(corrupt)); }
});

// ---- the protocol, both ends over an in-memory channel ----
function pair({ latency = 0, weapons = {} } = {}) {
    let clock = 100;
    const queue = [], log = {}, ends = {};
    for (const role of ['host', 'guest']) {
        log[role] = { starts: 0, results: [], ends: [], rematch: 0, sent: [] };
        ends[role] = duelKit.create({
            role, now: () => clock, ...(weapons[role] ? { weapon: weapons[role] } : {}),
            send: msg => { const copy = plain(msg); log[role].sent.push(copy); queue.push({ to: role === 'host' ? 'guest' : 'host', at: clock + latency, msg: copy }); },
            on: { start: () => log[role].starts++, result: o => log[role].results.push(o), end: r => log[role].ends.push(r), rematch: () => log[role].rematch++ }
        });
    }
    let connected = true;
    const deliver = () => { while (connected && queue.length && queue[0].at <= clock + 1e-9) { const { to, msg } = queue.shift(); ends[to].receive(msg); } };
    const shown = { host: [], guest: [] };
    const frame = (seconds = 0.01) => {
        clock += seconds; deliver();
        for (const role of ['host', 'guest']) shown[role].push(...ends[role].frame(seconds));
        deliver();
    };
    const run = seconds => { for (let i = 0; i < Math.round(seconds / 0.01); i++) frame(); };
    ends.host.open(); ends.guest.open(); deliver();
    return {
        host: ends.host, guest: ends.guest, log, shown, queue, frame, run, deliver,
        cut() { connected = false; }, get clock() { return clock; }, pass(seconds) { clock += seconds; }
    };
}
const fightNow = p => { p.run(PV.countdown + 0.2); assert.equal(p.host.phase, 'fight'); assert.equal(p.guest.phase, 'fight'); };
// Put the fighters face to face on the host; the guest learns it from the next snapshot.
const closeIn = p => { facing(p.host.sim); p.run(0.1); };
const press = (end, button) => end.command({ type: 'press', button });
const release = (end, button) => end.command({ type: 'release', button });

test('two phones: hello, start, ready, a countdown, then the fight on both', () => {
    const p = pair();
    assert.equal(p.host.battle, p.guest.battle); assert.ok(p.host.battle);
    assert.deepEqual([p.log.host.starts, p.log.guest.starts], [1, 1]);
    p.run(0.1);
    assert.equal(p.host.phase, 'countdown'); assert.equal(p.guest.phase, 'countdown');
    assert.ok(Math.abs(p.guest.countdown - (PV.countdown - 0.1)) < 0.03);
    assert.equal(press(p.guest, 'a'), false, 'no moves before the fight');
    assert.equal(p.guest.command({ type: 'move', x: 1, y: 0 }), true, 'the stick is taken');
    fightNow(p);
    assert.deepEqual([p.host.selfId, p.guest.selfId], ['host', 'guest']);
    assert.ok(p.host.sim.fighters[1].x > 820, 'the stick held through the countdown walks at once');
    const snaps = p.log.host.sent.filter(m => m.t === 'snap');
    assert.ok(snaps.length >= (PV.countdown + 0.2) / PV.snapshotSeconds - 2, `${snaps.length} snapshots`);
});

test('different rules on the other phone end it before it starts', () => {
    const p = pair();
    const h = duelKit.create({ role: 'host', now: () => p.clock, send() {}, on: { end: r => p.log.host.ends.push(r) } });
    h.receive({ t: 'hello', protocol: duelKit.PROTOCOL, rules: 'something-else', weapon: PV.weapons[0] });
    assert.equal(h.phase, 'ended'); assert.equal(h.endReason, 'incompatible');
    // So does a weapon that is not on the duel list.
    const odd = duelKit.create({ role: 'host', now: () => p.clock, send() {} });
    odd.receive({ t: 'hello', protocol: duelKit.PROTOCOL, rules: duelKit.rules(), weapon: 'iron_sword' });
    assert.equal(odd.endReason, 'incompatible');
    assert.throws(() => duelKit.create({ role: 'guest', now: () => 0, send() {}, weapon: 'iron_sword' }), /duel weapon/);
});

test('each side picks its weapon: a dagger against a sword, the same on both phones (user, 2026-10-02)', () => {
    assert.deepEqual(plain(PV.weapons.map(id => gameConfig.items[id].weapon)), ['sword', 'dagger'], 'one of each weapon type');
    const p = pair({ weapons: { host: 'wooden_sword', guest: 'assassin_dagger' } }); fightNow(p);
    for (const end of [p.host, p.guest]) {
        assert.deepEqual(plain(end.sim.fighters.map(f => f.loadout.main)), ['wooden_sword', 'assassin_dagger']);
        assert.deepEqual(plain(end.sim.fighters.map(f => f.loadout.offhand)), ['wooden_shield', 'wooden_shield'], 'the rest is the starter gear');
        assert.equal(end.sim.fighters[1].atk, inventoryKit.statsOf(duelKit.loadoutFor('assassin_dagger')).atk);
    }
    // Each plays its own tree.
    press(p.guest, 'a'); release(p.guest, 'a'); press(p.host, 'a'); release(p.host, 'a'); p.run(0.1);
    assert.deepEqual([p.host.sim.fighters[0].act?.move, p.host.sim.fighters[1].act?.move], ['slash', 'cut']);
    assert.equal(p.guest.sim.fighters[1].act?.move, 'cut');
    // A snapshot giving the dagger a sword move is refused.
    const snap = W.snapshot(p.host.sim);
    assert.equal(duelKit.validSnapshot(p.guest.sim, snap), true);
    snap.fighters[1].act.move = 'slash';
    assert.equal(duelKit.validSnapshot(p.guest.sim, snap), false);
    // Both may pick the same.
    const q = pair({ weapons: { host: 'assassin_dagger', guest: 'assassin_dagger' } });
    assert.ok(q.host.sim.fighters.every(f => f.loadout.main === 'assassin_dagger'));
});

test('the guest walks at once on its own phone; only the host moves the host copy', () => {
    const p = pair(); fightNow(p);
    const g = () => p.guest.sim.fighters[1], hg = () => p.host.sim.fighters[1], x = g().x;
    p.guest.command({ type: 'move', x: -1, y: 0 });
    p.guest.frame(0.03);
    assert.ok(g().x < x - 2, 'predicted before anything was delivered');
    assert.ok(Math.abs(hg().x - x) < 1e-9);
    p.run(0.5);
    p.guest.command({ type: 'move', x: 0, y: 0 }); p.run(0.3);
    assert.ok(hg().x < x - 50);
    assert.ok(Math.abs(hg().x - g().x) < 1, `host ${hg().x} guest ${g().x}`);
});

test('a guest combo reaches the same move on both phones, over latency', () => {
    const p = pair({ latency: 0.04 }); fightNow(p);
    press(p.guest, 'a'); release(p.guest, 'a');
    assert.equal(p.guest.sim.fighters[1].act.move, 'slash', 'predicted at once');
    p.run(0.2); press(p.guest, 'a'); release(p.guest, 'a'); p.run(M.slash.windup + M.slash.swing + M.slash.derive - 0.2 + 0.03);
    assert.equal(p.host.sim.fighters[1].act.move, 'backslash');
    assert.equal(p.guest.sim.fighters[1].act.move, 'backslash');
    p.run(1.2);
    assert.equal(p.host.sim.fighters[1].stats.attacks, 2);
    assert.equal(p.guest.sim.fighters[1].act, null);
    assert.equal(p.shown.guest.filter(e => e.type === 'attack' && e.side === 'guest').length, 2, 'each predicted once, never twice');
});

test('only the host changes HP; the guest sees it with the next snapshot', () => {
    const p = pair({ latency: 0.03 }); fightNow(p); closeIn(p);
    const hp = () => p.guest.sim.fighters.map(f => f.hp);
    press(p.guest, 'a'); release(p.guest, 'a');
    for (let i = 0; i < 25; i++) p.guest.frame(0.01);
    assert.deepEqual(plain(hp()), [360, 360], 'the guest\'s own cut decides nothing');
    p.run(0.4);
    assert.ok(p.host.sim.fighters[0].hp < 360);
    assert.deepEqual(plain(hp()), plain(p.host.sim.fighters.map(f => f.hp)));
    assert.equal(p.shown.guest.filter(e => e.type === 'hit').length, 1);
    assert.equal(p.shown.host.filter(e => e.type === 'hit').length, 1);
});

test('stale, foreign, duplicate and broken messages change nothing', () => {
    const p = pair(); fightNow(p);
    const battle = p.host.battle, hostGuest = p.host.sim.fighters[1];
    p.guest.command({ type: 'move', x: 0, y: 0.5 }); p.run(0.05);
    p.host.receive({ t: 'input', battle, seq: 1, cmd: { type: 'press', button: 'a' } });
    assert.equal(hostGuest.act, null, 'seq 1 was already used by the stick');
    const seq = p.log.guest.sent.filter(m => m.t === 'input').length;
    p.host.receive({ t: 'input', battle, seq: seq + 1, cmd: { type: 'teleport', x: 0 } });
    p.host.receive({ t: 'input', battle: 'old', seq: seq + 2, cmd: { type: 'press', button: 'a' } });
    assert.equal(hostGuest.act, null);
    const snap = p.log.host.sent.filter(m => m.t === 'snap').at(-1);
    p.run(0.1);
    const hp = p.guest.sim.fighters[1].hp;
    p.guest.receive({ ...plain(snap), serial: snap.serial + 1000, state: { ...plain(snap.state), fighters: [snap.state.fighters[0], { ...snap.state.fighters[1], hp: 1e5 }] } });
    p.guest.receive({ ...plain(snap) });
    assert.equal(p.guest.sim.fighters[1].hp, hp);
    assert.equal(p.guest.phase, 'fight');
});

test('a knock-out and a surrender each give one result on both phones', () => {
    const p = pair(); fightNow(p); closeIn(p);
    p.host.sim.fighters[1].hp = 1;
    press(p.host, 'a'); release(p.host, 'a'); p.run(0.5);
    assert.deepEqual(p.log.host.results, ['win']); assert.deepEqual(p.log.guest.results, ['lose']);
    assert.equal(p.guest.phase, 'over');
    assert.equal(press(p.host, 'a'), false, 'nothing after the end');
    const q = pair(); fightNow(q);
    assert.equal(q.guest.surrender(), true); q.run(0.1);
    assert.deepEqual(q.log.host.results, ['win']); assert.deepEqual(q.log.guest.results, ['lose']);
    assert.equal(q.guest.sim.result.conceded, 'guest');
});

test('a rematch either way round starts a fresh match on both; the old one is gone', () => {
    for (const first of ['host', 'guest']) {
        const p = pair(); fightNow(p);
        const old = p.host.battle;
        p.guest.surrender(); p.run(0.1);
        const second = first === 'host' ? 'guest' : 'host';
        assert.equal(p[first].rematch(), true); p.run(0.05);
        assert.equal(p.log[second].rematch, 1);
        assert.equal(p[second].phase, 'over');
        p[second].rematch(); p.run(0.1);
        assert.notEqual(p.host.battle, old); assert.equal(p.host.battle, p.guest.battle);
        assert.equal(p.host.phase, 'countdown'); assert.equal(p.guest.phase, 'countdown');
        assert.ok(p.guest.sim.fighters.every(f => f.hp === f.maxHp && !f.down));
        p.host.receive({ t: 'surrender', battle: old });
        fightNow(p);
        assert.equal(p.host.sim.result, null);
    }
});

test('silence past the timeout, or a phone leaving, ends it on both with a reason', () => {
    const p = pair(); fightNow(p);
    p.cut();
    p.run(PV.timeoutSeconds + 0.2);
    assert.deepEqual(p.log.host.ends, ['timeout']); assert.deepEqual(p.log.guest.ends, ['timeout']);
    const q = pair(); fightNow(q);
    q.guest.abort(); q.run(0.05);
    assert.deepEqual(q.log.guest.ends, ['aborted']); assert.deepEqual(q.log.host.ends, ['aborted']);
    const r = pair();
    r.host.leave(); r.run(0.05);
    assert.deepEqual(r.log.host.ends, ['closed']); assert.deepEqual(r.log.guest.ends, ['left']);
    // While nothing happens both still hear each other.
    const s = pair(); s.run(PV.timeoutSeconds * 2);
    assert.deepEqual([s.log.host.ends, s.log.guest.ends], [[], []]);
});
