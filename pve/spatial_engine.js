// Deterministic spatial battle. No DOM, saves, timers, or presentation state.
// Call step(seconds), and feed pointer offsets in CSS pixels to the input API.
const spatialEngine = (() => {
    const C = spatialData.baseCombatPreset;
    const S = spatialCombat;
    function validate(C) {
        const positive = v => Number.isFinite(v) && v > 0;
        if (![C.width, C.height, C.fullCharge, C.guardMax ?? gameConfig.guardBar.max].every(positive)) throw new Error('Invalid arena or combat limits');
        if (C.walls && (!Array.isArray(C.walls) || C.walls.some(w => !w || ![w.x, w.y, w.width, w.height].every(Number.isFinite) ||
            w.width <= 0 || w.height <= 0 || w.x < 0 || w.y < 0 || w.x + w.width > C.width || w.y + w.height > C.height))) throw new Error('Invalid arena walls');
        const nonnegative = v => Number.isFinite(v) && v >= 0;
        if (![C.playerTurn ?? gameConfig.combatBase.playerTurn, C.chargeMoveMultiplier ?? gameConfig.combatBase.chargeMoveMultiplier, C.chargeTurnMultiplier ?? gameConfig.combatBase.chargeTurnMultiplier, C.guardMoveMultiplier ?? gameConfig.combatBase.guardMoveMultiplier, C.guardTurnMultiplier ?? gameConfig.combatBase.guardTurnMultiplier, ...Object.values(C.motion || {})].every(nonnegative)) throw new Error('Invalid motion modifiers');
        validateCombo(C.combo);
        if (!nonnegative(C.atk)) throw new Error('Invalid attack');
        if (![C.guardStartup, C.parryWindow, C.spRegen, C.skillPointMax, C.hitStun, C.playerSpeed, C.blockMultiplier, C.parryDamage].every(nonnegative) ||
            !positive(C.moveRamp) || !positive(C.stagger.threshold) || !nonnegative(C.stagger.duration)) throw new Error('Invalid combat parameters');
        if (C.formal && !C.pvp && !C.solo && (!C.actions?.length || ![C.critChance, C.guardThorns, C.enemyApRegen].every(nonnegative) ||
            !positive(C.enemyApMax) || !nonnegative(C.chargeThreshold) || C.fullCharge < C.chargeThreshold + gameConfig.damage.fullChargeAfterThreshold - 1e-9)) throw new Error('Invalid profile');
        if (!Object.values(C.ai).every(nonnegative)) throw new Error('Invalid AI timing');
        for (const a of C.actions || [C.sweep, C.stomp]) {
            if (!a || !['sector', 'circle', 'dash'].includes(a.kind) || !positive(a.range) ||
                (a.kind === 'sector' && (!positive(a.arc) || a.arc > Math.PI * 2)) ||
                ![a.windup, a.recovery, a.damage].every(v => Number.isFinite(v) && v >= 0) ||
                (a.active != null && !nonnegative(a.active)) ||
                (a.dash && (![a.dash.distance, a.dash.speed, a.dash.width].every(positive))) ||
                (a.lock != null && (!Number.isFinite(a.lock) || a.lock < 0 || a.lock > a.windup))) throw new Error('Invalid spatial action');
        }
        // A solo preset walks one actor around a region: no enemy to validate.
        for (const body of C.solo ? [C.player] : [C.player, C.enemy]) {
            if (![body.x, body.y, body.facing].every(Number.isFinite) || !positive(body.radius) || !positive(body.maxHp) ||
                !Number.isFinite(body.hp) || body.hp < 0 || body.hp > body.maxHp ||
                body.x < body.radius || body.x > C.width - body.radius || body.y < body.radius || body.y > C.height - body.radius) throw new Error('Invalid spawn');
        }
        // An overlapping pair is deliberately NOT rejected here: a fight can
        // legitimately start exactly where two bodies already stand. create()
        // separates them on its own copy -- see below.
    }
    const INPUTS = ['tap', 'hold', 'pause'];
    function validateCombo(K) {
        const positive = v => Number.isFinite(v) && v > 0, nonnegative = v => Number.isFinite(v) && v >= 0;
        if (!K?.moves || !K.root || !K.moves[K.root.tap] || !K.moves[K.root.hold]) throw new Error('Invalid combo root');
        if (!positive(K.pauseAfterRecovery) || !(K.windowAfterRecovery > K.pauseAfterRecovery) || !positive(K.bufferSeconds) || !positive(K.poiseSeconds)) throw new Error('Invalid combo window');
        for (const m of Object.values(K.moves)) {
            if (!m || m.kind !== 'sector' || !positive(m.range) || !positive(m.arc) || m.arc > Math.PI * 2 + 1e-9 || ![1, -1].includes(m.sweep) ||
                !nonnegative(m.windup) || !positive(m.swing) || !positive(m.recovery) ||
                (m.derive != null && (!positive(m.derive) || m.derive > m.recovery)) ||
                !nonnegative(m.ratio) || !nonnegative(m.stagger) || (m.chargeRatio != null && !nonnegative(m.chargeRatio)) ||
                (m.minRange != null && (!positive(m.minRange) || m.minRange > m.range)) ||
                (m.minArc != null && (!positive(m.minArc) || m.minArc > m.arc)) ||
                Object.entries(m.next || {}).some(([input, id]) => !INPUTS.includes(input) || !K.moves[id])) throw new Error('Invalid combo move');
        }
        const charged = K.moves[K.root.hold];
        if (charged.minRange == null || charged.minArc == null || charged.chargeRatio == null) throw new Error('Invalid charge sector');
    }
    function create(config = C, random = Math.random) {
        validate(config);
        const C = JSON.parse(JSON.stringify(config));
        // Bodies that start touching are pushed apart rather than refused; only
        // an arena with no room for both is an error. Done on the clone, so
        // validating a caller's config never moves their actors -- b.player and
        // b.enemy below are the authoritative post-separation positions.
        if (!C.solo && !S.separate(C.player, C.enemy, C, C.walls || [])) throw new Error('Overlapping spawns');
        C.guardMax ??= gameConfig.guardBar.max;
        C.skills = spatialData.skillRules(C.skillMode || (C.pvp ? 'fair' : 'pve'), C.skillOverrides || {});
        return {
            config: C, random, buffs: { chargeHasteUntil: 0, instantCharge: false, autoParry: 0 }, apRateMult: 1,
            time: 0, elapsed: 0, running: false, started: false, result: null,
            skillPoints: Math.max(0, Math.min(C.skillPointMax ?? gameConfig.combatBase.skillPointMax, C.skillPoints ?? 0)), skillProgress: C.skillProgress ?? 0,
            player: { ...C.player, guardBar: C.guardMax, guardLocked: false, phase: 'idle', timer: 0, charge: 0, chain: null },
            enemy: C.solo ? null : { ...C.enemy, phase: 'approach', timer: C.ai.initialDelay, sequence: 0, stagger: 0 },
            controls: { ...gameConfig.controls, ...C.controls },
            move: null, action: null, guard: null, skill: null, queuedCommand: null, motionBuffs: [], events: [], inputVersion: 0, actionInputVersion: 0,
            stats: { attacks: 0, hits: 0, misses: 0, dodges: 0, blocks: 0, parries: 0, cancels: 0 }
        };
    }
    function emit(b, type, data = {}) {
        b.events.push({ type, time: b.time, ...data }); }
    function drainEvents(b) {
        return b.events.splice(0); }
    function dispatch(b, command) {
        const C = b.config;
        if (!canAct(b) || !command) return false;
        const p = b.player;
        if (command.type === 'charge' && p.phase === 'idle' && b.action?.mode === 'charge') {
            p.phase = 'charging'; p.charge = Math.min(C.fullCharge, b.time - b.action.start);
            p.chargeUpdatedAt = b.time;
            if (b.buffs.instantCharge) { p.charge = C.fullCharge; b.buffs.instantCharge = false; }
            return true;
        }
        if (command.type === 'light' && p.phase === 'idle' && b.move?.mode === 'pending' && !b.guard && !b.action) {
            attack(b, derive(b, 'tap', b.move.start)); return true;
        }
        if (command.type === 'heavy' && p.phase === 'charging' && b.action?.mode === 'charge') { attack(b, C.combo.root.hold); return true; }
        return false;
    }
    function canAct(b) {
        return b.running && !b.result; }
    function start(b) {
        if (!b.result) { b.started = true; b.running = true; } }
    function locked(b) { return ['attack', 'swing', 'recover', 'stunned'].includes(b.player.phase); }
    // In the middle of a move of one's own: windup, swing or recovery.
    function inMove(b) { return ['attack', 'swing', 'recover'].includes(b.player.phase); }
    function moveOf(b, id) { return b.config.combo.moves[id]; }
    // The chain stays open through the recovery and windowAfterRecovery past it.
    function chainOpen(b, at = b.time) {
        const c = b.player.chain;
        return !!c && at - c.at <= moveOf(b, c.move).recovery + b.config.combo.windowAfterRecovery + 1e-9;
    }
    // What the chain derives for an input pressed at `pressedAt`, or null. The
    // node is the move under way (an input pressed ahead, during its windup or
    // swing) or the finished one while its window is open. A tap pressed past
    // the pause line takes the pause derivation; a node without one treats it
    // as an ordinary tap, so pausing never costs a move. A pause only changes
    // taps: a hold is the node's hold either way.
    function chainNext(b, input, pressedAt = b.time) {
        const K = b.config.combo, p = b.player;
        let m, paused = false;
        if (['attack', 'swing'].includes(p.phase) && p.attack) m = moveOf(b, p.attack.move);
        else if (chainOpen(b, pressedAt)) {
            m = moveOf(b, p.chain.move);
            paused = input === 'tap' && pressedAt - p.chain.at >= m.recovery + K.pauseAfterRecovery - 1e-9;
        } else return null;
        const next = m.next || {};
        return (paused ? next.pause ?? next.tap : next[input]) || null;
    }
    // The move an input starts: the chain's derivation, else the root.
    function derive(b, input, pressedAt = b.time) { return chainNext(b, input, pressedAt) ?? b.config.combo.root[input]; }
    // One replaceable next command: taps never accumulate into an attack backlog.
    function flushQueue(b) {
        if (b.player.phase !== 'idle' || !b.queuedCommand) return;
        const q = b.queuedCommand, p = b.player; b.queuedCommand = null;
        if (q.type === 'input' && b.action === q.gesture) {
            b.action.queued = false;
            if (b.action.mode === 'charge' && !dispatch(b, { type: 'charge' })) b.action.mode = 'blocked';
        } else if (q.type === 'guard' && b.guard === q.gesture) {
            if (p.guardLocked) { b.guard = null; emit(b, 'guard_locked'); }
            else raiseGuard(b);
        } else if (q.type === 'tap') attack(b, derive(b, 'tap', q.at));
        else if (q.type === 'skill') emit(b, 'skill_ready', { kind: q.kind });
        else if (q.type === 'heavy') {
            p.charge = q.charge; p.facing = q.facing;
            if (b.buffs.instantCharge) { p.charge = b.config.fullCharge; b.buffs.instantCharge = false; }
            attack(b, b.config.combo.root.hold);
        }
    }
    // At the derive point a buffered input cuts the rest of the recovery short:
    // a tap, or a hold released after its threshold, starts its move; a hold
    // still held poises. A thumb still down but not yet a tap or a hold waits;
    // the recovery goes on.
    function deriveNow(b) {
        const p = b.player, q = b.queuedCommand, m = p.attack && moveOf(b, p.attack.move);
        if (m?.derive == null || m.recovery - p.timer < m.derive - 1e-9) return false;
        if (q?.type === 'tap') { b.queuedCommand = null; attack(b, derive(b, 'tap', q.at)); return true; }
        if (q?.type === 'hold') { b.queuedCommand = null; attack(b, q.move); return true; }
        if (b.move?.mode === 'hold') { poise(b); return true; }
        return false;
    }
    // A decided mid-combo hold: a turn-only stance. The move fires when the
    // thumb lifts, or by itself once the stance has lasted poiseSeconds.
    function poise(b) {
        const p = b.player;
        b.queuedCommand = null; p.phase = 'poise'; p.timer = b.config.combo.poiseSeconds;
    }
    function firePoise(b) {
        const g = b.move;
        if (g?.mode !== 'hold') { b.player.phase = 'idle'; return; }
        g.mode = 'move'; g.suppressTap = true; // spent: lifting the thumb now does nothing
        attack(b, g.derived);
    }
    // The opening hold's sector grows with charge from minRange/minArc.
    function heavyShape(b, charge = b.player.charge) {
        const a = b.config.combo.moves[b.config.combo.root.hold], t = S.clamp(charge / b.config.fullCharge, 0, 1);
        return { kind: 'sector', range: a.minRange + (a.range - a.minRange) * t, arc: a.minArc + (a.arc - a.minArc) * t };
    }
    // Damage share of the charge: 0 at the weapon threshold, 1 at full charge.
    function chargeShare(b, charge) {
        const C = b.config;
        return C.chargeThreshold != null ? S.clamp((charge - C.chargeThreshold) / (C.fullCharge - C.chargeThreshold), 0, 1) : S.clamp(charge / C.fullCharge, 0, 1);
    }
    // Equipment feeds config.motion; temporary buffs use these same independent multipliers.
    function setMotionBuff(b, id, multipliers, seconds) {
        if (!id || !multipliers || !Number.isFinite(seconds) || seconds <= 0) return false;
        const values = {};
        for (const key of ['move', 'turn', 'chargeMove', 'chargeTurn']) {
            const value = multipliers[key] ?? 1;
            if (!Number.isFinite(value) || value < 0) return false;
            values[key] = value;
        }
        b.motionBuffs = b.motionBuffs.filter(buff => buff.id !== id);
        b.motionBuffs.push({ id, ...values, until: b.time + seconds }); return true;
    }
    function motion(b, key) {
        // Haste boosts movement in every stance, but its turn bonus excludes charging.
        const haste = b.time < b.buffs.chargeHasteUntil;
        const hasteRule = b.config.skills?.haste || {};
        const skill = haste && key === 'move' ? (hasteRule.moveMultiplier ?? gameConfig.skills.haste.moveMultiplier) :
            haste && key === 'turn' && b.player.phase !== 'charging' ? (hasteRule.turnMultiplier ?? gameConfig.skills.haste.turnMultiplier) : 1;
        return skill * (b.config.motion?.[key] ?? 1) * b.motionBuffs.reduce((value, buff) => value * (buff.until > b.time ? buff[key] : 1), 1);
    }
    function movePlayer(b, dx, dy, dt, charging = false) {
        const C = b.config, p = b.player, len = Math.hypot(dx, dy);
        const deadZone = combatGestures.config.deadZone;
        if (len <= deadZone) return;
        const slow = charging ? (C.chargeMoveMultiplier ?? gameConfig.combatBase.chargeMoveMultiplier) * motion(b, 'chargeMove') : ['guard_start', 'guard'].includes(p.phase) ? (C.guardMoveMultiplier ?? gameConfig.combatBase.guardMoveMultiplier) : 1;
        const speed = C.playerSpeed * motion(b, 'move') * slow * Math.min(1, (len - deadZone) / C.moveRamp);
        S.move(p, dx / len * speed, dy / len * speed, dt, C, b.enemy);
    }
    const armed = combatGestures.armed;
    function holdMove(b) {
        if (!canAct(b) || b.action || b.guard || b.skill) return;
        // A solo walker has nothing to charge at. Charging exists to deliver a
        // heavy attack, so converting a resting thumb into one would only arm a
        // pad with no target and slow the walk to chargeMoveMultiplier -- the
        // charge would then be discarded anyway when a fight builds its own
        // engine. Walking keeps the plain move gesture; everything else about the
        // gesture, the ramp and the speed is shared with a fight.
        if (b.config.solo) return;
        const command = combatGestures.hold(b.move, b.time);
        if (!command) return;
        // Inside a combo a hold -- held still to the threshold, exactly like
        // the opening charge, so a drag is always a walk -- switches to that
        // node's hold move. It poises at once, or at the derive point if the
        // move under way has not got there yet. Elsewhere a hold is the
        // opening charge.
        const next = chainNext(b, 'hold', b.move.start);
        if (next) {
            b.move.mode = 'hold'; b.move.derived = next;
            if (b.player.phase === 'idle') poise(b);
            return;
        }
        // Separate serializable records: snapshots need no move/action alias repair.
        b.action = { ...b.move, start: command.start };
        if (locked(b)) { b.action.queued = true; b.queuedCommand = { type: 'input', gesture: b.action }; }
        else if (!dispatch(b, command)) {
            b.action = null; b.move.mode = 'move'; b.move.suppressTap = true;
        }
    }
    function press(b, channel, cx = 0, cy = 0) {
        if (!canAct(b) || !['move', 'guard', 'skill'].includes(channel)) return false;
        holdMove(b);
        const p = b.player;
        if (channel === 'skill') {
            if (b.skill || b.action || b.guard) return false;
            b.skill = { cx, cy, kind: null, outside: false, hasDragged: false, cancelAtCenter: b.controls.cancelAtCenter };
            if (b.move) b.move.suppressTap = true;
            return true;
        }
        if (channel !== 'move' && b.skill) return false;
        if (channel === 'move') {
            if (b.move) return false;
            b.move = combatGestures.begin(b.time, 0, 0);
            // Pre-input: a press during a move is kept, not dropped. One input
            // is buffered and runs at the derive point, so pressing early never
            // makes a move faster. The latest input wins, and it wins from the
            // moment the thumb lands: a new press replaces a buffered tap or
            // hold, whether it ends up a tap, a hold, a turn or a walk.
            dropBuffered(b);
            b.move.suppressTap = !!(b.guard || b.skill); return true;
        }
        if (b.guard || !['idle', 'charging', 'poise', 'attack', 'swing', 'recover', 'stunned'].includes(p.phase)) return false;
        if (p.guardLocked) { emit(b, 'guard_locked'); return false; }
        // Guard is the one input that interrupts: it drops a charge (active or
        // queued) and cuts a recovery. Windup and swing always finish, so a
        // guard pressed there waits for the swing's end; a stun is waited out.
        if (b.action) b.action.mode = 'blocked';
        if (p.phase === 'charging') { p.phase = 'idle'; p.charge = 0; b.stats.cancels++; emit(b, 'charge_cancelled'); }
        if (p.phase === 'poise') p.phase = 'idle';
        if (b.move) { b.move.suppressTap = true; if (b.move.mode === 'hold') b.move.mode = 'move'; }
        b.guard = { dx: 0, dy: 0, cx, cy };
        if (['attack', 'swing', 'stunned'].includes(p.phase)) { b.guard.queued = true; b.queuedCommand = { type: 'guard', gesture: b.guard }; return true; }
        raiseGuard(b);
        return true;
    }
    function raiseGuard(b) {
        const p = b.player;
        b.queuedCommand = null; b.guard.queued = false; p.chain = null;
        p.phase = 'guard_start'; p.timer = b.config.guardStartup;
        spendGuard(b, gameConfig.guardBar.raiseCost);
    }
    // Every guard cost goes through here. An empty bar drops the guard and
    // locks it until the bar refills to unlockRatio.
    function spendGuard(b, amount) {
        const p = b.player;
        p.guardBar = Math.max(0, p.guardBar - amount);
        if (p.guardBar > 1e-9) return;
        p.guardBar = 0; p.guardLocked = true;
        if (['guard_start', 'guard'].includes(p.phase)) p.phase = 'idle';
        if (b.queuedCommand?.type === 'guard') b.queuedCommand = null;
        b.guard = null;
        emit(b, 'guard_broken');
    }
    // Cost of defending one hit: `raw` is before DEF and block reduction; a
    // perfect parry pays parryCostRatio of what blocking it would.
    function guardCost(b, raw, parry) {
        const G = gameConfig.guardBar;
        return raw / b.player.maxHp * G.blockCostScale * G.max * (parry ? G.parryCostRatio : 1);
    }
    function tickGuardBar(b, dt) {
        const p = b.player, G = gameConfig.guardBar, max = b.config.guardMax;
        if (['guard_start', 'guard'].includes(p.phase)) { spendGuard(b, G.holdDrain * dt); return; }
        if (p.guardBar >= max) return;
        p.guardBar = Math.min(max, p.guardBar + max / G.refillSeconds * dt);
        if (p.guardLocked && p.guardBar >= max * G.unlockRatio - 1e-9) { p.guardLocked = false; emit(b, 'guard_ready'); }
    }
    function drag(b, channel, dx, dy, cx = dx, cy = dy) {
        if (!canAct(b) || ![dx, dy, cx, cy].every(Number.isFinite)) return;
        if (channel === 'skill' && b.skill) {
            const g = b.skill;
            g.cx = cx; g.cy = cy;
            g.hasDragged ||= Math.hypot(dx, dy) > combatGestures.config.skillDeadZone;
            if (g.hasDragged) combatGestures.selectSkill(g, cx, cy);
            return;
        }
        if (channel === 'move' && b.move) {
            holdMove(b);
            combatGestures.drag(b.move, dx, dy, dx, dy);
            if (b.action) combatGestures.drag(b.action, dx, dy, dx, dy);
            return;
        }
        if (channel === 'guard' && b.guard) {
            b.guard.dx = dx; b.guard.dy = dy; b.guard.cx = cx; b.guard.cy = cy;
            // This only changes facing. It never restarts the parry clock.
        }
    }
    // Start a move: windup (`attack`) -> `swing` -> `recover`. Shape, damage,
    // origin and facing are fixed here; nothing during the move changes them.
    function attack(b, id) {
        const C = b.config, p = b.player, m = moveOf(b, id);
        const charged = m.chargeRatio != null;
        p.attack = {
            move: id, shape: charged ? heavyShape(b) : { kind: 'sector', range: m.range, arc: m.arc }, sweep: m.sweep,
            damage: Math.max(1, Math.round(C.atk * (m.ratio + (charged ? m.chargeRatio * chargeShare(b, p.charge) : 0)))),
            stagger: m.stagger, heavy: charged, origin: { x: p.x, y: p.y }, facing: p.facing, progress: 0, hit: false
        };
        p.phase = 'attack'; p.timer = m.windup; p.charge = 0; p.chain = null;
        b.stats.attacks++;
        emit(b, 'attack_started', { move: id, heavy: charged });
    }
    // The part of the arc the blade crossed between two swing progress values,
    // as a sector of its own, so a fast blade cannot skip a target between steps.
    function bladeSlice(a, from, to) {
        const angle = u => a.sweep * a.shape.arc * (u - .5), start = angle(from), end = angle(to);
        return { shape: { kind: 'sector', range: a.shape.range, arc: Math.abs(end - start) }, facing: a.facing + (start + end) / 2 };
    }
    function swingStep(b, dt, onSwing) {
        const p = b.player, a = p.attack, m = moveOf(b, a.move);
        p.timer = Math.max(0, p.timer - dt);
        const from = a.progress, to = p.timer === 0 ? 1 : S.clamp(1 - p.timer / m.swing, from, 1);
        a.progress = to;
        onSwing(b, bladeSlice(a, from, to), to >= 1);
    }
    // End of the swing: report it, then recover. The chain opens here, so every
    // derive/pause/window time is counted from this moment.
    function finishSwing(b, quiet = false) {
        const p = b.player, a = p.attack;
        if (p.phase !== 'swing') return;
        if (!quiet) {
            emit(b, 'strike', { side: 'player', move: a.move, shape: a.shape, origin: { ...a.origin }, facing: a.facing, sweep: a.sweep });
            if (!a.hit && !b.config.solo) { b.stats.misses++; emit(b, 'miss', { side: 'player', blocked: !!a.blocked }); }
        }
        p.phase = 'recover'; p.timer = moveOf(b, a.move).recovery;
        p.chain = { move: a.move, at: b.time };
    }
    // What a renderer needs to pose a fighter: phase, 0..1 progress through it
    // and the blade angle relative to facing (0 = resting, pointing forward).
    function pose(body, config) {
        const a = body.attack, m = a && config.combo.moves[a.move];
        if (!m || !['attack', 'swing', 'recover'].includes(body.phase)) return { phase: body.phase, progress: 0, blade: 0, move: null };
        const start = -a.sweep * a.shape.arc / 2;
        if (body.phase === 'attack') {
            const progress = m.windup > 0 ? S.clamp(1 - body.timer / m.windup, 0, 1) : 1;
            return { phase: 'attack', progress, blade: start * progress, move: a.move };
        }
        if (body.phase === 'swing') return { phase: 'swing', progress: a.progress, blade: start + a.sweep * a.shape.arc * a.progress, move: a.move };
        const progress = S.clamp(1 - body.timer / m.recovery, 0, 1);
        return { phase: 'recover', progress, blade: -start * (1 - progress), move: a.move };
    }
    function release(b, channel, cancelled = false) {
        if (channel === 'skill') {
            const kind = !cancelled && canAct(b) ? combatGestures.selectedSkill(b.skill) : null;
            b.skill = null; return kind;
        }
        if (channel === 'move') {
            if (!cancelled) holdMove(b);
            releaseCharge(b, cancelled);
            const p = b.player, g = b.move;
            // Region walking has nothing to hit: a tap there is the interact key
            // (the adapter handles it) or nothing at all.
            if (g?.mode === 'pending' && !g.suppressTap && !cancelled && canAct(b) && !b.action && !b.guard && !b.skill && !b.config.solo) {
                if (locked(b)) b.queuedCommand = { type: 'tap', at: g.start, queuedAt: b.time };
                else dispatch(b, { type: 'light' });
            }
            if (g?.mode === 'hold') {
                if (cancelled || !canAct(b)) { if (p.phase === 'poise') p.phase = 'idle'; }
                else if (['poise', 'idle'].includes(p.phase)) attack(b, g.derived);
                else if (inMove(b)) b.queuedCommand = { type: 'hold', move: g.derived, queuedAt: b.time };
            }
            b.move = null; return;
        }
        if (channel === 'guard') {
            if (b.queuedCommand?.gesture === b.guard) b.queuedCommand = null;
            if (['guard_start', 'guard'].includes(b.player.phase)) b.player.phase = 'idle';
            b.guard = null;
        }
    }
    function releaseCharge(b, cancelled) {
        const g = b.action;
        if (!g) return;
        if (g.queued) {
            if (b.queuedCommand?.gesture === g) {
                const command = cancelled ? null : combatGestures.release(g);
                b.queuedCommand = command?.type === 'heavy' ? {
                    type: 'heavy', charge: Math.min(b.config.fullCharge, b.time - g.start), facing: b.player.facing
                } : null;
            }
        } else if (canAct(b) && !cancelled) dispatch(b, combatGestures.release(g));
        if (b.player.phase === 'charging') { b.player.phase = 'idle'; b.player.charge = 0; }
        b.action = null;
    }
    function cancelInputs(b, preserveMove = false) {
        if (!preserveMove) release(b, 'move', true);
        else if (b.move) { b.move.suppressTap = true; b.move.mode = 'move'; }
        if (b.player.phase === 'poise') b.player.phase = 'idle';
        releaseCharge(b, true); release(b, 'guard', true); release(b, 'skill', true);
        b.queuedCommand = null;
        if (preserveMove) b.actionInputVersion++;
        else b.inputVersion++;
    }
    function pause(b) {
        cancelInputs(b); b.running = false; }
    function finish(b) {
        if (!b.result && (b.player.hp <= 0 || b.enemy.hp <= 0)) {
            b.result = b.player.hp <= 0 ? 'defeat' : 'victory';
            pause(b);
            emit(b, 'finished', { result: b.result });
            return true;
        }
        return false;
    }
    function stagger(b, amount) {
        const C = b.config;
        const e = b.enemy;
        e.stagger += amount;
        if (e.stagger >= C.stagger.threshold) {
            e.stagger = 0; e.comboCount = 0; e.phase = 'stagger'; e.timer = C.stagger.duration;
            emit(b, 'stagger');
        }
    }
    // Simulation-side impact: both fighters hold still for a moment (hitstop),
    // then the one struck is pushed away from `from`. `victim` is 'player' or
    // 'enemy' of this battle; kind is 'hit', 'block' or 'parry'.
    function impact(b, victim, from, kind) {
        const I = gameConfig.impact, stop = I.hitstop[kind] || 0;
        for (const body of [b.player, b.enemy]) if (body) body.freeze = Math.max(body.freeze || 0, stop);
        const body = b[victim], distance = I.knockback[kind] || 0;
        if (!body || body.anchored || distance <= 0) return;
        const dx = body.x - from.x, dy = body.y - from.y, len = Math.hypot(dx, dy);
        if (len < 1e-9) return;
        const speed = distance / I.knockbackSeconds;
        body.push = { x: dx / len * speed, y: dy / len * speed, t: I.knockbackSeconds };
    }
    // Knockback runs once hitstop is over, with ordinary collision.
    function knock(b, body, other, dt) {
        const k = body.push, span = Math.min(dt, k.t);
        S.move(body, k.x, k.y, span, b.config, other, b.config.walls || []);
        k.t -= span;
        if (k.t <= 1e-9) body.push = null;
    }
    function damage(b, side, amount) {
        const body = b[side], previous = body.hp;
        body.hp = Math.max(0, body.hp - amount);
        emit(b, 'hp_changed', { side, previous, hp: body.hp, x: body.x, y: body.y });
    }
    // What each swing step does when the caller supplies no resolution of its
    // own. PVP does: it collects both sides' slices before settling either, then
    // ends the swings itself. A solo walker has no opponent, so its swing only
    // runs out -- without finishing, it would stay locked in `swing` for good.
    function resolveSwing(b, slice, done) {
        const C = b.config, p = b.player, e = b.enemy, a = p.attack;
        if (!C.solo && !a.hit && S.contains(slice.shape, a.origin, slice.facing, e)) {
            a.hit = true; // one hit per move and target
            const crit = C.formal && b.random() < C.critChance;
            const amount = C.formal ? defended(a.damage * (crit ? gameConfig.damage.critMultiplier : 1), C.enemy.def) : a.damage;
            damage(b, 'enemy', amount); b.stats.hits++;
            emit(b, 'hit', { side: 'player', move: a.move, heavy: a.heavy, damage: amount, crit });
            if (a.stagger > 0) stagger(b, a.stagger);
            impact(b, 'enemy', a.origin, 'hit');
        }
        if (done) finishSwing(b);
    }
    function enemyHit(b, path = null) {
        const C = b.config;
        const p = b.player, e = b.enemy, a = e.attack;
        const raw = a.damage * (e.enraged ? C.ai.enrageAtkMult : 1);
        const incoming = C.formal ? defended(raw, C.player.def) : raw;
        const origin = path?.start || { x: e.x, y: e.y }, facing = path?.facing ?? e.facing;
        const shape = path ? { kind: 'dash', start: path.start, end: path.end, width: a.dash.width } : a;
        emit(b, 'strike', { side: 'enemy', shape, origin, facing });
        // The moving enemy body also occupies space, so the attack corridor
        // begins at its leading edge rather than at the centre line alone.
        const hit = path ? S.segmentHitsBody(path.start, path.end, p, a.dash.width + e.radius) : S.contains(a, e, e.facing, p);
        if (!hit) {
            b.stats.dodges++; emit(b, 'miss', { side: 'enemy' }); return;
        }
        const front = Math.abs(S.angleDelta(S.facing(p, e), p.facing)) <= Math.PI / 2;
        const guarding = p.phase === 'guard' && front;
        const auto = b.buffs.autoParry > 0 && !guarding;
        if (auto || guarding) {
            const parry = auto || b.time - p.guardReadyAt <= C.parryWindow;
            if (auto) b.buffs.autoParry--;
            if (parry) {
                const counter = C.formal ? defended(C.parryDamage, C.enemy.def) : C.parryDamage;
                b.stats.parries++; damage(b, 'enemy', counter);
                emit(b, 'parry', { damage: counter }); stagger(b, C.stagger.parry);
                impact(b, 'enemy', p, 'parry');
            } else {
                const amount = Math.round(incoming * C.blockMultiplier);
                damage(b, 'player', amount); b.stats.blocks++;
                emit(b, 'block', { damage: amount });
                impact(b, 'player', origin, 'block');
                if (C.guardThorns > 0) {
                    const reflected = defended(raw * C.guardThorns, C.enemy.def);
                    damage(b, 'enemy', reflected); emit(b, 'thorns', { damage: reflected });
                }
            }
            // Paid after the hit is settled: the block that empties the bar still counts.
            if (!auto) spendGuard(b, guardCost(b, raw, parry));
        } else {
            const wasGuarding = p.phase === 'guard';
            damage(b, 'player', incoming);
            cancelInputs(b, true); p.phase = 'stunned'; p.timer = C.hitStun; p.chain = null;
            emit(b, 'hit', { side: 'enemy', damage: incoming, rear: !front && wasGuarding });
            impact(b, 'player', origin, 'hit');
        }
    }
    // Only pre-input attacks age out or yield to a drag; a queued guard,
    // skill or opening charge is a held gesture or an explicit choice.
    function dropBuffered(b, olderThan = -Infinity) {
        const q = b.queuedCommand;
        if (['tap', 'hold'].includes(q?.type) && b.time - q.queuedAt > olderThan + 1e-9) b.queuedCommand = null;
    }
    function tickPlayer(b, dt, onSwing = resolveSwing) {
        const C = b.config;
        const p = b.player;
        dropBuffered(b, C.combo.bufferSeconds);
        flushQueue(b);
        holdMove(b);
        const g = b.action;
        if (b.move?.mode === 'charge' && g?.mode !== 'charge') {
            b.move.mode = 'move'; b.move.suppressTap = true;
        }
        // Hitstop holds the fighter still: no movement, turning or timers.
        // Input bookkeeping, the guard bar and SP go on underneath it.
        const frozen = p.freeze > 0;
        if (frozen) p.freeze = Math.max(0, p.freeze - dt);
        else if (p.push) knock(b, p, b.enemy, dt);
        if (!frozen) tickMotion(b, dt);
        tickGuardBar(b, dt);
        // Solo walking must not bank skill points: they belong to a fight, and
        // accruing them on the way there would start every encounter at max SP.
        if (!C.solo) tickSkillPoints(b, dt);
        if (!frozen) tickTimers(b, dt, onSwing);
    }
    function tickMotion(b, dt) {
        const C = b.config, p = b.player, g = b.action;
        if (['move', 'charge'].includes(b.move?.mode) && ['idle', 'charging', 'guard_start', 'guard'].includes(p.phase)) {
            movePlayer(b, b.move.dx, b.move.dy, dt, p.phase === 'charging');
        }
        if (p.phase === 'idle') {
            if (b.move?.mode === 'move' && Math.hypot(b.move.dx, b.move.dy) > combatGestures.config.deadZone) {
                p.chain = null; // actually walking away ends the combo
                p.facing = S.turn(p.facing, Math.atan2(b.move.dy, b.move.dx), dt * (C.playerTurn ?? gameConfig.combatBase.playerTurn) * motion(b, 'turn'));
            } else if (b.controls.autoFace && b.enemy) p.facing = S.turn(p.facing, S.facing(p, b.enemy), dt * (C.playerTurn ?? gameConfig.combatBase.playerTurn) * motion(b, 'turn'));
        } else if (p.phase === 'charging') {
            if (g && Math.hypot(g.cx, g.cy) > combatGestures.config.deadZone) {
                p.facing = S.turn(p.facing, Math.atan2(g.cy, g.cx), dt * (C.playerTurn ?? gameConfig.combatBase.playerTurn) * motion(b, 'turn') * (C.chargeTurnMultiplier ?? gameConfig.combatBase.chargeTurnMultiplier) * motion(b, 'chargeTurn'));
            }
            p.charge = Math.min(C.fullCharge, p.charge + (b.time - p.chargeUpdatedAt) *
                (b.time <= b.buffs.chargeHasteUntil ? (C.skills?.haste?.chargeRate ?? gameConfig.skills.haste.chargeRate) : 1));
            p.chargeUpdatedAt = b.time;
        } else if (['recover', 'poise'].includes(p.phase)) {
            // Inside a combo a drag only turns; the next move goes where the
            // fighter faces the moment it starts.
            if (b.move && Math.hypot(b.move.dx, b.move.dy) > combatGestures.config.deadZone) {
                p.facing = S.turn(p.facing, Math.atan2(b.move.dy, b.move.dx), dt * (C.playerTurn ?? gameConfig.combatBase.playerTurn) * motion(b, 'turn'));
            }
        } else if (['guard_start', 'guard'].includes(p.phase)) {
            if (b.guard && Math.hypot(b.guard.cx, b.guard.cy) > combatGestures.config.deadZone) {
                p.facing = S.turn(p.facing, Math.atan2(b.guard.cy, b.guard.cx), dt * (C.playerTurn ?? gameConfig.combatBase.playerTurn) * motion(b, 'turn') * (C.guardTurnMultiplier ?? gameConfig.combatBase.guardTurnMultiplier));
            }
        }
    }
    function tickTimers(b, dt, onSwing) {
        const C = b.config, p = b.player;
        // A guard pressed during the windup or swing goes up as soon as the swing ends.
        if (p.phase === 'recover' && b.queuedCommand?.type === 'guard' && b.guard === b.queuedCommand.gesture) raiseGuard(b);
        if (p.phase === 'swing') swingStep(b, dt, onSwing);
        else if (p.timer > 0 || p.phase === 'attack') {
            p.timer = Math.max(0, p.timer - dt);
            if (p.phase === 'recover' && deriveNow(b)) return;
            if (p.timer === 0) {
                if (p.phase === 'guard_start') { p.phase = 'guard'; p.guardReadyAt = b.time; }
                else if (p.phase === 'attack') {
                    p.phase = 'swing'; p.timer = moveOf(b, p.attack.move).swing;
                    emit(b, 'swing_started', { side: 'player', move: p.attack.move, heavy: p.attack.heavy });
                }
                else if (p.phase === 'poise') firePoise(b);
                else if (['recover', 'stunned'].includes(p.phase)) { p.phase = 'idle'; flushQueue(b); }
            }
        }
        if (p.chain && p.phase === 'idle') {
            const m = moveOf(b, p.chain.move);
            if (!chainOpen(b)) p.chain = null;
            // Crossing the pause line of a node that has a pause move is cued once.
            else if (m.next?.pause && !p.chain.cued && b.time - p.chain.at >= m.recovery + C.combo.pauseAfterRecovery - 1e-9) {
                p.chain.cued = true; emit(b, 'pause_ready', { side: 'player', move: m.next.pause });
            }
        }
    }
    function tickEnemy(b, dt) {
        const C = b.config;
        const e = b.enemy, p = b.player;
        if (C.formal && !e.enraged && C.ai.enrageThreshold > 0 && e.hp / e.maxHp <= C.ai.enrageThreshold) {
            e.enraged = true; emit(b, 'enrage');
        }
        const tempo = e.enraged ? C.ai.enrageSpdMult : 1;
        if (C.formal) e.ap = Math.min(C.enemyApMax, (e.ap ?? C.enemyApMax) + dt * C.enemyApRegen * tempo * b.apRateMult);
        if (e.freeze > 0) { e.freeze = Math.max(0, e.freeze - dt); return; }
        if (e.push) knock(b, e, p, dt);
        if (e.phase === 'dash') {
            const dash = e.attack.dash, speed = dash.speed * tempo;
            const remaining = Math.max(0, e.dashRemaining);
            const dashDt = Math.min(dt, remaining / Math.max(speed, 1e-9));
            const start = { x: e.x, y: e.y };
            const moved = dashDt > 0 && S.move(e, Math.cos(e.dashFacing) * speed, Math.sin(e.dashFacing) * speed, dashDt, C, p, C.walls, false);
            const end = { x: e.x, y: e.y }, travelled = S.distance(start, end);
            e.dashRemaining = Math.max(0, remaining - travelled);
            if (!e.dashHit && S.segmentHitsBody(start, end, p, dash.width + e.radius)) {
                e.dashHit = true; enemyHit(b, { start, end, facing: e.dashFacing });
            }
            // A defended contact can stagger the attacker. Preserve that
            // phase; otherwise the dash ends at the actual contact point.
            if (e.phase !== 'dash') return;
            if (e.dashHit || !moved || travelled < speed * dashDt - 1e-7 || e.dashRemaining <= 1e-7) {
                e.dashRemaining = 0;
                e.phase = 'recover'; e.timer = e.attack.recovery;
            }
            return;
        }
        e.timer = Math.max(0, e.timer - dt * tempo);
        // An anchored enemy (the training dummy) never walks or turns: it
        // attacks on its own clock, always in the direction it was set down.
        const anchored = !!e.anchored;
        if (e.phase === 'approach') {
            const d = S.distance(e, p);
            if (!anchored) {
                e.facing = S.turn(e.facing, S.facing(e, p), dt * C.ai.turn);
                if (d > C.ai.stopDistance) {
                    const a = S.facing(e, p);
                    S.move(e, Math.cos(a) * C.ai.speed, Math.sin(a) * C.ai.speed, dt, C, p);
                }
            }
            if (e.timer === 0 && (anchored || d < C.ai.attackDistance) && (!C.formal || e.ap >= gameConfig.enemyDefaults.attackApCost)) {
                e.attack = C.actions ? C.actions[e.sequence++ % C.actions.length] : e.sequence++ % 3 === 2 ? C.stomp : C.sweep;
                if (C.formal) e.ap -= gameConfig.enemyDefaults.attackApCost;
                e.phase = 'windup'; e.timer = e.attack.windup;
                if (!anchored) e.facing = S.facing(e, p);
            }
        } else if (e.phase === 'windup') {
            if (!anchored && e.timer > e.attack.lock) e.facing = S.turn(e.facing, S.facing(e, p), dt * C.ai.trackingTurn);
            if (e.timer === 0) {
                if (e.attack.dash) {
                    e.phase = 'dash'; e.dashFacing = e.facing;
                    e.dashRemaining = e.attack.dash.distance; e.dashHit = false;
                    emit(b, 'dash_started', { facing: e.dashFacing, distance: e.dashRemaining });
                } else {
                    e.phase = 'active'; e.timer = e.attack.active;
                    enemyHit(b); // one hit per attack, never per render frame
                }
            }
        } else if (e.timer === 0) {
            if (e.phase === 'active') {
                e.phase = 'recover'; e.timer = e.attack.recovery;
                if (C.formal && (e.comboCount || 0) < C.ai.comboMax && b.random() < C.ai.comboChance) {
                    e.comboCount = (e.comboCount || 0) + 1;
                    e.timer = C.ai.comboDelay; emit(b, 'combo');
                } else e.comboCount = 0;
            }
            else { e.phase = 'approach'; e.timer = C.ai.delay; }
        }
    }
    function step(b, dt, deferFinish = false) {
        const C = b.config;
        if (!canAct(b) || !Number.isFinite(dt)) return;
        // A monotonic simulation clock drives gestures, guard, AI and charge.
        // No offline catch-up: callers pause on visibility loss.
        dt = S.clamp(dt, 0, .05);
        b.time += dt; b.elapsed += dt;
        b.motionBuffs = b.motionBuffs.filter(buff => buff.until > b.time);

        tickPlayer(b, dt);
        // A solo preset has no opponent to tick and nothing to settle against;
        // walking is the whole simulation.
        if (C.solo) return;
        if (!C.formal && finish(b)) return;
        tickEnemy(b, dt);
        if (!deferFinish) finish(b);
    }
    function defended(raw, def = 0) { return Math.max(1, Math.round(raw * (1 - def / (def + gameConfig.damage.defenseConstant)))); }
    function heal(b, amount) {
        if (!canAct(b) || !Number.isFinite(amount) || amount <= 0 || b.player.hp <= 0) return;
        const previous = b.player.hp;
        b.player.hp = Math.min(b.player.maxHp, previous + amount);
        emit(b, 'hp_changed', { side: 'player', previous, hp: b.player.hp });
    }
    function environment(b, playerDamage, enemyDamage) {
        if (!canAct(b)) return;
        damage(b, 'player', Math.max(0, playerDamage)); damage(b, 'enemy', Math.max(0, enemyDamage));
    }
    function useSkill(b, kind) {
        const skill = b.config.skills?.[kind];
        if (!canAct(b) || !skill) return false;
        const p = b.player;
        if (kind === 'heal') {
            if (b.player.hp >= b.player.maxHp) return false;
            heal(b, Math.floor(b.player.maxHp * skill.healRatio));
        }
        else if (kind === 'haste') b.buffs.chargeHasteUntil = b.time + skill.duration;
        else if (kind === 'full') {
            if (b.buffs.instantCharge) return false;
            if (b.player.phase === 'charging') b.player.charge = b.config.fullCharge;
            else b.buffs.instantCharge = true;
        } else if (kind === 'parry') {
            if (b.buffs.autoParry) return false;
            b.buffs.autoParry = 1;
        } else return false;
        p.chain = null; // a skill ends the combo, a poised hold included
        if (p.phase === 'poise') { p.phase = 'idle'; if (b.move) { b.move.mode = 'move'; b.move.suppressTap = true; } }
        return true;
    }
    function tickSkillPoints(b, dt) {
        const C = b.config, p = b.player, max = C.skillPointMax ?? gameConfig.combatBase.skillPointMax;
        if (!Number.isFinite(C.spRegen) || C.spRegen <= 0 || max <= 0 || p.hp <= 0 || b.skillPoints >= max) return;
        b.skillProgress = Math.max(0, b.skillProgress || 0) + dt * C.spRegen;
        while (b.skillProgress >= 1 - 1e-9 && b.skillPoints < max) {
            b.skillProgress -= 1; b.skillPoints++;
            emit(b, 'skill_point', { skillPoints: b.skillPoints });
        }
        if (b.skillPoints >= max) b.skillProgress = 0;
    }
    function queueSkill(b, kind) {
        if (!canAct(b) || !locked(b) || !b.config.skills?.[kind]) return false;
        if (kind === 'heal' && b.player.hp >= b.player.maxHp) return false;
        if (b.action?.queued) b.action.mode = 'blocked';
        if (b.guard?.queued) b.guard = null;
        b.queuedCommand = { type: 'skill', kind }; return true;
    }
    // A human-controlled actor can be advanced independently of the PVE AI.
    // The duel adapter collects both sides' swing slices before applying either.
    function advanceActor(b, dt, onSwing) {
        if (!canAct(b) || !Number.isFinite(dt) || dt <= 0) return;
        dt = Math.min(dt, .05);
        b.time += dt; b.elapsed += dt;
        b.motionBuffs = b.motionBuffs.filter(buff => buff.until > b.time);
        tickPlayer(b, dt, onSwing);
    }
    return { advanceActor, finishSwing, pose, spendGuard, guardCost, impact, defended, heavyShape, setMotionBuff, queueSkill, useSkill, validate, heal, environment, settle: finish, dispatch, drainEvents, config: C, create, start, pause, press, drag, release, cancelInputs, step, armed };
})();
