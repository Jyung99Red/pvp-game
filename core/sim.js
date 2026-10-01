// The world simulation: plain data advanced in fixed steps. It knows the
// five controls (move stick, A, B, offhand, interact) and nothing about the
// screen. Every value is serialisable except `terrain` and `rigs`, which are
// shared data derived from the map and the models. The player's rules are
// in core/fighter.js, the training dummy's in core/dummy.js; `events` is
// what happened, for sounds and effects to read and drain.
const worldSim = (() => {
    const BUTTONS = Object.freeze(['a', 'b', 'offhand', 'interact']);

    function create({ map = gameConfig.maps.clearing, loadout = { main: 'sword', offhand: 'shield' } } = {}) {
        const terrain = terrainKit.fromRows(map.rows);
        const rig = rigKit.build(playerModel, { scale: gameConfig.models.playerScale, equipment: equipmentModels.forLoadout(loadout) });
        const at = terrainKit.cellCentre(terrain, terrain.spawn.col, terrain.spawn.row);
        const buttons = {};
        for (const b of BUTTONS) buttons[b] = { held: false, presses: 0 };
        const dummy = dummyKit.create(terrain, map.dummyFacing ?? Math.PI);
        return {
            time: 0, tick: 0, terrain, rigs: { player: rig, dummy: dummy ? dummyKit.rig() : null },
            player: fighterKit.init({
                x: at.x, y: at.y, h: space.groundHeight(at.x, at.y),
                facing: Math.PI / 2, radius: gameConfig.player.radius,
                // gait: walk/run cycle phase, in cycles. moveTime: seconds of
                // unbroken walking, which turns into a run.
                speed: 0, gait: 0, moveBlend: 0, runBlend: 0, moveTime: 0,
                loadout: { ...loadout }
            }),
            dummy,
            input: { move: { x: 0, y: 0 }, buttons },
            events: [],
            stats: { attacks: 0, hits: 0, misses: 0, blocks: 0, parries: 0, hurt: 0 }
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
                fighterKit.press(sim, cmd.button);
                return true;
            }
            if (!b.held) return false;
            b.held = false;
            fighterKit.release(sim, cmd.button);
            return true;
        }
        return false;
    }

    function step(sim, dt) {
        sim.time += dt; sim.tick++;
        fighterKit.tick(sim, dt);
        dummyKit.tick(sim, dt);
        const p = sim.player;
        p.h = space.groundHeight(p.x, p.y);
    }
    // Take the events since the last call.
    function drain(sim) { return sim.events.splice(0); }
    return { BUTTONS, create, command, step, drain };
})();
