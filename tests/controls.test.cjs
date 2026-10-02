const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { controlsKit: K, space, gameConfig } = load();
const I = gameConfig.input, L = gameConfig.controlsLayout;

test('stick: nothing in the dead zone, full speed one ramp further out', () => {
    assert.equal(K.stickVector(I.deadZone, 0).mag, 0);
    assert.equal(K.stickVector(0, -I.deadZone * 0.9).mag, 0);
    const half = K.stickVector(I.deadZone + I.ramp / 2, 0);
    assert.ok(Math.abs(half.mag - 0.5) < 1e-9 && half.y === 0);
    assert.equal(K.stickVector(0, I.deadZone + I.ramp).mag, 1);
    const far = K.stickVector(-300, 400);
    assert.equal(far.mag, 1);
    assert.ok(Math.abs(far.x + 0.6) < 1e-9 && Math.abs(far.y - 0.8) < 1e-9, 'direction is kept');
});

test('keyboard: WASD and arrows make a unit vector; opposite keys cancel', () => {
    const v = codes => { const r = K.keyVector(new Set(codes)); return [r.x, r.y].map(n => Math.round(n * 1e6) / 1e6 + 0); };
    assert.deepEqual(v(['KeyW']), [0, -1]);
    assert.deepEqual(v(['ArrowDown']), [0, 1]);
    assert.deepEqual(v(['KeyW', 'KeyD']), [0.707107, -0.707107]);
    assert.deepEqual(v(['KeyA', 'KeyD']), [0, 0]);
    assert.deepEqual(v([]), [0, 0]);
    const keys = I.keys;
    assert.deepEqual([keys.a[0], keys.b[0], keys.offhand[0], keys.interact[0]], ['KeyJ', 'KeyK', 'KeyL', 'KeyE']);
});

test('screen directions map to the ground for the fixed camera', () => {
    const g = (sx, sy, yaw) => { const r = space.screenToGround(sx, sy, yaw); return [r.x, r.y].map(n => Math.round(n * 1e9) / 1e9 + 0); };
    assert.deepEqual(g(0, -1, 0), [0, -1], 'screen up is north (-y, 3D -z)');
    assert.deepEqual(g(1, 0, 0), [1, 0]);
    // A camera turned a quarter round still maps screen-up to "away from the camera".
    assert.deepEqual(g(0, -1, Math.PI / 2), [-1, 0]);
    assert.equal(gameConfig.camera.yaw, 0);
});

// Landscape phones: width x height in CSS px, with notch insets.
const PHONES = [
    ['iPhone 13 / 14', 844, 390, { left: 47, right: 47, bottom: 21 }],
    ['iPhone SE', 667, 375, {}],
    ['iPhone Pro Max', 932, 430, { left: 59, right: 59, bottom: 21 }],
    ['small Android', 640, 360, {}],
    ['Android 20:9', 800, 360, { left: 32 }],
    ['Android tall', 915, 412, {}]
];

test('controls fit every common landscape phone without overlapping', () => {
    for (const [name, w, h, insets] of PHONES) {
        assert.deepEqual(K.check(w, h, insets).length, 0, `${name}: ${K.check(w, h, insets).join('; ')}`);
        const { buttons: b, stickRest, stickZone } = K.layout(w, h, insets);
        // Right cluster: A biggest and lowest-right, B above it, offhand to its left.
        assert.ok(b.a.size > b.b.size && b.a.size > b.offhand.size, name);
        assert.ok(b.b.y < b.a.y && b.offhand.x < b.a.x, name);
        const cluster = ['a', 'b', 'offhand'].map(id => b[id]);
        const height = Math.max(...cluster.map(c => c.y + c.r)) - Math.min(...cluster.map(c => c.y - c.r));
        assert.ok(height <= 200, `${name}: right cluster ${height}px tall`);
        // The stick zone is a small bottom-left patch around where the stick rests.
        for (const c of cluster) assert.ok(c.x - c.r > stickZone.x1, `${name}: right buttons stay off the stick zone`);
        assert.ok(stickZone.x0 === 0 && stickZone.y1 === h, `${name}: the zone reaches the screen's corner`);
        assert.ok(stickZone.x1 <= w * 0.45 && stickZone.y1 - stickZone.y0 <= h * 0.6, `${name}: zone ${JSON.stringify(stickZone)} is small`);
        assert.ok(stickRest.x <= stickZone.x1 - 40 && stickRest.y >= stickZone.y0 + 40, `${name}: the resting stick sits inside the zone`);
        assert.ok(b.interact.x < stickZone.x1 && b.interact.y + b.interact.r < stickRest.y - I.stickRadius, name);
        assert.ok(stickRest.x - I.stickRadius > (insets.left || 0), `${name}: resting stick inside the safe area`);
    }
});

test('first sizes follow parameters.md 9', () => {
    assert.deepEqual([L.buttons.a.size, L.buttons.b.size, L.buttons.offhand.size, L.buttons.interact.size], [84, 72, 72, 56]);
    assert.equal(L.minGap, 10);
    assert.equal(I.maxTouches, 2);
    assert.deepEqual([I.deadZone, I.ramp], [12, 32]);
});

test('the checker does flag a bad layout', () => {
    const bad = { ...L, buttons: { ...L.buttons, b: { side: 'right', x: 78, y: 120, size: 72 } } };
    assert.ok(K.check(844, 390, {}, bad).some(p => /a and b/.test(p)));
    const off = { ...L, buttons: { ...L.buttons, a: { side: 'right', x: 20, y: 72, size: 84 } } };
    assert.ok(K.check(844, 390, {}, off).some(p => /safe area/.test(p)));
});
