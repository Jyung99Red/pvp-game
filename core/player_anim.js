// The main character's pose as a pure function of simulation state
// (3d-migration-concept.md 12.1): stance, walk, run, moves, shield and
// flinch depend only on what the simulation holds, so the host and a guest
// pose a body the same way, and a hit test sees what is drawn. `present`
// adds what is drawn but never tested (breathing, leaning, trembling).
const playerAnim = (() => {
    const cycles = new WeakMap();
    const BLEND = () => gameConfig.animation.blendSeconds;
    const clamp01 = v => Math.min(1, Math.max(0, v));
    const easeOut = t => 1 - (1 - t) * (1 - t);
    const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const smooth = t => t * t * (3 - 2 * t);
    const footOf = (rig, side) => rig.parts.findIndex(p => p.tag === 'foot' && rig.bones[p.bone].name === `shin${side}`);

    // Catmull-Rom through a closed loop of poses; phase in [0, 1).
    function loop(keys, phase) {
        const n = keys.length, f = ((phase % 1) + 1) % 1 * n, i = Math.floor(f), t = f - i;
        const P = k => keys[((i + k) % n + n) % n];
        const t2 = t * t, t3 = t2 * t;
        const w = [0.5 * (-t + 2 * t2 - t3), 0.5 * (2 - 5 * t2 + 3 * t3), 0.5 * (t + 4 * t2 - 3 * t3), 0.5 * (t3 - t2)];
        return rigKit.add(...[-1, 0, 1, 2].map((k, j) => rigKit.scale(P(k), w[j])));
    }
    // A gait's two keys and their mirrors: contact, passing, other contact, other passing.
    const cycleKeys = list => [list[0], list[1], rigKit.mirror(list[0]), rigKit.mirror(list[1])];
    const gait = (part, phase, runBlend) => rigKit.mix(loop(cycleKeys(playerPoses.walk[part]), phase), loop(cycleKeys(playerPoses.run[part]), phase), runBlend);

    // Raise or lower the whole body so its lowest box rests on the ground.
    function grounded(rig, pose) {
        const low = rigKit.lowest(rig, rigKit.solve(rig, pose));
        return rigKit.add(pose, { base: { py: -low / rig.scale } });
    }
    function legs(phase, moveBlend, runBlend) {
        return rigKit.mix(rigKit.pick(playerPoses.stance, playerModel.layers.lower), gait('legs', phase, runBlend), moveBlend);
    }
    // World units covered by one full cycle (two steps) of a pure gait: twice
    // how far a planted foot travels backwards between contact and the
    // mirrored contact, so feet do not slide whatever the key angles.
    function measure(rig, runBlend) {
        const foot = footOf(rig, 'R');
        const z = phase => rigKit.solve(rig, grounded(rig, legs(phase, 1, runBlend))).parts[foot][14];
        const length = 2 * (z(0) - z(0.5)) * gameConfig.world.unitsPerBlock;
        if (!(length > 0)) throw new Error('Gait keys must move the planted foot backwards');
        return length;
    }
    // Cycle length for a walk-to-run blend; the simulation advances the gait
    // phase by distance over this.
    function cycleLength(rig, runBlend = 0) {
        if (!cycles.has(rig)) cycles.set(rig, { walk: measure(rig, 0), run: measure(rig, 1) });
        const c = cycles.get(rig);
        return c.walk + (c.run - c.walk) * runBlend;
    }
    function locomotion(body) {
        const P = playerPoses, run = body.runBlend || 0;
        const upper = rigKit.add(rigKit.pick(P.stance, playerModel.layers.upper), rigKit.scale(gait('arms', body.gait, run), body.moveBlend));
        return rigKit.add(legs(body.gait, body.moveBlend, run), upper);
    }
    // A move in progress, `act` = { move, phase, t, from }: the windup eases
    // from wherever the previous move's recovery had got to (or the stance)
    // into key `a`; the swing goes `a` to `b`; the recovery back to stance.
    function movePose(act) {
        const K = playerMoves.moves[act.move], m = gameConfig.combo.moves[act.move], stance = playerPoses.stance;
        if (act.phase === 'windup') {
            const from = act.from ? movePose({ move: act.from.move, phase: 'recover', t: act.from.t }) : stance;
            return rigKit.mix(from, K.a, easeOut(clamp01(m.windup > 0 ? act.t / m.windup : 1)));
        }
        if (act.phase === 'charge') return K.a;
        if (act.phase === 'swing') return rigKit.mix(K.a, K.b, smooth(clamp01(act.t / m.swing)));
        return rigKit.mix(K.b, stance, easeInOut(clamp01(act.t / m.recovery)));
    }

    // The judged pose. `body` needs { gait, moveBlend, runBlend }, and for a
    // fighter { act, guardBlend, stun }.
    function pose(rig, body) {
        let pose = locomotion(body);
        const act = body.act;
        if (act) {
            // Out of a walk the move cross-fades in; out of a move it does not need to.
            const w = act.from || act.phase !== 'windup' ? 1 : clamp01(act.t / BLEND());
            let moving = movePose(act);
            // Charging may walk: the legs walk under the held charge, like
            // under a raised shield.
            if (act.phase === 'charge') {
                const lower = playerModel.layers.lower;
                moving = { ...moving, ...rigKit.mix(rigKit.pick(moving, lower), rigKit.pick(pose, lower), body.moveBlend) };
            }
            pose = rigKit.mix(pose, moving, w);
        }
        if (body.guardBlend > 0) {
            const raised = { ...rigKit.pick(pose, playerModel.layers.lower), ...playerMoves.guard };
            pose = rigKit.mix(pose, raised, body.guardBlend);
        }
        if (body.stun > 0) {
            // Thrown back over the first fifth of the stun, then easing back.
            const left = clamp01(body.stun / gameConfig.combat.hitStun), k = left > 0.8 ? (1 - left) / 0.2 : left / 0.8;
            pose = rigKit.add(pose, rigKit.scale(playerMoves.flinch, k));
        }
        return grounded(rig, pose);
    }
    // Drawn-only additions. `look` = { time, lean } (lean in radians).
    function present(judged, body, look) {
        const B = playerPoses.breath, s = Math.sin(look.time * B.rate) * (1 - body.moveBlend) * (body.act ? 0 : 1);
        const shake = body.act?.phase === 'charge' ? Math.sin(look.time * 70) * 0.012 : 0;
        return rigKit.add(judged, {
            base: { rz: look.lean || 0 },
            chest: { rx: B.chest * s, ry: shake }, head: { rx: B.head * s },
            upperArmR: { rz: -B.arms * s, ry: shake }, upperArmL: { rz: B.arms * s }
        });
    }
    return { pose, present, movePose, cycleLength, loop };
})();
