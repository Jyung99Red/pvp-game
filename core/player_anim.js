// The main character's pose as a pure function of simulation state
// (3d-migration-concept.md 12.1): stance and walk depend only on the walked
// distance and the walk blend, so the host and a guest pose a body the same
// way, and a hit test sees what is drawn. `present` adds what is drawn but
// never tested (breathing, leaning into turns).
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
    const walkKeys = list => [list[0], list[1], rigKit.mirror(list[0]), rigKit.mirror(list[1])];

    // Raise or lower the whole body so its lowest box rests on the ground.
    function grounded(rig, pose) {
        const low = rigKit.lowest(rig, rigKit.solve(rig, pose));
        return rigKit.add(pose, { base: { py: -low / rig.scale } });
    }
    function legs(rig, phase, blend) {
        const P = playerPoses, layer = playerModel.layers.lower;
        return rigKit.mix(rigKit.pick(P.stance, layer), loop(walkKeys(P.walk.legs), phase), blend);
    }
    // World units walked per full cycle (two steps): twice how far a planted
    // foot travels backwards between contact and the mirrored contact.
    function cycleLength(rig) {
        if (cycles.has(rig)) return cycles.get(rig);
        const foot = footOf(rig, 'R');
        const z = phase => rigKit.solve(rig, grounded(rig, legs(rig, phase, 1))).parts[foot][14];
        const length = 2 * (z(0) - z(0.5)) * gameConfig.world.unitsPerBlock;
        if (!(length > 0)) throw new Error('Walk keys must move the planted foot backwards');
        cycles.set(rig, length);
        return length;
    }
    function phaseOf(rig, walked) { return walked / cycleLength(rig); }

    // The judged pose. `body` needs { walk, moveBlend }.
    function pose(rig, body) {
        const P = playerPoses, phase = phaseOf(rig, body.walk), blend = body.moveBlend;
        const upper = rigKit.add(rigKit.pick(P.stance, playerModel.layers.upper), rigKit.scale(loop(walkKeys(P.walk.arms), phase), blend));
        return grounded(rig, rigKit.add(legs(rig, phase, blend), upper));
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
    return { pose, present, cycleLength, phaseOf, loop };
})();
