// Two human actors, one simulation clock. No network, DOM or progression writes.
const spatialDuel = (() => {
    const E = spatialEngine, S = spatialCombat;
    const SKILL_COSTS = Object.freeze({ heal: 2, haste: 2, full: 2, parry: 3 });
    const clone = value => JSON.parse(JSON.stringify(value));
    function create(profiles, random = Math.random) {
        const normalized = profiles.map(spatialProfiles.normalize);
        const sides = normalized.map((profile, i) => {
            const C = spatialProfiles.apply(clone(spatialData.training), profile);
            C.formal = true; C.pvp = true;
            C.width = 510; C.height = 566;
            C.camera = { width: 396, height: 440, followRate: 12, leadRate: 8, leadSeconds: .16, maxLead: 24 };
            Object.assign(C.player, { x: C.width / 2, y: C.height / 2 + (i ? -90 : 90), facing: i ? Math.PI / 2 : -Math.PI / 2 });
            Object.assign(C.enemy, { x: C.width / 2, y: C.height / 2 + (i ? 90 : -90), radius: 12 });
            const b = E.create(C, random); b.skillPoints = 0; E.start(b); return b;
        });
        sides.forEach((b, i) => { b.enemy = sides[1 - i].player; });
        return { profiles: normalized, sides, time: 0, tick: 0, result: null, events: [], random };
    }
    function emit(d, actor, type, extra = {}) { d.events.push({ type, actor, time: d.time, ...extra }); }
    function skill(d, i, kind, queued = true) {
        const b = d.sides[i], cost = SKILL_COSTS[kind];
        if (d.result || !cost || b.skillPoints < cost || (kind === 'heal' && b.player.hp >= b.player.maxHp)) return false;
        if (queued && E.queueSkill(b, kind)) return true;
        if (!E.useSkill(b, kind)) return false;
        b.skillPoints -= cost; emit(d, i, 'skill_used', { kind }); return true;
    }
    function events(d, i) {
        for (const e of E.drainEvents(d.sides[i])) {
            if (e.type === 'skill_ready') skill(d, i, e.kind, false);
            else { const { side, ...rest } = e; d.events.push({ ...rest, actor: side === 'enemy' ? 1 - i : i }); }
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
            if (!['move', 'action', 'guard', 'skill'].includes(channel)) return false;
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
        emit(d, i, 'hp_changed', { previous, hp: p.hp });
    }
    function stun(d, i) {
        const b = d.sides[i]; E.cancelInputs(b, true);
        b.player.phase = 'stunned'; b.player.timer = b.config.hitStun;
    }
    // Decide from the same post-movement snapshot, then apply all effects.
    // Stage two will add spatial clash rules here; there is no legacy time-only clash.
    function judge(d, i) {
        const atk = d.sides[i], def = d.sides[1 - i], a = atk.player.attack;
        const result = { i, a, type: 'miss' };
        if (!S.contains(a.shape, a.origin, a.facing, def.player)) return result;
        const front = Math.abs(S.angleDelta(S.facing(def.player, a.origin), def.player.facing)) <= Math.PI / 2;
        const guard = def.player.phase === 'guard' && front && def.player.ap >= 1;
        const auto = def.buffs.autoParry > 0 && !guard;
        const parry = auto || (guard && d.time - def.player.guardReadyAt <= def.config.parryWindow);
        result.auto = auto;
        if (parry) return { ...result, type: 'parry', amount: E.defended(def.config.parryDamage, atk.config.player.def) };
        const crit = !guard && d.random() < atk.config.critChance;
        const raw = a.damage * (crit ? 1.5 : 1), incoming = E.defended(raw, def.config.player.def);
        return { ...result, type: guard ? 'block' : 'hit', crit, rear: !front,
            amount: guard ? Math.round(incoming * def.config.blockMultiplier) : incoming,
            thorns: guard && def.config.guardThorns > 0 ? E.defended(raw * def.config.guardThorns, atk.config.player.def) : 0 };
    }
    function apply(d, r) {
        const i = r.i, j = 1 - i, atk = d.sides[i], def = d.sides[j];
        emit(d, i, 'strike', { shape: r.a.shape, origin: r.a.origin, facing: r.a.facing });
        if (r.type === 'miss') { emit(d, i, 'miss'); return; }
        if (r.type === 'parry') {
            if (r.auto) def.buffs.autoParry--;
            else def.player.ap = Math.max(0, def.player.ap - def.config.parryCost);
            hurt(d, i, r.amount); stun(d, i);
            def.skillPoints = Math.min(3, def.skillPoints + 1);
            emit(d, j, 'parry', { damage: r.amount });
        } else if (r.type === 'block') {
            def.player.ap = Math.max(0, def.player.ap - 1); hurt(d, j, r.amount);
            emit(d, j, 'block', { damage: r.amount });
            if (r.thorns) { hurt(d, i, r.thorns); emit(d, j, 'thorns', { damage: r.thorns }); }
        } else {
            hurt(d, j, r.amount); stun(d, j); atk.skillPoints = Math.min(3, atk.skillPoints + 1);
            emit(d, i, 'hit', { damage: r.amount, heavy: r.a.heavy, crit: r.crit, rear: r.rear });
        }
    }
    function step(d, dt = .01) {
        if (d.result || !Number.isFinite(dt) || dt <= 0 || dt > .05) return;
        d.time += dt; d.tick++;
        const ready = [], previous = d.sides.map(b => ({ ...b.player }));
        d.sides.forEach((b, i) => {
            b.enemy = previous[1 - i];
            E.advanceActor(b, dt, () => ready.push(i));
            events(d, i);
        });
        d.sides.forEach((b, i) => { b.enemy = d.sides[1 - i].player; });
        // Symmetric separation after both movement proposals (no host-first push).
        const [a, b] = d.sides.map(side => side.player), gap = S.distance(a, b), radius = a.radius + b.radius;
        const { width, height } = d.sides[0].config;
        if (gap < radius) {
            const dx = gap > 1e-9 ? (b.x - a.x) / gap : 0, dy = gap > 1e-9 ? (b.y - a.y) / gap : -1;
            for (let pass = 0; pass < 2; pass++) {
                const push = Math.max(0, radius - S.distance(a, b)) / 2;
                a.x = S.clamp(a.x - dx * push, a.radius, width - a.radius); a.y = S.clamp(a.y - dy * push, a.radius, height - a.radius);
                b.x = S.clamp(b.x + dx * push, b.radius, width - b.radius); b.y = S.clamp(b.y + dy * push, b.radius, height - b.radius);
            }
            if (S.distance(a, b) < radius - 1e-7) {
                Object.assign(a, { x: previous[0].x, y: previous[0].y });
                Object.assign(b, { x: previous[1].x, y: previous[1].y });
            }
        }
        const results = ready.map(i => judge(d, i));
        for (const i of ready) { const b = d.sides[i]; b.player.phase = 'recover'; b.player.timer = b.player.attack.shape.recovery; }
        for (const r of results) apply(d, r);
        if (a.hp <= 0 || b.hp <= 0) end(d, a.hp <= 0 && b.hp <= 0 ? 'draw' : a.hp <= 0 ? 'guest' : 'host');
    }
    function end(d, result) {
        if (d.result) return;
        d.result = result;
        d.sides.forEach(b => { E.pause(b); b.result = result; });
        emit(d, 0, 'finished', { result });
    }
    const fields = ['player', 'buffs', 'motionBuffs', 'controls', 'move', 'action', 'guard', 'skill', 'queuedCommand', 'stats', 'inputVersion', 'actionInputVersion', 'skillPoints', 'time', 'elapsed', 'running', 'started', 'result'];
    function snapshot(d) {
        return { time: d.time, tick: d.tick, result: d.result,
            sides: d.sides.map(b => clone(Object.fromEntries(fields.map(key => [key, b[key]])))) };
    }
    function validSnapshot(d, snap) {
        if (!snap || !Number.isFinite(snap.time) || snap.time < 0 || !Number.isSafeInteger(snap.tick) || snap.tick < 0 ||
            ![null, 'host', 'guest', 'draw'].includes(snap.result) || !Array.isArray(snap.sides) || snap.sides.length !== 2) return false;
        return snap.sides.every((b, i) => {
            const p = b?.player, C = d.sides[i].config;
            if (!p || ![p.x, p.y, p.hp, p.maxHp, p.facing, p.ap, p.timer, p.charge, b.time, b.elapsed].every(Number.isFinite) ||
                p.maxHp !== C.player.maxHp || p.radius !== C.player.radius || p.hp < 0 || p.hp > p.maxHp || p.ap < 0 || p.ap > C.apMax ||
                p.x < p.radius || p.x > C.width - p.radius || p.y < p.radius || p.y > C.height - p.radius ||
                p.timer < 0 || p.charge < 0 || p.charge > C.fullCharge || !['idle','charging','attack','recover','stunned','guard_start','guard'].includes(p.phase) ||
                !Number.isSafeInteger(b.inputVersion) || !Number.isSafeInteger(b.actionInputVersion) ||
                !Number.isInteger(b.skillPoints) || b.skillPoints < 0 || b.skillPoints > 3 || !b.buffs || !b.controls || !b.stats || !Array.isArray(b.motionBuffs)) return false;
            if (['attack','recover'].includes(p.phase)) {
                const a = p.attack;
                if (!a?.shape || !a.origin || ![a.origin.x,a.origin.y,a.facing,a.damage,a.shape.range,a.shape.arc,a.shape.windup,a.shape.recovery].every(Number.isFinite) ||
                    a.shape.kind !== 'sector' || a.shape.range <= 0 || a.shape.windup <= 0 || a.shape.recovery <= 0) return false;
            }
            return true;
        });
    }
    function restore(d, snap) {
        d.time = snap.time; d.tick = snap.tick; d.result = snap.result;
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
        const accepted = input(d, i, command);
        d.sides[i].player.hp = hp;
        return accepted;
    }
    function predict(d, i, dt) {
        const hp = d.sides[i].player.hp;
        E.advanceActor(d.sides[i], dt, b => { b.player.phase = 'recover'; b.player.timer = b.player.attack.shape.recovery; });
        events(d, i);
        d.sides[i].player.hp = hp;
    }
    return { create, input, step, end, snapshot, validSnapshot, restore, predict, predictInput, SKILL_COSTS };
})();
