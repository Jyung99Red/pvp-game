// The world (design.md 6): terrain in chunks that can change at run
// time, the regions and how their portals join up, entities, the interact
// key, chests, loot on the ground, bosses that stay down, and the save.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { worldSim: W, terrainKit: T, propKit, interactKit, saveKit, monsterKit, gameConfig } = load();
const U = gameConfig.world.unitsPerBlock, MAPS = gameConfig.maps, MON = gameConfig.monsters;
const plain = value => JSON.parse(JSON.stringify(value));
const step = (sim, seconds) => { for (let i = 0; i < Math.round(seconds / 0.01); i++) W.step(sim, 0.01); };
const press = (sim, b) => W.command(sim, { type: 'press', button: b });
const release = (sim, b) => W.command(sim, { type: 'release', button: b });
const tap = (sim, b = 'attack') => { press(sim, b); release(sim, b); };
const events = (sim, type) => W.drain(sim).filter(e => e.type === type);
const put = (body, x, y, facing) => { body.x = x; body.y = y; if (facing !== undefined) body.facing = facing; };
const REGIONS = Object.keys(MAPS).filter(id => !MAPS[id].duel);
// Stand `d` world units in front of entity `e` along `angle`, facing it.
function before(p, e, angle, d = 36) { put(p, e.x + Math.cos(angle) * d, e.y + Math.sin(angle) * d, angle + Math.PI); }

// ---- terrain ----
test('terrain is kept in 16 x 16 chunks and reads back what the rows say', () => {
    for (const id of Object.keys(MAPS)) {
        const map = MAPS[id], t = T.fromRows(map.rows);
        assert.equal(t.cw, Math.ceil(t.width / 16));
        assert.equal(t.chunks.length, t.cw * Math.ceil(t.height / 16));
        map.rows.forEach((row, r) => [...row].forEach((ch, c) => {
            const [kind, level] = T.cellOf(ch);
            assert.ok(T.kindAt(t, c, r) === kind && T.levelAt(t, c, r) === level, `${id} ${c},${r}`);
        }));
        assert.ok(T.solidAt(t, -1, 0) && T.solidAt(t, t.width, 0), 'outside the map is wall');
    }
    // Buildings, portals and their pillars are solid, three blocks high.
    for (const [ch, kind] of [['H', 'wood'], ['#', 'portal'], ['P', 'gate']]) {
        const [k, level] = T.cellOf(ch);
        assert.ok(T.isSolid(k) && level === 3 && T.NAMES[k] === kind, ch);
    }
});

test('a change to a block redraws only the chunks it can touch and is kept as an edit', () => {
    const t = T.fromRows(MAPS.field.rows), revs = () => t.chunks.map(k => k.rev);
    const changed = (a, b) => plain(a.flatMap((v, i) => v !== b[i] ? [i] : []));
    let was = revs();
    assert.equal(T.set(t, 20, 20, 'stone', 2), true);
    assert.deepEqual(changed(was, revs()), [T.chunkIndex(t, 20, 20)], 'well inside one chunk: that chunk only');
    was = revs();
    assert.equal(T.set(t, 15, 15, 'tree', 4), true);
    assert.deepEqual(changed(was, revs()).sort((a, b) => a - b), [0, 1, t.cw, t.cw + 1], 'at a chunk corner: the four around it');
    assert.equal(T.levelAt(t, 20, 20), 2);
    assert.deepEqual(plain(T.edits(t)), [[20, 20, 'stone', 2], [15, 15, 'tree', 4]]);
    // Back as the map had it: no edit left.
    const [k0, l0] = T.cellOf(MAPS.field.rows[20][20]);
    T.set(t, 20, 20, k0, l0);
    assert.deepEqual(plain(T.edits(t)), [[15, 15, 'tree', 4]]);
    // Nonsense is turned away.
    for (const args of [[-1, 0, 'stone', 1], [5, 5, 'grass', 2], [5, 5, 'stone', 0], [5, 5, 'lava', 1], [5, 5, 'stone', 16], [5, 5, 'stone', 1.5]]) {
        assert.equal(T.set(t, ...args), false, JSON.stringify(args));
    }
    assert.equal(T.set(t, 15, 15, 'tree', 4), false, 'no change, no new revision');
    // Collision reads the change: a wall put down stops a body.
    const open = T.fromRows(MAPS.field.rows);
    assert.equal(T.blocked(open, 20.5 * U, 20.5 * U, 12), false);
    T.set(open, 20, 20, 'stone', 1);
    assert.equal(T.blocked(open, 20.5 * U, 20.5 * U, 12), true);
    // Edits carry over to a fresh copy of the map.
    const copy = T.fromRows(MAPS.field.rows);
    assert.equal(T.applyEdits(copy, T.edits(t)), 1);
    assert.equal(T.kindAt(copy, 15, 15), T.KIND.tree);
});

// ---- ponds (design.md 6.1; user, 2026-10-04) ----
test('a pond stops bodies and nothing else: it is seen across, a blow lands across it, and the way goes round', () => {
    // Three blocks of water across the middle of a walled room.
    const t = T.fromRows(['1111111', '1.....1', '1.@...1', '1.~~~.1', '1.....1', '1.....1', '1111111']);
    assert.deepEqual([T.NAMES[T.kindAt(t, 3, 3)], T.levelAt(t, 3, 3)], ['water', 0]);
    assert.ok(!T.isSolid(T.KIND.water) && !T.isOpen(T.KIND.water) && T.isOpen(T.KIND.grass) && !T.isOpen(T.KIND.stone));
    assert.ok(!T.solidAt(t, 3, 3) && T.closedAt(t, 3, 3) && !T.closedAt(t, 3, 2) && T.closedAt(t, 0, 0) && T.closedAt(t, -1, 3));
    // A body walking south at it is stopped at the bank, like at a wall.
    const body = { x: 3.5 * U, y: 2.5 * U, radius: 12 };
    for (let i = 0; i < 200; i++) T.moveCircle(t, body, 0, 1);
    assert.ok(Math.abs(body.y - (3 * U - 12)) < 1e-6 && T.blocked(t, 3.5 * U, 3.5 * U, 12), `stopped at ${body.y}`);
    // Sight and blows go straight across; a body's way does not.
    const north = [3.5 * U, 2.5 * U], south = [3.5 * U, 4.5 * U];
    assert.ok(T.sightClear(t, ...north, ...south) && T.lineClear(t, ...north, ...south));
    assert.equal(T.openWay(t, ...north, ...south, 12), false);
    const went = walk(t, [3, 2], [3, 4], 12);
    assert.ok(went.left <= 3 && went.steps > 2 * U, `round the pond in ${went.steps} steps, ${went.left.toFixed(0)} short`);
    // It is ground as far as a change goes (no height), and no floor for a map's markers.
    assert.equal(T.set(t, 3, 2, 'water', 0), true);
    assert.equal(T.set(t, 3, 2, 'water', 1), false);
    assert.throws(() => T.fromRows(['@~'], U, '~'), /floor must be ground/);
});

test('a hedge is a low block of leaves: it stops a body and a blow, and is seen over; with trees it closes a map as a wall does', () => {
    const t = T.fromRows(['*T*T*', '*...*', 'T.@.*', '*.*.T', '*****']);
    assert.deepEqual([T.NAMES[T.kindAt(t, 2, 3)], T.levelAt(t, 2, 3), T.isSolid(T.KIND.hedge)], ['hedge', 1, true]);
    // The one in the middle of the south side: a body walking at it stops, a blow across it does not land, eyes pass over.
    const body = { x: 2.5 * U, y: 2.5 * U, radius: 12 };
    for (let i = 0; i < 100; i++) T.moveCircle(t, body, 0, 1);
    assert.ok(Math.abs(body.y - (3 * U - 12)) < 1e-6, `stopped at ${body.y}`);
    assert.equal(T.lineClear(t, 1.5 * U, 3.5 * U, 3.5 * U, 3.5 * U), false);
    assert.equal(T.sightClear(t, 1.5 * U, 3.5 * U, 3.5 * U, 3.5 * U), true);
    // A tree in the ring does hide.
    assert.equal(T.sightClear(t, 2.5 * U, 2.5 * U, 0.5 * U, 2.5 * U), false);
    // The ring is shut: nothing inside it is next to the open edge of the map.
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) if (!T.closedAt(t, c, r)) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.ok(T.inside(t, c + dc, r + dr));
    for (let c = 0; c < 5; c++) assert.ok(T.closedAt(t, c, 0) && T.closedAt(t, c, 4) && T.closedAt(t, 0, c) && T.closedAt(t, 4, c));
});

test('the edges of a map need not be walls: the drop beyond a cliff stops bodies only, a fence stops bodies and blows and is seen over', () => {
    // A yard with a fence on the south and a cliff on the east.
    const t = T.fromRows(['33333__', '3...___', '3.@..__', '3...___', '3+++___']);
    assert.deepEqual([[4, 2], [1, 4]].map(([c, r]) => [T.NAMES[T.kindAt(t, c, r)], T.levelAt(t, c, r)]), [['grass', 0], ['fence', 1]]);
    assert.deepEqual([T.NAMES[T.kindAt(t, 5, 2)], T.levelAt(t, 5, 2), T.isSolid(T.KIND.drop), T.isOpen(T.KIND.drop), T.isSolid(T.KIND.fence)], ['drop', 0, false, false, true]);
    // Walking east off the cliff: stopped at its edge. Sight and a blow pass over the drop.
    const east = { x: 2.5 * U, y: 2.5 * U, radius: 12 };
    for (let i = 0; i < 200; i++) T.moveCircle(t, east, 1, 0);
    assert.ok(Math.abs(east.x - (5 * U - 12)) < 1e-6, `stopped at ${east.x}`);
    assert.ok(T.closedAt(t, 5, 2) && !T.solidAt(t, 5, 2) && T.sightClear(t, 2.5 * U, 2.5 * U, 6.5 * U, 2.5 * U) && T.lineClear(t, 2.5 * U, 2.5 * U, 6.5 * U, 2.5 * U));
    // Walking south at the fence: stopped; a blow across it does not land; eyes pass over.
    const south = { x: 2.5 * U, y: 2.5 * U, radius: 12 };
    for (let i = 0; i < 200; i++) T.moveCircle(t, south, 0, 1);
    assert.ok(Math.abs(south.y - (4 * U - 12)) < 1e-6, `stopped at ${south.y}`);
    assert.equal(T.lineClear(t, 2.5 * U, 3.5 * U, 2.5 * U, 4.9 * U), false);
    assert.equal(T.sightClear(t, 2.5 * U, 3.5 * U, 2.5 * U, 4.9 * U), true);
    // Neither is ground for a map's markers.
    assert.throws(() => T.fromRows(['@_'], U, '_'), /floor must be ground/);
});

// ---- a way round walls ----
// A room cut in two by a wall down column 6, with a gap one block wide at
// the north end and one `south` blocks wide at the south end.
function halves(south = 1) {
    return T.fromRows(Array.from({ length: 11 }, (_, r) => r === 0 || r === 10 ? '1'.repeat(13)
        : `1${r === 5 ? '..@..' : '.....'}${r >= 2 && r <= 9 - south ? '3' : '.'}.....1`));
}
// Walk a circle from cell centre to cell centre the way a monster does:
// a step at a time towards wherever wayTo points. Seconds of steps taken,
// and how far it ended from where it was going.
function walk(t, from, to, radius, most = 2000) {
    const body = { x: (from[0] + 0.5) * U, y: (from[1] + 0.5) * U, radius }, tx = (to[0] + 0.5) * U, ty = (to[1] + 0.5) * U, way = {};
    let steps = 0, north = Infinity, south = -Infinity;
    for (; steps < most && Math.hypot(tx - body.x, ty - body.y) > 3; steps++) {
        T.wayTo(t, body.x, body.y, tx, ty, radius, 0, way);
        const d = Math.hypot(way.x - body.x, way.y - body.y);
        T.moveCircle(t, body, (way.x - body.x) / d * Math.min(d, 1), (way.y - body.y) / d * Math.min(d, 1));
        north = Math.min(north, body.y); south = Math.max(south, body.y);
    }
    return { steps, left: Math.hypot(tx - body.x, ty - body.y), north, south };
}
test('a body finds its way round a wall, by the nearer gap it fits through; in the open it walks straight', () => {
    const t = halves(), way = {};
    // Nothing in the way: straight there.
    assert.equal(T.openWay(t, 2.5 * U, 5.5 * U, 4.5 * U, 2.5 * U, 12), true);
    assert.deepEqual(plain(T.wayTo(t, 2.5 * U, 5.5 * U, 4.5 * U, 2.5 * U, 12, 0, way)), { x: 4.5 * U, y: 2.5 * U, direct: true });
    // Across the wall: not straight, and the next point is somewhere it can walk to.
    assert.equal(T.openWay(t, 3.5 * U, 5.5 * U, 9.5 * U, 5.5 * U, 12), false);
    T.wayTo(t, 3.5 * U, 5.5 * U, 9.5 * U, 5.5 * U, 12, 0, way);
    assert.ok(!way.direct && (way.x !== 9.5 * U || way.y !== 5.5 * U) && T.openWay(t, 3.5 * U, 5.5 * U, way.x, way.y, 12));
    // A walker gets there through a gap, not by pressing on the wall; from nearer the south end it takes the south gap.
    for (const radius of [12, 16, 18]) {
        const went = walk(t, [3, 5], [9, 5], radius);
        assert.ok(went.left <= 3, `radius ${radius} stopped ${went.left.toFixed(0)} short`);
        assert.ok(went.steps < 700, `radius ${radius} took ${went.steps} steps for a way of about 440`);
    }
    assert.ok(walk(t, [3, 7], [9, 7], 12).south > 9 * U, 'the south gap from nearer the south');
    assert.ok(walk(t, [3, 3], [9, 3], 12).north < 2 * U, 'the north gap from nearer the north');
    // A body wider than a block fits neither gap: no route, so it is sent straight at the wall as before.
    T.wayTo(t, 3.5 * U, 5.5 * U, 9.5 * U, 5.5 * U, 22, 0, way);
    assert.deepEqual(plain(way), { x: 9.5 * U, y: 5.5 * U, direct: false });
    assert.ok(walk(t, [3, 5], [9, 5], 22, 600).left > 3 * U);
    // A gap two blocks wide lets it through, down the middle.
    const wide = walk(halves(2), [3, 5], [9, 5], 22);
    assert.ok(wide.left <= 3 && wide.south > 8 * U, `the wide body stopped ${wide.left.toFixed(0)} short`);
});

test('`short` of a body it walks up to counts as there; the way follows the terrain as it changes', () => {
    const t = halves();
    // The middle of the wall block is never reached, but a block short of it is open ground.
    assert.equal(T.openWay(t, 3.5 * U, 5.5 * U, 6.5 * U, 5.5 * U, 12), false);
    assert.equal(T.openWay(t, 3.5 * U, 5.5 * U, 6.5 * U, 5.5 * U, 12, U), true);
    assert.equal(T.openWay(t, 3.5 * U, 5.5 * U, 6.5 * U, 5.5 * U, 12, U - 10), false);
    // A block knocked out of the wall opens the straight way; put back, it is shut again.
    assert.equal(T.wayTo(t, 3.5 * U, 5.5 * U, 9.5 * U, 5.5 * U, 12).direct, false);
    T.set(t, 6, 5, 'grass', 0);
    assert.equal(T.wayTo(t, 3.5 * U, 5.5 * U, 9.5 * U, 5.5 * U, 12).direct, true);
    T.set(t, 6, 5, 'stone', 3);
    assert.equal(T.wayTo(t, 3.5 * U, 5.5 * U, 9.5 * U, 5.5 * U, 12).direct, false);
    // Both gaps shut: no way round, and the walker is left where the wall stops it.
    T.set(t, 6, 1, 'stone', 3); T.set(t, 6, 9, 'stone', 3);
    assert.ok(walk(t, [3, 5], [9, 5], 12, 600).left > 3 * U);
    // Low stones stop a body like any wall.
    T.set(t, 6, 5, 'stone', 1);
    assert.equal(T.openWay(t, 3.5 * U, 5.5 * U, 9.5 * U, 5.5 * U, 12), false);
});

// ---- the regions ----
// Cells walkable from `from`; with `burn`, dry thickets count as open (a
// lit torch burns them away).
function reachable(t, from, burn = true) {
    const seen = new Set([`${from.col},${from.row}`]), todo = [[from.col, from.row]];
    const open_ = (c, r) => !T.closedAt(t, c, r) || (burn && T.inside(t, c, r) && T.kindAt(t, c, r) === T.KIND.brush);
    let open = true;
    while (todo.length) {
        const [c, r] = todo.pop();
        if (c <= 0 || r <= 0 || c >= t.width - 1 || r >= t.height - 1) open = false;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = `${c + dc},${r + dr}`;
            if (!seen.has(key) && open_(c + dc, r + dr)) { seen.add(key); todo.push([c + dc, r + dr]); }
        }
    }
    return { seen, closed: open, has: (x, y) => seen.has(`${Math.floor(x / U)},${Math.floor(y / U)}`) };
}
test('every region is closed, and its portals, doors, chests and monsters can all be reached', () => {
    for (const id of REGIONS) {
        const map = MAPS[id], sim = W.create({ region: id }), t = sim.terrain, area = reachable(t, t.spawn);
        assert.ok(area.closed, `${id}: an open way to the edge of the map`);
        for (const e of sim.entities) {
            if (e.type === 'building' || e.type === 'monster' || e.type === 'dummy') assert.ok(area.has(e.x, e.y), `${id}: ${e.id} out of reach`);
            if (e.type === 'portal' || e.type === 'chest') {
                const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => area.has(e.x + dx * U, e.y + dy * U));
                assert.ok(near, `${id}: ${e.id} cannot be walked up to`);
            }
        }
        for (const p of map.portals || []) {
            const at = propKit.arrival(map, t, p.to);
            assert.ok(area.has(at.x, at.y) && !T.blocked(t, at.x, at.y, gameConfig.player.radius), `${id}: arriving from ${p.to} is not on open ground`);
        }
    }
});

test('portals come in pairs, the base is safe, and arrivals are out of every monster\'s notice', () => {
    for (const id of REGIONS) {
        const map = MAPS[id];
        for (const p of map.portals || []) assert.ok((MAPS[p.to].portals || []).some(q => q.to === id), `${id} -> ${p.to} has no way back`);
        if (map.safe) assert.equal(T.fromRows(map.rows).monsters.length, 0, `${id} is safe`);
        const sim = W.create({ region: id }), t = sim.terrain;
        // Coming from a region that cannot be reached from the base while a
        // boss stands, that boss is down.
        const spots = [{ ...terrainKit_centre(t, t.spawn), down: [] }, ...(map.portals || []).map(p => ({ ...propKit.arrival(map, t, p.to), down: implied(p.to) }))];
        for (const m of sim.monsters) for (const at of spots) {
            if (at.down.includes(m.kind)) continue;
            const d = Math.hypot(m.x - at.x, m.y - at.y);
            assert.ok(d > MON[m.kind].alertRange + 100, `${id}: ${m.kind} at ${(m.x / U).toFixed(1)},${(m.y / U).toFixed(1)} would notice an arrival (${d.toFixed(0)})`);
        }
    }
    // Every region can be reached from the base; the valley (and the cave off it) waits on the goblin chief.
    const seen = new Set(['base']), todo = ['base'];
    while (todo.length) for (const p of MAPS[todo.pop()].portals || []) if (!seen.has(p.to)) { seen.add(p.to); todo.push(p.to); }
    assert.deepEqual([...seen].sort(), [...REGIONS].sort());
    assert.deepEqual([...reachedWithout('goblinChief')].sort(), ['base', 'clearing', 'field'], 'the valley and the cave beyond it wait on the goblin chief');
    // Each region but the base has a boss and its chest.
    assert.deepEqual(plain(T.fromRows(MAPS.field.rows).monsters.filter(m => MON[m.kind].boss).map(m => m.kind)), ['goblinChief']);
    assert.deepEqual(plain(T.fromRows(MAPS.valley.rows).monsters.filter(m => MON[m.kind].boss).map(m => m.kind)), ['wolfKing']);
});
const terrainKit_centre = (t, cell) => T.cellCentre(t, cell.col, cell.row);
// Regions reached from the base without going through a portal that waits on `boss`.
function reachedWithout(boss) {
    const seen = new Set(['base']), todo = ['base'];
    while (todo.length) for (const p of MAPS[todo.pop()].portals || []) if (p.requires !== boss && !seen.has(p.to)) { seen.add(p.to); todo.push(p.to); }
    return seen;
}
// The bosses that must be down for anyone to be in `region`.
const implied = region => Object.keys(MON).filter(k => MON[k].boss && !reachedWithout(k).has(region));

test('a map whose lists and letters disagree does not load', () => {
    const base = MAPS.base;
    const broken = [
        { ...base, buildings: base.buildings.slice(1) },
        { ...base, buildings: [{ ...base.buildings[0], at: [5, 5, 4, 3] }, ...base.buildings.slice(1)] },
        { ...base, portals: base.portals.slice(1) },
        { ...base, portals: [{ ...base.portals[0], to: 'nowhere' }, ...base.portals.slice(1)] },
        { ...base, portals: [{ ...base.portals[0], facing: 'east' }, ...base.portals.slice(1)] },
        { ...base, portals: [{ ...base.portals[0], requires: 'goblin' }, ...base.portals.slice(1)] },
        { ...MAPS.field, chests: [] }
    ];
    for (const map of broken) assert.throws(() => W.create({ map }), undefined, JSON.stringify(map.portals?.[0]));
});

test('arriving through a portal: in front of the portal back, facing in, with the HP carried', () => {
    const sim = W.create({ region: 'field', arrival: 'base', carry: { hp: 100 } }), p = sim.player;
    const portal = sim.entities.find(e => e.id === 'p-base');
    assert.ok(Math.abs(Math.hypot(p.x - portal.x, p.y - portal.y) - gameConfig.props.arriveDistance) < 1e-9);
    assert.ok(Math.abs(p.facing - -Math.PI / 2) < 1e-9 && p.y < portal.y, 'north of the south gate, facing north');
    assert.equal(p.hp, 100);
    const plainSpawn = W.create({ region: 'field', arrival: 'nowhere' }), t = plainSpawn.terrain;
    assert.deepEqual(plain([plainSpawn.player.x, plainSpawn.player.y]), plain(Object.values(T.cellCentre(t, t.spawn.col, t.spawn.row))));
});

// ---- the interact key ----
test('the interact key: the hot spring rests, a shop opens, a portal travels; the target is picked by distance and facing', () => {
    const sim = W.create({ region: 'base' }), p = sim.player;
    const spring = sim.entities.find(e => e.kind === 'hotSpring'), shop = sim.entities.find(e => e.kind === 'shop');
    assert.equal(p.focus, null);
    before(p, spring, Math.PI / 2, 30);
    step(sim, 0.02);
    assert.equal(p.focus, spring.id);
    assert.deepEqual(plain(interactKit.target(sim, p).offer), { verb: '泡温泉', name: '温泉', hold: 0, ready: true, why: '' });
    p.hp = 100;
    tap(sim, 'interact'); step(sim, 0.01);
    assert.equal(p.hp, p.maxHp);
    assert.equal(events(sim, 'rest').length, 1);
    before(p, shop, Math.PI / 2, 30); step(sim, 0.02);
    tap(sim, 'interact');
    assert.deepEqual(plain(events(sim, 'open').map(e => e.what)), ['shop']);
    // Out of reach (past `release`, as it was the target): nothing.
    before(p, shop, Math.PI / 2, gameConfig.interact.release + 10); step(sim, 0.02);
    assert.equal(p.focus, null);
    // Two in reach: the one ahead wins; turned round, the one now ahead.
    const a = { id: 'xa', type: 'building', kind: 'storage', name: 'A', x: 0, y: 0, h: 0, facing: 0, radius: 0, solid: false };
    const b = { ...a, id: 'xb', name: 'B' };
    put(p, 15 * U, 15.5 * U, 0); Object.assign(a, { x: p.x + 40, y: p.y }); Object.assign(b, { x: p.x - 40, y: p.y });
    sim.entities.push(a, b);
    step(sim, 0.01);
    assert.equal(p.focus, 'xa');
    p.facing = Math.PI; step(sim, 0.01);
    assert.equal(p.focus, 'xb');
    // The target holds on past its reach, up to `release`.
    a.x = p.x + 50; b.x = p.x + 300; p.facing = 0; step(sim, 0.01);
    assert.equal(p.focus, 'xa');
    a.x = p.x + gameConfig.interact.release - 4; step(sim, 0.01);
    assert.equal(p.focus, 'xa', 'still held');
    a.x = p.x + gameConfig.interact.release + 4; step(sim, 0.01);
    assert.equal(p.focus, null);
    // The gate to the field travels; the gate to the valley, further along the north wall, waits on the goblin chief.
    sim.entities.splice(-2);
    const north = sim.entities.find(e => e.id === 'p-field'), valley = sim.entities.find(e => e.id === 'p-valley');
    before(p, north, Math.PI / 2); step(sim, 0.02);
    assert.equal(p.focus, 'p-field');
    tap(sim, 'interact');
    assert.deepEqual(plain(events(sim, 'travel').map(e => [e.to, e.from])), [['field', 'base']]);
    before(p, valley, Math.PI / 2); step(sim, 0.02);
    const locked = interactKit.target(sim, p).offer;
    assert.ok(!locked.ready && /哥布林头目/.test(locked.why), JSON.stringify(locked));
    tap(sim, 'interact');
    assert.equal(events(sim, 'travel').length, 0);
    sim.progress.bosses.goblinChief = true;
    tap(sim, 'interact');
    assert.deepEqual(plain(events(sim, 'travel').map(e => e.to)), ['valley']);
});

test('interacting reaches the left hand out: a moment for a use at once, all through a hold (user, 2026-10-04)', () => {
    const H = gameConfig.interact.hand;
    const sim = W.create({ region: 'base' }), p = sim.player, spring = sim.entities.find(e => e.kind === 'hotSpring');
    before(p, spring, Math.PI / 2, 30); step(sim, 0.02);
    assert.deepEqual([p.handOut, p.handFor], [0, 0]);
    tap(sim, 'interact'); step(sim, H.out);
    assert.ok(p.handOut > 0.99, 'out');
    step(sim, H.stay);
    assert.ok(p.handOut < 1, 'coming back after a moment');
    step(sim, H.back + 0.02);
    assert.equal(p.handOut, 0, 'back');
    // Nothing to interact with: no reach.
    p.x += 400; step(sim, 0.05);
    tap(sim, 'interact'); step(sim, 0.05);
    assert.equal(p.handOut, 0);
    // A chest: out all the while the key is held.
    const field = W.create({ region: 'field' }), q = field.player, chest = field.entities.find(e => e.type === 'chest');
    field.monsters = []; field.progress.bosses.goblinChief = true;
    before(q, chest, Math.PI / 2, 34); step(field, 0.02);
    press(field, 'interact');
    for (let t = 0; t < gameConfig.interact.chestHold - 0.05; t += 0.1) { step(field, 0.1); if (t > H.out) assert.ok(q.handOut > 0.99, `out at ${t.toFixed(1)} s`); }
    step(field, 0.1);
    assert.equal(chest.open, true);
    release(field, 'interact'); step(field, H.stay + H.back + 0.05);
    assert.equal(q.handOut, 0);
});

test('interacting works with the shield up, and not at all in a fight', () => {
    const sim = W.create({ region: 'field' }), p = sim.player;
    const portal = sim.entities.find(e => e.id === 'p-base');
    before(p, portal, -Math.PI / 2);
    press(sim, 'guard'); step(sim, 0.3);
    assert.equal(p.guard.state, 'up');
    tap(sim, 'interact');
    assert.equal(events(sim, 'travel').length, 1, 'shield and interact together');
    release(sim, 'guard');
    const m = sim.monsters.find(x => x.kind === 'goblin');
    put(m, p.x + 100, p.y - 60); m.phase = 'chase'; m.wait = 99;
    step(sim, 0.02);
    const offer = interactKit.target(sim, p).offer;
    assert.ok(!offer.ready && offer.why === '战斗中');
    tap(sim, 'interact');
    assert.equal(events(sim, 'travel').length, 0);
});

test('a chest: guarded until its boss is down, then opened by holding the key; letting go early starts over', () => {
    const sim = W.create({ region: 'field' }), p = sim.player, H = gameConfig.interact.chestHold;
    sim.monsters = [];
    const chest = sim.entities.find(e => e.type === 'chest');
    before(p, chest, Math.PI / 2, 34); step(sim, 0.02);
    assert.equal(p.focus, chest.id);
    assert.equal(interactKit.target(sim, p).offer.ready, false);
    press(sim, 'interact'); step(sim, H + 0.1); release(sim, 'interact');
    assert.equal(chest.open, false);
    sim.progress.bosses.goblinChief = true;
    press(sim, 'interact'); step(sim, H / 2);
    assert.ok(Math.abs(interactKit.target(sim, p).progress - 0.5) < 0.05);
    release(sim, 'interact'); step(sim, 0.01);
    assert.equal(p.using, null);
    assert.equal(chest.open, false, 'let go too soon');
    press(sim, 'interact'); step(sim, H + 0.02);
    assert.equal(chest.open, true);
    assert.equal(sim.progress.chests[`field/${chest.id}`], true);
    const ev = W.drain(sim);
    assert.equal(ev.filter(e => e.type === 'chest_open').length, 1);
    assert.ok(sim.entities.some(e => e.type === 'drop'), 'loot came out');
    // An open chest offers nothing more; the loot is picked up by walking by.
    release(sim, 'interact'); step(sim, 0.02);
    assert.notEqual(p.focus, chest.id);
    step(sim, 2);
    assert.ok(sim.progress.inventory.gold >= gameConfig.loot.chiefChest[0].amount[0], `gold ${sim.progress.inventory.gold}`);
    // The save keeps it open.
    const again = W.create({ region: 'field', progress: saveKit.merge(saveKit.fresh(), sim) });
    assert.equal(again.entities.find(e => e.type === 'chest').open, true);
});

// ---- loot and bosses ----
test('a monster down drops its loot; it pops out, settles, and flies to whoever comes near', () => {
    const kill = seed => {
        const sim = W.create({ region: 'field', seed }), p = sim.player, m = sim.monsters.find(x => x.kind === 'goblin');
        sim.monsters = [m];
        m.hp = 1; m.phase = 'patrol'; m.rest = 99;
        put(p, m.x - 50, m.y, 0);
        tap(sim); step(sim, 0.3);
        return { sim, p, m };
    };
    const { sim, p, m } = kill(7);
    assert.equal(m.phase, 'dead');
    const drops = sim.entities.filter(e => e.type === 'drop');
    assert.ok(drops.some(d => d.item === 'gold'), 'gold always');
    assert.ok(drops.every(d => d.item === 'gold' || d.item === 'goblin_ear'));
    // The same seed drops the same.
    assert.deepEqual(plain(kill(7).sim.entities.filter(e => e.type === 'drop').map(d => [d.item, d.amount])), plain(drops.map(d => [d.item, d.amount])));
    // Walk away first: nothing comes along.
    put(p, m.x - 300, m.y);
    step(sim, 1.5);
    assert.ok(sim.entities.filter(e => e.type === 'drop').every(d => d.h === 0 && d.pull === null), 'lying still');
    assert.ok(drops.every(d => Math.hypot(d.x - m.x, d.y - m.y) > 4), 'popped out of the body');
    assert.equal(sim.progress.inventory.gold, 0);
    put(p, m.x - 20, m.y);
    step(sim, 1);
    assert.equal(sim.entities.filter(e => e.type === 'drop').length, 0);
    const want = { gold: 0, items: {} };
    for (const d of drops) if (d.item === 'gold') want.gold += d.amount; else want.items[d.item] = (want.items[d.item] || 0) + d.amount;
    assert.deepEqual(plain(sim.progress.inventory), want);
    assert.equal(events(sim, 'pickup').length, drops.length);
});

test('the goblin chief: a bigger goblin; down, it stays down, and the gate and chest it kept open', () => {
    const sim = W.create({ region: 'field' }), p = sim.player, boss = sim.monsters.find(m => m.boss);
    assert.equal(boss.kind, 'goblinChief');
    assert.ok(monsterKit.height('goblinChief') > monsterKit.height('goblin') * 1.35, 'scaled up');
    assert.ok(boss.maxHp > MON.goblin.maxHp * 3);
    sim.monsters = [boss];
    boss.hp = 1; boss.rest = 99;
    put(p, boss.x - 60, boss.y, 0);
    tap(sim); step(sim, 0.3);
    assert.equal(boss.phase, 'dead');
    const ev = W.drain(sim);
    assert.deepEqual(plain(ev.filter(e => e.type === 'boss_defeated').map(e => [e.kind, e.name])), [['goblinChief', '哥布林头目']]);
    assert.equal(sim.progress.bosses.goblinChief, true);
    assert.ok(sim.entities.some(e => e.type === 'drop' && e.item === 'chief_tusk'));
    const gate = sim.entities.find(e => e.id === 'p-valley');
    before(p, gate, Math.PI / 2); step(sim, 0.02);
    assert.equal(interactKit.target(sim, p).offer.ready, true);
    const save = saveKit.merge(saveKit.fresh(), sim);
    const again = W.create({ region: 'field', progress: save });
    assert.equal(again.monsters.some(m => m.boss), false, 'it does not come back');
    assert.equal(again.monsters.length, sim.terrain.monsters.length - 1);
    const base = W.create({ region: 'base', progress: save }), valley = base.entities.find(e => e.id === 'p-valley');
    before(base.player, valley, Math.PI / 2); step(base, 0.02);
    assert.equal(interactKit.target(base, base.player).offer.ready, true, 'the village\'s own gate to the valley opens too');
});

test('a monster that gives up the chase and gets home is whole again', () => {
    const sim = W.create({ region: 'field' }), m = sim.monsters.find(x => x.kind === 'wolf');
    sim.monsters = [m];
    put(sim.player, 2 * U, 2 * U);
    m.hp = 10; m.enraged = true; m.phase = 'return'; m.x = m.home.x + 30;
    step(sim, 2);
    assert.equal(m.phase, 'patrol');
    assert.ok(m.hp === m.maxHp && !m.enraged);
});

// ---- the save ----
function storage() {
    const data = new Map();
    return { data, getItem: k => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
}
test('the save: fresh, written and read back with progress, gear and terrain edits, and junk cleaned out', () => {
    const store = storage(), START = { wooden_sword: 1, wooden_shield: 1, cloth_armor: 1 }, WORN = plain(gameConfig.gear.starter);
    const fresh = plain(saveKit.load(store));
    assert.deepEqual(fresh, plain(saveKit.fresh()));
    assert.deepEqual(fresh, { v: 2, bosses: {}, chests: {}, inventory: { gold: 0, items: START }, loadout: WORN, edits: {}, clock: 0, gathered: {} }, 'a new game owns and wears the starter gear');
    const sim = W.create({ region: 'field' });
    sim.progress.bosses.goblinChief = true;
    sim.progress.inventory.gold = 12; sim.progress.inventory.items.goblin_ear = 3; sim.progress.inventory.items.iron_armor = 1;
    sim.progress.loadout.armor = 'iron_armor';
    T.set(sim.terrain, 20, 20, 'stone', 2);
    assert.equal(saveKit.write(store, saveKit.merge(saveKit.fresh(), sim)), true);
    const back = saveKit.load(store), items = { ...START, goblin_ear: 3, iron_armor: 1 };
    assert.deepEqual(plain(back), { v: 2, bosses: { goblinChief: true }, chests: {}, inventory: { gold: 12, items }, loadout: { ...WORN, armor: 'iron_armor' }, edits: { field: [[20, 20, 'stone', 2]] }, clock: 0, gathered: {} });
    // A region made from the save has the edit back, carries what was carried and wears what was worn.
    const again = W.create({ region: 'field', progress: back });
    assert.equal(T.levelAt(again.terrain, 20, 20), 2);
    assert.deepEqual(plain(again.progress.inventory), { gold: 12, items });
    assert.equal(again.player.loadout.armor, 'iron_armor');
    // Junk is dropped, and anything unreadable starts fresh. A version 1
    // save (M5, before gear) gets the starter gear.
    const junk = {
        v: 1, bosses: { goblinChief: true, goblin: true, nobody: true }, chests: { 'field/chest-53-5': true, 'mars/x': true },
        inventory: { gold: -5, items: { goblin_ear: 2.5, wolf_pelt: 3, junk: 9, gold: 4, potion: 99 } },
        edits: { arena: [[1, 1, 'stone', 1]], field: [[1, 1, 'stone', 1], 'x', [1, 2, 'lava', 1]], mars: [[1, 1, 'stone', 1]] }
    };
    assert.deepEqual(plain(saveKit.clean(junk)), {
        v: 2, bosses: { goblinChief: true }, chests: { 'field/chest-53-5': true }, inventory: { gold: 0, items: { ...START, wolf_pelt: 3, potion: 5 } },
        loadout: WORN, edits: { field: [[1, 1, 'stone', 1]] }, clock: 0, gathered: {}
    });
    // Gear worn but not owned, or in the wrong slot, falls back to the starter piece; the main hand is never empty.
    const worn = saveKit.clean({ ...fresh, loadout: { main: null, offhand: 'iron_shield', armor: 'wooden_sword', accessory: 'chief_charm' } });
    assert.deepEqual(plain(worn.loadout), WORN);
    assert.equal(saveKit.clean({ ...fresh, loadout: { ...WORN, offhand: null } }).loadout.offhand, null, 'the offhand may be empty');
    for (const raw of ['not json', '{"v":3}', 'null', '[]']) { store.setItem(saveKit.KEY, raw); assert.deepEqual(plain(saveKit.load(store)), plain(saveKit.fresh()), raw); }
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
    assert.deepEqual(plain(saveKit.load(broken)), plain(saveKit.fresh()));
    assert.equal(saveKit.write(broken, saveKit.fresh()), false);
    assert.deepEqual(plain(saveKit.erase(store)), plain(saveKit.fresh()));
    assert.equal(store.data.size, 0);
});

test('a world with entities replays the same and survives a JSON round trip', () => {
    const play = () => {
        const sim = W.create({ region: 'field', seed: 3 }), p = sim.player, m = sim.monsters.find(x => x.kind === 'goblin');
        put(p, m.x - 120, m.y, 0);
        for (let t = 0; t < 600; t++) {
            if (t % 40 === 0) tap(sim);
            W.step(sim, 0.01);
        }
        return sim;
    };
    const strip = sim => JSON.stringify(W.snapshot(sim));
    const a = play();
    assert.equal(strip(a), strip(play()));
    assert.ok(a.entities.length > 0);
    assert.equal('monsters' in W.snapshot(a), false, 'aliases are not part of a snapshot');
    const copy = W.restore(W.create({ region: 'field', seed: 3 }), JSON.parse(strip(a)));
    for (const s of [a, copy]) step(s, 2);
    assert.equal(strip(copy), strip(a));
});
