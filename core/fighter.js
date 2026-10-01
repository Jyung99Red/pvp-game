// The player as a fighter: the move tree on A and B (pre-input, derive
// points, the pause line, the opening charge), the offhand (a shield for
// now), being struck, and moving between all of that. Rules carried over
// from the 2D version (tag v1-2d, pve/spatial_engine.js) with the input
// layer of controls-landscape-concept.md 4: A and B are separate keys, A or
// B start their move the moment they are pressed.
//
// State on sim.player:
//   act    the move under way: { move, phase: windup|charge|swing|recover,
//          t (seconds into the phase), facing, pressAt, share, stepTotal,
//          hit: [ids], from: { move, t } | null }
//   chain  the last finished swing, while its combo window is open:
//          { move, at (time the swing ended), cued }
//   buffer one input pressed ahead: { input: 'a' | 'b', at, age } (age
//          counts unfrozen time only, so a hitstop never eats into it)
//   combo  the inputs of the running combo, for display: 'a', 'b', '-'
//   guard  { state: down|raising|up, t, readyAt, bar, locked, queued }
//   stun, freeze (hitstop), push (knockback), bPress: { at, held, upAt }
//   down, downT  fallen (HP emptied where nobody is `endless`), and since when
const fighterKit = (() => {
    const K = () => gameConfig.combo, F = () => gameConfig.combat;
    const moveOf = id => gameConfig.combo.moves[id];
    const emit = (sim, type, data) => combatKit.emit(sim, type, { side: 'player', ...data });
    const approach = (value, target, rate) => target > value ? Math.min(target, value + rate) : Math.max(target, value - rate);

    // `endless`: an emptied HP bar refills (training) instead of falling.
    function init(p, { endless = true } = {}) {
        const S = F().fighters.player;
        return Object.assign(p, {
            id: 'player', side: 'player', hp: S.maxHp, maxHp: S.maxHp, atk: S.atk, def: S.def, endless,
            act: null, chain: null, buffer: null, combo: [], stun: 0, freeze: 0, push: null, bPress: null, down: false, downT: 0,
            guard: { state: 'down', t: 0, readyAt: -1, bar: F().guardBar.max, locked: false, queued: false }, guardBlend: 0
        });
    }
    // Everyone the player can hit: the training dummy and living monsters.
    function foes(sim) {
        const out = sim.dummy ? [sim.dummy] : [];
        for (const m of sim.monsters) if (monsterKit.living(m)) out.push(m);
        return out;
    }
    const obstacles = foes;
    // The player's body as judged now.
    function solve(sim) {
        const p = sim.player, rig = sim.rigs.player;
        return rigKit.solve(rig, playerAnim.pose(rig, p), space.toBlocks(p.x, p.y, p.h), space.yawOf(p.facing));
    }
    function hurtboxes(sim) { return combatKit.hurtboxes(sim.rigs.player, solve(sim)); }
    // Foes further than this from the player are not tested against a swing.
    const REACH = 240;

    // ---- the move tree ----
    function chainOpen(sim, at) {
        const c = sim.player.chain;
        return !!c && at - c.at <= moveOf(c.move).recovery + K().windowAfterRecovery + 1e-9;
    }
    // The move an input pressed at `at` starts. The node is the move under
    // way (pressed ahead, in its windup or swing) or the last finished one
    // while its window is open. An A past the pause line takes the node's
    // pause move; a node without one treats it as an ordinary A. An input
    // with no entry starts over from the root.
    function derive(sim, input, at) {
        const p = sim.player;
        let node = null, paused = false;
        if (p.act && (p.act.phase === 'windup' || p.act.phase === 'swing')) node = p.act.move;
        else if (chainOpen(sim, at)) {
            node = p.chain.move;
            paused = input === 'a' && at - p.chain.at >= moveOf(node).recovery + K().pauseAfterRecovery - 1e-9;
        }
        const next = node ? moveOf(node).next || {} : {};
        const id = paused ? next.pause ?? next.a : next[input];
        return id ? { id, derived: true, paused: paused && !!next.pause } : { id: K().root[input], derived: false, paused: false };
    }
    function startMove(sim, input, at) {
        const p = sim.player, d = derive(sim, input, at), prev = p.act;
        p.act = {
            move: d.id, phase: 'windup', t: 0, facing: p.facing, pressAt: at, share: 0, stepTotal: moveOf(d.id).step, hit: [],
            from: prev && prev.phase === 'recover' ? { move: prev.move, t: prev.t } : null
        };
        p.combo = d.derived ? [...p.combo, ...(d.paused ? ['-'] : []), input] : [input];
        p.chain = null; p.buffer = null;
        // Attacking stands the body still: a run is over.
        p.runBlend = 0; p.moveTime = 0;
        sim.stats.attacks++;
        emit(sim, 'attack', { move: d.id });
    }
    function pressAttack(sim, input) {
        const p = sim.player;
        // Shield up (or going up): A and B do nothing.
        if (p.guard.state !== 'down' || p.guard.queued) return false;
        if (p.act?.phase === 'charge') return false;
        // Pre-input: kept, never dropped; only the latest counts, and it runs
        // at the derive point, so pressing early never makes a move faster.
        if (p.act || p.stun > 0 || p.freeze > 0) { p.buffer = { input, at: sim.time, age: 0 }; return true; }
        startMove(sim, input, sim.time);
        return true;
    }
    // Charge held so far for the move started by the B press at `pressAt`.
    function chargeOf(sim, act) {
        const b = sim.player.bPress, C = F().charge;
        if (!b || b.at !== act.pressAt) return 0;
        return Math.min(C.full, (b.held ? sim.time : b.upAt) - b.at);
    }
    // `charged`: the swing comes out of a held charge. Let go before the
    // windup was over, it is the minimum charge (controls-landscape 4.2).
    function beginSwing(sim, charged = false) {
        const p = sim.player, a = p.act, m = moveOf(a.move), C = F().charge;
        if (m.charge) {
            a.share = charged ? Math.min(1, Math.max(0, (chargeOf(sim, a) - C.threshold) / (C.full - C.threshold))) : 0;
            a.stepTotal = m.step + (m.chargeStep || 0) * a.share;
        }
        // A charge can turn; the cut goes where the body faces now.
        a.facing = p.facing;
        a.phase = 'swing'; a.t = 0;
        emit(sim, 'swing', { move: a.move, heavy: m.knockback > 0 || m.stagger > 0 });
    }
    function endSwing(sim) {
        const p = sim.player, a = p.act;
        if (!a.hit.length) { sim.stats.misses++; emit(sim, 'miss', { move: a.move }); }
        a.phase = 'recover'; a.t = 0;
        p.chain = { move: a.move, at: sim.time, cued: false };
    }
    // The player's body at swing progress u, for sampling the sweep.
    function solveAt(sim, x0, y0, x1, y1, u0, u1) {
        const p = sim.player, rig = sim.rigs.player, a = p.act, m = moveOf(a.move);
        return u => {
            const k = u1 > u0 ? (u - u0) / (u1 - u0) : 1;
            const body = { ...p, act: { ...a, t: u * m.swing } };
            return rigKit.solve(rig, playerAnim.pose(rig, body), space.toBlocks(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, p.h), space.yawOf(a.facing));
        };
    }
    function swingStep(sim, dt) {
        const p = sim.player, a = p.act, m = moveOf(a.move);
        const u0 = a.t / m.swing;
        a.t = Math.min(m.swing, a.t + dt);
        const u1 = a.t / m.swing;
        // The lunge: forward along the locked facing, easing out.
        const lunge = u => a.stepTotal * (1 - (1 - u) * (1 - u));
        const x0 = p.x, y0 = p.y, want = lunge(u1) - lunge(u0);
        if (want > 0) terrainKit.moveCircle(sim.terrain, p, Math.cos(a.facing) * want, Math.sin(a.facing) * want, obstacles(sim));
        // Each foe within reach is hit at most once by a move, and never
        // across a wall.
        const targets = foes(sim).filter(f => !a.hit.includes(f.id) && Math.hypot(f.x - p.x, f.y - p.y) <= REACH && terrainKit.lineClear(sim.terrain, p.x, p.y, f.x, f.y))
            .map(f => ({ id: f.id, foe: f, boxes: combatKit.kitOf(f).hurtboxes(sim, f) }));
        if (targets.length) {
            for (const hit of combatKit.contacts(sim.rigs.player, solveAt(sim, x0, y0, p.x, p.y, u0, u1), u0, u1, targets)) {
                land(sim, hit, targets.find(t => t.id === hit.id).foe);
            }
        }
        if (a.t >= m.swing - 1e-9) endSwing(sim);
    }
    function land(sim, hit, foe) {
        const p = sim.player, a = p.act, m = moveOf(a.move);
        a.hit.push(hit.id);
        const amount = combatKit.defended(p.atk * (m.ratio + (m.chargeRatio || 0) * a.share), foe.def);
        sim.stats.hits++;
        emit(sim, 'hit', { target: foe.id, move: a.move, damage: amount, heavy: m.knockback > 0 || m.stagger > 0, at: hit.point });
        combatKit.kitOf(foe).struck(sim, foe, { amount, stagger: m.stagger });
        combatKit.impact(sim, foe, p, 'hit', m.knockback);
    }

    // ---- the offhand: what the key does depends on what is carried ----
    function raise(sim) {
        const p = sim.player, g = p.guard;
        g.queued = false; g.state = 'raising'; g.t = 0;
        p.chain = null; p.combo = []; p.buffer = null;
        p.runBlend = 0; p.moveTime = 0;
        emit(sim, 'guard_raise');
        combatKit.spendGuard(sim, p, F().guardBar.raiseCost);
    }
    const OFFHAND = {
        shield: {
            // It drops a charge at once. Any other move plays out whole --
            // windup, swing and recovery (user, 2026-10-01) -- and the
            // shield goes up as it ends; a stun is waited out the same way.
            press(sim) {
                const p = sim.player, g = p.guard;
                if (g.locked) { emit(sim, 'guard_locked'); return false; }
                if (g.state !== 'down' || g.queued) return false;
                if (p.act?.phase === 'charge') { p.act = null; emit(sim, 'charge_dropped'); }
                p.buffer = null;
                if (p.act || p.stun > 0) { g.queued = true; return true; }
                raise(sim);
                return true;
            },
            release(sim) {
                const g = sim.player.guard;
                g.queued = false;
                if (g.state !== 'down') { g.state = 'down'; emit(sim, 'guard_lower'); }
            },
            tick(sim, dt) {
                const p = sim.player, g = p.guard;
                if (g.state === 'raising') {
                    g.t += dt;
                    if (g.t >= F().guard.startup - 1e-9) { g.state = 'up'; g.readyAt = sim.time; }
                }
            }
        }
    };
    const offhandOf = p => OFFHAND[p.loadout.offhand] || null;

    function press(sim, button) {
        const p = sim.player;
        if (p.down) return false;
        if (button === 'b') p.bPress = { at: sim.time, held: true, upAt: null };
        if (button === 'a' || button === 'b') return pressAttack(sim, button);
        if (button === 'offhand') { const o = offhandOf(p); return o ? o.press(sim) : false; }
        return true; // interact: nothing to interact with yet
    }
    function release(sim, button) {
        const p = sim.player;
        if (p.down) return;
        if (button === 'b' && p.bPress?.held) {
            p.bPress.held = false; p.bPress.upAt = sim.time;
            // Letting go of a charge cuts.
            if (p.act?.phase === 'charge' && p.act.pressAt === p.bPress.at) beginSwing(sim, true);
        }
        if (button === 'offhand') offhandOf(p)?.release(sim);
    }

    // ---- being struck (called by combatKit.strikePlayer) ----
    // The HP bar emptied where the player can lose: down for good.
    function fall(sim) {
        const p = sim.player;
        if (p.down) return;
        Object.assign(p, { down: true, downT: 0, act: null, chain: null, combo: [], buffer: null, stun: 0, push: null, speed: 0, runBlend: 0, moveTime: 0 });
        p.guard.state = 'down'; p.guard.queued = false;
        emit(sim, 'down');
    }
    function struck(sim) {
        const p = sim.player;
        p.act = null; p.chain = null; p.combo = [];
        if (p.guard.state !== 'down') p.guard.state = 'down';
        // Still holding the shield key: it goes back up once the stun is over.
        p.guard.queued = sim.input.buttons.offhand.held && !!offhandOf(p) && !p.guard.locked;
        p.stun = F().hitStun;
        p.runBlend = 0; p.moveTime = 0;
    }

    // ---- moving ----
    function motion(sim, dt) {
        const P = gameConfig.player, p = sim.player, mv = sim.input.move, mag = Math.hypot(mv.x, mv.y), a = p.act;
        const guarding = p.guard.state !== 'down', charging = a?.phase === 'charge';
        let striding = false;
        p.speed = 0;
        if (mag > 1e-6 && !p.stun && (!a || charging)) {
            let speed = P.speed * Math.min(1, mag), turn = P.turnRate;
            if (guarding) { speed *= F().guard.moveMultiplier; turn *= F().guard.turnMultiplier; }
            else if (charging) { speed *= F().charge.moveMultiplier; turn *= F().charge.turnMultiplier; }
            else speed *= 1 + (P.runMultiplier - 1) * p.runBlend;
            const x0 = p.x, y0 = p.y;
            terrainKit.moveCircle(sim.terrain, p, mv.x / mag * speed * dt, mv.y / mag * speed * dt, obstacles(sim));
            const moved = Math.hypot(p.x - x0, p.y - y0);
            p.gait += moved / playerAnim.cycleLength(sim.rigs.player, p.runBlend);
            p.speed = moved / dt;
            p.facing = space.turn(p.facing, Math.atan2(mv.y, mv.x), turn * dt);
            // Walking off ends the combo.
            if (!a && moved > 1e-9) { p.chain = null; p.combo = []; }
            // An unbroken walk turns into a run: stick well pushed, free
            // walking (no shield, no charge), and really getting somewhere.
            striding = !guarding && !a && mag >= P.runStick - 1e-9 && moved >= 0.5 * P.speed * dt;
        } else if (mag > 1e-6 && a?.phase === 'recover') {
            // Inside a combo the stick only turns, and slower; the next move
            // goes where the fighter faces the moment it starts.
            p.facing = space.turn(p.facing, Math.atan2(mv.y, mv.x), P.turnRate * K().recoveryTurnMultiplier * dt);
        }
        p.moveTime = striding ? p.moveTime + dt : 0;
        p.runBlend = approach(p.runBlend, p.moveTime >= P.runAfter - 1e-9 ? 1 : 0, dt / P.runRampSeconds);
    }

    function tick(sim, dt) {
        const p = sim.player, B = gameConfig.animation.blendSeconds;
        if (p.down) { p.downT += dt; p.speed = 0; blends(p, dt, B); return; }
        // The guard bar runs on under the hitstop.
        combatKit.tickGuardBar(sim, p, dt);
        if (p.freeze > 0) { p.freeze = Math.max(0, p.freeze - dt); blends(p, dt, B); return; }
        // A buffered input expires, unless it is a B still held down: that is
        // an opening charge waiting for its turn, not a stale press.
        const b = p.buffer;
        if (b && (b.age += dt) > K().bufferSeconds + 1e-9 && !(b.input === 'b' && p.bPress?.held && p.bPress.at === b.at)) p.buffer = null;
        if (p.push) combatKit.tickPush(sim, p, dt, obstacles(sim));
        if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
        free(sim);
        offhandOf(p)?.tick(sim, dt);
        motion(sim, dt);
        tickAct(sim, dt);
        free(sim);
        // Crossing the pause line of a node that has a pause move is cued once.
        const c = p.chain;
        if (c && !p.act) {
            const m = moveOf(c.move);
            if (!chainOpen(sim, sim.time)) { p.chain = null; p.combo = []; }
            else if (m.next?.pause && !c.cued && sim.time - c.at >= m.recovery + K().pauseAfterRecovery - 1e-9) {
                c.cued = true; emit(sim, 'pause_ready', { move: m.next.pause });
            }
        }
        blends(p, dt, B);
    }
    // Free again (a move over, a stun over, a hitstop over) with something
    // waiting: a queued shield goes up, else a buffered input runs.
    function free(sim) {
        const p = sim.player;
        if (p.act || p.stun > 0) return;
        if (p.guard.queued) raise(sim);
        else if (p.buffer && p.guard.state === 'down') { const w = p.buffer; startMove(sim, w.input, w.at); }
    }
    function blends(p, dt, B) {
        p.moveBlend = approach(p.moveBlend, p.speed > 1e-6 ? 1 : 0, dt / B);
        const up = p.guard.state !== 'down';
        p.guardBlend = approach(p.guardBlend, up ? 1 : 0, dt / (up ? F().guard.startup : B));
    }
    function tickAct(sim, dt) {
        const p = sim.player, a = p.act;
        if (!a) return;
        const m = moveOf(a.move);
        if (a.phase === 'windup') {
            a.t += dt;
            if (a.t < m.windup - 1e-9) return;
            // Still holding the B that started a charging move: charge -- unless
            // the shield was pressed meanwhile, which drops the charge.
            if (m.charge && p.bPress?.held && p.bPress.at === a.pressAt) {
                if (p.guard.queued) { p.act = null; emit(sim, 'charge_dropped'); raise(sim); return; }
                a.phase = 'charge'; a.t = 0; emit(sim, 'charge'); return;
            }
            beginSwing(sim);
        } else if (a.phase === 'charge') {
            a.t += dt;
        } else if (a.phase === 'swing') {
            swingStep(sim, dt);
        } else {
            a.t += dt;
            // At the derive point a buffered input cuts the recovery short.
            if (m.derive != null && a.t >= m.derive - 1e-9 && p.buffer) { const b = p.buffer; startMove(sim, b.input, b.at); return; }
            if (a.t >= m.recovery - 1e-9) {
                p.act = null;
                if (p.buffer) { const b = p.buffer; startMove(sim, b.input, b.at); }
            }
        }
    }
    return { init, press, release, tick, struck, fall, foes, solve, hurtboxes, derive, chargeOf, OFFHAND };
})();
