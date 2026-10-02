// The main character's pose as a pure function of simulation state
// (design.md 2.3): stance, walk, run, moves, shield and
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
    // A pure gait, measured once per skeleton. `length`: world units covered
    // by one full cycle (two steps), twice how far a planted foot travels
    // backwards between contact and the mirrored contact. `slip`: the keys
    // swing the legs on curves, so over the half cycle a foot is down it
    // would still drift a little against the body's even progress; the
    // table holds that drift (blocks, at PLANT samples), and the body is
    // shifted back by it so the planted foot stays put.
    const PLANT = 24;
    function measure(rig, runBlend) {
        const foot = footOf(rig, 'R');
        const z = phase => rigKit.solve(rig, grounded(rig, legs(phase, 1, runBlend))).parts[foot][14];
        const z0 = z(0), half = z0 - z(0.5), length = 2 * half * gameConfig.world.unitsPerBlock;
        if (!(length > 0)) throw new Error('Gait keys must move the planted foot backwards');
        const slip = [];
        for (let i = 0; i <= PLANT; i++) { const u = i / PLANT; slip.push(z(u / 2) - (z0 - u * half)); }
        return { length, slip };
    }
    const gaitOf = rig => {
        if (!cycles.has(rig)) cycles.set(rig, { walk: measure(rig, 0), run: measure(rig, 1) });
        return cycles.get(rig);
    };
    // Cycle length for a walk-to-run blend; the simulation advances the gait
    // phase by distance over this.
    function cycleLength(rig, runBlend = 0) {
        const c = gaitOf(rig);
        return c.walk.length + (c.run.length - c.walk.length) * runBlend;
    }
    // How far to shift the body (model units, along its facing) at a gait
    // phase so that the planted foot does not slide.
    function plant(rig, phase, runBlend) {
        const c = gaitOf(rig), f = ((phase % 0.5) + 0.5) % 0.5 * 2 * PLANT, i = Math.min(PLANT - 1, Math.floor(f)), t = f - i;
        const at = table => table[i] + (table[i + 1] - table[i]) * t;
        return -(at(c.walk.slip) + (at(c.run.slip) - at(c.walk.slip)) * runBlend) / rig.scale;
    }
    function locomotion(rig, body) {
        const P = playerPoses, run = body.runBlend || 0;
        const upper = rigKit.add(rigKit.pick(P.stance, playerModel.layers.upper), rigKit.scale(gait('arms', body.gait, run), body.moveBlend));
        const lower = rigKit.add(legs(body.gait, body.moveBlend, run), { base: { pz: plant(rig, body.gait, run) * body.moveBlend } });
        return rigKit.add(lower, upper);
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
    // fighter { act, guardBlend, stun, down, downT, drink, loadout }.
    function pose(rig, body) {
        let pose = locomotion(rig, body);
        const act = body.act, lowerBody = playerModel.layers.lower;
        // A torch is carried up and forward when the arm is not busy.
        if (!act && inventoryKit.offhandOf(body.loadout) === 'torch') pose = { ...pose, ...playerMoves.torch };
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
            const raised = { ...rigKit.pick(pose, lowerBody), ...playerMoves.guard };
            pose = rigKit.mix(pose, raised, body.guardBlend);
        }
        // Drinking: the flask comes up over a fifth of a second, stays, and
        // goes down over the last tenth.
        const d = body.drink;
        if (d?.phase === 'drink') {
            const S = gameConfig.combat.potion.seconds, k = Math.min(clamp01(d.t / 0.2), clamp01((S - d.t) / 0.1));
            pose = rigKit.mix(pose, { ...rigKit.pick(pose, lowerBody), ...playerMoves.drink }, smooth(k));
        }
        if (body.down) pose = rigKit.mix(pose, playerMoves.down, easeOut(clamp01(body.downT / 0.5)));
        if (body.stun > 0) {
            // Thrown back over the first fifth of the stun, then easing back.
            const left = clamp01(body.stun / gameConfig.combat.hitStun), k = left > 0.8 ? (1 - left) / 0.2 : left / 0.8;
            pose = rigKit.add(pose, rigKit.scale(playerMoves.flinch, k));
        }
        return grounded(rig, pose);
    }
    // Drawn-only additions. `look` = { time, lean } (lean in radians).
    function present(judged, body, look) {
        const B = playerPoses.breath, s = Math.sin(look.time * B.rate) * (1 - body.moveBlend) * (body.act || body.down ? 0 : 1);
        const shake = body.act?.phase === 'charge' ? Math.sin(look.time * 70) * 0.012 : 0;
        return rigKit.add(judged, {
            base: { rz: look.lean || 0 },
            chest: { rx: B.chest * s, ry: shake }, head: { rx: B.head * s },
            upperArmR: { rz: -B.arms * s, ry: shake }, upperArmL: { rz: B.arms * s }
        });
    }
    return { pose, present, movePose, cycleLength, loop };
})();
