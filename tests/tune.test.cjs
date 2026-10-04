// The move tuner's workbench (tune/lab.js, the page is tune.html): what it
// writes out pastes straight back into the files, editing never leaks
// from one key into another, its checks agree with tests/hits.test.cjs, and
// its combos are played by the real move tree with the real timing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { load, read } = require('./load.cjs');

// The game's scripts plus the workbench in one context. `unfrozen`: as on
// the tuner's page, the config table can be changed.
// `edit(g)` changes the files' data first, as if the code had been edited
// since a draft was made.
function workbench({ unfrozen = true, edit = null } = {}) {
    const g = load({ globals: unfrozen ? { unfrozenConfig: true } : {} });
    if (edit) edit(g);
    vm.runInContext(read('tune/lab.js'), g.context, { filename: 'tune/lab.js' });
    return g;
}
const SOURCE = { moves: read('models/player_moves.js'), config: read('game_config.js') };
// A key as `key(...)` would build it from the text written out.
const evaluate = (g, text) => vm.runInContext(`(() => { const key = pose => ({ ...playerMoves.shieldArm, ...pose }); return ${text}; })()`, g.context);
const keysOf = (g, source) => evaluate(g, `({ ${source.trim().replace(/,$/, '')} })`);

test('what it writes out is the files\' own text: every move\'s keys and every move\'s line of timing', () => {
    const g = workbench(), L = g.moveLab;
    for (const id of Object.keys(g.playerMoves.moves)) {
        assert.ok(SOURCE.moves.includes(L.moveSource(id).replace(/,$/, '')), `models/player_moves.js has ${id} as written out`);
        assert.ok(SOURCE.config.includes(L.timingSource(id).replace(/,$/, '')), `game_config.js has ${id}'s line as written out`);
    }
    // The other poses come back to the same values.
    for (const id of Object.keys(L.POSES)) assert.ok(L.samePose(evaluate(g, L.poseSource(id).trim().replace(/^\w+: /, '').replace(/,$/, '')), L.poseOf(id)), id);
    assert.equal(L.changesSource(), '', 'nothing changed yet');
});

test('an edit stays in its key: the shield arm other keys share is untouched, and the text written out builds the edited key', () => {
    const g = workbench(), L = g.moveLab, M = g.playerMoves;
    const arm = JSON.stringify(M.shieldArm), slashArm = JSON.stringify(M.moves.slash.a.upperArmL);
    L.set('thrust.a', 'upperArmL', 'rx', -1.2);
    L.set('slash.b', 'forearmL', 'rx', 0);
    L.set('smite.a', 'handR', 'rx', 2.2);
    L.set('stance', 'chest', 'rx', 0.1);
    assert.equal(JSON.stringify(M.shieldArm), arm);
    assert.equal(JSON.stringify(M.moves.slash.a.upperArmL), slashArm);
    assert.ok(L.changed('thrust.a') && L.changed('slash.b') && L.changed('smite.a') && L.changed('stance') && !L.changed('slash.a'));
    // The left forearm at rest in slash.b is written out empty, so `key` does not put the shield arm back.
    for (const id of ['thrust', 'slash', 'smite']) {
        const built = keysOf(g, L.moveSource(id))[id];
        for (const k of ['a', 'b']) assert.ok(L.samePose(built[k], M.moves[id][k]), `${id}.${k} rebuilt from its text`);
    }
    assert.match(L.moveSource('slash'), /forearmL: \{\}/);
    // A draft carries the edits over to a fresh page; reverting brings the files back.
    const draft = JSON.parse(JSON.stringify(L.draft()));
    assert.deepEqual(Object.keys(draft.poses).sort(), ['slash.b', 'smite.a', 'stance', 'thrust.a']);
    const fresh = workbench();
    fresh.moveLab.apply(draft);
    for (const t of Object.keys(draft.poses)) assert.ok(L.samePose(fresh.moveLab.poseOf(t), L.poseOf(t)), t);
    L.revertAll();
    assert.equal(L.changesSource(), '');
    assert.ok(L.samePose(M.moves.smite.a, L.original('smite.a')));
});

test('a draft meets the files as they are now: what was written back drops out, what the code changed since is the code\'s unless forced', () => {
    const before = workbench(), L = before.moveLab;
    L.set('slash.a', 'handR', 'rx', 1.5);
    L.set('cleave.b', 'chest', 'rx', 0.5);
    L.set('stance', 'head', 'rx', 0.2);
    L.setTiming('smite', 'swing', 0.3);
    L.setTiming('cut', 'windup', 0.2);
    const draft = JSON.parse(JSON.stringify(L.draft()));
    // Since then the code took slash.a and smite's swing as tuned (written
    // back), and changed cleave.b and cut's timing some other way.
    const after = workbench({
        edit: g => {
            const M = g.playerMoves.moves, C = g.gameConfig.combo.moves;
            M.slash.a.handR = { ...M.slash.a.handR, rx: 1.5 };
            M.cleave.b.chest = { ...M.cleave.b.chest, rx: 0.1 };
            C.smite.swing = 0.3;
            C.cut.recovery = 0.4;
        }
    });
    const A = after.moveLab, M = after.playerMoves.moves, report = A.apply(draft);
    assert.deepEqual([...report.done].sort(), ['slash.a', 'smite.timing']);
    assert.deepEqual([...report.stale].sort(), ['cleave.b', 'cut.timing']);
    assert.deepEqual([...report.applied], ['stance']);
    assert.equal(M.cleave.b.chest.rx, 0.1, 'the code\'s new value is shown');
    assert.equal(after.gameConfig.combo.moves.cut.windup, 0.1);
    assert.equal(after.playerPoses.stance.head.rx, 0.2, 'what the code left alone is the draft\'s');
    assert.deepEqual(Object.keys(A.draft().poses), ['stance'], 'written back: gone from the draft');
    // Asked for, the old draft goes in anyway.
    A.apply(report.leftover, { force: true });
    assert.equal(M.cleave.b.chest.rx, 0.5);
    assert.equal(after.gameConfig.combo.moves.cut.windup, 0.2);
    // A draft from before `base` was kept still goes in.
    const old = workbench().moveLab;
    old.apply({ poses: { 'slash.a': draft.poses['slash.a'].pose } });
    assert.ok(old.changed('slash.a'));
});

test('timing is changed only where the config is unfrozen (the tuner\'s page), and the preview follows it', () => {
    const frozen = workbench({ unfrozen: false }).moveLab;
    assert.equal(frozen.timingEditable(), false);
    assert.throws(() => frozen.setTiming('slash', 'windup', 0.2));
    const g = workbench(), L = g.moveLab, m = g.gameConfig.combo.moves.slash, before = L.single('slash').duration;
    L.setTiming('slash', 'windup', m.windup + 0.1);
    assert.ok(Math.abs(L.single('slash').duration - before - 0.1) < 1e-9);
    // The derive point stays within the recovery.
    L.setTiming('slash', 'recovery', 0.1);
    assert.equal(m.derive, 0.1);
    assert.match(L.changesSource(), /slash: \{ weapon: 'sword', name: '斜斩', windup: 0\.23, swing: 0\.10, recovery: 0\.10, derive: 0\.10,/);
    L.revertMove('slash');
    assert.equal(L.timingChanged('slash'), false);
});

test('its checks are the hit tests\': every move lands on the dummy and on a person at the standard distance, none at 140', () => {
    const g = workbench(), L = g.moveLab;
    for (const id of Object.keys(g.gameConfig.combo.moves)) {
        const m = L.measure(id);
        assert.ok(m.landsDummy && m.landsPlayer, `${id} lands at ${m.standard}`);
        assert.equal(m.tooFar, false, `${id} does not reach ${L.TOO_FAR}`);
        assert.ok(m.reach >= m.standard && m.reach < L.TOO_FAR, `${id} reaches ${m.reach}`);
        assert.ok(m.sweep > 0 && m.path.length === 41);
    }
    // The sword's cuts stay off the ground (tests/hits.test.cjs).
    for (const id of ['slash', 'backslash', 'smite', 'charged']) assert.ok(L.measure(id, { quick: true }).lowest > 0.3, id);
});

test('combos: every move of a weapon is on some route; the real tree plays them, chained at the derive point', () => {
    const g = workbench(), L = g.moveLab, M = g.gameConfig.combo.moves;
    for (const type of L.weaponTypes()) {
        const routes = L.routes(type), seen = new Set(routes.flatMap(r => r.moves));
        assert.deepEqual([...seen].sort(), [...L.movesOf(type)].sort(), `${type}: routes cover the tree`);
        for (const r of routes) assert.equal(M[r.moves.at(-1)].next, undefined, `${r.label} ends on a finisher`);
    }
    assert.deepEqual([...L.follow('sword', ['a', 'a', 'p'])], ['slash', 'backslash', 'thrust']);
    assert.equal(L.follow('sword', ['p']), null);
    assert.deepEqual([...L.nextInputs('sword', ['a', 'a'])], ['a', 'b', 'p']);

    const aaa = L.combo('sword', ['a', 'a', 'a']);
    assert.deepEqual([...aaa.occs.map(o => o.move)], ['slash', 'backslash', 'smite']);
    const seg = (occ, phase) => aaa.segments.find(s => s.occ === occ && s.phase === phase);
    assert.ok(Math.abs(seg(1, 'windup').start - seg(0, 'swing').end - M.slash.derive) < 0.011, 'backslash at slash\'s derive point');
    assert.ok(Math.abs(seg(2, 'windup').start - seg(1, 'swing').end - M.backslash.derive) < 0.011, 'smite at backslash\'s derive point');
    assert.deepEqual([...aaa.hits.map(h => h.move)], ['slash', 'backslash', 'smite'], 'each lands on the dummy at the standard distance');
    // Its keys are the moments the poses are reached: a as the windup ends, b as the swing ends.
    const at = aaa.stateAt(aaa.keys['backslash.a']).body.act;
    assert.deepEqual([at.move, at.phase, at.t], ['backslash', 'swing', 0]);

    // After the pause line an A takes the pause move.
    const paused = L.combo('sword', ['a', 'a', 'p']), w = paused.segments.find(s => s.move === 'thrust' && s.phase === 'windup');
    const swingEnd = paused.segments.find(s => s.move === 'backslash' && s.phase === 'swing').end;
    assert.ok(w.start - swingEnd >= M.backslash.recovery + g.gameConfig.combo.weapons.sword.pauseAfterRecovery - 1e-9);
    // The opening B held past its windup charges.
    const charged = L.combo('sword', ['b', 'a'], { hold: 1.2 });
    assert.ok(charged.segments.some(s => s.move === 'charged' && s.phase === 'charge'));
    assert.deepEqual([...charged.occs.map(o => o.move)], ['charged', 'follow']);
    // Without the dummy nothing is hit.
    assert.equal(L.combo('dagger', ['a', 'a', 'a', 'a', 'a'], { target: false }).hits.length, 0);
});

test('one move from the stance, and the other poses, each reach their key', () => {
    const g = workbench(), L = g.moveLab;
    const one = L.single('smite');
    assert.equal(one.stateAt(one.keys['smite.a']).body.act.phase, 'swing');
    assert.equal(one.stateAt(one.keys['smite.b']).body.act.phase, 'recover');
    assert.equal(one.hits.length, 1);
    assert.ok(one.stateAt(one.keys['smite.b']).x === g.gameConfig.combo.moves.smite.step);
    const guard = L.pose('guard');
    assert.equal(guard.stateAt(guard.keys.guard).body.guardBlend, 1);
    assert.equal(guard.loadout.offhand, 'wooden_shield');
    assert.equal(L.pose('guardWeapon').loadout.offhand, null);
    const down = L.pose('down');
    assert.equal(down.stateAt(down.keys.down).body.down, true);
});
