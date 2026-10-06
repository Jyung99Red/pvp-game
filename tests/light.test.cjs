// Light baked into the terrain's drawing (render/terrain_light.js): the
// sky each face sees. Presentation only, but plain maths on the block
// grid, so it is tested here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { terrainKit: T, terrainLight: L } = load({ include: file => !/^(ui|net|vendor)\//.test(file) && (!/^render\//.test(file) || file === 'render/terrain_light.js') });
const UP = [0, 1, 0];

test('sky visibility: open ground sees all the sky; a wall, a narrow way and a roof take it, the less the nearer', () => {
    const rows = [
        '@...................',
        '....................',
        '....................',
        '..........4.........',
        '..........4.........',
        '..........4.........',
        '..........4.........',
        '..........4.........',
        '...3.3..............',
        '...3.3..............',
        '...3.3..............',
        '...3.3..............',
        '....................',
        '....................'
    ];
    // Walls of stone: '3' three blocks high, '4' four.
    const t = T.fromRows(rows.map(r => r.replace(/\d/g, '.')));
    rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '3' || ch === '4') T.set(t, c, r, 'stone', Number(ch)); }));
    // A roof five blocks square over (16, 11), two blocks up.
    const roof = [];
    for (let dc = -2; dc <= 2; dc++) for (let dr = -2; dr <= 2; dr++) roof.push([16 + dc, 2, 11 + dr]);
    const g = L.blocks(t, roof), sky = L.sky(g);
    assert.equal(sky(19, 0, 0, UP), 1, 'open ground');
    const byWall = [11, 12, 13, 15].map(c => sky(c, 0, 5, UP));
    assert.ok(byWall.every((v, i) => i === 0 || v > byWall[i - 1]), `brighter away from the wall: ${byWall}`);
    assert.ok(byWall[0] < 0.75 && byWall[3] > 0.9, `${byWall}`);
    assert.ok(sky(4, 0, 9, UP) < byWall[0], 'a way one block wide between walls is darker than the foot of one wall');
    assert.ok(sky(16, 0, 11, UP) < 0.3, 'under a roof');
    // A wall's face: open in front sees its half of the sky; across a narrow way, less.
    assert.ok(sky(11, 1, 5, [1, 0, 0]) > 0.85, `a wall facing the open: ${sky(11, 1, 5, [1, 0, 0])}`);
    assert.ok(sky(4, 1, 9, [1, 0, 0]) < 0.5, 'a wall facing another one block off');
    // The grid: gates and fences let light by; under the ground is solid.
    T.set(t, 1, 1, 'fence', 1); T.set(t, 2, 1, 'gate', 3);
    const after = L.blocks(t);
    assert.ok(!after.solid(1, 0, 1) && !after.solid(2, 0, 1) && after.solid(10, 3, 3) && !after.solid(10, 4, 3) && after.solid(0, -1, 0));
    // Corners take the mean of the open cells round them, and a face that sees no sky keeps SKY.floor of the sky's light.
    assert.equal(L.skyShade(0), L.SKY.floor);
    const corners = L.corners(g, sky, [[11, 0, 6], [12, 0, 6], [12, 0, 5], [11, 0, 5]], UP, 11, -1, 5);
    assert.ok(corners[0] < corners[1], `the corner at the wall is darker: ${corners}`);
});

test('block light: it spreads round corners and fades, a wall two high stops it, low things let it by', () => {
    const rows = [
        '@...............',
        '................',
        '....#######.....',
        '....#######.....',
        '..........#.....',
        '..........#.....',
        '..........#.+*O.',
        '................'
    ];
    // '#' walls three high; '+' a fence, '*' a hedge, 'O' ore: one high.
    const t = T.fromRows(rows.map(r => r.replace(/#/g, '.')));
    rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') T.set(t, c, r, 'stone', 3); }));
    const at = (light, c, r) => light[(r * t.width + c) * 4];
    const one = L.blockLight(t, [{ c: 6, r: 1, reach: 8, rgb: [1, 0.5, 0] }]);
    assert.equal(at(one, 6, 1), 255, 'full at the source');
    assert.equal(one[(1 * t.width + 6) * 4 + 1], 128, 'in its colour');
    assert.ok(at(one, 7, 1) < 255 && at(one, 8, 1) < at(one, 7, 1), 'fading a cell at a time');
    assert.ok(at(one, 3, 4) > 0, 'round the corner of the wall');
    assert.equal(at(one, 6, 4), 0, 'behind the wall, two thick, nothing (the way round is longer than its reach)');
    assert.equal(at(one, 6, 2), 0, 'nor in the wall');
    assert.equal(at(one, 15, 1), 0, 'nothing past its reach');
    // Over a fence, a hedge and ore: from (15, 6) westwards along the row.
    const low = L.blockLight(t, [{ c: 15, r: 6, reach: 6, rgb: [1, 1, 1] }]);
    assert.ok(at(low, 12, 6) > 0 && at(low, 12, 6) < at(low, 14, 6), 'low blocks let it by');
    // Two sources add up.
    const two = L.blockLight(t, [{ c: 6, r: 1, reach: 8, rgb: [0.4, 0.4, 0.4] }, { c: 7, r: 1, reach: 8, rgb: [0.4, 0.4, 0.4] }]);
    assert.ok(at(two, 6, 1) > at(L.blockLight(t, [{ c: 6, r: 1, reach: 8, rgb: [0.4, 0.4, 0.4] }]), 6, 1));
});
