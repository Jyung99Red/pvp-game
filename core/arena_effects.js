// arena_effects.js - Battlefield (arena) effect system, pure logic.
// An arena effect changes the battle ENVIRONMENT over time -- AP recovery
// surging, burning ground -- as opposed to either side's stats or the
// exchange judgment. Definitions live in a registry (same pattern as
// EFFECT_REGISTRY and the resolver's exchange rules): adding a new
// environmental mechanic = one arenaEffects.register() call.
//
// Usage (see pve_logic): the engine calls create() with the enemy's
// content.enemies[key].arena entries when a fight starts, then drives the
// returned arena state once per frame with tick(). tick() returns events
// ({ type:'log'|'damage', ... }) that the CALLER applies -- this module
// never touches DOM, network, or global state, so PVP could reuse it by
// having the Host run it and broadcast the resulting damage like any other
// judgment result.

const arenaEffects = (() => {

    const _defs = {};   // key -> { defaults, tick(inst, arena, ctx, dt, emit) }

    // Re-registering a key overwrites it -- deliberate, so a variant can
    // replace a built-in without editing this file.
    function register(key, def) { _defs[key] = def; }

    // entries: array of 'key' strings or { key, ...opts } objects (straight
    // from content data); opts override the definition's defaults per-use.
    // Returns null when there is nothing to run so callers can cheaply skip.
    function create(entries) {
        if (!entries || !entries.length) return null;
        const list = [];
        for (const entry of entries) {
            const key = typeof entry === 'string' ? entry : entry.key;
            const def = _defs[key];
            if (!def) continue;
            const opts = Object.assign({}, def.defaults,
                                       typeof entry === 'object' ? entry : null);
            list.push({ key, opts, vars: {} });   // vars: per-instance scratch state
        }
        return list.length ? { elapsedMs: 0, apRateMult: 1, list } : null;
    }

    // ctx: { player, enemy } side-state objects, read-only here -- damage
    // goes out as events for the caller to apply (it owns death handling).
    // apRateMult is recomputed from 1 every frame so effects stay stateless
    // about it (an effect that ends just stops multiplying).
    function tick(arena, ctx, dt) {
        if (!arena) return [];
        arena.elapsedMs += dt;
        arena.apRateMult = 1;
        const events = [];
        const emit = ev => events.push(ev);
        for (const inst of arena.list) {
            _defs[inst.key].tick(inst, arena, ctx, dt, emit);
        }
        return events;
    }

    // ── Built-in effects ─────────────────────────────────────────────────

    // AP surge: past atMs, BOTH sides recover AP apRateMult times faster --
    // the whole fight shifts up-tempo. Announce log fires once on the
    // transition frame.
    register('ap_surge', {
        defaults: {
            atMs: 30000,
            apRateMult: 2,
            logText: '🌀 战场涌动！双方行动力恢复加速'
        },
        tick(inst, arena, ctx, dt, emit) {
            if (arena.elapsedMs < inst.opts.atMs) return;
            if (!inst.vars.announced) {
                inst.vars.announced = true;
                emit({ type: 'log', text: inst.opts.logText });
            }
            arena.apRateMult *= inst.opts.apRateMult;
        }
    });

    // Burning ground: from startMs on, every intervalMs BOTH sides take pct
    // of their own maxHp (min 1) as environmental damage -- a shared clock
    // that punishes stalling. First interval starts counting at the
    // announce frame, so the initial burn lands startMs + intervalMs in.
    register('burning_ground', {
        defaults: {
            startMs: 20000,
            intervalMs: 3000,
            pct: 0.03,
            logText: '🔥 地面燃起烈焰！双方持续受到灼烧'
        },
        tick(inst, arena, ctx, dt, emit) {
            if (arena.elapsedMs < inst.opts.startMs) return;
            if (!inst.vars.announced) {
                inst.vars.announced = true;
                inst.vars.nextBurnAt = arena.elapsedMs + inst.opts.intervalMs;
                emit({ type: 'log', text: inst.opts.logText });
                return;
            }
            if (arena.elapsedMs >= inst.vars.nextBurnAt) {
                inst.vars.nextBurnAt += inst.opts.intervalMs;
                const playerDmg = Math.max(1, Math.round(ctx.player.maxHp * inst.opts.pct));
                const enemyDmg  = Math.max(1, Math.round(ctx.enemy.maxHp  * inst.opts.pct));
                emit({
                    type: 'damage', playerDmg, enemyDmg,
                    text: `🔥 灼烧！双方受到 ${playerDmg} / ${enemyDmg} 点伤害`
                });
            }
        }
    });

    return { register, create, tick };
})();
