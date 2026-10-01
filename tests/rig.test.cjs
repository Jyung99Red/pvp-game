const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const g = load();
const { math3d: M, rigKit: R, playerModel, playerAnim, equipmentModels, space, gameConfig } = g;

const equipment = equipmentModels.forLoadout({ main: 'sword', offhand: 'shield' });
const rig = R.build(playerModel, { equipment });
const half = part => part.size.map(v => v / 2);
const cornersOf = (solved, i) => M.corners(M.obb(solved.parts[i], half(rig.parts[i])));
const find = (fn) => rig.parts.findIndex(fn);
const top = solved => Math.max(...rig.parts.map((_, i) => Math.max(...cornersOf(solved, i).map(c => c[1]))));
const lowestBody = solved => R.lowest(rig, solved);
// Objects made inside the vm have their own prototypes; compare as data.
const plain = value => JSON.parse(JSON.stringify(value));

test('the main character has the 14 bones of 3d-migration-concept.md 12.1', () => {
    const names = rig.bones.map(b => b.name);
    assert.deepEqual(plain(names.sort()), ['base', 'chest', 'forearmL', 'forearmR', 'handL', 'handR', 'head', 'pelvis', 'shinL', 'shinR', 'thighL', 'thighR', 'upperArmL', 'upperArmR'].sort());
    const parent = name => { const b = rig.bones[rig.index[name]]; return b.parent < 0 ? null : rig.bones[b.parent].name; };
    assert.equal(parent('base'), null);
    assert.equal(parent('pelvis'), 'base');
    assert.equal(parent('chest'), 'pelvis');
    assert.equal(parent('head'), 'chest');
    for (const s of ['R', 'L']) {
        assert.equal(parent(`upperArm${s}`), 'chest');
        assert.equal(parent(`forearm${s}`), `upperArm${s}`);
        assert.equal(parent(`hand${s}`), `forearm${s}`);
        assert.equal(parent(`thigh${s}`), 'pelvis');
        assert.equal(parent(`shin${s}`), `thigh${s}`);
    }
    // Mount points are points on bones, not bones.
    for (const mount of ['handR', 'handL', 'back', 'waist', 'head']) assert.ok(playerModel.mounts[mount]);
    // The animation layers split the skeleton cleanly.
    const layered = [...playerModel.layers.lower, ...playerModel.layers.upper];
    assert.deepEqual([...layered].sort(), [...rig.bones.map(b => b.name)].sort());
    assert.equal(new Set(layered).size, layered.length);
});

test('scale follows the prototype: about 1.9 blocks tall, standing on the ground', () => {
    const solved = R.solve(rig, playerAnim.pose(rig, { walk: 0, moveBlend: 0 }));
    const head = find(p => p.kind === 'body' && rig.bones[p.bone].name === 'head');
    const headTop = Math.max(...cornersOf(solved, head).map(c => c[1]));
    assert.ok(headTop > 1.8 && headTop < 1.95, `head top ${headTop}`);
    assert.ok(top(solved) < 2.05, `overall ${top(solved)}`);
    assert.ok(Math.abs(lowestBody(solved)) < 1e-9);
    const big = R.build(playerModel, { scale: 2, equipment });
    const bigSolved = R.solve(big, playerAnim.pose(big, { walk: 0, moveBlend: 0 }));
    const bigTop = Math.max(...big.parts.map((p, i) => Math.max(...M.corners(M.obb(bigSolved.parts[i], p.size.map(v => v / 2))).map(c => c[1]))));
    assert.ok(Math.abs(bigTop - 2 * top(solved)) < 1e-6, 'scale multiplies every size');
});

test('the model faces +z with its right hand on -x; facing maps to yaw in one place', () => {
    const pose = playerAnim.pose(rig, { walk: 0, moveBlend: 0 });
    const eye = find(p => p.color === 'eye'), handR = rig.index.handR, handL = rig.index.handL;
    const rest = R.solve(rig, pose);
    assert.ok(rest.parts[eye][14] > 0.2, 'eyes on the +z face');
    assert.ok(rest.bones[handR][12] < 0 && rest.bones[handL][12] > 0);
    // Facing east (theta = 0, +x on screen): the face points along +x.
    for (const [facing, axis, sign] of [[0, 12, 1], [Math.PI / 2, 14, 1], [Math.PI, 12, -1], [-Math.PI / 2, 14, -1]]) {
        const s = R.solve(rig, pose, [10, 0, 5], space.yawOf(facing)), origin = axis === 12 ? 10 : 5;
        assert.ok(sign * (s.parts[eye][axis] - origin) > 0.2, `facing ${facing}`);
    }
    const [x, h, z] = space.toBlocks(400, 120, 40);
    assert.deepEqual([x, h, z], [10, 1, 3]);
});

test('hurtboxes are the body only: not deco, not the sword, not the shield', () => {
    const solved = R.solve(rig, playerAnim.pose(rig, { walk: 0, moveBlend: 0 }));
    const hurt = R.boxes(rig, solved, ['body']).map(b => rig.parts[b.part]);
    assert.ok(hurt.length >= 15);
    assert.ok(hurt.every(p => p.kind === 'body' && p.owner === 'body'));
    const bones = new Set(hurt.map(p => rig.bones[p.bone].name));
    for (const b of ['head', 'chest', 'upperArmR', 'forearmL', 'handR', 'thighL', 'shinR']) assert.ok(bones.has(b), `${b} can be hit`);
    const weapons = R.boxes(rig, solved, ['weapon']);
    assert.equal(weapons.length, 1);
    assert.equal(rig.parts[weapons[0].part].size[2], gameConfig.models.swordBladeLength);
    assert.equal(R.boxes(rig, solved, ['shield']).length, 1);
});

test('sparse poses: unnamed bones stay at rest; mirror, mix and add', () => {
    const rest = R.solve(rig, {}), nudged = R.solve(rig, { thighR: { rx: 0.5 } });
    for (const name of ['head', 'handR', 'thighL', 'shinL']) assert.deepEqual(Array.from(nudged.bones[rig.index[name]]), Array.from(rest.bones[rig.index[name]]));
    assert.notDeepEqual(Array.from(nudged.bones[rig.index.shinR]), Array.from(rest.bones[rig.index.shinR]));
    assert.deepEqual(plain(R.mirror({ thighR: { rx: 0.3, ry: 0.2, pz: 1 }, chest: { rz: 0.1, px: 0.5 } })), { thighL: { rx: 0.3, ry: -0.2, pz: 1 }, chest: { rz: -0.1, px: -0.5 } });
    assert.deepEqual(plain(R.mix({ a: { rx: 1 } }, { a: { rx: 3 }, b: { ry: 2 } }, 0.5)), { a: { rx: 2 }, b: { ry: 1 } });
    assert.deepEqual(plain(R.add({ a: { rx: 1 } }, { a: { rx: 2, py: 1 } })), { a: { rx: 3, py: 1 } });
    // A mirrored pose solves to the mirror image.
    const pose = { upperArmR: { rx: -0.8, rz: -0.3 }, thighL: { rx: 0.4, ry: 0.2 } };
    const a = R.solve(rig, pose), b = R.solve(rig, R.mirror(pose));
    for (const [l, r] of [['handR', 'handL'], ['shinL', 'shinR']]) {
        const pa = a.bones[rig.index[l]], pb = b.bones[rig.index[r]];
        assert.ok(Math.abs(pa[12] + pb[12]) < 1e-9 && Math.abs(pa[13] - pb[13]) < 1e-9 && Math.abs(pa[14] - pb[14]) < 1e-9);
    }
});

test('walking is a pure function of distance walked and blend, feet on the ground', () => {
    const cycle = playerAnim.cycleLength(rig);
    const at = (walk, moveBlend = 1) => R.solve(rig, playerAnim.pose(rig, { walk, moveBlend }));
    // Same state, separately built rig: the same pose. Nothing hidden in
    // the rig or in earlier calls feeds the result.
    const other = R.build(playerModel, { equipment: equipmentModels.forLoadout({ main: 'sword', offhand: 'shield' }) });
    at(3 * cycle / 7);
    assert.equal(JSON.stringify(playerAnim.pose(other, { walk: 17.5, moveBlend: 0.4 })), JSON.stringify(playerAnim.pose(rig, { walk: 17.5, moveBlend: 0.4 })));
    assert.notDeepEqual(Array.from(at(0).bones[rig.index.thighR]), Array.from(at(cycle / 4).bones[rig.index.thighR]));
    for (let i = 0; i <= 40; i++) {
        for (const blend of [0, 0.5, 1]) {
            const low = lowestBody(at(cycle * i / 40, blend));
            assert.ok(Math.abs(low) < 1e-9, `phase ${i / 40} blend ${blend}: lowest body point ${low}`);
        }
    }
    // A full cycle returns to the same pose.
    assert.ok(Array.from(at(0).parts[3]).every((v, k) => Math.abs(v - at(cycle).parts[3][k]) < 1e-9));
});

test('the stride matches the leg swing: the planted foot barely slides', () => {
    const cycle = playerAnim.cycleLength(rig), unit = gameConfig.world.unitsPerBlock;
    const foot = find(p => p.tag === 'foot' && rig.bones[p.bone].name === 'shinR');
    const zs = [];
    for (let f = 0; f <= 0.5 + 1e-9; f += 0.025) {
        const s = R.solve(rig, playerAnim.pose(rig, { walk: f * cycle, moveBlend: 1 }));
        zs.push(s.parts[foot][14] + f * cycle / unit); // body walks forward along +z
    }
    const slide = Math.max(...zs) - Math.min(...zs);
    assert.ok(slide < 0.15, `planted foot slides ${slide.toFixed(3)} blocks`);
    const stepsPerSecond = 2 * gameConfig.player.speed / cycle;
    assert.ok(stepsPerSecond > 3 && stepsPerSecond < 5, `${stepsPerSecond.toFixed(2)} steps a second at full speed`);
});

test('drawn-only additions never change the judged pose', () => {
    const body = { walk: 30, moveBlend: 0 }, judged = playerAnim.pose(rig, body);
    const before = JSON.stringify(judged);
    const shown = playerAnim.present(judged, body, { time: 1.3, lean: 0.1 });
    assert.equal(JSON.stringify(judged), before);
    assert.notDeepEqual(plain(shown), plain(judged));
});

test('rigs reject bad data', () => {
    assert.throws(() => R.build({ bones: [{ name: 'a', parent: 'b', at: [0, 0, 0] }], parts: [], mounts: {} }));
    assert.throws(() => R.build({ bones: [{ name: 'a', parent: null, at: [0, 0, 0] }], parts: [{ bone: 'x', size: [1, 1, 1], at: [0, 0, 0] }], mounts: {} }));
    assert.throws(() => R.build(playerModel, { equipment: [{ mount: 'tail', parts: [] }] }));
    assert.throws(() => equipmentModels.forLoadout({ main: 'bow' }));
});
