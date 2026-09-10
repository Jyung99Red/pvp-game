// Run: node --test tests/training.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({});
for (const file of ['core/spatial_combat.js', 'core/combat_gestures.js', 'pve/spatial_data.js', 'pve/spatial_engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}
const L = vm.runInContext('spatialEngine', context);
const S = vm.runInContext('spatialCombat', context);

test('shared view mounts on training Document and formal Element roots, and redraws after resize', () => {
    for (const formal of [false, true]) {
        let resized, draws = 0, disconnected = false;
        const canvasContext = new Proxy({}, { get: (_, key) => key === 'clearRect' ? () => draws++ :
            key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {} });
        const nodes = new Map();
        function element() {
            return { textContent: '', style: {}, classList: { toggle() {} },
                setAttribute() {}, appendChild(node) { return node; }, remove() {},
                getBoundingClientRect: () => ({ width: 390, height: 844, top: 700, bottom: 90 }),
                querySelector: () => ({ style: {} }) };
        }
        const root = { querySelector(selector) {
            if (!nodes.has(selector)) nodes.set(selector, element());
            return nodes.get(selector);
        } };
        if (formal) root.classList = { contains: () => true };
        const canvas = root.querySelector('[id="arena"]');
        canvas.getContext = () => canvasContext;
        canvas.getBoundingClientRect = () => ({ width: 390, height: 844, top: 0 });
        const c = vm.createContext({ root, document: { createElement: element }, window: { devicePixelRatio: 1 },
            ResizeObserver: class { constructor(callback) { resized = callback; } observe() {} disconnect() { disconnected = true; } } });
        for (const file of ['core/spatial_combat.js', 'core/combat_gestures.js', 'pve/spatial_data.js', 'pve/spatial_engine.js', 'ui/ui_spatial_battle.js']) {
            vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c);
        }
        const { view, battle } = vm.runInContext('({view: uiSpatialBattle.create(root), battle: spatialEngine.create()})', c);
        view.render(battle);
        assert.equal(draws, 1); resized(); assert.equal(draws, 2);
        assert.equal(root.querySelector('[id="player-hp"]').textContent, '120 / 120');
        view.destroy(); assert.equal(disconnected, true);
    }
});
function setup() {
    const b = L.create(); L.start(b);
    b.enemy.phase = 'recover'; b.enemy.timer = 100;
    return b;
}
function advance(b, seconds) {
    for (let left = seconds; left > 1e-8; left -= .01) L.step(b, Math.min(left, .01));
}
function incoming(b, timer = .1) {
    b.enemy.x = 180; b.enemy.y = 180; b.enemy.facing = Math.PI / 2;
    b.player.x = 180; b.player.y = 255;
    b.enemy.phase = 'windup'; b.enemy.attack = L.config.sweep; b.enemy.timer = timer;
}
test('tap attacks at the same position and spends exactly one AP', () => {
    const b = setup(), { x, y } = b.player;
    L.press(b, 'action'); advance(b, .08); L.release(b, 'action');
    assert.equal(b.stats.attacks, 1); assert.equal(b.player.ap, 4);
    assert.equal(b.player.x, x); assert.equal(b.player.y, y);
});
test('upward movement starts immediately and release never attacks, even after a long hold', () => {
    const b = setup(); b.enemy.x = 50; b.enemy.y = 50;
    L.press(b, 'action'); L.drag(b, 'action', 0, -60); advance(b, .01);
    assert.ok(b.player.y < 275);
    advance(b, 1.8); L.release(b, 'action');
    assert.equal(b.stats.attacks, 0); assert.equal(b.player.charge, 0);
    const y = b.player.y; advance(b, .2); assert.equal(b.player.y, y);
});
test('charged hold is immobile, never auto-fires, and release in place cancels without AP cost', () => {
    const b = setup(); L.press(b, 'action'); advance(b, 2);
    assert.equal(b.player.phase, 'charging'); assert.equal(b.player.charge, L.config.fullCharge);
    assert.equal(b.stats.attacks, 0);
    assert.equal(b.player.x, 180); assert.equal(b.player.y, 275);
    L.release(b, 'action');
    assert.equal(b.stats.attacks, 0); assert.equal(b.stats.cancels, 1);
    assert.equal(b.player.ap, 5); assert.equal(b.player.phase, 'idle');
});
test('upward release commits heavy attack without movement; returning to origin cancels', () => {
    const b = setup(); L.press(b, 'action'); advance(b, 1.7);
    L.drag(b, 'action', 0, -50); advance(b, .1); L.release(b, 'action');
    assert.equal(b.player.attack.heavy, true); assert.equal(b.player.attack.damage, 58);
    assert.equal(b.player.y, 275); assert.equal(b.stats.attacks, 1);
    const c = setup(); L.press(c, 'action'); advance(c, .5);
    L.drag(c, 'action', 0, -50); L.drag(c, 'action', 2, 3); L.release(c, 'action');
    assert.equal(c.stats.attacks, 0); assert.equal(c.stats.cancels, 1);
});
test('pointer cancellation and pause cannot release an armed attack', () => {
    for (const cancel of [b => L.release(b, 'action', true), b => L.pause(b)]) {
        const b = setup(); L.press(b, 'action'); advance(b, .6); L.drag(b, 'action', 0, -50);
        cancel(b); assert.equal(b.stats.attacks, 0); assert.equal(b.player.phase, 'idle');
    }
    const b = setup(); L.press(b, 'action'); L.drag(b, 'action', 60, 0); L.pause(b);
    const time = b.time, x = b.player.x; advance(b, 5);
    assert.equal(b.time, time); assert.equal(b.player.x, x);
});
test('guard overrides movement, rotates in place, and rotation never refreshes parry time', () => {
    const b = setup(); L.press(b, 'action'); L.drag(b, 'action', 60, 0); advance(b, .1);
    assert.equal(L.press(b, 'guard'), true);
    const { x, y } = b.player; advance(b, .2);
    const ready = b.player.guardReadyAt;
    L.drag(b, 'guard', 60, 0); advance(b, .5);
    assert.equal(b.player.x, x); assert.equal(b.player.y, y);
    assert.equal(b.player.facing, 0); assert.equal(b.player.guardReadyAt, ready);
    L.release(b, 'guard'); advance(b, .2); L.release(b, 'action');
    assert.equal(b.player.x, x); assert.equal(b.stats.attacks, 0);
});
test('geometry covers front, back, radial edges and circular reach', () => {
    const origin = { x: 0, y: 0 }, sector = { kind: 'sector', range: 100, arc: Math.PI / 2 };
    assert.equal(S.contains(sector, origin, 0, { x: 80, y: 0, radius: 10 }), true);
    assert.equal(S.contains(sector, origin, 0, { x: -50, y: 0, radius: 10 }), false);
    assert.equal(S.contains(sector, origin, 0, { x: 50, y: 55, radius: 5 }), true);
    assert.equal(S.contains(sector, origin, 0, { x: 110, y: 0, radius: 5 }), false);
    assert.equal(S.contains({ kind: 'circle', range: 100 }, origin, 0, { x: -90, y: 0, radius: 5 }), true);
});
test('one attack damages once, misses outside range, and light hits do not interrupt windup', () => {
    const b = setup(); incoming(b, 1);
    L.press(b, 'action'); L.release(b, 'action'); advance(b, .2);
    assert.equal(b.enemy.hp, 342); assert.equal(b.enemy.phase, 'windup');
    advance(b, .2); assert.equal(b.enemy.hp, 342);
    const c = setup(); c.enemy.y = 50;
    L.press(c, 'action'); L.release(c, 'action'); advance(c, .2);
    assert.equal(c.enemy.hp, 360); assert.equal(c.stats.misses, 1);
});
test('front guard, rear hit and precise guard produce different outcomes', () => {
    const b = setup(); L.press(b, 'guard'); advance(b, .6); incoming(b); advance(b, .2);
    assert.equal(b.stats.blocks, 1); assert.equal(b.player.hp, 114);
    advance(b, .3); assert.equal(b.player.hp, 114);
    const c = setup(); L.press(c, 'guard'); advance(c, .6); incoming(c); c.player.facing = Math.PI / 2;
    advance(c, .2); assert.equal(c.stats.blocks, 0); assert.equal(c.player.hp, 95);
    const d = setup(); L.press(d, 'guard'); advance(d, .18); incoming(d, .05); advance(d, .1);
    assert.equal(d.stats.parries, 1); assert.equal(d.player.hp, 120); assert.equal(d.enemy.hp, 350);
});
test('locked windup stops tracking, and moving outside its sector avoids damage', () => {
    const b = setup(); incoming(b, .3); const facing = b.enemy.facing;
    b.player.x = 70; b.player.y = 170; advance(b, .4);
    assert.equal(b.enemy.facing, facing); assert.equal(b.player.hp, 120); assert.equal(b.stats.dodges, 1);
});
test('a lethal player hit ends the fight before a pending enemy hit can execute', () => {
    const b = setup(); incoming(b, .1); b.enemy.hp = 1; b.player.hp = 1;
    L.press(b, 'action'); L.release(b, 'action'); advance(b, .2);
    assert.equal(b.result, 'victory'); assert.equal(b.player.hp, 1); assert.equal(b.running, false);
});

test('semantic commands cannot bypass charge, AP, pause or finished state', () => {
    const b = setup();
    assert.equal(L.dispatch(b, { type: 'heavy' }), false);
    L.press(b, 'action'); b.player.ap = 0; advance(b, .3);
    assert.equal(b.action.mode, 'blocked'); assert.equal(b.player.phase, 'idle');
    L.pause(b); assert.equal(L.dispatch(b, { type: 'light' }), false);
    assert.equal(b.stats.attacks, 0);
});

test('events describe damage and finish once, draining cannot change combat', () => {
    const b = setup(); incoming(b, .1); b.enemy.hp = 1;
    L.press(b, 'action'); L.release(b, 'action'); advance(b, .2);
    const events = L.drainEvents(b);
    assert.equal(events.filter(e => e.type === 'finished').length, 1);
    assert.ok(events.some(e => e.type === 'hp_changed' && e.side === 'enemy' && e.hp === 0));
    assert.ok(events.some(e => e.type === 'hit'));
    assert.equal(L.drainEvents(b).length, 0);
    advance(b, 1); assert.equal(L.press(b, 'action'), false);
    assert.equal(L.drainEvents(b).length, 0);
});

test('hit invalidates both inputs and instances do not share mutable fighter state', () => {
    const b = setup(), other = setup(); incoming(b, .1);
    L.press(b, 'action'); const version = b.inputVersion; advance(b, .2);
    assert.ok(b.inputVersion > version); assert.equal(b.action, null); assert.equal(b.guard, null);
    L.release(b, 'action'); assert.equal(b.stats.attacks, 0);
    assert.equal(other.player.hp, 120); assert.equal(other.events.length, 0);
    assert.equal(Object.isFrozen(L.config.heavy), true);
});


test('pointer adapter owns each channel, cancels lost capture and removes listeners', () => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui/combat_input.js'), 'utf8'), context);
    const Input = vm.runInContext('combatInput', context);
    function pad() {
        const listeners = new Map(), held = new Set();
        return {
            addEventListener: (type, fn) => listeners.set(type, fn),
            removeEventListener: type => listeners.delete(type),
            setPointerCapture: id => held.add(id), hasPointerCapture: id => held.has(id),
            releasePointerCapture(id) { held.delete(id); this.fire('lostpointercapture', id); },
            fire(type, id, x = 0, y = 0) { listeners.get(type)?.({ pointerId: id, button: 0, clientX: x, clientY: y, preventDefault() {} }); },
            listeners, held
        };
    }
    const action = pad(), guard = pad(), b = setup();
    const input = Input.attach({ action, guard }, {
        press: channel => L.press(b, channel),
        drag: (channel, dx, dy) => L.drag(b, channel, dx, dy),
        release: (channel, cancelled) => L.release(b, channel, cancelled)
    });
    action.fire('pointerdown', 1); action.fire('pointermove', 1, 60);
    guard.fire('pointerdown', 2); action.fire('pointerdown', 3);
    assert.equal(action.held.size, 1); assert.equal(guard.held.size, 1);
    guard.fire('pointerup', 2); action.fire('pointerup', 1);
    assert.equal(b.stats.attacks, 0);
    action.fire('pointerdown', 4); advance(b, .5); action.fire('pointermove', 4, 0, -50);
    action.releasePointerCapture(4);
    assert.equal(b.stats.attacks, 0); assert.equal(b.action, null);
    L.pause(b); input.destroy();
    assert.equal(action.listeners.size, 0); assert.equal(guard.listeners.size, 0);
    assert.equal(action.held.size, 0); assert.equal(guard.held.size, 0);
});
