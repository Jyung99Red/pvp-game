// The region simulation is stepped by the page adapter and drawn by the shared
// spatial view, so it has no canvas and no listeners of its own. This harness
// therefore drives `stepWorld` by hand and renders through the REAL view, with a
// fake ctx that keeps a real transform stack -- which is what lets the facing
// tests read a heading straight off the drawn geometry.
//
// A canvas exactly the size of the region map makes the view's camera a no-op
// (its window is the whole map, so the clamp has nothing to choose), which pins
// the world-to-screen mapping to the identity: drawn coordinates ARE world
// coordinates.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const ROOT = path.join(__dirname, '..');

const PLAYER_ARC_RADIUS = 12, EXIT_LABEL_LIFT = 26;
const FILES = ['game_config.js', 'core/data.js', 'core/effects.js', 'core/save.js', 'core/player.js',
    'core/combat_rules.js', 'core/spatial_combat.js', 'core/combat_gestures.js',
    'pve/spatial_data.js', 'pve/spatial_engine.js', 'core/spatial_profiles.js', 'pve/pve_profiles.js',
    'ui/ui_spatial_battle.js', 'pve/adventure_world.js'];

function setup(rect, { region = 'b', arrivalFrom = null, defeated = {} } = {}) {
    const ops = [], labels = [], clock = { t: 0 };
    // A real transform stack. Facing is expressed purely through
    // translate/rotate, so a ctx that swallows transforms cannot be asserted
    // on; every recorded point is in screen space, after the transform.
    let m = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const mul = n => {
        m = [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
             m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
             m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    };
    const at = (x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
    const ctx = {
        save() { stack.push(m.slice()); }, restore() { m = stack.pop() || [1, 0, 0, 1, 0, 0]; },
        translate(x, y) { mul([1, 0, 0, 1, x, y]); },
        rotate(a) { const c = Math.cos(a), s = Math.sin(a); mul([c, s, -s, c, 0, 0]); },
        scale(x, y) { mul([x, 0, 0, y, 0, 0]); },
        setTransform() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {}, fillRect() {}, lineTo() {},
        rect() {}, clip() {}, clearRect() {}, ellipse() {}, createRadialGradient: () => ({ addColorStop() {} }),
        moveTo(x, y) { ops.push({ type: 'move', ...at(x, y) }); },
        arc(x, y, r) { ops.push({ type: 'arc', ...at(x, y), r }); },
        fillText(text, x, y) { const p = at(x, y); labels.push({ text, x: p.x, y: p.y }); }
    };
    // Every id the shared view or the adapter resolves, plus the canvas itself.
    const nodes = new Map();
    function element() {
        return {
            textContent: '', className: '', max: 0, value: 0, hidden: false, dataset: {},
            style: { setProperty() {}, transform: '' },
            classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
            addEventListener() {}, setAttribute() {}, remove() {}, appendChild: node => node,
            querySelector: () => ({ style: {} }), querySelectorAll: () => [],
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
        };
    }
    const canvas = {
        width: 0, height: 0, getContext: () => ctx,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: rect.width, height: rect.height }),
        addEventListener() {}, setPointerCapture() {}, releasePointerCapture() {}
    };
    nodes.set('[id="adventure-world"]', canvas);
    const root = {
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); }
    };
    const context = vm.createContext({
        console, Math, JSON, Object, Array, Set, Map, Number, String, Boolean, Error, isNaN, AbortController,
        performance: { now: () => clock.t },
        document: { createElement: element, hidden: false, getElementById: id => nodes.get(`[id="${id}"]`) || null },
        window: { addEventListener() {}, devicePixelRatio: 1 },
        ResizeObserver: class { observe() {} disconnect() {} },
        ui: { switchTab() {}, log() {} },
        pveLogic: { travel() {}, startEncounter: () => false }
    });
    for (const file of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context);
    vm.runInContext(`state.progress.currentRegionId = ${JSON.stringify(region)}`, context);
    vm.runInContext(`state.world.currentTab = 'adventure'`, context);
    vm.runInContext(`state.world.arrivalFrom = ${JSON.stringify(arrivalFrom)}`, context);
    vm.runInContext(`state.progress.defeatedBosses = ${JSON.stringify(defeated)}`, context);
    const world = vm.runInContext('adventureWorld', context), engine = vm.runInContext('spatialEngine', context);
    let view = null;
    const field = () => world.scene().field;
    return {
        context, world, engine, regions: vm.runInContext('content.regions', context), field, root,
        // Exactly what the adapter does: the region's own canvas, and the region
        // as the view's world layer.
        activate() {
            world.enter();
            view = vm.runInContext('uiSpatialBattle', context).create(root, field().config, 'adv-s-',
                { canvasId: 'adventure-world', layer: { world: (c, offer) => world.worldLayer(c, offer) } });
        },
        arrivalFrom: () => vm.runInContext('state.world.arrivalFrom', context),
        // dt comes from the frame timestamp, so the clock has to advance with it.
        step(seconds, fps = 60) {
            for (let i = 0; i < Math.round(seconds * fps); i++) {
                clock.t += 1000 / fps;
                world.stepWorld(1 / fps);
                view?.render(field(), [], 1 / fps);
            }
        },
        // The move pad is the only movement control, so walking is driven through
        // the engine's gesture surface rather than through canvas pointer events.
        pad: {
            press: () => engine.press(field(), 'move'),
            drag: (dx, dy) => engine.drag(field(), 'move', dx, dy),
            release: () => engine.release(field(), 'move', false)
        },
        clear() { ops.length = 0; labels.length = 0; },
        ops: () => ops,
        drawn() { return ops.filter(o => o.type === 'arc' && o.r === PLAYER_ARC_RADIUS).pop(); },
        label: text => labels.filter(l => l.text === text).pop()
    };
}

// Recovers the world position of the player from the drawn player arc plus the
// camera, which a known stationary exit label reveals.
function worldPlayer(t, exitWorld, exitLabel) {
    const drawn = t.drawn(), label = t.label(exitLabel);
    assert.ok(drawn && label, `expected the player and ${exitLabel} to be drawn`);
    return { x: drawn.x + (exitWorld.x - label.x), y: drawn.y + (exitWorld.y - (label.y + EXIT_LABEL_LIFT)) };
}

test('every arrival lands beside the portal back, out of aggro and off the exit trigger', () => {
    for (const [fromId, from] of Object.entries(setup({ width: 0, height: 0 }).regions)) {
        for (const exit of from.exits || []) {
            const to = setup({ width: 0, height: 0 }).regions[exit.to];
            // A canvas matching the map pins the camera to (0,0).
            const t = setup({ width: to.map.width, height: to.map.height },
                { region: exit.to, arrivalFrom: fromId, defeated: { elder_dragon: true } });
            t.activate(); t.step(1 / 60);
            const spawn = t.drawn();
            const back = (to.exits || []).find(e => e.to === fromId);
            assert.ok(back, `${exit.to} must have a way back to ${fromId}`);
            const portalDistance = Math.hypot(back.portal.x - spawn.x, back.portal.y - spawn.y);
            const label = `${fromId}->${exit.to}`;
            // Beyond the 52px exit trigger, or the fresh scene bounces straight back.
            assert.ok(portalDistance > 52, `${label} spawns ${portalDistance.toFixed(0)}px from the return portal`);
            assert.ok(spawn.x >= 14 && spawn.x <= to.map.width - 14 && spawn.y >= 14 && spawn.y <= to.map.height - 14,
                `${label} spawns out of bounds at (${spawn.x.toFixed(0)}, ${spawn.y.toFixed(0)})`);
            for (const m of to.map.monsters || []) {
                if (m.boss && m.enemyId in { elder_dragon: true }) continue;   // already dead by then
                const d = Math.hypot(m.x - spawn.x, m.y - spawn.y);
                assert.ok(d > m.alertRange, `${label} spawns ${d.toFixed(0)}px from ${m.enemyId}, inside its ${m.alertRange} alert range`);
            }
        }
    }
});

test('the arrival hint is consumed once and default spawns stay untouched', () => {
    const to = setup({ width: 0, height: 0 }).regions.b.map;
    const t = setup({ width: to.width, height: to.height }, { region: 'b', arrivalFrom: 'a' });
    t.activate();
    assert.equal(t.arrivalFrom(), null, 'arrivalFrom must be cleared once the scene is built');
    t.step(1 / 60);
    const arrived = t.drawn();
    const fresh = setup({ width: to.width, height: to.height }, { region: 'b' });
    fresh.activate(); fresh.step(1 / 60);
    // Compared as numbers: state and content live in the vm realm, whose
    // prototypes make strict deep-equality against host objects fail.
    assert.equal(fresh.drawn().x, to.playerSpawn.x, 'without an arrival hint the region default spawn still applies');
    assert.equal(fresh.drawn().y, to.playerSpawn.y);
    assert.ok(arrived.x !== to.playerSpawn.x || arrived.y !== to.playerSpawn.y, 'a return trip must not reuse the default spawn');
});

test('the move pad walks the player and a release stops them', () => {
    const t = setup({ width: 800, height: 600 }, { region: 'b' });
    const b = t.regions.b;
    t.activate(); t.step(1 / 60);
    t.clear(); t.step(1 / 60);
    const start = worldPlayer(t, { x: 80, y: 480 }, '南门 · 曙光据点');
    assert.deepEqual({ x: Math.round(start.x), y: Math.round(start.y) }, { x: 150, y: 720 }, 'starts at the region spawn');

    // A stationary press is a tap, not a walk: the gesture stays `pending` until
    // the drag clears the dead zone.
    t.pad.press();
    t.clear(); t.step(.5);
    const still = worldPlayer(t, { x: 80, y: 480 }, '南门 · 曙光据点');
    assert.ok(Math.abs(still.x - start.x) < .5 && Math.abs(still.y - start.y) < .5, 'a press alone must not move the player');
    // And resting a thumb there must not arm a charge: walking has no target for
    // one, and chargeMoveMultiplier would silently cut the walk to 60% speed.
    assert.equal(t.field().move?.mode, 'pending', 'a solo walk must never slip into a charge');

    // Dragging east walks east, and keeps walking while held -- the gesture is a
    // direction, not a one-shot nudge to where the finger is.
    t.pad.drag(80, 0);
    const path = [];
    for (let i = 0; i < 120; i++) {              // 2 seconds
        t.clear(); t.step(1 / 60);
        path.push(worldPlayer(t, { x: 80, y: 480 }, '南门 · 曙光据点').x);
    }
    t.pad.release();
    const walked = path.at(-1) - start.x;
    // playerSpeed 115 u/s, full ramp (the drag is well past moveRamp), so two
    // seconds is ~230px -- the same speed a fight moves at.
    assert.ok(walked > 200, `expected ~2s of walking at the shared battle speed, moved ${walked.toFixed(0)}px`);
    for (let i = 1; i < path.length; i++)
        assert.ok(path[i] >= path[i - 1] - .01, `walk stalled at frame ${i} (${path[i - 1].toFixed(1)} -> ${path[i].toFixed(1)})`);

    t.clear(); t.step(.5);
    const stopped = worldPlayer(t, { x: 80, y: 480 }, '南门 · 曙光据点').x;
    t.clear(); t.step(.5);
    assert.ok(Math.abs(worldPlayer(t, { x: 80, y: 480 }, '南门 · 曙光据点').x - stopped) < .5, 'releasing the pad must stop the walk');
});

// The player's facing is the first moveTo drawn after the player's own arc --
// the aiming notch runs from the centre out along the heading.
function playerFacing(t) {
    const all = t.ops();
    const i = all.findLastIndex(o => o.type === 'arc' && o.r === PLAYER_ARC_RADIUS);
    assert.ok(i >= 0, 'expected the player to be drawn');
    const tip = all.slice(i).find(o => o.type === 'move');
    assert.ok(tip, 'expected a facing notch after the player');
    return Math.atan2(tip.y - all[i].y, tip.x - all[i].x);
}

// A gate's chevron tip sits exactly 28 units out from the portal along its
// facing, so its bearing is readable straight off the drawn geometry.
function portalFacing(t, portal) {
    const tip = t.ops().filter(o => o.type === 'move')
        .find(o => Math.abs(Math.hypot(o.x - portal.x, o.y - portal.y) - 28) < .05);
    assert.ok(tip, 'expected a portal chevron');
    return Math.atan2(tip.y - portal.y, tip.x - portal.x);
}

const mapSize = region => setup({ width: 0, height: 0 }, { region }).regions[region].map;
// Facings are directions, so compare them modulo a full turn: atan2 normalises
// into (-PI, PI], and a bearing of 2PI reads back as 0.
const angleDiff = (a, b) => {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return Math.min(d, Math.PI * 2 - d);
};
const outwardBearing = (map, portal) =>
    Math.atan2(portal.y - map.height / 2, portal.x - map.width / 2);

test('an authored gate angle wins', () => {
    const map = mapSize('a');
    const t = setup({ width: map.width, height: map.height }, { region: 'a' });
    t.activate(); t.step(1 / 60);
    const portal = t.regions.a.exits[0].portal;          // authored: leads east
    assert.equal(portal.angle, 0);
    assert.ok(Math.abs(portalFacing(t, portal) - 0) < 1e-3);
});

test('an unauthored gate assumes it leads out of the region', () => {
    const map = mapSize('a');
    const t = setup({ width: map.width, height: map.height }, { region: 'a' });
    vm.runInContext('delete content.regions.a.exits[0].portal.angle', t.context);
    t.activate(); t.step(1 / 60);
    const portal = t.regions.a.exits[0].portal;
    assert.ok(Math.abs(portalFacing(t, portal) - outwardBearing(map, portal)) < 1e-3);
});

test('an arrival comes out facing away from the gate that leads back', () => {
    const map = mapSize('b');
    const t = setup({ width: map.width, height: map.height }, { region: 'b', arrivalFrom: 'a' });
    t.activate(); t.step(1 / 60);
    const gate = t.regions.b.exits.find(e => e.to === 'a').portal;
    // Authored gate leads west (Math.PI); the arrival faces the reverse, so it
    // walks into the region rather than back through the gate it came from.
    assert.equal(gate.angle, Math.PI);
    assert.ok(angleDiff(playerFacing(t), gate.angle + Math.PI) < 1e-6);
    const p = t.drawn();
    assert.ok(Math.abs(Math.hypot(p.x - gate.x, p.y - gate.y) - 92) < .01, 'lands ARRIVAL_OFFSET out');
});

test('a gate authored facing inward cannot strand the arrival on its trigger', () => {
    const map = mapSize('b');
    const t = setup({ width: map.width, height: map.height }, { region: 'b', arrivalFrom: 'a' });
    // Wedged against the west edge AND facing inward: the reverse bearing would
    // clamp the arrival onto the gate, so the outward fallback has to take over.
    vm.runInContext(
        '{ const g = content.regions.b.exits.find(e => e.to === "a").portal; g.x = 20; g.angle = 0; }',
        t.context);
    t.activate(); t.step(1 / 60);
    const p = t.drawn();
    const d = Math.hypot(p.x - 20, p.y - 480);
    assert.ok(d > 52, `arrival sits ${d.toFixed(0)}px from the gate trigger`);
});

test('a fresh spawn starts at zero facing unless the region authors one', () => {
    const map = mapSize('b');
    const plain = setup({ width: map.width, height: map.height }, { region: 'b' });
    plain.activate(); plain.step(1 / 60);
    assert.ok(Math.abs(playerFacing(plain)) < 1e-6);

    const authored = setup({ width: map.width, height: map.height }, { region: 'b' });
    vm.runInContext('content.regions.b.map.playerSpawn.facing = Math.PI / 2', authored.context);
    authored.activate(); authored.step(1 / 60);
    assert.ok(Math.abs(playerFacing(authored) - Math.PI / 2) < 1e-6);
});
