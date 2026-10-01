// Fighting rules every fighter shares: damage, impact (hitstop and
// knockback), the guard bar, and the hit test itself. A hit is a weapon box
// touching a body box (3d-migration-concept.md 4.1): the attacker's swing is
// sampled at sub-steps between simulation steps so a fast blade cannot pass
// through a thin limb.
const combatKit = (() => {
    const C = () => gameConfig.combat;

    function defended(raw, def = 0) {
        return Math.max(1, Math.round(raw * (1 - def / (def + C().damage.defenseConstant))));
    }
    function emit(sim, type, data = {}) { sim.events.push({ type, time: sim.time, ...data }); }

    // Take hit points. A body marked `endless` (training) is refilled
    // instead of falling.
    function damage(sim, body, amount) {
        body.hp = Math.max(0, body.hp - amount);
        if (body.hp === 0 && body.endless) { body.hp = body.maxHp; emit(sim, 'refilled', { side: body.side }); }
    }

    // On contact both fighters' clocks stop for the hitstop; then the one
    // struck is pushed `distance` world units straight away from the other.
    function impact(sim, victim, attacker, kind, distance = C().impact.knockback[kind]) {
        const I = C().impact, stop = I.hitstop[kind] || 0;
        for (const body of [victim, attacker]) body.freeze = Math.max(body.freeze || 0, stop);
        if (victim.anchored || !(distance > 0)) return;
        const dx = victim.x - attacker.x, dy = victim.y - attacker.y, len = Math.hypot(dx, dy);
        if (len < 1e-9) return;
        const speed = distance / I.knockbackSeconds;
        victim.push = { x: dx / len * speed, y: dy / len * speed, t: I.knockbackSeconds };
    }
    // Knockback plays out after the hitstop, with ordinary collision.
    function tickPush(sim, body, dt, obstacles) {
        const k = body.push, span = Math.min(dt, k.t);
        terrainKit.moveCircle(sim.terrain, body, k.x * span, k.y * span, obstacles);
        k.t -= span;
        if (k.t <= 1e-9) body.push = null;
    }

    // ---- guard bar (combat-combo-concept.md 7) ----
    function guardCost(raw, maxHp, parry) {
        const G = C().guardBar;
        return raw / maxHp * G.blockCostScale * G.max * (parry ? G.parryCostRatio : 1);
    }
    // Every guard cost goes through here. An empty bar drops the shield and
    // locks it until the bar refills to unlockRatio.
    function spendGuard(sim, body, amount) {
        const g = body.guard;
        g.bar = Math.max(0, g.bar - amount);
        if (g.bar > 1e-9) return;
        g.bar = 0; g.locked = true; g.state = 'down'; g.queued = false;
        emit(sim, 'guard_broken', { side: body.side });
    }
    function tickGuardBar(sim, body, dt) {
        const g = body.guard, G = C().guardBar;
        if (g.state !== 'down') { spendGuard(sim, body, G.holdDrain * dt); return; }
        if (g.bar >= G.max) return;
        g.bar = Math.min(G.max, g.bar + G.max / G.refillSeconds * dt);
        if (g.locked && g.bar >= G.max * G.unlockRatio - 1e-9) { g.locked = false; emit(sim, 'guard_ready', { side: body.side }); }
    }

    // ---- hit test ----
    const UNIT = () => gameConfig.world.unitsPerBlock;
    // Body boxes of a fighter as it stands now.
    function hurtboxes(rig, solved) { return rigKit.boxes(rig, solved, ['body']).map(b => b.box); }
    // Weapon boxes, grown by `pad` blocks on every side.
    function weaponBoxes(rig, solved, pad) {
        return rigKit.boxes(rig, solved, ['weapon']).map(({ box }) => ({ ...box, h: box.h.map(v => v + pad) }));
    }
    const thinnest = boxes => Math.min(...boxes.map(b => 2 * Math.min(...b.h)));
    // How far the weapon's corners travel between two solved states.
    function travel(rig, s0, s1) {
        let far = 0;
        const w0 = weaponBoxes(rig, s0, 0), w1 = weaponBoxes(rig, s1, 0);
        w0.forEach((box, i) => {
            const c0 = math3d.corners(box), c1 = math3d.corners(w1[i]);
            c0.forEach((p, k) => { far = Math.max(far, math3d.length(math3d.sub(p, c1[k]))); });
        });
        return far;
    }
    // Sample the attacker's swing from progress u0 to u1. `solveAt(u)` gives
    // the attacker's solved rig at progress u; targets are { id, boxes }
    // (body boxes, already solved). Returns the first contact, or null.
    function sweep(rig, solveAt, u0, u1, targets) {
        if (!targets.length || !(u1 > u0)) return null;
        const pad = C().weaponPad / UNIT();
        const first = solveAt(u0), last = solveAt(u1);
        const n = math3d.substeps(travel(rig, first, last), Math.min(...targets.map(t => thinnest(t.boxes))));
        for (let k = 1; k <= n; k++) {
            const solved = k === n ? last : solveAt(u0 + (u1 - u0) * k / n);
            for (const weapon of weaponBoxes(rig, solved, pad)) {
                for (const target of targets) {
                    const box = target.boxes.find(b => math3d.overlap(weapon, b));
                    if (box) return { id: target.id, point: weapon.c.map((v, i) => (v + box.c[i]) / 2), u: u0 + (u1 - u0) * k / n };
                }
            }
        }
        return null;
    }
    // Is `from` within the guard's front arc of `body`?
    function inFront(body, from) {
        const toward = Math.atan2(from.y - body.y, from.x - body.x);
        return Math.abs(space.wrapAngle(toward - body.facing)) <= C().guard.frontAngle + 1e-9;
    }
    return { defended, emit, damage, impact, tickPush, guardCost, spendGuard, tickGuardBar, hurtboxes, weaponBoxes, sweep, inFront };
})();
