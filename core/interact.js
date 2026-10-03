// The interact key (design.md 3.5): one target at a time, picked from the entities in reach that offer
// something (core/props.js offer), nearest first with a penalty for being
// off to the side, so the one ahead of a fighter wins over one behind. The
// target holds on a little past its reach, so the prompt does not flicker
// at the edge. Pressing the key does the target's action at once, or for an
// action with a `hold` (opening a chest) starts filling a bar that runs
// while the key stays down and the target stays the same and ready.
// Nothing works in a fight: a monster after the fighter greys it out.
// With nothing in reach, or in a fight, the key uses the offhand item
// instead (a potion, a torch: core/fighter.js).
//
// On a fighter: focus (the target's id, or null) and using ({ id, t } while
// a hold fills, else null).
const interactKit = (() => {
    const I = () => gameConfig.interact;
    // Fighting: any monster noticing, chasing, attacking or reeling.
    function inCombat(sim, p) { return sim.monsters.some(m => monsterKit.engaged(m)); }
    function offerOf(sim, e, p) {
        const kit = entityKit.kitOf(e);
        return kit.offer && entityKit.present(e) ? kit.offer(sim, e, p) : null;
    }
    // The best target for `p` now, or null.
    function pick(sim, p) {
        const S = I();
        let best = null, score = Infinity;
        for (const e of sim.entities) {
            const held = e.id === p.focus, d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d > (held ? S.release : S.reach)) continue;
            if (!offerOf(sim, e, p)) continue;
            const off = d > 1e-6 ? Math.abs(space.wrapAngle(Math.atan2(e.y - p.y, e.x - p.x) - p.facing)) : 0;
            const s = d + off * S.facingWeight - (held ? S.holdBonus : 0);
            if (s < score) { score = s; best = e; }
        }
        return best;
    }
    // The current target and what it offers, for the screen: null or
    // { entity, offer, progress (0..1 of a hold under way) }.
    function target(sim, p) {
        const e = p.focus ? entityKit.byId(sim, p.focus) : null, offer = e && offerOf(sim, e, p);
        if (!offer) return null;
        const progress = p.using && p.using.id === e.id && offer.hold > 0 ? Math.min(1, p.using.t / offer.hold) : 0;
        return { entity: e, offer, progress };
    }
    function press(sim, p) {
        const t = target(sim, p);
        if (!t || !t.offer.ready) return false;
        if (t.offer.hold > 0) { p.using = { id: t.entity.id, t: 0 }; return true; }
        entityKit.kitOf(t.entity).use(sim, t.entity, p);
        return true;
    }
    // Whether a press goes to the offhand item rather than a target.
    function usesItem(sim, p) { return inCombat(sim, p) || !target(sim, p); }
    function release(sim, p) { p.using = null; }
    function tick(sim, p, dt) {
        const e = pick(sim, p);
        p.focus = e ? e.id : null;
        const u = p.using;
        if (!u) return;
        const t = target(sim, p);
        if (!t || t.entity.id !== u.id || !t.offer.ready || !p.input.buttons.interact.held) { p.using = null; return; }
        u.t += dt;
        if (u.t >= t.offer.hold - 1e-9) { p.using = null; entityKit.kitOf(t.entity).use(sim, t.entity, p); }
    }
    return { inCombat, pick, target, usesItem, press, release, tick };
})();
