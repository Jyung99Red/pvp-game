// Run: node --test tests/spatial-engine.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({});
for (const file of ['game_config.js', 'core/spatial_combat.js', 'core/combat_gestures.js', 'pve/spatial_data.js', 'pve/spatial_engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}
const L = vm.runInContext('spatialEngine', context);
const S = vm.runInContext('spatialCombat', context);

test('shared view mounts on training Document and formal Element roots, and redraws after resize', () => {
    for (const formal of [false, true]) {
        let resized, draws = 0, disconnected = false;
        const rotations = [];
        const canvasContext = new Proxy({}, { get: (_, key) => key === 'clearRect' ? () => draws++ :
            key === 'rotate' ? angle => rotations.push(angle) :
            key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {} });
        const nodes = new Map();
        function element() {
            return { textContent: '', style: { setProperty(key, value) { this[key] = value; } }, classList: { toggle() {} }, addEventListener() {}, querySelectorAll: () => [],
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
        const c = vm.createContext({ root, AbortController, document: { createElement: element }, window: { devicePixelRatio: 1, addEventListener() {} },
            ResizeObserver: class { constructor(callback) { resized = callback; } observe() {} disconnect() { disconnected = true; } } });
        for (const file of ['game_config.js', 'core/spatial_combat.js', 'core/combat_gestures.js', 'pve/spatial_data.js', 'pve/spatial_engine.js', 'ui/ui_spatial_battle.js']) {
            vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c);
        }
        const { view, battle } = vm.runInContext('({view: uiSpatialBattle.create(root), battle: spatialEngine.create()})', c);
        view.render(battle);
        assert.equal(draws, 1); resized(); assert.equal(draws, 2);
        assert.equal(root.querySelector('[id="player-hp"]').textContent, '120 / 120');
        battle.player.phase = 'guard_start'; battle.player.timer = battle.config.guardStartup / 2;
        const saved = JSON.stringify(battle);
        view.render(battle, [], .016);
        assert.ok(Math.abs(rotations.at(-1) - Math.PI * .36) < 1e-8);
        resized(); assert.ok(Math.abs(rotations.at(-1) - Math.PI * .36) < 1e-8);
        assert.equal(JSON.stringify(battle), saved);
        battle.player.phase = 'guard'; view.render(battle, [], .016);
        assert.equal(rotations.at(-1), 0);
        battle.player.phase = 'idle'; view.render(battle, [], .1);
        assert.ok(rotations.at(-1) > 0 && rotations.at(-1) < Math.PI * .72);
        const visibility = vm.runInContext(`(() => {
            const config = JSON.parse(JSON.stringify(spatialData.baseCombatPreset));
            config.walls = [{ x: 30, y: 100, width: 20, height: 50 }];
            const calls = [], original = spatialCombat.visibilityPolygon;
            spatialCombat.visibilityPolygon = (origin, ...args) => { calls.push({x:origin.x,y:origin.y}); return original(origin,...args); };
            const battle = spatialEngine.create(config), view = uiSpatialBattle.create(root,config);
            battle.visibilityOrigin = {x:battle.player.x+10,y:battle.player.y};
            view.render(battle); view.destroy();
            spatialCombat.visibilityPolygon = original;
            return calls;
        })()`,c);
        assert.deepEqual(Array.from(visibility, point=>[point.x,point.y]),[[190,275]]);
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
    L.press(b, 'move'); advance(b, .08); L.release(b, 'move');
    assert.equal(b.stats.attacks, 1); assert.equal(b.player.ap, 4);
    assert.equal(b.player.x, x); assert.equal(b.player.y, y);
});
test('upward movement starts immediately and release never attacks, even after a long hold', () => {
    const b = setup(); b.enemy.x = 50; b.enemy.y = 50;
    L.press(b, 'move'); L.drag(b, 'move', 0, -60); advance(b, .01);
    assert.ok(b.player.y < 275);
    advance(b, 1.8); L.release(b, 'move');
    assert.equal(b.stats.attacks, 0); assert.equal(b.player.charge, 0);
    const y = b.player.y; advance(b, .2); assert.equal(b.player.y, y);
});
test('charged hold is immobile, never auto-fires, and release in place cancels without AP cost', () => {
    const b = setup(); L.press(b, 'move'); advance(b, 2);
    assert.equal(b.player.phase, 'charging'); assert.equal(b.player.charge, L.config.fullCharge);
    assert.equal(b.stats.attacks, 0);
    assert.equal(b.player.x, 180); assert.equal(b.player.y, 275);
    L.release(b, 'move');
    assert.equal(b.stats.attacks, 0); assert.equal(b.stats.cancels, 1);
    assert.equal(b.player.ap, 5); assert.equal(b.player.phase, 'idle');
});
test('charged drag moves at 60 percent; release attacks and returning to origin cancels', () => {
    const b = setup(); L.press(b, 'move'); advance(b, 2);
    L.drag(b, 'move', 0, -50); advance(b, .1); L.release(b, 'move');
    // Training atk 60 x (ratio .3 + chargeRatio .8 at full charge).
    assert.equal(b.player.attack.heavy, true); assert.equal(b.player.attack.damage, 66);
    assert.ok(Math.abs(b.player.y - (275 - 115 * .6 * .1)) < 1e-8); assert.equal(b.stats.attacks, 1);
    const c = setup(); L.press(c, 'move'); advance(c, .5);
    L.drag(c, 'move', 0, -50); L.drag(c, 'move', 2, 3); L.release(c, 'move');
    assert.equal(c.stats.attacks, 0); assert.equal(c.stats.cancels, 1);
});
test('pointer cancellation and pause cannot release an armed attack', () => {
    for (const cancel of [b => L.release(b, 'move', true), b => L.pause(b)]) {
        const b = setup(); L.press(b, 'move'); advance(b, .6); L.drag(b, 'move', 0, -50);
        cancel(b); assert.equal(b.stats.attacks, 0); assert.equal(b.player.phase, 'idle');
    }
    const b = setup(); L.press(b, 'move'); L.drag(b, 'move', 60, 0); L.pause(b);
    const time = b.time, x = b.player.x; advance(b, 5);
    assert.equal(b.time, time); assert.equal(b.player.x, x);
});
test('guard and left movement coexist at 30% speed; turning does not refresh parry', () => {
    const b = setup(); b.enemy.x = 50; b.enemy.y = 50;
    L.press(b, 'move'); L.drag(b, 'move', 60, 0);
    assert.equal(L.press(b, 'guard'), true);
    const x = b.player.x; advance(b, .2);
    assert.ok(Math.abs(b.player.x - x - 115 * .3 * .2) < 1e-8);
    const ready = b.player.guardReadyAt;
    L.drag(b, 'guard', 60, 0); advance(b, .5);
    assert.equal(b.player.facing, 0); assert.equal(b.player.guardReadyAt, ready);
    L.release(b, 'move'); L.release(b, 'guard');
    const stopped = b.player.x; advance(b, .2); assert.equal(b.player.x, stopped);
    assert.equal(b.stats.attacks, 0);
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
    L.press(b, 'move'); L.release(b, 'move'); advance(b, .2);
    assert.equal(b.enemy.hp, 342); assert.equal(b.enemy.phase, 'windup');
    advance(b, .2); assert.equal(b.enemy.hp, 342);
    const c = setup(); c.enemy.y = 50;
    L.press(c, 'move'); L.release(c, 'move'); advance(c, .2);
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
    // The slash lands mid-swing (~.15s); the enemy's windup would end at .3s.
    const b = setup(); incoming(b, .3); b.enemy.hp = 1; b.player.hp = 1;
    L.press(b, 'move'); L.release(b, 'move'); advance(b, .2);
    assert.equal(b.result, 'victory'); assert.equal(b.player.hp, 1); assert.equal(b.running, false);
});

// Combo tree: every move is windup -> swing -> recovery, read from the table.
const K = L.config.combo;
function tap(b) { L.press(b, 'move'); L.release(b, 'move'); }
function phaseLog(b, seconds) {
    const log = [];
    for (let left = seconds; left > 1e-8; left -= .01) {
        L.step(b, .01);
        const key = `${b.player.phase}:${b.player.attack?.move ?? ''}`;
        if (log.at(-1)?.key !== key) log.push({ key, time: b.time });
    }
    return log;
}
test('taps walk the tap chain and a buffered tap starts the next move at the derive point', () => {
    const b = setup(); b.enemy.y = b.player.y - 60;
    tap(b); const log = phaseLog(b, .2);
    tap(b); log.push(...phaseLog(b, .3));
    tap(b); log.push(...phaseLog(b, 2));
    assert.deepEqual(log.map(x => x.key).filter(k => k.startsWith('attack')), ['attack:slash', 'attack:backslash', 'attack:spin']);
    const swingEnd = log.find(x => x.key === 'recover:backslash').time;
    const next = log.find(x => x.key === 'attack:spin').time;
    assert.ok(Math.abs(next - swingEnd - K.moves.backslash.derive) < .011, 'the recovery is cut at the derive point');
    // A finisher has no derive point: its recovery always plays out in full.
    const spinEnd = log.find(x => x.key === 'recover:spin').time, idle = log.find(x => x.key === 'idle:spin').time;
    assert.ok(Math.abs(idle - spinEnd - K.moves.spin.recovery) < .011);
    assert.deepEqual(Array.from(L.drainEvents(b).filter(e => e.type === 'hit'), e => e.move), ['slash', 'backslash', 'spin']);
});
test('without a buffered input the recovery plays out, and the chain window then closes', () => {
    const b = setup(); tap(b);
    const log = phaseLog(b, .6);
    assert.ok(Math.abs(log.find(x => x.key === 'idle:slash').time - log.find(x => x.key === 'recover:slash').time - K.moves.slash.recovery) < .011);
    tap(b); assert.equal(b.player.attack.move, 'backslash', 'inside the window a tap continues the chain');
    const c = setup(); tap(c); advance(c, .18 + K.moves.slash.recovery + K.windowAfterRecovery + .05);
    assert.equal(c.player.chain, null); tap(c); assert.equal(c.player.attack.move, 'slash', 'after the window a tap starts over');
    const d = setup(); tap(d); advance(d, .5);
    L.press(d, 'move'); L.drag(d, 'move', 60, 0); advance(d, .05); L.release(d, 'move');
    assert.equal(d.player.chain, null, 'walking away ends the combo'); tap(d); assert.equal(d.player.attack.move, 'slash');
});
test('the blade hits whoever stands on its starting side first, once per move', () => {
    const hitAt = side => {
        const b = setup(); b.enemy.radius = 8;
        const a = -Math.PI / 2 + side * K.moves.slash.arc * .4;
        b.enemy.x = b.player.x + Math.cos(a) * 50; b.enemy.y = b.player.y + Math.sin(a) * 50;
        tap(b);
        for (let i = 0; i < 40; i++) { L.step(b, .01); if (b.stats.hits) return b.time; }
        return null;
    };
    const left = hitAt(-1), right = hitAt(1);
    assert.ok(left != null && right != null && left < right, `left ${left} right ${right}`);
    const b = setup(); b.enemy.y = b.player.y - 60; tap(b); advance(b, .6);
    assert.equal(b.stats.hits, 1); assert.equal(b.enemy.hp, 360 - 18);
});
test('a fast swing cannot skip a target between two steps', () => {
    const b = setup(); b.player.chain = { move: 'backslash', at: 0 }; b.time = .5;
    b.enemy.x = b.player.x; b.enemy.y = b.player.y + 50; // directly behind: only the spin reaches it
    tap(b); assert.equal(b.player.attack.move, 'spin');
    for (let i = 0; i < 20; i++) L.step(b, .05); // the engine's largest step
    assert.equal(b.stats.hits, 1);
});
test('pose reports phase, progress and a blade that crosses the whole arc', () => {
    const b = setup(); tap(b);
    const arc = K.moves.slash.arc, angles = [];
    let first = null;
    for (let i = 0; i < 30; i++) {
        L.step(b, .01); const pose = L.pose(b.player, b.config);
        if (pose.phase === 'swing') angles.push(pose.blade);
        if (pose.phase === 'recover' && !first) first = pose;
    }
    assert.ok(angles[0] < 0 && angles.every((v, i) => !i || v >= angles[i - 1]), 'sweep 1 moves left to right');
    assert.ok(Math.abs(first.blade - arc / 2) < arc * .05, 'the recovery starts where the swing ended, on the far side');
    assert.equal(L.pose(b.player, b.config).phase, 'recover');
});

test('semantic commands cannot bypass charge, AP, pause or finished state', () => {
    const b = setup();
    assert.equal(L.dispatch(b, { type: 'heavy' }), false);
    assert.equal(L.press(b, 'action'), false);
    b.player.ap = 0; assert.equal(L.press(b, 'move'), true); advance(b, .25);
    assert.equal(b.action, null); assert.equal(b.player.phase, 'idle');
    L.pause(b); assert.equal(L.dispatch(b, { type: 'light' }), false);
    assert.equal(b.stats.attacks, 0);
});

test('events describe damage and finish once, draining cannot change combat', () => {
    const b = setup(); incoming(b, .3); b.enemy.hp = 1;
    L.press(b, 'move'); L.release(b, 'move'); advance(b, .2);
    const events = L.drainEvents(b);
    assert.equal(events.filter(e => e.type === 'finished').length, 1);
    assert.ok(events.some(e => e.type === 'hp_changed' && e.side === 'enemy' && e.hp === 0));
    assert.ok(events.some(e => e.type === 'hit'));
    assert.equal(L.drainEvents(b).length, 0);
    advance(b, 1); assert.equal(L.press(b, 'move'), false);
    assert.equal(L.drainEvents(b).length, 0);
});

test('hit invalidates right input and instances do not share mutable fighter state', () => {
    const b = setup(), other = setup(); incoming(b, .1);
    L.press(b, 'move'); const version = b.actionInputVersion; advance(b, .2);
    assert.ok(b.actionInputVersion > version); assert.equal(b.action, null); assert.equal(b.guard, null);
    L.release(b, 'move'); assert.equal(b.stats.attacks, 0);
    assert.equal(other.player.hp, 120); assert.equal(other.events.length, 0);
    assert.equal(Object.isFrozen(L.config.combo.moves.charged), true);
});


test('pointer adapter owns each channel, cancels lost capture and removes listeners', () => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui/combat_input.js'), 'utf8'), context);
    const Input = vm.runInContext('combatInput', context);
    context.window = { addEventListener() {}, removeEventListener() {} };
    function pad() {
        const listeners = new Map(), held = new Set();
        return {
            addEventListener: (type, fn) => listeners.set(type, fn),
            removeEventListener: type => listeners.delete(type),
            setPointerCapture: id => held.add(id), hasPointerCapture: id => held.has(id),
            releasePointerCapture(id) { held.delete(id); this.fire('lostpointercapture', id); },
            fire(type, id, x = 0, y = 0) { listeners.get(type)?.({ pointerId: id, button: 0, clientX: x, clientY: y, preventDefault() {} }); },
            dataset: {}, style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } }, classList: { remove() {} }, querySelectorAll: () => [], querySelector: () => ({ style: {} }),
            getBoundingClientRect: () => ({left: -40, top: -40, width: 80, height: 80}),
            listeners, held
        };
    }
    const guard = pad(), move = pad(), skill = pad(), b = setup();
    move.dataset.originAtPress = '';
    const input = Input.attach({ guard, move, skill }, {
        press: channel => L.press(b, channel),
        drag: (channel, dx, dy) => L.drag(b, channel, dx, dy),
        release: (channel, cancelled) => L.release(b, channel, cancelled)
    });
    move.fire('pointerdown', 1, 10, 15); advance(b, .3); move.fire('pointermove', 1, 70, 15);
    assert.equal(move.style['--gesture-x'], '50px'); assert.equal(move.style['--gesture-y'], '55px');
    assert.equal(b.action.cx, 60); assert.equal(b.action.cy, 0);
    guard.fire('pointerdown', 2); move.fire('pointerdown', 3);
    assert.equal(move.held.size, 1); assert.equal(guard.held.size, 0);
    move.fire('pointercancel', 1);
    assert.equal(move.style['--gesture-x'], undefined);
    assert.equal(b.stats.attacks, 0);
    move.fire('pointerdown', 4); advance(b, .5); move.fire('pointermove', 4, 0, -50);
    move.releasePointerCapture(4);
    assert.equal(b.stats.attacks, 0); assert.equal(b.action, null);
    move.fire('pointerdown', 5); move.fire('pointermove', 5, 60);
    guard.fire('pointerdown', 6); skill.fire('pointerdown', 7);
    assert.equal(move.held.size, 1); assert.equal(guard.held.size, 1); assert.equal(skill.held.size, 0);
    L.pause(b); input.destroy();
    assert.equal(move.listeners.size, 0); assert.equal(guard.listeners.size, 0);
    assert.equal(move.held.size, 0); assert.equal(guard.held.size, 0);
});

test('hit preserves held left movement through stun; release during stun stops it', () => {
    for (const releaseDuringStun of [false, true]) {
        const b=setup(); incoming(b,.01);
        L.press(b,'move'); L.drag(b,'move',60,0);
        advance(b,.02); assert.equal(b.player.phase,'stunned');
        assert.ok(b.move); assert.equal(b.action,null);
        const x=b.player.x;
        advance(b,.1); assert.equal(b.player.x,x);
        if (releaseDuringStun) L.release(b,'move');
        advance(b,.4);
        assert.equal(b.stats.attacks,0);
        if (releaseDuringStun) assert.equal(b.player.x,x);
        else assert.ok(b.player.x>x);
    }
});

test('skill directions require dead zone exit; center cancellation is optional', () => {
    for (const [x,y,kind] of [[0,-40,'heal'],[40,0,'haste'],[0,40,'full'],[-40,0,'parry']]) {
        const b=setup(); L.press(b,'skill'); L.drag(b,'skill',x,y);
        assert.equal(L.release(b,'skill'),kind);
    }
    for (const cancelAtCenter of [false,true]) {
        const b=setup(); b.controls.cancelAtCenter=cancelAtCenter;
        L.press(b,'skill'); L.drag(b,'skill',20,0); assert.equal(L.release(b,'skill'),null);
        L.press(b,'skill'); L.drag(b,'skill',40,0); L.drag(b,'skill',0,0);
        assert.equal(L.release(b,'skill'),cancelAtCenter ? null : 'haste');
        L.press(b,'skill'); L.drag(b,'skill',0,-40); assert.equal(L.release(b,'skill',true),null);
    }
});

test('haste applies move and non-charge turn bonuses; charge remains 65 percent', () => {
    for (const stance of ['idle','charging','guard']) {
        const b=setup(); b.enemy.x=40; b.enemy.y=40;
        if (stance==='charging') { L.press(b,'move'); advance(b,.25); }
        if (stance==='guard') { L.press(b,'guard'); advance(b,.2); }
        L.useSkill(b,'haste');
        L.press(b,'move'); L.drag(b,'move',60,0);
        if (stance==='charging') L.drag(b,'move',60,0);
        if (stance==='guard') L.drag(b,'guard',60,0);
        const x=b.player.x, facing=b.player.facing;
        advance(b,.01);
        const moveMult=stance==='charging' ? .6 : stance==='guard' ? .3 : 1;
        const turn=stance==='charging' ? 5.2 : stance==='guard' ? 4.2 : 8.4;
        assert.ok(Math.abs(b.player.x-x-115*1.1*moveMult*.01)<1e-8);
        assert.ok(Math.abs(b.player.facing-facing-turn*.01)<1e-8);
    }
});

test('move gesture latches until release; a fresh stationary press crosses the hold threshold', () => {
    const b = setup(); b.enemy.x = 40; b.enemy.y = 40;
    L.press(b, 'move'); L.drag(b, 'move', 50, 0); advance(b, .1);
    L.drag(b, 'move', 0, 0); advance(b, .8);
    assert.equal(b.move.mode, 'move'); assert.equal(b.player.phase, 'idle');
    L.release(b, 'move'); assert.equal(b.stats.attacks, 0);
    L.press(b, 'move'); advance(b, .24);
    assert.equal(b.player.phase, 'idle'); advance(b, .01);
    assert.equal(b.player.phase, 'charging'); assert.ok(Math.abs(b.player.charge) < 1e-8);
    advance(b, .5); assert.ok(Math.abs(b.player.charge - .5) < 1e-8);
});

test('instant reversal releases along actual facing, including queued heavy and auto-face enabled', () => {
    for (const queued of [false, true]) {
        const b = setup(); b.controls.autoFace = true;
        if (queued) { b.player.phase = 'recover'; b.player.timer = 1; }
        L.press(b, 'move'); advance(b, .3);
        L.drag(b, 'move', 0, -60); advance(b, .05);
        const facing = b.player.facing;
        L.drag(b, 'move', 0, 60); L.release(b, 'move');
        if (queued) { assert.equal(b.queuedCommand.facing, facing); advance(b, .66); }
        assert.equal(b.player.attack.facing, facing);
        assert.ok(Math.abs(S.angleDelta(b.player.attack.facing, Math.PI / 2)) > 2);
    }
    const b = setup(); b.controls.autoFace = true; b.player.facing = 0;
    L.press(b, 'move'); L.release(b, 'move'); assert.equal(b.player.attack.facing, 0);
});

test('charging turn stays bounded and a hit keeps movement without resuming the charge', () => {
    const b = setup(); L.press(b, 'move'); advance(b, .3);
    L.drag(b, 'move', 60, 0); const facing = b.player.facing;
    advance(b, .01); assert.ok(Math.abs(b.player.facing - facing - .052) < 1e-8);
    incoming(b, .01); advance(b, .02);
    assert.equal(b.player.phase, 'stunned'); assert.equal(b.action, null);
    assert.equal(b.move.mode, 'move'); assert.equal(b.move.suppressTap, true);
    const x = b.player.x; advance(b, .4); assert.ok(b.player.x > x);
    assert.equal(b.player.phase, 'idle'); L.release(b, 'move'); assert.equal(b.stats.attacks, 0);
});

test('guard and skill gestures suppress pending taps and never arm a latent charge', () => {
    for (const channel of ['guard', 'skill']) for (const secondaryFirst of [false, true]) {
        const b = setup();
        if (secondaryFirst) L.press(b, channel);
        L.press(b, 'move');
        if (!secondaryFirst) L.press(b, channel);
        advance(b, .3); L.release(b, channel); advance(b, .5);
        assert.equal(b.player.phase, 'idle'); assert.equal(b.action, null);
        L.release(b, 'move'); assert.equal(b.stats.attacks, 0);
    }
});

test('combined release cancellation, AP failure and optional center release have no ghost attacks', () => {
    for (const cancel of [b => L.release(b, 'move', true), b => L.pause(b)]) {
        const b = setup(); L.press(b, 'move'); advance(b, .3); L.drag(b, 'move', 60, 0);
        cancel(b); assert.equal(b.action, null); assert.equal(b.move, null); assert.equal(b.stats.attacks, 0);
    }
    const b = setup(); b.player.ap = 0; L.press(b, 'move'); advance(b, .3);
    assert.equal(b.action, null); advance(b, 2); L.release(b, 'move'); assert.equal(b.stats.attacks, 0);
    const c = setup(); c.controls.cancelAtCenter = false;
    L.press(c, 'move'); advance(c, .3); L.release(c, 'move');
    assert.equal(c.player.attack.heavy, true); assert.equal(c.stats.attacks, 1);
});

test('replacing a queued charge restores ordinary movement and turning without another attack', () => {
    const b = setup(); b.player.phase = 'recover'; b.player.timer = 1;
    L.press(b, 'move'); advance(b, .3); assert.equal(b.queuedCommand.type, 'input');
    L.drag(b, 'move', 60, 0); assert.equal(L.queueSkill(b, 'haste'), true);
    advance(b, .72);
    assert.equal(b.move.mode, 'move'); assert.ok(b.player.facing > -Math.PI / 2);
    L.release(b, 'move'); assert.equal(b.stats.attacks, 0);
});

// A region session and a fight must share ONE world-to-screen mapping: if the
// fight kept the fixed 350x390 window while the overworld drew 1:1, starting a
// fight would zoom ~2x -- exactly the visual cut the merge exists to remove.
test('a zoomed region config pins the scale and derives its window from the canvas', () => {
    const scales = [], rects = [];
    const canvasContext = new Proxy({}, { get: (_, key) => key === 'scale' ? (x) => scales.push(x) :
        key === 'rect' ? (x, y, w, h) => rects.push({ w, h }) :
        key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {} });
    const nodes = new Map();
    function element() {
        return { textContent: '', style: { setProperty() {} }, classList: { toggle() {} }, addEventListener() {}, querySelectorAll: () => [],
            setAttribute() {}, appendChild: node => node, remove() {},
            getBoundingClientRect: () => ({ width: 390, height: 844, top: 700, bottom: 90 }),
            querySelector: () => ({ style: {} }) };
    }
    const root = { classList: { contains: () => true }, querySelector(s) { if (!nodes.has(s)) nodes.set(s, element()); return nodes.get(s); } };
    const canvas = root.querySelector('[id="arena"]');
    canvas.getContext = () => canvasContext;
    canvas.getBoundingClientRect = () => ({ width: 390, height: 844, top: 0 });
    const c = vm.createContext({ root, AbortController, document: { createElement: element }, window: { devicePixelRatio: 1, addEventListener() {} },
        ResizeObserver: class { observe() {} disconnect() {} } });
    for (const file of ['game_config.js', 'core/spatial_combat.js', 'core/combat_gestures.js', 'pve/spatial_data.js', 'pve/spatial_engine.js', 'ui/ui_spatial_battle.js'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c);
    const built = vm.runInContext(`(() => {
        const R = JSON.parse(JSON.stringify(spatialData.baseCombatPreset));
        R.solo = true; R.width = 2200; R.height = 1400; R.camera = { ...gameConfig.adventure.camera };
        const region = uiSpatialBattle.create(root, R, '');
        const arena = uiSpatialBattle.create(root);
        return { region, arena, zoom: gameConfig.adventure.camera.zoom, config: R,
                 battle: spatialEngine.create(R), fixed: spatialEngine.create() };
    })()`, c);
    // Fullscreen HUD strip: 844 - 700 (vitals) - 12 = 132 usable, 8px insets.
    const usableHeight = 132, usableWidth = 390 - 16;
    // The arena transform is the FIRST scale() of a draw -- fighter() rescales
    // again for the shield, so read positionally rather than off the end.
    built.region.render(built.battle);
    assert.equal(scales[0], built.zoom, 'a region fight must draw at the configured zoom');
    // A region config states its own window insets, and they WIN over the
    // fullscreen strip -- which this fake root claims to be. That is what makes
    // the window independent of `.vitals`, and `.vitals` is hidden while walking.
    assert.ok(Math.abs(rects[0].w - 390 / built.zoom) < 1e-9, `window width ${rects[0].w}`);
    assert.ok(Math.abs(rects[0].h - 844 / built.zoom) < 1e-9, `window height ${rects[0].h}`);
    // The fit-the-window branch is untouched for everything without a zoom.
    scales.length = 0;
    built.arena.render(built.fixed);
    assert.ok(Math.abs(scales[0] - Math.min(usableWidth / built.fixed.config.width, usableHeight / built.fixed.config.height)) < 1e-9);
    // One view serves both halves of a region session: swapping the config must
    // retarget the scale without the view being rebuilt.
    scales.length = 0; rects.length = 0;
    built.arena.useConfig(built.config);
    built.arena.render(built.battle);
    assert.equal(scales[0], built.zoom, 'useConfig must adopt the new camera');
    assert.ok(Math.abs(rects[0].w - 390 / built.zoom) < 1e-9, `swapped window width ${rects[0].w}`);
    assert.ok(Math.abs(rects[0].h - 844 / built.zoom) < 1e-9, `swapped window height ${rects[0].h}`);
});
