// Deterministic spatial battle. No DOM, saves, timers, or presentation state.
// Call step(seconds), and feed pointer offsets in CSS pixels to the input API.
const spatialEngine = (() => {
    const C = spatialData.training;
    const S = spatialCombat;
    function validate(C) {
        const positive = v => Number.isFinite(v) && v > 0;
        if (![C.width, C.height, C.fullCharge, C.apMax].every(positive)) throw new Error('Invalid arena or combat limits');
        const nonnegative = v => Number.isFinite(v) && v >= 0;
        if (![C.playerTurn ?? 8, C.chargeMoveMultiplier ?? .7, C.chargeTurnMultiplier ?? .7, ...Object.values(C.motion || {})].every(nonnegative)) throw new Error('Invalid motion modifiers');
        if ((C.heavy.minRange != null && (!positive(C.heavy.minRange) || C.heavy.minRange > C.heavy.range)) ||
            (C.heavy.minArc != null && (!positive(C.heavy.minArc) || C.heavy.minArc > C.heavy.arc))) throw new Error('Invalid charge sector');
        if (![C.guardStartup, C.parryWindow, C.apRegen, C.hitStun, C.playerSpeed, C.guardTurn, C.blockMultiplier, C.parryDamage, C.parryCost].every(nonnegative) ||
            !positive(C.moveRamp) || !positive(C.stagger.threshold) || !nonnegative(C.stagger.duration)) throw new Error('Invalid combat parameters');
        if (C.formal && (!C.actions?.length || ![C.critChance, C.guardThorns, C.enemyApRegen].every(nonnegative) ||
            !positive(C.enemyApMax) || !nonnegative(C.chargeThreshold) || C.chargeThreshold >= C.fullCharge)) throw new Error('Invalid profile');
        if (!Object.values(C.ai).every(nonnegative)) throw new Error('Invalid AI timing');
        for (const a of [C.light, C.heavy, ...(C.actions || [C.sweep, C.stomp])]) {
            if (!a || !['sector', 'circle'].includes(a.kind) || !positive(a.range) ||
                (a.kind === 'sector' && (!positive(a.arc) || a.arc > Math.PI * 2)) ||
                ![a.windup, a.recovery, a.damage].every(v => Number.isFinite(v) && v >= 0) ||
                (a.active != null && !nonnegative(a.active)) ||
                (a.lock != null && (!Number.isFinite(a.lock) || a.lock < 0 || a.lock > a.windup))) throw new Error('Invalid spatial action');
        }
        for (const body of [C.player, C.enemy]) {
            if (![body.x, body.y, body.facing].every(Number.isFinite) || !positive(body.radius) || !positive(body.maxHp) ||
                !Number.isFinite(body.hp) || body.hp < 0 || body.hp > body.maxHp ||
                body.x < body.radius || body.x > C.width - body.radius || body.y < body.radius || body.y > C.height - body.radius) throw new Error('Invalid spawn');
        }
        if (S.distance(C.player, C.enemy) < C.player.radius + C.enemy.radius) throw new Error('Overlapping spawns');
    }
    function create(config = C, random = Math.random) {
        validate(config);
        const C = JSON.parse(JSON.stringify(config));
        return {
            config: C, random, buffs: { chargeHasteUntil: 0, instantCharge: false, autoParry: 0 }, apRateMult: 1,
            time: 0, elapsed: 0, running: false, started: false, result: null,
            player: { ...C.player, ap: C.apMax, phase: 'idle', timer: 0, charge: 0 },
            enemy: { ...C.enemy, phase: 'approach', timer: C.ai.initialDelay, sequence: 0, stagger: 0 },
            move: null, action: null, guard: null, queuedCommand: null, motionBuffs: [], events: [], inputVersion: 0,
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
        if (command.type === 'charge' && p.phase === 'idle' && p.ap >= 1 && b.action?.mode === 'charge') {
            p.phase = 'charging'; p.charge = Math.min(C.fullCharge, b.time - b.action.start);
            p.chargeUpdatedAt = b.time;
            if (b.buffs.instantCharge) { p.charge = C.fullCharge; b.buffs.instantCharge = false; }
            return true;
        }
        if (command.type === 'light' && p.phase === 'idle' && b.move?.mode === 'pending' && !b.guard && !b.action) { attack(b, false); return true; }
        if (command.type === 'heavy' && p.phase === 'charging' && combatGestures.armed(b.action)) { attack(b, true); return true; }
        if (command.type === 'cancel_charge' && p.phase === 'charging') {
            b.stats.cancels++; p.phase = 'idle'; p.charge = 0;
            if (b.action) b.action.mode = 'blocked';
            emit(b, 'charge_cancelled'); return true;
        }
        return false;
    }
    function canAct(b) {
        return b.running && !b.result; }
    function start(b) {
        if (!b.result) { b.started = true; b.running = true; } }
    function locked(b) { return ['attack', 'recover', 'stunned'].includes(b.player.phase); }
    // One replaceable next command: taps never accumulate into an attack backlog.
    function flushQueue(b) {
        if (b.player.phase !== 'idle' || !b.queuedCommand) return;
        const q = b.queuedCommand, p = b.player; b.queuedCommand = null;
        if (q.type === 'input' && b.action === q.gesture) {
            b.action.queued = false;
            if (b.action.mode === 'charge' && !dispatch(b, { type: 'charge' })) b.action.mode = 'blocked';
        } else if (q.type === 'guard' && b.guard === q.gesture) {
            b.guard.queued = false;
            if (p.ap >= 1) { p.phase = 'guard_start'; p.timer = b.config.guardStartup; }
            else { b.guard = null; emit(b, 'ap_insufficient'); }
        } else if (q.type === 'light') attack(b, false);
        else if (q.type === 'skill') emit(b, 'skill_ready', { kind: q.kind });
        else if (q.type === 'heavy') {
            p.charge = q.charge; p.facing = q.facing;
            if (b.buffs.instantCharge) { p.charge = b.config.fullCharge; b.buffs.instantCharge = false; }
            attack(b, true);
        }
    }
    function heavyShape(b, charge = b.player.charge) {
        const a = b.config.heavy, t = S.clamp(charge / b.config.fullCharge, 0, 1);
        return { ...a, range: (a.minRange ?? a.range * .6) + (a.range - (a.minRange ?? a.range * .6)) * t,
            arc: (a.minArc ?? a.arc * .4) + (a.arc - (a.minArc ?? a.arc * .4)) * t };
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
        return (b.config.motion?.[key] ?? 1) * b.motionBuffs.reduce((value, buff) => value * (buff.until > b.time ? buff[key] : 1), 1);
    }
    function movePlayer(b, dx, dy, dt, charging = false) {
        const C = b.config, p = b.player, len = Math.hypot(dx, dy);
        const deadZone = combatGestures.config.deadZone;
        if (len <= deadZone) return;
        const slow = charging ? (C.chargeMoveMultiplier ?? .7) * motion(b, 'chargeMove') : 1;
        const speed = C.playerSpeed * motion(b, 'move') * slow * Math.min(1, (len - deadZone) / C.moveRamp);
        S.move(p, dx / len * speed, dy / len * speed, dt, C, b.enemy);
    }
    const armed = combatGestures.armed;
    function press(b, channel, cx = 0, cy = 0) {
        if (!canAct(b) || !['move', 'action', 'guard'].includes(channel)) return false;
        const p = b.player;
        if (channel === 'move') {
            if (b.move) return false;
            b.move = combatGestures.begin(b.time, cx, cy); return true;
        }
        if (channel === 'action') {
            if (b.action || (b.guard && !b.guard.queued) || (p.phase !== 'idle' && !locked(b))) return false;
            if (b.guard?.queued) b.guard = null;
            b.action = combatGestures.begin(b.time, cx, cy);
            b.action.mode = 'charge';
            if (locked(b)) { b.action.queued = true; b.queuedCommand = { type: 'input', gesture: b.action }; }
            else if (!dispatch(b, { type: 'charge' })) { b.action = null; emit(b, 'ap_insufficient'); return false; }
        } else {
            if (b.guard || (p.phase !== 'idle' && !locked(b)) || (!locked(b) && p.ap < 1)) return false;
            // Right-hand controls are exclusive; the left movement pointer stays independent.
            if (b.action) b.action.mode = 'blocked';
            b.guard = { dx: 0, dy: 0, cx, cy };
            if (locked(b)) { b.guard.queued = true; b.queuedCommand = { type: 'guard', gesture: b.guard }; return true; }
            p.facing = S.facing(p, b.enemy);
            p.phase = 'guard_start'; p.timer = b.config.guardStartup;
        }
        return true;
    }
    function drag(b, channel, dx, dy, cx = dx, cy = dy) {
        if (!canAct(b) || ![dx, dy, cx, cy].every(Number.isFinite)) return;
        if (channel === 'move' && b.move) { combatGestures.drag(b.move, dx, dy, cx, cy); return; }
        if (channel === 'action' && b.action) {
            const g = b.action;
            combatGestures.drag(g, dx, dy, cx, cy);
        } else if (channel === 'guard' && b.guard) {
            b.guard.dx = dx; b.guard.dy = dy; b.guard.cx = cx; b.guard.cy = cy;
            // This only changes facing. It never restarts the parry clock.
        }
    }
    function attack(b, heavy) {
        const C = b.config;
        const p = b.player;
        if (p.ap < 1) { emit(b, 'ap_insufficient'); p.phase = 'idle'; p.charge = 0; return; }
        p.ap -= 1;
        if (!heavy) p.facing = S.facing(p, b.enemy);
        p.attack = {
            shape: heavy ? heavyShape(b) : { ...C.light },
            damage: heavy ? Math.round(C.heavy.damage + C.heavy.chargeBonus * (C.chargeThreshold != null ? S.clamp((p.charge - C.chargeThreshold) / (C.fullCharge - C.chargeThreshold), 0, 1) : p.charge / C.fullCharge)) : C.light.damage,
            heavy, origin: { x: p.x, y: p.y }, facing: p.facing
        };
        p.phase = 'attack'; p.timer = heavy ? C.heavy.windup : C.light.windup; p.charge = 0;
        b.stats.attacks++;
        emit(b, 'attack_started', { heavy });
    }
    function release(b, channel, cancelled = false) {
        if (channel === 'move') {
            if (b.move?.mode === 'pending' && !cancelled && canAct(b) && !b.action && !b.guard) {
                if (locked(b)) b.queuedCommand = { type: 'light' };
                else dispatch(b, { type: 'light' });
            }
            b.move = null; return;
        }
        if (channel === 'action') {
            const g = b.action;
            if (!g) return;
            if (g.queued) {
                if (b.queuedCommand?.gesture === g) {
                    const command = cancelled ? null : combatGestures.release(g, false);
                    b.queuedCommand = command?.type === 'light' ? { type: 'light' } : command?.type === 'heavy' ? {
                        type: 'heavy', charge: Math.min(b.config.fullCharge, b.time - g.start), facing: Math.atan2(g.cy, g.cx)
                    } : null;
                }
            } else if (canAct(b) && !cancelled) dispatch(b, combatGestures.release(g, false));
            if (b.player.phase === 'charging') { b.player.phase = 'idle'; b.player.charge = 0; }
            b.action = null;
        } else {
            if (b.queuedCommand?.gesture === b.guard) b.queuedCommand = null;
            if (['guard_start', 'guard'].includes(b.player.phase)) b.player.phase = 'idle';
            b.guard = null;
        }
    }
    function cancelInputs(b) {
        release(b, 'move', true); release(b, 'action', true); release(b, 'guard', true); b.queuedCommand = null; b.inputVersion++; }
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
    function damage(b, side, amount) {
        const body = b[side], previous = body.hp;
        body.hp = Math.max(0, body.hp - amount);
        emit(b, 'hp_changed', { side, previous, hp: body.hp });
    }
    function playerHit(b) {
        const C = b.config;
        const p = b.player, e = b.enemy, a = p.attack;
        emit(b, 'strike', { side: 'player', shape: a.shape, origin: { ...a.origin }, facing: a.facing });
        if (S.contains(a.shape, a.origin, a.facing, e)) {
            const crit = C.formal && b.random() < C.critChance;
            const amount = C.formal ? defended(a.damage * (crit ? 1.5 : 1), C.enemy.def) : a.damage;
            damage(b, 'enemy', amount); b.stats.hits++;
            emit(b, 'hit', { side: 'player', heavy: a.heavy, damage: amount, crit });
            if (a.heavy) stagger(b, C.stagger.heavy);
        } else { b.stats.misses++; emit(b, 'miss', { side: 'player' }); }
        p.phase = 'recover'; p.timer = a.heavy ? C.heavy.recovery : C.light.recovery;
    }
    function enemyHit(b) {
        const C = b.config;
        const p = b.player, e = b.enemy, a = e.attack;
        const raw = a.damage * (e.enraged ? C.ai.enrageAtkMult : 1);
        const incoming = C.formal ? defended(raw, C.player.def) : raw;
        emit(b, 'strike', { side: 'enemy', shape: a, origin: { x: e.x, y: e.y }, facing: e.facing });
        if (!S.contains(a, e, e.facing, p)) {
            b.stats.dodges++; emit(b, 'miss', { side: 'enemy' }); return;
        }
        const front = Math.abs(S.angleDelta(S.facing(p, e), p.facing)) <= Math.PI / 2;
        const auto = b.buffs.autoParry > 0 && !(p.phase === 'guard' && front && p.ap >= 1);
        if (auto || (p.phase === 'guard' && front && p.ap >= 1)) {
            const parry = auto || b.time - p.guardReadyAt <= C.parryWindow;
            if (auto) b.buffs.autoParry--;
            if (!auto) p.ap = Math.max(0, p.ap - (parry ? C.parryCost : 1));
            if (parry) {
                const counter = C.formal ? defended(C.parryDamage, C.enemy.def) : C.parryDamage;
                b.stats.parries++; damage(b, 'enemy', counter);
                emit(b, 'parry', { damage: counter }); stagger(b, C.stagger.parry);
            } else {
                const amount = Math.round(incoming * C.blockMultiplier);
                damage(b, 'player', amount); b.stats.blocks++;
                emit(b, 'block', { damage: amount });
                if (C.guardThorns > 0) {
                    const reflected = defended(raw * C.guardThorns, C.enemy.def);
                    damage(b, 'enemy', reflected); emit(b, 'thorns', { damage: reflected });
                }
            }
        } else {
            damage(b, 'player', incoming);
            cancelInputs(b); p.phase = 'stunned'; p.timer = C.hitStun;
            emit(b, 'hit', { side: 'enemy', damage: incoming, rear: !front && p.ap >= 1 });
        }
    }
    function tickPlayer(b, dt) {
        const C = b.config;
        const p = b.player;
        flushQueue(b);
        const g = b.action;
        if (b.move?.mode === 'move' && ['idle', 'charging', 'guard_start', 'guard'].includes(p.phase)) {
            movePlayer(b, b.move.dx, b.move.dy, dt, p.phase === 'charging');
        }
        if (p.phase === 'idle') {
            p.facing = S.facing(p, b.enemy);
        } else if (p.phase === 'charging') {
            if (g && Math.hypot(g.cx, g.cy) > combatGestures.config.cancelRadius) {
                p.facing = S.turn(p.facing, Math.atan2(g.cy, g.cx), dt * (C.playerTurn ?? 8) * motion(b, 'turn') * (C.chargeTurnMultiplier ?? .7) * motion(b, 'chargeTurn'));
            }
            p.charge = C.formal ? Math.min(C.fullCharge, p.charge + (b.time - p.chargeUpdatedAt) * (b.time <= b.buffs.chargeHasteUntil ? 1.5 : 1)) : Math.min(C.fullCharge, b.time - g.start);
            p.chargeUpdatedAt = b.time;
        } else if (['guard_start', 'guard'].includes(p.phase)) {
            if (b.guard && Math.hypot(b.guard.cx, b.guard.cy) > combatGestures.config.deadZone) {
                p.facing = S.turn(p.facing, Math.atan2(b.guard.cy, b.guard.cx), dt * C.guardTurn * motion(b, 'turn'));
            }
        }
        if (['idle', 'recover', 'stunned'].includes(p.phase)) p.ap = Math.min(C.apMax, p.ap + dt * C.apRegen * b.apRateMult);
        if (p.timer > 0) {
            p.timer = Math.max(0, p.timer - dt);
            if (p.timer === 0) {
                if (p.phase === 'guard_start') { p.phase = 'guard'; p.guardReadyAt = b.time; }
                else if (p.phase === 'attack') playerHit(b);
                else if (['recover', 'stunned'].includes(p.phase)) { p.phase = 'idle'; flushQueue(b); }
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
        e.timer = Math.max(0, e.timer - dt * tempo);
        if (e.phase === 'approach') {
            e.facing = S.turn(e.facing, S.facing(e, p), dt * C.ai.turn);
            const d = S.distance(e, p);
            if (d > C.ai.stopDistance) {
                const a = S.facing(e, p);
                S.move(e, Math.cos(a) * C.ai.speed, Math.sin(a) * C.ai.speed, dt, C, p);
            }
            if (e.timer === 0 && d < C.ai.attackDistance && (!C.formal || e.ap >= 1)) {
                e.attack = C.actions ? C.actions[e.sequence++ % C.actions.length] : e.sequence++ % 3 === 2 ? C.stomp : C.sweep;
                if (C.formal) e.ap--;
                e.phase = 'windup'; e.timer = e.attack.windup;
                e.facing = S.facing(e, p);
            }
        } else if (e.phase === 'windup') {
            if (e.timer > e.attack.lock) e.facing = S.turn(e.facing, S.facing(e, p), dt * C.ai.trackingTurn);
            if (e.timer === 0) {
                e.phase = 'active'; e.timer = e.attack.active;
                enemyHit(b); // one hit per attack, never per render frame
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
        if (!C.formal && finish(b)) return;
        tickEnemy(b, dt);
        if (!deferFinish) finish(b);
    }
    function defended(raw, def = 0) { return Math.max(1, Math.round(raw - Math.min(raw * .2, def * .15))); }
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
        if (!canAct(b)) return false;
        if (kind === 'heal') heal(b, Math.floor(b.player.maxHp * .3));
        else if (kind === 'haste') b.buffs.chargeHasteUntil = b.time + 10;
        else if (kind === 'full') {
            if (b.buffs.instantCharge) return false;
            if (b.player.phase === 'charging') b.player.charge = b.config.fullCharge;
            else b.buffs.instantCharge = true;
        } else if (kind === 'parry') {
            if (b.buffs.autoParry) return false;
            b.buffs.autoParry = 1;
        } else return false;
        return true;
    }
    function queueSkill(b, kind) {
        if (!canAct(b) || !locked(b) || !['heal', 'haste', 'full', 'parry'].includes(kind)) return false;
        if (b.action?.queued) b.action.mode = 'blocked';
        if (b.guard?.queued) b.guard = null;
        b.queuedCommand = { type: 'skill', kind }; return true;
    }
    return { heavyShape, setMotionBuff, queueSkill, useSkill, validate, heal, environment, settle: finish, dispatch, drainEvents, config: C, create, start, pause, press, drag, release, cancelInputs, step, armed };
})();
