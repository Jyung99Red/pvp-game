// Two human actors, one simulation clock. No network, DOM or progression writes.
const spatialDuel = (() => {
    const E = spatialEngine, S = spatialCombat;
    const SKILL_COSTS = Object.freeze({ ...spatialData.skillCosts });
    const clone = value => JSON.parse(JSON.stringify(value));
    function visibility(d) {
        return d.sides.map((b, i) => S.hasLineOfSight(b.player, d.sides[1 - i].player, b.config.walls));
    }
    function create(profiles, random = Math.random) {
        const normalized = profiles.map(spatialProfiles.normalize);
        const sides = normalized.map((profile, i) => {
            const C = spatialProfiles.apply(clone(spatialData.baseCombatPreset), profile);
            C.formal = true; C.pvp = true; C.skillMode = 'fair'; C.skillOverrides = {};
            C.width = spatialData.pvpArena.width; C.height = spatialData.pvpArena.height;
            C.wallLayoutId = spatialData.pvpArena.layoutId; C.wallVersion = spatialData.pvpArena.version;
            C.walls = clone(spatialData.pvpArena.walls);
            C.camera = { ...spatialData.camera };
            Object.assign(C.player, { x: C.width / 2, y: C.height / 2 + (i ? -gameConfig.pvpSpawnOffset : gameConfig.pvpSpawnOffset), facing: i ? Math.PI / 2 : -Math.PI / 2 });
            Object.assign(C.enemy, { x: C.width / 2, y: C.height / 2 + (i ? gameConfig.pvpSpawnOffset : -gameConfig.pvpSpawnOffset), radius: C.player.radius });
            const b = E.create(C, random); b.skillPoints = 0; E.start(b); return b;
        });
        sides.forEach((b, i) => { b.enemy = sides[1 - i].player; });
        return { profiles: normalized, sides, time: 0, tick: 0, result: null, events: [], random };
    }
    function emit(d, actor, type, extra = {}) { d.events.push({ type, actor, time: d.time, visibleTo: visibility(d), ...extra }); }
    function skill(d, i, kind, queued = true) {
        const b = d.sides[i], cost = b?.config.skills?.[kind]?.cost;
        if (d.result || !cost || b.skillPoints < cost || (kind === 'heal' && b.player.hp >= b.player.maxHp)) return false;
        if (queued && E.queueSkill(b, kind)) return true;
        if (!E.useSkill(b, kind)) return false;
        b.skillPoints -= cost; emit(d, i, 'skill_used', { kind }); return true;
    }
    function events(d, i) {
        for (const e of E.drainEvents(d.sides[i])) {
            if (e.type === 'skill_ready') skill(d, i, e.kind, false);
            else { const { side, ...rest } = e; d.events.push({ ...rest, actor: side === 'enemy' ? 1 - i : i, visibleTo: visibility(d) }); }
        }
    }
    function input(d, i, command) {
        if (d.result || !d.sides[i] || !command || typeof command !== 'object') return false;
        const b = d.sides[i], { type, channel } = command;
        let ok = true;
        if (type === 'cancel') E.cancelInputs(b);
        else if (type === 'settings') {
            if (typeof command.cancelAtCenter !== 'boolean' || typeof command.autoFace !== 'boolean') return false;
            E.cancelInputs(b); Object.assign(b.controls, { cancelAtCenter: command.cancelAtCenter, autoFace: command.autoFace });
        } else if (type === 'skill') ok = skill(d, i, command.kind);
        else {
            if (!['move', 'guard', 'skill'].includes(channel)) return false;
            const values = command.values;
            if (type === 'press' || type === 'drag') {
                if (!Array.isArray(values) || values.length !== (type === 'press' ? 2 : 4) || !values.every(v => Number.isFinite(v) && Math.abs(v) <= 4096)) return false;
                if (type === 'press') ok = E.press(b, channel, ...values);
                else E.drag(b, channel, ...values);
            } else if (type === 'release' && typeof command.cancelled === 'boolean') {
                const kind = E.release(b, channel, command.cancelled);
                if (kind) skill(d, i, kind);
            } else return false;
        }
        events(d, i); return ok;
    }
    function hurt(d, i, amount) {
        const p = d.sides[i].player, previous = p.hp;
        p.hp = Math.max(0, p.hp - amount);
        emit(d, i, 'hp_changed', { previous, hp: p.hp, x: p.x, y: p.y });
    }
    function stun(d, i) {
        const b = d.sides[i]; E.cancelInputs(b, true);
        b.player.phase = 'stunned'; b.player.timer = b.config.hitStun; b.player.chain = null;
    }
    // Decide every swing slice from the same post-movement snapshot, then apply
    // all effects. A move reaches the other side at most once.
    function judge(d, { i, slice }) {
        const atk = d.sides[i], def = d.sides[1 - i], a = atk.player.attack;
        const result = { i, a, type: 'none' };
        if (a.hit || !S.contains(slice.shape, a.origin, slice.facing, def.player)) return result;
        if (S.segmentBlocked(a.origin, def.player, atk.config.walls)) return { ...result, blocked: true };
        const front = Math.abs(S.angleDelta(S.facing(def.player, a.origin), def.player.facing)) <= Math.PI / 2;
        const guard = def.player.phase === 'guard' && front;
        const auto = def.buffs.autoParry > 0 && !guard;
        const parry = auto || (guard && d.time - def.player.guardReadyAt <= def.config.parryWindow);
        result.auto = auto;
        // Guard-bar cost uses the raw hit, before DEF and block reduction.
        if (parry) return { ...result, type: 'parry', amount: E.defended(def.config.parryDamage, atk.config.player.def), cost: auto ? 0 : E.guardCost(def, a.damage, true) };
        const crit = !guard && d.random() < atk.config.critChance;
        const raw = a.damage * (crit ? gameConfig.damage.critMultiplier : 1), incoming = E.defended(raw, def.config.player.def);
        return { ...result, type: guard ? 'block' : 'hit', crit, rear: !front, cost: guard ? E.guardCost(def, raw, false) : 0,
            amount: guard ? Math.round(incoming * def.config.blockMultiplier) : incoming,
            thorns: guard && def.config.guardThorns > 0 ? E.defended(raw * def.config.guardThorns, atk.config.player.def) : 0 };
    }
    function apply(d, r) {
        const i = r.i, j = 1 - i, atk = d.sides[i], def = d.sides[j];
        if (r.type === 'none') { if (r.blocked) r.a.blocked = true; return; }
        r.a.hit = true;
        // Hitstop for both, knockback for whoever was struck (the attacker, on a parry).
        if (r.type === 'parry') {
            if (r.auto) def.buffs.autoParry--;
            hurt(d, i, r.amount); stun(d, i);
            emit(d, j, 'parry', { damage: r.amount });
            E.impact(def, 'enemy', def.player, 'parry');
        } else if (r.type === 'block') {
            hurt(d, j, r.amount);
            emit(d, j, 'block', { damage: r.amount });
            E.impact(atk, 'enemy', r.a.origin, 'block');
            if (r.thorns) { hurt(d, i, r.thorns); emit(d, j, 'thorns', { damage: r.thorns }); }
        }
        // Paid after the hit is settled: the block that empties the bar still counts.
        if (r.cost) { E.spendGuard(def, r.cost); events(d, j); }
        if (['parry', 'block'].includes(r.type)) return;
        {
            hurt(d, j, r.amount); stun(d, j);
            emit(d, i, 'hit', { damage: r.amount, move: r.a.move, heavy: r.a.heavy, crit: r.crit, rear: r.rear });
            E.impact(atk, 'enemy', r.a.origin, 'hit');
        }
    }
    function step(d, dt = .01) {
        if (d.result || !Number.isFinite(dt) || dt <= 0 || dt > .05) return;
        d.time += dt; d.tick++;
        const ready = [], previous = d.sides.map(b => ({ ...b.player }));
        d.sides.forEach((b, i) => {
            b.enemy = previous[1 - i];
            E.advanceActor(b, dt, (_, slice, done) => ready.push({ i, slice, done }));
            events(d, i);
        });
        d.sides.forEach((b, i) => { b.enemy = d.sides[1 - i].player; });
        // Symmetric separation after both movement proposals (no host-first push).
        const [a, b] = d.sides.map(side => side.player), gap = S.distance(a, b), radius = a.radius + b.radius;
        S.separate(a, b, d.sides[0].config, d.sides[0].config.walls, previous);
        const results = ready.map(slice => judge(d, slice));
        for (const r of results) apply(d, r);
        // A parried swing already ended in stun; finishSwing ignores it.
        for (const { i, done } of ready) if (done) { E.finishSwing(d.sides[i]); events(d, i); }
        if (a.hp <= 0 || b.hp <= 0) end(d, a.hp <= 0 && b.hp <= 0 ? 'draw' : a.hp <= 0 ? 'guest' : 'host');
    }
    function end(d, result) {
        if (d.result) return;
        d.result = result;
        d.sides.forEach(b => { E.pause(b); b.result = result; });
        emit(d, 0, 'finished', { result });
    }
    const fields = ['player', 'buffs', 'motionBuffs', 'controls', 'move', 'action', 'guard', 'skill', 'queuedCommand', 'stats', 'inputVersion', 'actionInputVersion', 'skillPoints', 'skillProgress', 'time', 'elapsed', 'running', 'started', 'result'];
    function snapshot(d) {
        return { time: d.time, tick: d.tick, result: d.result,
            wallLayoutId: d.sides[0].config.wallLayoutId, wallVersion: d.sides[0].config.wallVersion,
            visibility: visibility(d),
            sides: d.sides.map(b => clone(Object.fromEntries(fields.map(key => [key, b[key]])))) };
    }
    function validSnapshot(d, snap) {
        if (!snap || snap.wallLayoutId !== d.sides[0].config.wallLayoutId || snap.wallVersion !== d.sides[0].config.wallVersion ||
            !Number.isFinite(snap.time) || snap.time < 0 || !Number.isSafeInteger(snap.tick) || snap.tick < 0 ||
            ![null, 'host', 'guest', 'draw'].includes(snap.result) || !Array.isArray(snap.visibility) ||
            snap.visibility.length !== 2 || !snap.visibility.every(value => typeof value === 'boolean') ||
            !Array.isArray(snap.sides) || snap.sides.length !== 2) return false;
        return snap.sides.every((b, i) => {
            const p = b?.player, C = d.sides[i].config;
            if (!p || ![p.x, p.y, p.hp, p.maxHp, p.facing, p.guardBar, p.timer, p.charge, b.time, b.elapsed].every(Number.isFinite) ||
                p.maxHp !== C.player.maxHp || p.radius !== C.player.radius || p.hp < 0 || p.hp > p.maxHp ||
                p.guardBar < 0 || p.guardBar > C.guardMax + 1e-9 || typeof p.guardLocked !== 'boolean' ||
                (p.freeze != null && !(Number.isFinite(p.freeze) && p.freeze >= 0 && p.freeze <= 1)) ||
                (p.push != null && ![p.push.x, p.push.y, p.push.t].every(Number.isFinite)) ||
                p.x < p.radius || p.x > C.width - p.radius || p.y < p.radius || p.y > C.height - p.radius ||
                p.timer < 0 || p.charge < 0 || p.charge > C.fullCharge || !['idle','charging','poise','attack','swing','recover','stunned','guard_start','guard'].includes(p.phase) ||
                !Number.isSafeInteger(b.inputVersion) || !Number.isSafeInteger(b.actionInputVersion) ||
                !Number.isInteger(b.skillPoints) || b.skillPoints < 0 || b.skillPoints > C.skillPointMax || !Number.isFinite(b.skillProgress) || b.skillProgress < 0 || b.skillProgress >= 1 || !b.buffs || !b.controls || !b.stats || !Array.isArray(b.motionBuffs)) return false;
            if (['attack','swing','recover'].includes(p.phase)) {
                const a = p.attack;
                if (!a?.shape || !a.origin || !C.combo.moves[a.move] || ![a.origin.x,a.origin.y,a.facing,a.damage,a.shape.range,a.shape.arc,a.progress,a.stagger].every(Number.isFinite) ||
                    a.shape.kind !== 'sector' || a.shape.range <= 0 || a.shape.arc <= 0 || a.shape.arc > Math.PI * 2 + 1e-9 ||
                    ![1, -1].includes(a.sweep) || a.progress < 0 || a.progress > 1 || typeof a.hit !== 'boolean') return false;
            }
            if (p.chain != null && (!C.combo.moves[p.chain.move] || !Number.isFinite(p.chain.at) || p.chain.at > b.time ||
                (p.chain.cued != null && typeof p.chain.cued !== 'boolean'))) return false;
            if (b.move?.mode === 'hold' && !C.combo.moves[b.move.derived]) return false;
            if (b.queuedCommand?.type === 'hold' && !C.combo.moves[b.queuedCommand.move]) return false;
            if (['tap', 'hold'].includes(b.queuedCommand?.type) && !(Number.isFinite(b.queuedCommand.queuedAt) && b.queuedCommand.queuedAt <= b.time)) return false;
            return true;
        });
    }
    function restore(d, snap) {
        d.time = snap.time; d.tick = snap.tick; d.result = snap.result;
        d.visibility = snap.visibility.slice();
        d.sides.forEach((b, i) => {
            const data = clone(snap.sides[i]);
            for (const key of fields) b[key] = data[key];
            if (b.queuedCommand?.type === 'input') b.queuedCommand.gesture = b.action;
            if (b.queuedCommand?.type === 'guard') b.queuedCommand.gesture = b.guard;
            b.events.length = 0;
        });
        d.sides.forEach((b, i) => { b.enemy = d.sides[1 - i].player; });
    }
    // Client prediction advances only the local actor. HP/outcomes stay authoritative.
    function predictInput(d, i, command) {
        const hp = d.sides[i].player.hp;
        const skillPoints = d.sides[i].skillPoints, skillProgress = d.sides[i].skillProgress;
        const accepted = input(d, i, command);
        d.sides[i].player.hp = hp;
        d.sides[i].skillPoints = skillPoints; d.sides[i].skillProgress = skillProgress;
        return accepted;
    }
    function predict(d, i, dt) {
        const hp = d.sides[i].player.hp;
        const skillPoints = d.sides[i].skillPoints, skillProgress = d.sides[i].skillProgress;
        // Prediction never judges hits; a predicted swing ends silently and the
        // host's strike/miss events arrive with the snapshot.
        E.advanceActor(d.sides[i], dt, (b, _, done) => { if (done) E.finishSwing(b, true); });
        events(d, i);
        d.sides[i].player.hp = hp;
        d.sides[i].skillPoints = skillPoints; d.sides[i].skillProgress = skillProgress;
    }
    return { create, input, step, end, snapshot, validSnapshot, restore, predict, predictInput, visibility, SKILL_COSTS };
})();
