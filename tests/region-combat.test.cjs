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
    // rAF stays stubbed only because the scene-less fallback loop in pve_logic
    // still calls it. With a live region scene `_beginFight` deliberately starts
    // NO loop -- the page adapter owns the one rAF, and this harness drives it.
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
        uiAdventure: new Proxy({}, { get: () => () => {} }),
        fx: { log: new Proxy({}, { get: () => () => {} }) }
    });
    for (const file of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), c);
    const t = { c, ...vm.runInContext('({state,content,pveLogic,adventureWorld,spatialEngine,pveProfiles})', c) };
    t.pveLogic.setRandom(() => .5);
    // Entering a region builds its scene; startEncounter is guarded on status.
    vm.runInContext(`state.progress.currentRegionId = ${JSON.stringify(region)}`, c);
    vm.runInContext(`state.world.currentTab = 'adventure'`, c);
    t.adventureWorld.enter();
    vm.runInContext(`state.world.status = 'exploring'`, c);
    // One frame of the page adapter's single loop: the world always steps, and the
    // fight advances on top of it. `uiAdventure` is stubbed out here, so this is
    // the loop the adapter would be running, driven by hand.
    t.frames = (count, fps = 60) => {
        for (let i = 0; i < count; i++) {
            clock.t += 1000 / fps;
            t.adventureWorld.stepWorld(1 / fps);
            if (t.state.pveBattle?.active) t.pveLogic.advance(1 / fps);
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

test('a fight keeps the region alive without letting it start a second one', () => {
    const t = setup();
    const wolf = t.monster('b-wolf-1');
    wolf.phase = 'chase';
    t.pveLogic.startEncounter('goblin', 'b-goblin-1');
    assert.equal(wolf.phase, 'return', 'a chaser is sent home at enlist');
    const id = t.state.pveBattle.battleId;
    const scene = t.adventureWorld.scene();
    // The world keeps running under the fight -- that is the point of the merge --
    // so a monster parked inside its alert range has to be held off by the guard
    // in _updateMonsters, not by the region being frozen. Without it the fight
    // that just ended would chain straight into the next one.
    wolf.x = scene.player.x + 120; wolf.y = scene.player.y; wolf.phase = 'idle';
    const patrol = t.monster('b-orc-1'), patrolFrom = [patrol.x, patrol.y];
    t.frames(60);
    assert.equal(t.state.pveBattle.battleId, id, 'no second encounter while one is running');
    assert.equal(wolf.phase, 'idle', 'nothing picks a target while a fight is running');
    assert.notDeepEqual([patrol.x, patrol.y], patrolFrom, 'but the rest of the region keeps patrolling');
});

test('the region resumes engagement the moment the fight resolves', () => {
    const t = setup();
    t.pveLogic.startEncounter('goblin', 'b-goblin-1');
    const scene = t.adventureWorld.scene(), wolf = t.monster('b-wolf-1');
    wolf.x = scene.player.x + 120; wolf.y = scene.player.y; wolf.phase = 'idle';
    t.frames(10);
    assert.equal(wolf.phase, 'idle', 'held off while the fight runs');
    // Disengage: nobody wins, the region simply resumes where it left off.
    const b = t.state.pveBattle;
    b.spatial.enemy.x = b.home.x + b.leash + 40; b.spatial.enemy.y = b.home.y;
    b.spatial.player.x = b.spatial.enemy.x + 800;
    t.pveLogic.advance(.05);
    assert.equal(b.active, false);
    // Placed against where the region actually handed the player back, inside the
    // wolf's alert range (180) but well outside its encounter range (50).
    wolf.x = scene.player.x + 120; wolf.y = scene.player.y; wolf.phase = 'idle';
    t.frames(2);
    assert.equal(wolf.phase, 'chase', 'the guard is scoped to the fight, not a permanent freeze');
});

test('a walking monster still aggros into a fight on contact', () => {
    const t = setup();
    const scene = t.adventureWorld.scene(), monster = t.monster('b-goblin-1');
    scene.player.x = monster.x; scene.player.y = monster.y;   // inside alertRange and encounterRange
    t.frames(2);
    assert.ok(t.state.pveBattle?.active, 'contact must start a fight');
    assert.equal(t.state.world.status, 'fighting');
});

test('a victory banks its rewards and puts the walk straight back, with no screen', () => {
    const t = setup();
    const scene = t.adventureWorld.scene(), monster = t.monster('b-goblin-1');
    t.pveLogic.startEncounter('goblin', monster.id);
    const b = t.state.pveBattle, exp = t.state.inventory.exp, gold = t.state.resources.gold;
    // What the fight left behind: the player somewhere else, the enemy dead.
    b.spatial.player.x = scene.player.x + 40; b.spatial.player.y = scene.player.y + 25;
    b.enemy.hp = 0;
    t.pveLogic.advance(.01);

    assert.ok(t.state.inventory.exp > exp && t.state.resources.gold > gold, 'rewards bank on the spot');
    assert.equal(monster.alive, false);
    assert.equal(b.ended, true);
    assert.equal(b.active, false, 'nothing is left waiting for the player');
    assert.equal(t.state.world.status, 'exploring');
    // The region body is told where the fight actually ended, or the resume would
    // snap the walker back to where the encounter started.
    assert.deepEqual([scene.player.x, scene.player.y], [b.spatial.player.x, b.spatial.player.y]);
    // What replaced the result screen: a line in the region's own log, which
    // expires rather than becoming the region's permanent description.
    assert.match(scene.notice, /击败/);
    t.frames(7 * 60);
    assert.equal(scene.notice, '');
});

test('a defeated region monster comes back on the region clock', () => {
    const t = setup();
    const goblin = t.monster('b-goblin-1');
    // What a victory does to the map body (pveLogic._onVictory).
    t.adventureWorld.completeEncounter(goblin.id);
    assert.equal(goblin.alive, false);

    const delay = vm.runInContext('gameConfig.adventure.monsterRespawnSeconds', t.c);
    t.frames(Math.ceil((delay - 5) * 60));
    assert.equal(goblin.alive, false, 'still down before its timer elapses');

    // Just past the timer: alive, and standing on its post rather than wherever
    // it fell. (It walks off on patrol a moment later, hence the one-frame read.)
    t.frames(5 * 60 + 2);
    assert.equal(goblin.alive, true, 'back on the region clock');
    assert.equal(goblin.phase, 'idle');
    assert.ok(Math.hypot(goblin.x - goblin.home.x, goblin.y - goblin.home.y) < 1, 'revived at its post');
});

test('a defeated boss stays down: respawning is for the region, not for progress', () => {
    const t = setup({ region: 'c' });
    const boss = t.monster('c-elder-dragon');
    assert.ok(boss?.boss, 'region c authors a boss body');
    t.adventureWorld.completeEncounter(boss.id);
    t.state.progress.defeatedBosses[boss.enemyId] = true;
    t.frames(180 * 60);
    assert.equal(boss.alive, false);
});

test('the hot spring restores the walker and the body the region carries', () => {
    const t = setup({ region: 'a' });
    const scene = t.adventureWorld.scene();
    const spring = scene.structures.find(item => item.kind === 'hotSpring');
    assert.ok(spring, 'the safe region authors a hot spring');

    t.state.player.currentHp = 12;
    scene.field.player.hp = 12;
    scene.player.x = spring.x; scene.player.y = spring.y + 20;
    t.frames(1);
    assert.equal(scene.interaction?.kind, 'hotSpring', 'standing in reach is what arms the interact key');

    assert.equal(t.pveLogic.interact(), true);
    assert.equal(t.state.player.currentHp, vm.runInContext('player.getStats().maxHp', t.c));
    // The walking engine holds its own copy of the body: leaving it at 12 would
    // start the next fight from the old HP.
    assert.equal(scene.field.player.hp, scene.field.player.maxHp);
});

test('an unbuilt facility opens the build panel instead of its own', () => {
    const t = setup({ region: 'a' });
    const scene = t.adventureWorld.scene();
    const smithy = scene.structures.find(item => item.kind === 'smithy');
    // The stub `ui` carries only what pveLogic already called; the panel openers
    // are added here so the dispatch can be observed.
    vm.runInContext('var OPENED = []; ui.openBuildingModal = () => OPENED.push("build"); ui.openSmithyModal = () => OPENED.push("smithy");', t.c);

    t.state.base.buildings.smithy = 0;
    scene.player.x = smithy.x; scene.player.y = smithy.y + 20;
    t.frames(1);
    assert.equal(t.pveLogic.interact(), true);
    assert.deepEqual([...vm.runInContext('OPENED', t.c)], ['build'], 'nothing to walk into yet: the build panel is the only door');

    t.state.base.buildings.smithy = 1;
    t.pveLogic.interact();
    assert.deepEqual([...vm.runInContext('OPENED', t.c)], ['build', 'smithy']);
});
