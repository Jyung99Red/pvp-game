// Monsters (rebuild-plan.md M3): the goblin and the wolf, on the old
// minimal AI of the 2D version (tag v1-2d, pve/adventure_world.js and
// pve/spatial_engine.js): patrol round home, notice the player and stand
// alert a moment, chase, attack the moves in turn, enrage when low, walk
// home past the leash. Their blows hit by the same box test as the
// player's sword (3d-migration-concept.md 4.4); the wolf's leap rams with
// its whole body along its path. How far a move reaches, and the warning
// on the ground, are swept out of its key poses once (`reach`).
//
// A monster on sim.monsters: { id, kind, side: 'monster', x, y, h, facing,
//   radius, hp, maxHp, atk, def, home: { x, y }, phase, t, move (index of
//   the move under way), seq (moves started), wait, struck, stopped (a
//   leap that has met something), stagger, flinch, freeze, push, enraged,
//   patrolAt (angle of the next waypoint), rest, gait, speed, moveBlend }
// phase: patrol | alert | chase | windup | swing | recover | reel | return | dead
const monsterKit = (() => {
    const M = () => gameConfig.monsters, F = () => gameConfig.combat;
    const UNIT = () => gameConfig.world.unitsPerBlock;
    const MODELS = { goblin: () => goblinModel, wolf: () => wolfModel };
    const POSES = { goblin: () => goblinPoses, wolf: () => wolfPoses };
    const GEAR = { goblin: () => [goblinPoses.club()], wolf: () => [] };
    const emit = (sim, m, type, data) => combatKit.emit(sim, type, { side: 'monster', id: m.id, kind: m.kind, ...data });
    const clamp01 = v => Math.min(1, Math.max(0, v));
    const easeOut = t => 1 - (1 - t) * (1 - t);
    const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const smooth = t => t * t * (3 - 2 * t);
    const approach = (value, target, rate) => target > value ? Math.min(target, value + rate) : Math.max(target, value - rate);
    const configOf = kind => {
        const S = M()[kind];
        if (!S || !MODELS[kind]) throw new Error(`Unknown monster ${kind}`);
        return S;
    };
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const living = m => m.phase !== 'dead';
    // Distance walked by the monster being ticked, for its gait.
    let walked = 0;

    function rig(kind) { configOf(kind); return rigKit.build(MODELS[kind](), { equipment: GEAR[kind]() }); }
    function create(terrain, spawn, index) {
        const S = configOf(spawn.kind), at = terrainKit.cellCentre(terrain, spawn.col, spawn.row);
        return {
            id: `m${index}`, kind: spawn.kind, side: 'monster',
            x: at.x, y: at.y, h: space.groundHeight(at.x, at.y), facing: Math.PI / 2 + index * 1.3, radius: S.radius,
            hp: S.maxHp, maxHp: S.maxHp, atk: S.atk, def: S.def, home: { x: at.x, y: at.y },
            phase: 'patrol', t: 0, move: 0, seq: 0, wait: 0, struck: false, stopped: false,
            stagger: 0, flinch: 0, freeze: 0, push: null, enraged: false,
            patrolAt: index * 1.7, rest: 0.4 * index, gait: 0, speed: 0, moveBlend: 0
        };
    }

    // ---- the pose: a pure function of the monster's state ----
    const lunge = (move, u) => move.step * (1 - (1 - u) * (1 - u));
    // World units covered by one gait cycle (two steps): each leg swings
    // `amp` either side, so a planted foot travels 2 L sin(amp) a step.
    function cycleLength(kind) {
        const leg = POSES[kind]().walk.leg;
        return 4 * leg.length * Math.sin(leg.amp) * UNIT();
    }
    function locomotion(P, m) {
        const out = {}, phase = m.gait * Math.PI * 2;
        for (const [bone, channel, amp, offset] of P.walk.swing) (out[bone] || (out[bone] = {}))[channel] = amp * Math.sin(phase + offset) * m.moveBlend;
        return rigKit.add(P.idle, out);
    }
    // Lift or lower the whole body so its lowest box (any but the weapon)
    // rests on the ground.
    function grounded(rigData, pose) {
        const low = rigKit.lowest(rigData, rigKit.solve(rigData, pose), part => part.kind !== 'weapon');
        return rigKit.add(pose, { base: { py: -low / rigData.scale } });
    }
    function pose(rigData, m) {
        const P = POSES[m.kind](), S = configOf(m.kind), move = S.moves[m.move], K = move && P.moves[move.id];
        const walk = locomotion(P, m), B = gameConfig.animation.blendSeconds;
        let pose = walk, hop = 0;
        if (m.phase === 'alert') pose = rigKit.add(walk, rigKit.scale(P.alert, clamp01(Math.min(m.t, S.alertSeconds - m.t) / B)));
        else if (m.phase === 'windup') pose = rigKit.mix(walk, K.a, easeOut(clamp01(m.t / move.windup)));
        else if (m.phase === 'swing') {
            const u = clamp01(m.t / move.swing);
            pose = rigKit.mix(K.a, K.b, smooth(u));
            hop = (K.hop || 0) * Math.sin(Math.PI * u);
        } else if (m.phase === 'recover') pose = rigKit.mix(K.b, walk, easeInOut(clamp01(m.t / move.recovery)));
        else if (m.phase === 'reel') {
            pose = rigKit.add(rigKit.mix(walk, P.reel, clamp01(m.t / B)), { base: { rz: Math.sin(m.t * 9) * 0.07, ry: Math.sin(m.t * 6) * 0.1 } });
        } else if (m.phase === 'dead') pose = rigKit.mix(walk, P.dead, easeOut(clamp01(m.t / 0.45)));
        if (m.flinch > 0 && m.phase !== 'dead') pose = rigKit.add(pose, rigKit.scale(P.flinch, m.flinch / S.flinchSeconds));
        pose = grounded(rigData, pose);
        return hop ? rigKit.add(pose, { base: { py: hop } }) : pose;
    }
    function rigOf(sim, m) { return sim.rigs.monsters[m.kind]; }
    function solve(sim, m) { return rigKit.solve(rigOf(sim, m), pose(rigOf(sim, m), m), space.toBlocks(m.x, m.y, m.h), space.yawOf(m.facing)); }
    function hurtboxes(sim, m) { return combatKit.hurtboxes(rigOf(sim, m), solve(sim, m)); }
    // What strikes in a move, and how much it grows for the hit test.
    const striking = move => move.ram ? { kinds: ['body', 'weapon'], pad: 0 } : { kinds: ['weapon'], pad: F().weaponPad / UNIT() };

    // ---- reach, swept out of the key poses (3d-migration-concept.md 4.3, 4.4) ----
    // For move `index` of `kind`, in the monster's own frame (blocks, +z
    // ahead, standing at the origin): `hull`, the convex outline on the
    // ground of everything that strikes over the swing, lunge included (the
    // warning; wider rather than narrower); `forward`, in world units, how
    // far ahead of the monster's centre it reaches (when the AI attacks).
    const reaches = new Map();
    function reach(kind, index) {
        const key = `${kind}:${index}`;
        if (reaches.has(key)) return reaches.get(key);
        const S = configOf(kind), move = S.moves[index], r = rig(kind), { kinds, pad } = striking(move), points = [];
        let forward = 0;
        const N = 32;
        for (let k = 0; k <= N; k++) {
            const u = k / N, body = { kind, phase: 'swing', t: u * move.swing, move: index, flinch: 0, gait: 0, moveBlend: 0 };
            const solved = rigKit.solve(r, pose(r, body), [0, 0, lunge(move, u) / UNIT()], 0);
            for (const box of combatKit.attackBoxes(r, solved, kinds, pad)) {
                for (const c of math3d.corners(box)) { points.push([c[0], c[2]]); forward = Math.max(forward, c[2]); }
            }
        }
        const out = Object.freeze({ hull: Object.freeze(hull(points)), forward: forward * UNIT() });
        reaches.set(key, out);
        return out;
    }
    // Convex hull, counter-clockwise (Andrew's monotone chain).
    function hull(points) {
        const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lower = [], upper = [];
        for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
        for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
        return [...lower.slice(0, -1), ...upper.slice(0, -1)];
    }

    // ---- being hit (combatKit.kitOf) ----
    function struck(sim, m, { amount, stagger: points = 0 }) {
        if (!living(m)) return;
        combatKit.damage(sim, m, amount);
        if (m.hp <= 0) { defeat(sim, m); return; }
        const S = configOf(m.kind);
        m.flinch = S.flinchSeconds;
        if (!m.enraged && S.enrage && m.hp <= m.maxHp * S.enrage.threshold + 1e-9) { m.enraged = true; emit(sim, m, 'enrage', { at: chest(m) }); }
        // Struck before it noticed anyone: it fights back at once.
        if (['patrol', 'alert', 'return'].includes(m.phase)) { m.phase = 'chase'; m.t = 0; m.wait = S.firstDelay; }
        if (points > 0) stagger(sim, m, points);
    }
    function stagger(sim, m, amount) {
        const S = F().stagger;
        if (m.phase === 'reel') return;
        m.stagger += amount;
        if (m.stagger >= S.threshold - 1e-9) {
            m.stagger = 0; m.phase = 'reel'; m.t = 0; m.struck = false;
            emit(sim, m, 'stagger');
        }
    }
    function defeat(sim, m) {
        m.phase = 'dead'; m.t = 0; m.stagger = 0; m.flinch = 0; m.hp = 0;
        sim.stats.kills++;
        emit(sim, m, 'defeated', { at: chest(m) });
    }
    // About the middle of the body, in blocks, for effects.
    function chest(m) { const at = space.toBlocks(m.x, m.y, m.h); return [at[0], at[1] + 0.6, at[2]]; }

    // ---- moving ----
    // Bodies a monster cannot walk through: the player (unless fallen),
    // the training dummy, the other living monsters.
    function obstacles(sim, m) {
        const out = sim.player.down ? [] : [sim.player];
        if (sim.dummy) out.push(sim.dummy);
        for (const o of sim.monsters) if (o !== m && living(o)) out.push(o);
        return out;
    }
    function face(m, at, rate, dt) { m.facing = space.turn(m.facing, Math.atan2(at.y - m.y, at.x - m.x), rate * dt); }
    // Step towards (x, y) at `speed`; true once there.
    function walkTo(sim, m, x, y, speed, dt, turn = true) {
        const dx = x - m.x, dy = y - m.y, d = Math.hypot(dx, dy);
        if (d < 3) return true;
        const go = Math.min(d, speed * dt), x0 = m.x, y0 = m.y;
        terrainKit.moveCircle(sim.terrain, m, dx / d * go, dy / d * go, obstacles(sim, m));
        if (turn) face(m, { x, y }, configOf(m.kind).turnRate, dt);
        walked += Math.hypot(m.x - x0, m.y - y0);
        return false;
    }

    // ---- the AI, on the monster's own clock (dt is already times tempo) ----
    function think(sim, m, dt) {
        const S = configOf(m.kind), p = sim.player, d = distance(m, p), alive = !p.down;
        const next = m.seq % S.moves.length;
        switch (m.phase) {
            case 'patrol': {
                if (alive && d <= S.alertRange) { m.phase = 'alert'; m.t = 0; emit(sim, m, 'alert'); return; }
                if (m.rest > 0) { m.rest = Math.max(0, m.rest - dt); return; }
                const x = m.home.x + Math.cos(m.patrolAt) * S.patrolRadius, y = m.home.y + Math.sin(m.patrolAt) * S.patrolRadius;
                if (walkTo(sim, m, x, y, S.patrolSpeed, dt)) { m.patrolAt += 2.4; m.rest = S.patrolRest; }
                return;
            }
            case 'alert':
                face(m, p, S.turnRate, dt);
                m.t += dt;
                if (m.t >= S.alertSeconds - 1e-9) { m.phase = 'chase'; m.t = 0; m.wait = S.firstDelay; }
                return;
            case 'chase': {
                if (!alive || (distance(m, m.home) > S.leash && d > S.alertRange)) { m.phase = 'return'; m.t = 0; return; }
                m.wait = Math.max(0, m.wait - dt);
                const r = reach(m.kind, next).forward;
                face(m, p, S.turnRate, dt);
                if (m.wait === 0 && d <= r) {
                    m.move = next; m.phase = 'windup'; m.t = 0; m.struck = false; m.stopped = false;
                    emit(sim, m, 'windup', { move: S.moves[next].id });
                    return;
                }
                if (d > r * S.standOff) walkTo(sim, m, p.x, p.y, S.speed, dt, false);
                return;
            }
            case 'windup': {
                const move = S.moves[m.move];
                // It keeps turning to the player until `lock` before the swing.
                if (alive && m.t < move.windup - move.lock) face(m, p, S.trackTurn, dt);
                m.t += dt;
                if (m.t >= move.windup - 1e-9) { m.phase = 'swing'; m.t = 0; emit(sim, m, 'swing', { move: move.id, heavy: !!move.ram }); }
                return;
            }
            case 'swing': swingStep(sim, m, dt); return;
            case 'recover':
                m.t += dt;
                if (m.t >= S.moves[m.move].recovery - 1e-9) { m.phase = 'chase'; m.t = 0; m.wait = S.delay; m.seq++; }
                return;
            case 'reel':
                m.t += dt;
                if (m.t >= F().stagger.duration - 1e-9) { m.phase = 'chase'; m.t = 0; m.wait = S.delay; emit(sim, m, 'recovered'); }
                return;
            case 'return':
                if (walkTo(sim, m, m.home.x, m.home.y, S.speed, dt)) { m.phase = 'patrol'; m.t = 0; m.rest = S.patrolRest; }
                return;
        }
    }
    // The swing: lunge along the locked facing and sample the blow from the
    // last step to this one, the body's own movement included.
    function swingStep(sim, m, dt) {
        const S = configOf(m.kind), move = S.moves[m.move], r = rigOf(sim, m);
        const u0 = m.t / move.swing;
        m.t = Math.min(move.swing, m.t + dt);
        const u1 = m.t / move.swing;
        const x0 = m.x, y0 = m.y, want = m.stopped ? 0 : lunge(move, u1) - lunge(move, u0);
        if (want > 0) terrainKit.moveCircle(sim.terrain, m, Math.cos(m.facing) * want, Math.sin(m.facing) * want, obstacles(sim, m));
        const p = sim.player;
        if (!m.struck && !p.down && terrainKit.lineClear(sim.terrain, m.x, m.y, p.x, p.y)) {
            const x1 = m.x, y1 = m.y;
            const at = u => {
                const k = u1 > u0 ? (u - u0) / (u1 - u0) : 1;
                return rigKit.solve(r, pose(r, { ...m, t: u * move.swing }), space.toBlocks(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, m.h), space.yawOf(m.facing));
            };
            const hit = combatKit.sweep(r, at, u0, u1, [{ id: 'player', boxes: fighterKit.hurtboxes(sim) }], striking(move));
            if (hit) {
                m.struck = true; m.stopped = true;
                combatKit.strikePlayer(sim, m, m.atk * move.ratio * (m.enraged ? S.enrage.atk : 1), hit.point, move.id);
            }
        }
        if (m.phase === 'swing' && m.t >= move.swing - 1e-9) { m.phase = 'recover'; m.t = 0; }
    }

    function tickOne(sim, m, dt) {
        if (m.push) combatKit.tickPush(sim, m, dt, living(m) ? obstacles(sim, m) : []);
        if (!living(m)) { m.t += dt; m.moveBlend = approach(m.moveBlend, 0, dt / gameConfig.animation.blendSeconds); return; }
        if (m.flinch > 0) m.flinch = Math.max(0, m.flinch - dt);
        if (m.freeze > 0) { m.freeze = Math.max(0, m.freeze - dt); return; }
        const S = configOf(m.kind), tempo = m.enraged ? S.enrage.tempo : 1;
        walked = 0;
        think(sim, m, dt * tempo);
        m.gait += walked / cycleLength(m.kind);
        m.speed = walked / dt;
        m.moveBlend = approach(m.moveBlend, walked > 1e-6 ? 1 : 0, dt / gameConfig.animation.blendSeconds);
        m.h = space.groundHeight(m.x, m.y);
    }
    function tick(sim, dt) { for (const m of sim.monsters) tickOne(sim, m, dt); }
    return { rig, create, pose, solve, hurtboxes, struck, stagger, reach, cycleLength, tick, living };
})();
