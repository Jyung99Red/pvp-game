// The merge seam: a fight that starts inside a live region scene runs in region
// space, at the monster's own position, and hands the region back when it ends.
// The legacy arena path is covered by tests/pve-spatial.test.cjs; this file only
// exercises the branch that needs both adventure_world and pve_logic mounted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const ROOT = path.join(__dirname, '..');

const FILES = ['game_config.js', 'core/data.js', 'core/effects.js', 'core/save.js', 'core/player.js',
    'core/combat_rules.js', 'core/arena_effects.js', 'core/spatial_combat.js', 'core/combat_gestures.js',
    'pve/spatial_data.js', 'pve/spatial_engine.js', 'core/spatial_profiles.js', 'pve/pve_profiles.js',
    'pve/adventure_world.js', 'pve/pve_logic.js', 'core/tick.js'];

function setup({ region = 'b' } = {}) {
    const nodes = new Map(), clock = { t: 0 };
    // A QUEUE of pending frames, not a single slot: the region loop and the fight
    // loop are both alive at the merge seam, and a one-slot fake would silently
    // hand every frame to whichever asked last -- making the region unobservable.
    let nextFrame = 0; const pending = new Map();
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
    function element() {
        return { textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} },
            addEventListener() {}, appendChild: n => n, setAttribute() {}, querySelectorAll: () => [] };
    }
    const canvas = { width: 0, height: 0, getContext: () => ctx, addEventListener() {}, setPointerCapture() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
    const c = vm.createContext({
        console, Math, JSON, Object, Array, Set, Map, Number, String, Boolean, Error, isNaN, AbortController,
        performance: { now: () => clock.t },
        requestAnimationFrame: fn => { pending.set(++nextFrame, fn); return nextFrame; },
        cancelAnimationFrame: id => pending.delete(id),
        document: { hidden: false, getElementById: id => (id === 'adventure-world' ? canvas : element()) },
        window: { addEventListener() {}, devicePixelRatio: 1 },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        ui: { switchTab() {}, updateBase() {}, updateAdventure() {}, log() {} },
        uiPve: new Proxy({}, { get: () => () => {} }),
        fx: { log: new Proxy({}, { get: () => () => {} }) }
    });
    for (const file of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), c);
    const t = { c, ...vm.runInContext('({state,content,pveLogic,adventureWorld,spatialEngine,pveProfiles})', c) };
    t.pveLogic.setRandom(() => .5);
    // Entering a region builds its scene; startEncounter is guarded on status.
    vm.runInContext(`state.progress.currentRegionId = ${JSON.stringify(region)}`, c);
    vm.runInContext(`state.world.currentTab = 'adventure'`, c);
    t.adventureWorld.activate();
    vm.runInContext(`state.world.status = 'exploring'`, c);
    // dt is read from the frame timestamp, so the clock has to advance with it.
    // Every callback pending at the start of a frame is driven, the way a real
    // browser runs every registered loop.
    t.frames = (count, fps = 60) => {
        for (let i = 0; i < count; i++) {
            clock.t += 1000 / fps;
            const due = [...pending.values()]; pending.clear();
            for (const fn of due) fn(clock.t);
        }
    };
    t.monster = id => t.adventureWorld.scene().monsters.find(m => m.id === id);
    return t;
}

test('a region fight runs in region space at the monster position, not an arena offset', () => {
    const t = setup();
    const monster = t.monster('b-goblin-1');
    assert.equal(t.pveLogic.startEncounter('goblin', 'b-goblin-1'), true);
    const b = t.state.pveBattle, C = b.spatial.config;
    assert.equal(C.width, 2200); assert.equal(C.height, 1400);          // the region, not 510x566
    assert.deepEqual([b.spatial.enemy.x, b.spatial.enemy.y], [monster.x, monster.y]);
    assert.deepEqual([b.spatial.player.x, b.spatial.player.y], [t.adventureWorld.scene().player.x, t.adventureWorld.scene().player.y]);
    assert.equal(C.enemy.radius, 16);
    assert.equal(C.ai.speed, monster.speed);                            // authored speed, not the arena default
    assert.equal(b.leash, monster.leash);                               // disengage data rides along
    assert.deepEqual([b.home.x, b.home.y], [monster.home.x, monster.home.y]);
    assert.equal(t.state.world.status, 'fighting');
});

test('running past the leash ends the fight with no reward and hands the region back', () => {
    const t = setup();
    t.pveLogic.startEncounter('goblin', 'b-goblin-1');
    const b = t.state.pveBattle;
    const exp = t.state.inventory.exp, gold = t.state.resources.gold, hp = t.state.player.currentHp;
    // The engine AI has no home awareness, so shove it out of leash range directly.
    b.spatial.enemy.x = b.home.x + b.leash + 40;
    b.spatial.enemy.y = b.home.y;
    b.spatial.player.x = b.spatial.enemy.x + 800;
    t.pveLogic.advance(.05);
    assert.equal(b.spatial.result, null, 'nobody won');
    assert.equal(b.ended, true);
    assert.equal(b.active, false);
    assert.equal(t.state.inventory.exp, exp, 'a disengage banks no exp');
    assert.equal(t.state.resources.gold, gold, 'a disengage banks no gold');
    assert.equal(t.state.player.currentHp, hp, 'the player keeps the HP they had');
    assert.equal(t.state.world.status, 'exploring', 'or every later encounter stays blocked');
    const monster = t.monster('b-goblin-1');
    assert.equal(monster.phase, 'return', 'hands the monster back walking home');
    assert.equal(monster.x, b.spatial.enemy.x);
    assert.equal(monster.alive, true, 'a disengage does not kill it');
});

test('a fight locks the region: chasers go home and nothing else can engage', () => {
    const t = setup();
    const wolf = t.monster('b-wolf-1');
    wolf.phase = 'chase';
    t.pveLogic.startEncounter('goblin', 'b-goblin-1');
    assert.equal(wolf.phase, 'return', 'a chaser is sent home at enlist');
    const id = t.state.pveBattle.battleId;
    // The region world must not advance for the duration of a fight, so a monster
    // parked inside its alert range neither picks a target nor drifts toward the
    // duel. Deliberately mechanism-agnostic: _beginFight deactivating the region
    // and _loop's own `pveBattle.active` guard each hold this on their own, and
    // this asserts the invariant rather than either implementation.
    const scene = t.adventureWorld.scene();
    wolf.x = scene.player.x + 120; wolf.y = scene.player.y; wolf.phase = 'idle';
    const parked = [wolf.x, wolf.y];
    t.frames(30);
    assert.equal(t.state.pveBattle.battleId, id, 'no second encounter while one is running');
    assert.equal(wolf.phase, 'idle', 'nothing picks a target while a fight is running');
    assert.deepEqual([wolf.x, wolf.y], parked, 'and nothing closes in on the duel');
});

test('a walking monster still aggros into a fight on contact', () => {
    const t = setup();
    const scene = t.adventureWorld.scene(), monster = t.monster('b-goblin-1');
    scene.player.x = monster.x; scene.player.y = monster.y;   // inside alertRange and encounterRange
    t.frames(2);
    assert.ok(t.state.pveBattle?.active, 'contact must start a fight');
    assert.equal(t.state.world.status, 'fighting');
});
