// The world simulation: plain data advanced in fixed steps. It knows the
// five controls (move stick, A, B, offhand, interact) and nothing about the
// screen. Every value is serialisable except `terrain` and `rigs`, which are
// shared data derived from the map and the models. M1: the character walks
// and runs; A, B, offhand and interact only record their state.
const worldSim = (() => {
    const BUTTONS = Object.freeze(['a', 'b', 'offhand', 'interact']);

    function create({ map = gameConfig.maps.clearing, loadout = { main: 'sword', offhand: 'shield' } } = {}) {
        const terrain = terrainKit.fromRows(map.rows);
        const rig = rigKit.build(playerModel, { scale: gameConfig.models.playerScale, equipment: equipmentModels.forLoadout(loadout) });
        const at = terrainKit.cellCentre(terrain, terrain.spawn.col, terrain.spawn.row);
        const buttons = {};
        for (const b of BUTTONS) buttons[b] = { held: false, presses: 0 };
        return {
            time: 0, tick: 0, terrain, rigs: { player: rig },
            player: {
                x: at.x, y: at.y, h: space.groundHeight(at.x, at.y),
                facing: Math.PI / 2, radius: gameConfig.player.radius,
                // gait: walk/run cycle phase, in cycles. moveTime: seconds of
                // unbroken walking, which turns into a run.
                speed: 0, gait: 0, moveBlend: 0, runBlend: 0, moveTime: 0,
                loadout: { ...loadout }
            },
            input: { move: { x: 0, y: 0 }, buttons }
        };
    }

    // Commands from the input layer (or, later, the network):
    // { type: 'move', x, y } with |(x, y)| <= 1 on the ground plane;
    // { type: 'press' | 'release', button }. Returns whether it was taken.
    function command(sim, cmd) {
        if (!cmd || typeof cmd !== 'object') return false;
        if (cmd.type === 'move') {
            if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return false;
            const len = Math.hypot(cmd.x, cmd.y), k = len > 1 ? 1 / len : 1;
            sim.input.move = { x: cmd.x * k, y: cmd.y * k };
            return true;
        }
        if (cmd.type === 'press' || cmd.type === 'release') {
            const b = sim.input.buttons[cmd.button];
            if (!b) return false;
            if (cmd.type === 'press') {
                if (b.held) return false;
                b.held = true; b.presses++;
                return true;
            }
            if (!b.held) return false;
            b.held = false;
            return true;
        }
        return false;
    }

    const approach = (value, target, rate) => target > value ? Math.min(target, value + rate) : Math.max(target, value - rate);

    function step(sim, dt) {
        const C = gameConfig, P = C.player, p = sim.player, m = sim.input.move, mag = Math.hypot(m.x, m.y);
        let striding = false;
        p.speed = 0;
        if (mag > 1e-6) {
            const speed = P.speed * Math.min(1, mag) * (1 + (P.runMultiplier - 1) * p.runBlend), x0 = p.x, y0 = p.y;
            terrainKit.moveCircle(sim.terrain, p, m.x / mag * speed * dt, m.y / mag * speed * dt);
            const moved = Math.hypot(p.x - x0, p.y - y0);
            p.gait += moved / playerAnim.cycleLength(sim.rigs.player, p.runBlend);
            p.speed = moved / dt;
            p.facing = space.turn(p.facing, Math.atan2(m.y, m.x), P.turnRate * dt);
            // An unbroken walk: stick well pushed and the body really getting
            // somewhere (pressing into a wall breaks it; sliding along does not).
            striding = mag >= P.runStick - 1e-9 && moved >= 0.5 * P.speed * dt;
        }
        p.moveTime = striding ? p.moveTime + dt : 0;
        p.runBlend = approach(p.runBlend, p.moveTime >= P.runAfter - 1e-9 ? 1 : 0, dt / P.runRampSeconds);
        p.h = space.groundHeight(p.x, p.y);
        p.moveBlend = approach(p.moveBlend, p.speed > 1e-6 ? 1 : 0, dt / C.animation.blendSeconds);
        sim.time += dt; sim.tick++;
    }
    return { BUTTONS, create, command, step };
})();
