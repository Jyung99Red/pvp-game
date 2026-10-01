const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { worldSim: W, simLoop, terrainKit, space, gameConfig } = load();
const plain = value => JSON.parse(JSON.stringify(value));
const SPEED = gameConfig.player.speed, U = gameConfig.world.unitsPerBlock;

function running() {
    const sim = W.create();
    const loop = simLoop.create(dt => W.step(sim, dt));
    return { sim, loop, p: sim.player };
}

test('a new world puts the player on the spawn block, on the ground, nothing held', () => {
    const { sim, p } = running(), t = sim.terrain;
    assert.deepEqual(plain({ x: p.x, y: p.y }), plain(terrainKit.cellCentre(t, t.spawn.col, t.spawn.row)));
    assert.equal(p.h, 0);
    assert.ok(Object.values(sim.input.buttons).every(b => !b.held && b.presses === 0));
    assert.deepEqual(plain(Object.keys(sim.input.buttons)), ['a', 'b', 'offhand', 'interact']);
});

test('the fixed-step clock: whole steps, carried remainders, long frames capped', () => {
    let steps = 0;
    const loop = simLoop.create(() => steps++);
    assert.equal(loop.advance(0.016), 1);
    assert.equal(loop.advance(0.016), 2, "0.006 s carried over plus 0.016 s");
    steps = 0; loop.reset();
    assert.equal(loop.advance(5), Math.round(simLoop.MAX_FRAME / simLoop.STEP), 'a 5 s stall runs only 0.1 s');
    assert.equal(loop.run(1), 100);
    assert.equal(simLoop.STEP, 0.01);
});

test('full stick walks at player.speed; a half-pushed stick at half speed', () => {
    const { sim, loop, p } = running(), x0 = p.x;
    W.command(sim, { type: 'move', x: 1, y: 0 });
    loop.run(1);
    assert.ok(Math.abs(p.x - x0 - SPEED) < 1e-6, `moved ${p.x - x0}`);
    assert.ok(Math.abs(p.walk - SPEED) < 1e-6);
    const y0 = p.y;
    W.command(sim, { type: 'move', x: 0, y: -0.5 });
    loop.run(0.5);
    assert.ok(Math.abs(y0 - p.y - SPEED * 0.25) < 1e-6);
    assert.equal(p.h, 0, 'height comes from the ground query, flat for now');
});

test('the body turns towards the stick at turnRate', () => {
    const { sim, loop, p } = running();
    p.facing = 0;
    W.command(sim, { type: 'move', x: -1, y: 0.0001 }); // straight behind
    loop.run(0.1);
    assert.ok(Math.abs(Math.abs(p.facing) - gameConfig.player.turnRate * 0.1) < 1e-6);
    loop.run(0.4);
    assert.ok(Math.abs(Math.abs(space.wrapAngle(p.facing)) - Math.PI) < 1e-3, 'faces the stick within about 0.4 s');
});

test('commands are validated; a long vector is clipped to full speed', () => {
    const { sim } = running();
    for (const bad of [null, 5, { type: 'move', x: NaN, y: 0 }, { type: 'jump' }, { type: 'press', button: 'skill' }]) assert.equal(W.command(sim, bad), false);
    assert.equal(W.command(sim, { type: 'move', x: 30, y: 40 }), true);
    assert.deepEqual(plain(sim.input.move), { x: 0.6, y: 0.8 });
    assert.equal(W.command(sim, { type: 'release', button: 'a' }), false, 'nothing to release');
    assert.equal(W.command(sim, { type: 'press', button: 'a' }), true);
    assert.equal(W.command(sim, { type: 'press', button: 'a' }), false, 'already held');
    assert.equal(W.command(sim, { type: 'release', button: 'a' }), true);
    assert.equal(sim.input.buttons.a.presses, 1);
});

test('two thumbs: walking while A is held, then the offhand while walking', () => {
    const { sim, loop, p } = running(), x0 = p.x;
    W.command(sim, { type: 'move', x: 1, y: 0 });
    W.command(sim, { type: 'press', button: 'a' });
    loop.run(0.5);
    assert.ok(sim.input.buttons.a.held && p.x - x0 > SPEED * 0.49);
    W.command(sim, { type: 'release', button: 'a' });
    W.command(sim, { type: 'press', button: 'offhand' });
    W.command(sim, { type: 'press', button: 'interact' });
    loop.run(0.5);
    assert.ok(sim.input.buttons.offhand.held && sim.input.buttons.interact.held && !sim.input.buttons.a.held);
    assert.ok(p.x - x0 > SPEED * 0.99);
});

test('walls stop the body and it slides along them', () => {
    const { sim, loop, p } = running(), t = sim.terrain, r = p.radius;
    W.command(sim, { type: 'move', x: 0, y: -1 }); // north, into the north wall
    loop.run(10);
    const northWallBottom = 4 * U; // row 3 is wall
    assert.ok(Math.abs(p.y - (northWallBottom + r)) < 1e-6, `stopped at ${p.y}`);
    assert.ok(p.speed < 1e-6 && p.moveBlend === 0, 'pressing into a wall is standing still');
    // Pushing diagonally into the wall still walks along it.
    const x0 = p.x;
    W.command(sim, { type: 'move', x: 0.7071, y: -0.7071 });
    loop.run(0.5);
    assert.ok(p.x - x0 > SPEED * 0.5 * 0.7, `slid ${p.x - x0}`);
    assert.ok(!terrainKit.blocked(t, p.x, p.y, r));
});

test('a block corner is walked round, not snagged on', () => {
    // A lone 1x1 stone at cell (2, 2) in an open field, approached due south
    // with the body's centre just beside the stone's west face: the body
    // must slide round the corner and keep going (keyboard walking is
    // always exactly along an axis).
    const t = terrainKit.fromRows(['.......', '.......', '..1....', '.......', '...@...', '.......', '.......']);
    for (const offset of [2, 6, 11]) {
        const body = { x: 2 * U - offset, y: 0.5 * U, radius: 12 };
        for (let i = 0; i < 200; i++) terrainKit.moveCircle(t, body, 0, 1.15);
        assert.ok(body.y > 4 * U, `offset ${offset}: stuck at y = ${body.y.toFixed(1)}`);
        assert.ok(!terrainKit.blocked(t, body.x, body.y, body.radius));
    }
    // Head-on into the middle of a face still stops dead.
    const body = { x: 2.5 * U, y: 0.5 * U, radius: 12 };
    for (let i = 0; i < 200; i++) terrainKit.moveCircle(t, body, 0, 1.15);
    assert.ok(Math.abs(body.y - (2 * U - 12)) < 1e-6 && Math.abs(body.x - 2.5 * U) < 1e-9);
});

test('walk blend eases in and out over animation.blendSeconds', () => {
    const { sim, loop, p } = running(), b = gameConfig.animation.blendSeconds;
    W.command(sim, { type: 'move', x: 1, y: 0 });
    loop.run(b / 2);
    assert.ok(p.moveBlend > 0.3 && p.moveBlend < 0.7);
    loop.run(b);
    assert.equal(p.moveBlend, 1);
    W.command(sim, { type: 'move', x: 0, y: 0 });
    loop.run(b + 0.01);
    assert.equal(p.moveBlend, 0);
    assert.equal(p.speed, 0);
});

test('the same commands give the same world', () => {
    const script = [[0, { type: 'move', x: 0.3, y: -1 }], [37, { type: 'press', button: 'b' }], [80, { type: 'move', x: -1, y: 0.2 }], [140, { type: 'release', button: 'b' }]];
    const play = () => {
        const sim = W.create();
        for (let tick = 0; tick < 300; tick++) {
            for (const [at, cmd] of script) if (at === tick) W.command(sim, cmd);
            W.step(sim, simLoop.STEP);
        }
        const { terrain, ...rest } = sim;
        return JSON.stringify(rest);
    };
    assert.equal(play(), play());
});

test('the clearing map is well formed and closed', () => {
    const rows = gameConfig.maps.clearing.rows, t = terrainKit.fromRows(rows);
    assert.equal(rows.filter(r => r.includes('@')).length, 1);
    assert.ok(!terrainKit.solidAt(t, t.spawn.col, t.spawn.row));
    // Flood fill from the spawn never reaches the map edge.
    const seen = new Set([`${t.spawn.col},${t.spawn.row}`]), todo = [[t.spawn.col, t.spawn.row]];
    while (todo.length) {
        const [c, r] = todo.pop();
        assert.ok(c > 0 && r > 0 && c < t.width - 1 && r < t.height - 1, `open path to the edge at ${c},${r}`);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = `${c + dc},${r + dr}`;
            if (!seen.has(key) && !terrainKit.solidAt(t, c + dc, r + dr)) { seen.add(key); todo.push([c + dc, r + dr]); }
        }
    }
    assert.ok(seen.size > 150, `${seen.size} open blocks to walk on`);
    assert.throws(() => terrainKit.fromRows(['..', '.']));
    assert.throws(() => terrainKit.fromRows(['..x@']));
    assert.throws(() => terrainKit.fromRows(['...']));
});
