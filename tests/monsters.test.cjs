// Monsters (rebuild-plan.md M3): the goblin and wolf models, the player's
// cuts landing on a short monster (3d-migration-concept.md 4.6), their own
// blows as bone hits with reach and warning swept from the key poses
// (4.3, 4.4), and the old minimal AI: patrol, alert, chase, attack in turn,
// enrage, leash; then a whole fight to a result.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const g = load();
const { worldSim: W, rigKit: R, math3d: M, playerAnim, combatKit, monsterKit, terrainKit, space, gameConfig, playerModel, equipmentModels } = g;
const MOVES = gameConfig.combo.moves, MON = gameConfig.monsters, U = gameConfig.world.unitsPerBlock, F = gameConfig.combat;
const STANDARD = 60;
const plain = value => JSON.parse(JSON.stringify(value));

const player = R.build(playerModel, { equipment: equipmentModels.forLoadout({ main: 'sword', offhand: 'shield' }) });
const still = { gait: 0, moveBlend: 0, runBlend: 0, guardBlend: 0, stun: 0 };
const standing = kind => ({ kind, phase: 'patrol', t: 0, move: 0, flinch: 0, gait: 0, moveBlend: 0 });
const rigs = { goblin: monsterKit.rig('goblin'), wolf: monsterKit.rig('wolf') };
const extent = (rig, solved, kinds) => {
    let top = -Infinity, low = Infinity;
    rig.parts.forEach((p, i) => {
        if (kinds && !kinds.includes(p.kind)) return;
        for (const c of M.corners(M.obb(solved.parts[i], p.size.map(v => v / 2)))) { top = Math.max(top, c[1]); low = Math.min(low, c[1]); }
    });
    return { top, low };
};

// ---- models ----
test('the goblin is a 1.4-block humanoid on the simple 9-bone monster skeleton', () => {
    const rig = rigs.goblin, s = R.solve(rig, monsterKit.pose(rig, standing('goblin')));
    assert.deepEqual(plain(rig.bones.map(b => b.name)), plain(g.dummyModel.bones.map(b => b.name)), 'the same skeleton as the training dummy');
    const all = extent(rig, s);
    assert.ok(Math.abs(all.top - 1.4) < 0.08, `about 1.4 blocks tall (12.1): ${all.top.toFixed(2)}`);
    assert.ok(Math.abs(all.low) < 1e-6, 'standing on the ground');
    // Ears, eyes and rags are drawn only; the club strikes; the body is hit.
    const kinds = name => rig.parts.filter(p => p.kind === name).length;
    assert.equal(kinds('weapon'), 1);
    assert.ok(kinds('deco') >= 8 && kinds('body') === 6);
});

test('the wolf is a quadruped with its back about 0.8 and head about 1.0 blocks up', () => {
    const rig = rigs.wolf, s = R.solve(rig, monsterKit.pose(rig, standing('wolf')));
    const names = rig.bones.map(b => b.name);
    for (const leg of ['legFR', 'legFL', 'legBR', 'legBL']) assert.ok(names.includes(leg));
    const body = rig.parts.findIndex(p => p.bone === rig.index.body && p.kind === 'body');
    const back = Math.max(...M.corners(M.obb(s.parts[body], rig.parts[body].size.map(v => v / 2))).map(c => c[1]));
    assert.ok(Math.abs(back - 0.8) < 0.08, `back at ${back.toFixed(2)}`);
    const hurt = extent(rig, s, ['body']);
    assert.ok(Math.abs(hurt.top - 1.0) < 0.08, `head top at ${hurt.top.toFixed(2)}`);
    assert.ok(Math.abs(extent(rig, s).low) < 1e-6, 'standing on the ground');
    assert.equal(rig.parts.filter(p => p.kind === 'weapon').length, 1, 'the muzzle bites');
});

test('walking swings the legs and keeps the feet on the ground; the stride follows the legs', () => {
    for (const kind of ['goblin', 'wolf']) {
        const rig = rigs[kind];
        let moved = false;
        for (let k = 0; k < 8; k++) {
            const pose = monsterKit.pose(rig, { ...standing(kind), gait: k / 8, moveBlend: 1 });
            assert.ok(Math.abs(extent(rig, R.solve(rig, pose)).low) < 1e-6, `${kind} grounded at phase ${k / 8}`);
            if (Object.keys(pose).some(b => /^leg/.test(b) && Math.abs(pose[b].rx || 0) > 0.3)) moved = true;
        }
        assert.ok(moved, `${kind} legs swing`);
        const leg = (kind === 'goblin' ? g.goblinPoses : g.wolfPoses).walk.leg;
        assert.ok(Math.abs(monsterKit.cycleLength(kind) - 4 * leg.length * Math.sin(leg.amp) * U) < 1e-9);
    }
});

// ---- the player's cuts on monsters (3d-migration-concept.md 4.6) ----
const swingAt = (move, u) => R.solve(player, playerAnim.pose(player, { ...still, act: { move, phase: 'swing', t: u * MOVES[move].swing, from: null } }), [0, 0, 0], space.yawOf(0));
// A monster `dist` ahead of the player, turned `turn` from facing it.
function monsterAt(kind, dist, turn = 0) {
    const rig = rigs[kind];
    return combatKit.hurtboxes(rig, R.solve(rig, monsterKit.pose(rig, standing(kind)), space.toBlocks(dist, 0, 0), space.yawOf(Math.PI + turn)));
}
function lands(move, boxes) {
    const n = Math.ceil(MOVES[move].swing / 0.01);
    for (let i = 0; i < n; i++) if (combatKit.sweep(player, u => swingAt(move, u), i / n, (i + 1) / n, [{ id: 't', boxes }])) return true;
    return false;
}
test('at the standard distance every move lands on the goblin and on the low wolf, whichever way they face', () => {
    for (const kind of ['goblin', 'wolf']) {
        for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
            for (const move of Object.keys(MOVES)) assert.ok(lands(move, monsterAt(kind, STANDARD, turn)), `${move} misses a ${kind} turned ${turn.toFixed(2)}`);
        }
        assert.ok(!lands('slash', monsterAt(kind, 150)), `the slash does not reach a ${kind} far off`);
    }
});

// ---- monster blows ----
function playerAt(dist, angle) {
    const x = Math.cos(angle) * dist, y = Math.sin(angle) * dist;
    return combatKit.hurtboxes(player, R.solve(player, playerAnim.pose(player, still), space.toBlocks(x, y, 0), space.yawOf(Math.atan2(-y, -x))));
}
// The monster at the origin facing +x; returns the first contact with a
// player standing `dist` away at `angle`, lunge included, or null.
function blow(kind, i, dist, angle = 0) {
    const rig = rigs[kind], mv = MON[kind].moves[i], lunge = u => mv.step * (1 - (1 - u) * (1 - u));
    const at = u => R.solve(rig, monsterKit.pose(rig, { ...standing(kind), phase: 'swing', t: u * mv.swing, move: i }), [lunge(u) / U, 0, 0], space.yawOf(0));
    const opts = mv.ram ? { kinds: ['body', 'weapon'], pad: 0 } : undefined, n = Math.ceil(mv.swing / 0.01), boxes = playerAt(dist, angle);
    for (let k = 0; k < n; k++) { const hit = combatKit.sweep(rig, at, k / n, (k + 1) / n, [{ id: 'p', boxes }], opts); if (hit) return hit; }
    return null;
}
// Is the ground point (x, z) inside a counter-clockwise convex hull?
const inside = (hull, x, z) => hull.every((a, i) => { const b = hull[(i + 1) % hull.length]; return (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-9; });

test('each monster move reaches as far as its key poses carry it, in front only, and the warning covers where it lands', () => {
    for (const kind of ['goblin', 'wolf']) MON[kind].moves.forEach((mv, i) => {
        const r = monsterKit.reach(kind, i);
        assert.ok(r.forward > 40 && r.forward < 220, `${kind} ${mv.id} reach ${r.forward}`);
        // Where the AI attacks from, and closer, the blow lands on a player in front.
        for (const d of [30, MON[kind].standOff * r.forward, r.forward]) {
            const hit = blow(kind, i, d);
            assert.ok(hit, `${kind} ${mv.id} misses at ${d.toFixed(0)}`);
            // The warning, in the monster's frame (+z ahead): the contact is inside it.
            assert.ok(inside(r.hull, -hit.point[2], hit.point[0]), `${kind} ${mv.id} lands outside its warning`);
        }
        assert.ok(!blow(kind, i, r.forward + 30), `${kind} ${mv.id} reaches past its reach`);
        assert.ok(!blow(kind, i, 40, Math.PI), `${kind} ${mv.id} reaches behind`);
    });
    // The leap flies far and straight; the bite stays close.
    assert.ok(monsterKit.reach('wolf', 1).forward > 4 * U && monsterKit.reach('wolf', 0).forward < 2 * U);
    assert.ok(!blow('wolf', 1, 120, Math.PI / 3), 'the leap does not reach far to the side');
});

// ---- the AI on the field ----
// The field with only the first monster of each kind named left in it.
function field(...kinds) {
    const sim = W.create({ map: gameConfig.maps.field });
    sim.monsters = kinds.map(kind => sim.monsters.find(m => m.kind === kind));
    return sim;
}
const step = (sim, seconds) => { for (let i = 0; i < Math.round(seconds / 0.01); i++) W.step(sim, 0.01); };
const press = (sim, b) => W.command(sim, { type: 'press', button: b });
const release = (sim, b) => W.command(sim, { type: 'release', button: b });
const tap = (sim, b = 'a') => { press(sim, b); release(sim, b); };
const events = (sim, type) => W.drain(sim).filter(e => e.type === type);
const put = (body, x, y, facing) => { body.x = x; body.y = y; if (facing !== undefined) body.facing = facing; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('the field: closed, the player spawns out of every alert range, monsters stand on open grass', () => {
    const sim = W.create({ map: gameConfig.maps.field }), t = sim.terrain;
    assert.deepEqual(plain(sim.monsters.map(m => m.kind).sort()), ['goblin', 'goblin', 'wolf', 'wolf']);
    assert.equal(sim.dummy, null);
    assert.equal(sim.player.endless, false, 'outside training the player can fall');
    for (const m of sim.monsters) {
        assert.ok(!terrainKit.blocked(t, m.x, m.y, m.radius), `${m.id} placed clear`);
        assert.ok(dist(m, sim.player) > MON[m.kind].alertRange + 100, `${m.id} would notice the player at once`);
    }
    const seen = new Set([`${t.spawn.col},${t.spawn.row}`]), todo = [[t.spawn.col, t.spawn.row]];
    while (todo.length) {
        const [c, r] = todo.pop();
        assert.ok(c > 0 && r > 0 && c < t.width - 1 && r < t.height - 1, `open path to the edge at ${c},${r}`);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = `${c + dc},${r + dr}`;
            if (!seen.has(key) && !terrainKit.solidAt(t, c + dc, r + dr)) { seen.add(key); todo.push([c + dc, r + dr]); }
        }
    }
    for (const m of sim.monsters) assert.ok(seen.has(`${Math.floor(m.x / U)},${Math.floor(m.y / U)}`), `${m.id} can be reached`);
    assert.throws(() => terrainKit.fromRows(['@x']));
});

test('a patrol walks from waypoint to waypoint near home and rests between them', () => {
    const sim = field('goblin', 'wolf');
    let far = 0, rests = 0, wasResting = false;
    for (let i = 0; i < 2000; i++) {
        W.step(sim, 0.01);
        for (const m of sim.monsters) far = Math.max(far, dist(m, m.home) - MON[m.kind].patrolRadius);
        const m = sim.monsters[0];
        if (m.rest > 0 && !wasResting) rests++;
        wasResting = m.rest > 0;
    }
    assert.ok(sim.monsters.every(m => m.phase === 'patrol'));
    assert.ok(far < 4, `strays ${far.toFixed(1)} past its patrol radius`);
    assert.ok(rests >= 2, `rested ${rests} times in 20 s`);
    assert.ok(sim.monsters.every(m => m.gait > 1), 'legs walk the patrol');
});

test('notice, stand alert, chase, and attack once the player is within the move\'s reach', () => {
    const sim = field('goblin'), m = sim.monsters[0], p = sim.player, S = MON.goblin;
    put(p, m.x - S.alertRange + 10, m.y, 0);
    step(sim, 0.02);
    assert.equal(m.phase, 'alert');
    assert.equal(events(sim, 'alert').length, 1);
    const x0 = m.x;
    step(sim, S.alertSeconds - 0.05);
    assert.equal(m.phase, 'alert'); assert.ok(Math.abs(m.x - x0) < 1e-9, 'an alert monster stands');
    step(sim, 0.1);
    assert.equal(m.phase, 'chase');
    // It closes in until the player is within the first move's reach.
    const reach = monsterKit.reach('goblin', 0).forward;
    for (let i = 0; i < 400 && m.phase === 'chase'; i++) W.step(sim, 0.01);
    assert.equal(m.phase, 'windup');
    assert.ok(dist(m, p) <= reach + 1e-6 && dist(m, p) > reach * S.standOff - 3, `attacks from ${dist(m, p).toFixed(1)}`);
    assert.ok(m.speed === 0 || m.moveBlend < 1, 'stops to attack');
    // Standing still, the player takes the blow.
    const hp = p.hp;
    step(sim, S.moves[0].windup + S.moves[0].swing + 0.05);
    assert.ok(p.hp < hp && sim.stats.hurt === 1, 'the flail lands');
    assert.ok(W.drain(sim).some(e => e.type === 'hit' && e.target === 'player' && e.side === 'monster' && e.source === m.id));
    // The moves come in turn, `delay` apart.
    for (let i = 0; i < 600 && m.seq < 1; i++) W.step(sim, 0.01);
    for (let i = 0; i < 600 && m.phase !== 'windup'; i++) W.step(sim, 0.01);
    assert.equal(S.moves[m.move].id, 'pounce');
});

test('the windup turns to follow the player until `lock` before the swing, then holds', () => {
    const sim = field('wolf'), m = sim.monsters[0], p = sim.player, S = MON.wolf, mv = S.moves[0];
    put(m, 600, 400, 0); put(p, 650, 400, 0);
    m.phase = 'chase'; m.wait = 0;
    W.step(sim, 0.01);
    assert.equal(m.phase, 'windup');
    // Sidestep while it winds up: it turns after the player.
    put(p, 640, 430);
    step(sim, mv.windup - mv.lock - 0.05);
    const toward = Math.atan2(p.y - m.y, p.x - m.x);
    assert.ok(Math.abs(space.wrapAngle(m.facing - toward)) < 0.1, 'tracked the sidestep');
    // Inside the lock it no longer turns.
    step(sim, 0.06);
    const locked = m.facing;
    put(p, m.x, m.y - 50);
    step(sim, mv.lock - 0.03);
    assert.equal(m.facing, locked);
});

test('lured past its leash it gives up and walks home, then patrols again', () => {
    const sim = field('goblin'), m = sim.monsters[0], p = sim.player, S = MON.goblin;
    m.phase = 'chase'; m.wait = 99;
    put(m, m.home.x - S.leash - 10, m.home.y);
    put(p, m.x - S.alertRange - 40, m.y);
    W.step(sim, 0.01);
    assert.equal(m.phase, 'return');
    step(sim, 12);
    assert.equal(m.phase, 'patrol');
    assert.ok(dist(m, m.home) < S.patrolRadius + 4);
});

test('enraged below its threshold: harder blows and a faster clock, for good', () => {
    const S = MON.wolf, mv = S.moves[0];
    const timeToHit = enraged => {
        const sim = field('wolf'), m = sim.monsters[0], p = sim.player;
        put(m, 600, 400, 0); put(p, 650, 400, Math.PI);
        m.phase = 'chase'; m.wait = 0;
        if (enraged) { m.hp = Math.floor(m.maxHp * S.enrage.threshold); m.enraged = true; }
        const hp = p.hp;
        for (let i = 0; i < 300 && p.hp === hp; i++) W.step(sim, 0.01);
        return { time: sim.time, damage: hp - p.hp };
    };
    const calm = timeToHit(false), wild = timeToHit(true);
    assert.ok(Math.abs(wild.time * S.enrage.tempo - calm.time) < 0.05, `windup ${calm.time} then ${wild.time}`);
    const def = F.fighters.player.def, hit = raw => Math.max(1, Math.round(raw * (1 - def / (def + F.damage.defenseConstant))));
    assert.equal(calm.damage, hit(S.atk * mv.ratio));
    assert.equal(wild.damage, hit(S.atk * mv.ratio * S.enrage.atk));
    // The player's hits set it off at the threshold.
    const sim = field('goblin'), m = sim.monsters[0];
    put(sim.player, m.x - STANDARD, m.y, 0); m.wait = 99;
    m.hp = Math.ceil(m.maxHp * MON.goblin.enrage.threshold) + 2;
    tap(sim); step(sim, 0.3);
    assert.ok(m.enraged && events(sim, 'enrage').length === 1);
});

test('struck while still on patrol or alert it fights back at once; B moves push it and stagger it into a reel', () => {
    const sim = field('goblin'), m = sim.monsters[0], p = sim.player;
    put(p, m.x - STANDARD, m.y, 0);
    m.rest = 99; m.phase = 'patrol';
    // Hit before its alert has run out: it skips the rest and fights.
    tap(sim); step(sim, 0.25);
    assert.equal(sim.stats.hits, 1);
    assert.ok(['chase', 'windup'].includes(m.phase) && sim.time < MON.goblin.alertSeconds);
    // A B (rising): pushed back and 1.5 stagger; a second A B reels it.
    const x0 = m.x;
    step(sim, 0.2); tap(sim, 'b'); step(sim, 0.6);
    assert.ok(m.x - x0 > 5, `pushed ${(m.x - x0).toFixed(1)}`);
    assert.equal(m.stagger, MOVES.rising.stagger);
    m.hp = m.maxHp; m.phase = 'chase'; m.wait = 99;
    put(p, m.x - STANDARD, m.y, 0);
    step(sim, 0.5); tap(sim); step(sim, 0.25); tap(sim, 'b'); step(sim, 0.6);
    assert.equal(m.phase, 'reel');
    step(sim, F.stagger.duration + 0.05);
    assert.equal(m.phase, 'chase');
});

test('a block and a perfect parry work against a monster as against the dummy', () => {
    const S = MON.goblin, mv = S.moves[0];
    const fight = raiseBefore => {
        const sim = field('goblin'), m = sim.monsters[0], p = sim.player;
        put(m, 600, 400, Math.PI); put(p, 560, 400, 0);
        m.phase = 'chase'; m.wait = 0;
        W.step(sim, 0.01);
        step(sim, mv.windup - raiseBefore);
        press(sim, 'offhand');
        step(sim, raiseBefore + mv.swing + 0.1);
        return sim;
    };
    const block = fight(0.8);
    assert.equal(block.stats.blocks, 1); assert.equal(block.stats.hurt, 0);
    const parry = fight(F.guard.startup + 0.04);
    assert.equal(parry.stats.parries, 1);
    const m = parry.monsters[0];
    assert.ok(m.hp < m.maxHp && m.stagger === F.stagger.parry, 'the parry hits back and staggers');
});

test('the wolf\'s leap rams with its body along the path, sub-stepped, and stops where it meets the player', () => {
    const S = MON.wolf, mv = S.moves[1];
    const leap = (playerDist, guard = false) => {
        const sim = field('wolf'), m = sim.monsters[0], p = sim.player;
        if (guard) { press(sim, 'offhand'); step(sim, 0.4); }
        put(m, 400, 400, 0); put(p, 400 + playerDist, 400, Math.PI);
        m.phase = 'windup'; m.move = 1; m.t = mv.windup - 0.005;
        const x0 = m.x;
        step(sim, mv.swing + 0.05);
        return { sim, m, p, travelled: m.x - x0 };
    };
    const open = leap(1000);
    assert.ok(Math.abs(open.travelled - mv.step) < 1, `leapt ${open.travelled.toFixed(1)} in the open`);
    const mid = leap(110);
    assert.equal(mid.sim.stats.hurt, 1, 'a player in the path is hit');
    assert.ok(mid.travelled < 110, `stopped after ${mid.travelled.toFixed(1)}`);
    assert.ok(W.drain(mid.sim).some(e => e.type === 'hit' && e.move === 'leap'));
    const guarded = leap(110, true);
    assert.equal(guarded.sim.stats.blocks, 1, 'and it can be blocked');
});

test('no blow lands across a wall, either way (3d-migration-concept.md 10, item 4)', () => {
    // A one-block stone at cell (15, 15) of the field; the two stand either side of it.
    const across = (stone, goblinSwings) => {
        const sim = field('goblin'), m = sim.monsters[0], p = sim.player, t = sim.terrain;
        assert.ok(terrainKit.solidAt(t, 15, 15));
        const y = 15.5 * U, x = stone ? 15 * U - 14 : 13 * U;
        put(p, x, y, 0); put(m, x + 68, y, Math.PI);
        assert.equal(terrainKit.lineClear(t, p.x, p.y, m.x, m.y), !stone);
        if (goblinSwings) { m.phase = 'windup'; m.move = 1; m.t = MON.goblin.moves[1].windup - 0.01; } else { m.phase = 'chase'; m.wait = 99; tap(sim, 'b'); }
        step(sim, 0.8);
        return goblinSwings ? sim.stats.hurt : sim.stats.hits;
    };
    assert.equal(across(false, true), 1, 'the pounce lands in the open');
    assert.equal(across(false, false), 1, 'and so does the charged cut');
    assert.equal(across(true, true), 0, 'across the stone the pounce does not');
    assert.equal(across(true, false), 0, 'nor the charged cut');
});

test('a whole fight: every monster down is a win; a fallen player is a loss and the monsters go home', () => {
    // Win: cut every monster down with A combos, standing at each in turn.
    const sim = W.create({ map: gameConfig.maps.field }), p = sim.player;
    for (const m of sim.monsters) { m.atk = 0; m.wait = 999; }
    for (let guard = 0; guard < 400 && !sim.result; guard++) {
        const m = sim.monsters.find(monsterKit.living);
        put(p, m.x - 50, m.y, 0); p.push = null;
        tap(sim); step(sim, 0.3);
    }
    assert.deepEqual(plain(sim.result && sim.result.outcome), 'win');
    assert.equal(sim.stats.kills, 4);
    assert.ok(sim.monsters.every(m => m.phase === 'dead' && m.hp === 0));
    const ev = W.drain(sim);
    assert.equal(ev.filter(e => e.type === 'defeated').length, 4);
    assert.equal(ev.filter(e => e.type === 'result' && e.outcome === 'win').length, 1);
    // The fallen block nothing and take no more hits.
    assert.deepEqual(plain(fighterFoes(sim)), []);
    // Loss: the player's HP runs out.
    const lose = field('goblin', 'wolf'), q = lose.player;
    q.hp = 5;
    for (const m of lose.monsters) { put(m, q.x + 45, q.y + (m.kind === 'wolf' ? 40 : -40), Math.PI); m.phase = 'chase'; m.wait = 0; }
    for (let i = 0; i < 400 && !lose.result; i++) W.step(lose, 0.01);
    assert.equal(lose.result?.outcome, 'lose');
    assert.ok(q.down && q.hp === 0);
    assert.equal(W.command(lose, { type: 'press', button: 'a' }), true);
    assert.equal(q.act, null, 'a fallen player does nothing');
    step(lose, 2);
    assert.ok(lose.monsters.every(m => ['return', 'patrol'].includes(m.phase)), 'the monsters lose interest');
    // Training never ends: the HP bar refills.
    const training = W.create();
    assert.equal(training.player.endless, true);
});
const fighterFoes = sim => g.fighterKit.foes(sim).map(f => f.id);

test('the same inputs give the same field fight, and it survives a JSON round trip (PVP snapshots)', () => {
    const script = { 0: ['move', 1, 0.2], 150: ['press', 'a'], 152: ['release', 'a'], 300: ['press', 'b'], 340: ['release', 'b'] };
    const play = () => {
        const sim = W.create({ map: gameConfig.maps.field });
        const m = sim.monsters[0]; put(sim.player, m.x - 230, m.y);
        for (let t = 0; t < 900; t++) {
            const s = script[t];
            if (s) W.command(sim, s[0] === 'move' ? { type: 'move', x: s[1], y: s[2] } : { type: s[0], button: s[1] });
            if (t === 200) W.command(sim, { type: 'move', x: 0, y: 0 });
            W.step(sim, 0.01);
        }
        return sim;
    };
    const strip = ({ terrain, rigs, events, ...rest }) => JSON.stringify(rest);
    const a = play();
    assert.equal(strip(a), strip(play()));
    assert.ok(a.monsters[0].phase !== 'patrol', 'the goblin joined in');
    const { terrain, rigs, ...state } = a, copy = { ...JSON.parse(JSON.stringify(state)), terrain, rigs };
    for (const s of [a, copy]) { tap(s); step(s, 3); }
    assert.equal(strip(copy), strip(a));
});
