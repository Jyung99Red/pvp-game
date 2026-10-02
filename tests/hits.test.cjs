// Bone hit tests (3d-migration-concept.md 4): only a weapon box in its
// swing hits, body boxes follow the model, weapon boxes grow by
// combat.weaponPad, and a fast swing is sampled finely enough to hit a thin
// target. Every move must land on a standard target at the standard
// distance, and keep the horizontal sweep it was designed with (4.3, 4.5).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const g = load();
const { rigKit: R, math3d: M, playerAnim, combatKit, space, gameConfig, playerModel, equipmentModels, dummyKit, worldSim: W } = g;
const MOVES = gameConfig.combo.moves, U = gameConfig.world.unitsPerBlock;
// Centre to centre, about a block and a half: the distance a fight is held at.
const STANDARD = 60;

const player = R.build(playerModel, { equipment: equipmentModels.forLoadout(gameConfig.gear.starter) });
const dummy = dummyKit.rig();
const still = { gait: 0, moveBlend: 0, runBlend: 0, guardBlend: 0, stun: 0 };
// The attacker at the origin facing +x (simulation facing 0), at swing progress u.
const swingAt = (move, u) => R.solve(player, playerAnim.pose(player, { ...still, act: { move, phase: 'swing', t: u * MOVES[move].swing, from: null } }), [0, 0, 0], space.yawOf(0));
// A target standing `dist` away at `angle` from the attacker's facing, facing back.
function target(kind, dist, angle = 0) {
    const x = Math.cos(angle) * dist, y = Math.sin(angle) * dist, yaw = space.yawOf(Math.atan2(-y, -x)), at = space.toBlocks(x, y, 0);
    if (kind === 'dummy') return combatKit.hurtboxes(dummy, R.solve(dummy, dummyKit.pose({ phase: 'idle', t: 0, move: 0, flinch: 0 }), at, yaw));
    if (kind === 'player') return combatKit.hurtboxes(player, R.solve(player, playerAnim.pose(player, still), at, yaw));
    // A thin post two blocks tall: measures where the blade goes, not how wide the target is.
    return [M.obb(M.compose(at[0], 1, at[2], 0, 0, 0), [0.05, 1, 0.05])];
}
// Swing in simulation-sized steps; true if the target is touched.
function lands(move, boxes, stepSeconds = 0.01) {
    const n = Math.ceil(MOVES[move].swing / stepSeconds);
    for (let i = 0; i < n; i++) if (combatKit.sweep(player, u => swingAt(move, u), i / n, (i + 1) / n, [{ id: 't', boxes }])) return true;
    return false;
}
const degrees = r => r * 180 / Math.PI;
// Where the blade tip points, horizontally, relative to facing: + is the attacker's left.
function tipAngles(move) {
    const blade = player.parts.findIndex(p => p.kind === 'weapon'), half = player.parts[blade].size[2] / 2, out = [];
    for (let k = 0; k <= 40; k++) {
        const s = R.solve(player, playerAnim.pose(player, { ...still, act: { move, phase: 'swing', t: k / 40 * MOVES[move].swing, from: null } }));
        const tip = M.transformPoint(s.parts[blade], [0, 0, half]);
        out.push({ angle: Math.atan2(tip[0], tip[2]), height: tip[1] });
    }
    // Unwrap so a sweep through the back is one continuous range.
    for (let k = 1; k < out.length; k++) out[k].angle = out[k - 1].angle + space.wrapAngle(out[k].angle - out[k - 1].angle);
    return out;
}

test('every move lands on a standard target at the standard distance, the dummy and a person alike', () => {
    for (const move of Object.keys(MOVES)) {
        for (const kind of ['dummy', 'player']) assert.ok(lands(move, target(kind, STANDARD)), `${move} misses a ${kind} at ${STANDARD}`);
        assert.ok(!lands(move, target('dummy', 140)), `${move} reaches far beyond its range`);
    }
});

test('horizontal cuts keep the sweep of their 2D sectors; the spin covers about 210 degrees', () => {
    // Blade tip sweep, degrees, against the arc each move had as a 2D sector.
    const designed = { slash: 94, backslash: 101, follow: 90, charged: 122, thrust: 25 };
    for (const [move, arc] of Object.entries(designed)) {
        const a = tipAngles(move).map(x => x.angle), sweep = degrees(Math.max(...a) - Math.min(...a));
        assert.ok(Math.abs(sweep - arc) <= 15, `${move} sweeps ${sweep.toFixed(0)} degrees, designed ${arc}`);
    }
    const spin = tipAngles('spin').map(x => x.angle), spinSweep = degrees(Math.max(...spin) - Math.min(...spin));
    assert.ok(spinSweep >= 200 && spinSweep <= 220, `the spin sweeps ${spinSweep.toFixed(0)} degrees`);
    // Slash and charged go right to left; backslash and follow left to right.
    for (const move of ['slash', 'charged']) { const a = tipAngles(move); assert.ok(a.at(-1).angle > a[0].angle, `${move} goes right to left`); }
    for (const move of ['backslash', 'follow']) { const a = tipAngles(move); assert.ok(a.at(-1).angle < a[0].angle, `${move} goes left to right`); }
});

test('the spin reaches both sides but leaves a gap behind', () => {
    const covered = [];
    for (let deg = -180; deg < 180; deg += 10) if (lands('spin', target('post', STANDARD, deg * Math.PI / 180))) covered.push(deg);
    assert.ok(covered.includes(-90) && covered.includes(90), 'both sides');
    const back = covered.filter(d => Math.abs(d) >= 135);
    assert.deepEqual(back, [], 'nothing within 45 degrees of straight behind');
    assert.ok(covered.length * 10 >= 200 && covered.length * 10 <= 250, `${covered.length * 10} degrees of posts at ${STANDARD}`);
});

test('the rising cut goes low-left to high-right, the cleave high-right to low-left', () => {
    const rising = tipAngles('rising'), cleave = tipAngles('cleave');
    assert.ok(rising[0].angle > 0 && rising[0].height < 0.6, 'rising starts low on the left');
    assert.ok(rising.at(-1).angle < 0 && rising.at(-1).height > 1.6, 'and ends high on the right');
    assert.ok(cleave[0].angle < 0 && cleave[0].height > 1.6, 'cleave starts high on the right');
    assert.ok(cleave.at(-1).angle > 0 && cleave.at(-1).height < 0.8, 'and ends low on the left');
});

test('only the swing hits: a blade resting on the target through the windup does not', () => {
    // In a real fight, find where to stand so that the slash's windup pose
    // already has the blade in the dummy as it stands there.
    const sim = W.create(), dm = sim.dummy, p = sim.player, pad = gameConfig.combat.weaponPad / U;
    dm.wait = 1e9; p.facing = 0;
    const dummyBoxes = combatKit.hurtboxes(sim.rigs.dummy, dummyKit.solve(sim));
    const windupEnd = (x, y) => combatKit.weaponBoxes(player, R.solve(player, playerAnim.pose(player, { ...still, act: { move: 'slash', phase: 'windup', t: MOVES.slash.windup, from: null } }), space.toBlocks(x, y, 0), space.yawOf(0)), pad);
    let spot = null;
    for (let dx = -80; dx <= 0 && !spot; dx += 4) for (let dy = -80; dy <= 80 && !spot; dy += 4) {
        const x = dm.x + dx, y = dm.y + dy;
        if (Math.hypot(dx, dy) > dm.radius + p.radius && windupEnd(x, y).some(w => dummyBoxes.some(b => M.overlap(w, b)))) spot = { x, y };
    }
    assert.ok(spot, 'some spot has the windup blade in the dummy');
    p.x = spot.x; p.y = spot.y;
    W.command(sim, { type: 'press', button: 'a' });
    for (let i = 0; i < Math.round(MOVES.slash.windup / 0.01); i++) W.step(sim, 0.01);
    assert.equal(sim.stats.hits, 0, 'nothing during the windup, though the blade is in the dummy');
    assert.equal(sim.player.act.phase, 'swing');
    W.step(sim, 0.01);
    assert.equal(sim.stats.hits, 1, 'and the first swing step lands');
});

test('weapon boxes grow by weaponPad for hits; body boxes are exactly what is drawn', () => {
    const s = swingAt('slash', 0.5), pad = gameConfig.combat.weaponPad / U;
    const drawn = R.boxes(player, s, ['weapon'])[0].box, grown = combatKit.weaponBoxes(player, s, pad)[0];
    drawn.h.forEach((h, i) => assert.ok(Math.abs(grown.h[i] - h - pad) < 1e-12));
    assert.ok(Math.abs(pad - 0.2) < 1e-9, 'about 0.2 blocks (3d-migration-concept.md 4.6)');
    const body = combatKit.hurtboxes(player, s);
    const parts = player.parts.filter(p => p.kind === 'body');
    body.forEach((b, i) => b.h.forEach((h, k) => assert.ok(Math.abs(h - parts[i].size[k] / 2) < 1e-12)));
});

test('a fast swing sampled in one coarse step still cannot pass a thin post', () => {
    // The spin's whole swing in a single call, against a post at the side.
    const post = target('post', STANDARD, Math.PI / 2);
    assert.ok(combatKit.sweep(player, u => swingAt('spin', u), 0, 1, [{ id: 't', boxes: post }]), 'sub-steps catch it');
});

test('the dummy reaches the player at the standard distance, and only in front', () => {
    const D = gameConfig.dummy;
    const hitsPlayer = (i, dist, angle) => {
        const mv = D.moves[i], boxes = target('player', dist, angle);
        const at = u => R.solve(dummy, dummyKit.pose({ phase: 'swing', t: u * mv.swing, move: i, flinch: 0 }), [0, 0, 0], space.yawOf(0));
        return !!combatKit.sweep(dummy, at, 0, 1, [{ id: 'p', boxes }]);
    };
    D.moves.forEach((mv, i) => {
        assert.ok(hitsPlayer(i, STANDARD, 0), `${mv.id} reaches a player in front`);
        assert.ok(!hitsPlayer(i, STANDARD, Math.PI), `${mv.id} does not reach behind`);
    });
});
