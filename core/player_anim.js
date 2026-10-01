// The main character's pose as a pure function of simulation state
// (3d-migration-concept.md 12.1): stance, walk and run depend only on the
// gait phase and the walk and run blends, so the host and a guest pose a
// body the same way, and a hit test sees what is drawn. `present` adds what
// is drawn but never tested (breathing, leaning into turns).
const playerAnim = (() => {
    const cycles = new WeakMap();
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

    // The judged pose. `body` needs { gait, moveBlend, runBlend }: gait is
    // the phase in cycles, the blends are 0..1.
    function pose(rig, body) {
        const P = playerPoses, phase = body.gait, run = body.runBlend || 0;
        const upper = rigKit.add(rigKit.pick(P.stance, playerModel.layers.upper), rigKit.scale(gait('arms', phase, run), body.moveBlend));
        return grounded(rig, rigKit.add(legs(phase, body.moveBlend, run), upper));
    }
    // Drawn-only additions. `look` = { time, lean } (lean in radians).
    function present(judged, body, look) {
        const B = playerPoses.breath, s = Math.sin(look.time * B.rate) * (1 - body.moveBlend);
        return rigKit.add(judged, {
            base: { rz: look.lean || 0 },
            chest: { rx: B.chest * s }, head: { rx: B.head * s },
            upperArmR: { rz: -B.arms * s }, upperArmL: { rz: B.arms * s }
        });
    }
    return { pose, present, cycleLength, loop };
})();
