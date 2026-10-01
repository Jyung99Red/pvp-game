// The world simulation: plain data advanced in fixed steps. It knows the
// five controls (move stick, A, B, offhand, interact) and nothing about the
// screen. Every value is serialisable except `terrain` and `rigs`, which are
// shared data derived from the map and the models. The fighters' rules are
// in core/fighter.js, the training dummy's in core/dummy.js, the monsters'
// in core/monster.js; `events` is what happened, for sounds and effects to
// read and drain.
//
// `fighters` are the people playing: one in PVE ('player'), two in a duel
// ('host' and 'guest', rebuild-plan.md M4). sim.player, sim.input and
// sim.stats are the first fighter's own (getters, left out of snapshots).
// `result` is null until the fight is decided. PVE: { outcome: 'win'
// (every monster down) | 'lose' (the player down), at }; a duel:
// { winner: 'host' | 'guest' | null (both fell in the same step), at,
// conceded? }.
const worldSim = (() => {
    const BUTTONS = fighterKit.BUTTONS;
    const DUEL_IDS = Object.freeze(['host', 'guest']);
    const FIRST = { player: s => s.fighters[0], input: s => s.fighters[0].input, stats: s => s.fighters[0].stats };
    function aliases(sim) {
        for (const [key, get] of Object.entries(FIRST)) Object.defineProperty(sim, key, { get() { return get(this); }, enumerable: false, configurable: true });
        return sim;
    }

    // A duel puts one fighter on each of the map's first two spawns, each
    // facing the other, with the same fixed stats and loadout (a fair fight;
    // no potions: controls-landscape-concept.md 8, item 5).
    function create({ map = gameConfig.maps.clearing, loadout = { main: 'sword', offhand: 'shield' }, duel = false } = {}) {
        const terrain = terrainKit.fromRows(map.rows);
        if (duel && terrain.spawns.length < 2) throw new Error('A duel needs a map with two spawns');
        if (duel) loadout = { main: 'sword', offhand: 'shield' };
        const rig = rigKit.build(playerModel, { scale: gameConfig.models.playerScale, equipment: equipmentModels.forLoadout(loadout) });
        const ids = duel ? DUEL_IDS : ['player'];
        const spots = ids.map((_, i) => terrainKit.cellCentre(terrain, terrain.spawns[i].col, terrain.spawns[i].row));
        const fighters = ids.map((id, i) => {
            const at = spots[i], other = spots[1 - i];
            return fighterKit.init({
                x: at.x, y: at.y, h: space.groundHeight(at.x, at.y),
                facing: duel ? Math.atan2(other.y - at.y, other.x - at.x) : Math.PI / 2, radius: gameConfig.player.radius,
                // gait: walk/run cycle phase, in cycles. moveTime: seconds of
                // unbroken walking, which turns into a run.
                speed: 0, gait: 0, moveBlend: 0, runBlend: 0, moveTime: 0,
                loadout: { ...loadout }
            }, { id, endless: !duel && !!map.training });
        });
        const dummy = dummyKit.create(terrain, map.dummyFacing ?? Math.PI);
        const monsters = terrain.monsters.map((spawn, i) => monsterKit.create(terrain, spawn, i));
        const kinds = [...new Set(monsters.map(m => m.kind))];
        return aliases({
            time: 0, tick: 0, terrain, map: map.name || '', duel,
            rigs: { player: rig, dummy: dummy ? dummyKit.rig() : null, monsters: Object.fromEntries(kinds.map(k => [k, monsterKit.rig(k)])) },
            fighters, dummy, monsters,
            events: [], result: null
        });
    }

    // Commands from the input layer or the network, for fighter `who`
    // (index, the first by default): { type: 'move', x, y } with
    // |(x, y)| <= 1 on the ground plane; { type: 'press' | 'release', button }.
    // Returns whether it was taken.
    function command(sim, cmd, who = 0) {
        const p = sim.fighters[who];
        if (!p || !cmd || typeof cmd !== 'object') return false;
        if (cmd.type === 'move') {
            if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return false;
            const len = Math.hypot(cmd.x, cmd.y), k = len > 1 ? 1 / len : 1;
            p.input.move = { x: cmd.x * k, y: cmd.y * k };
            return true;
        }
        if (cmd.type === 'press' || cmd.type === 'release') {
            const b = Object.hasOwn(p.input.buttons, cmd.button) ? p.input.buttons[cmd.button] : null;
            if (!b) return false;
            if (cmd.type === 'press') {
                if (b.held) return false;
                b.held = true; b.presses++;
                fighterKit.press(sim, p, cmd.button);
                return true;
            }
            if (!b.held) return false;
            b.held = false;
            fighterKit.release(sim, p, cmd.button);
            return true;
        }
        return false;
    }

    // The nearest fighter still standing, or null.
    function nearestFighter(sim, from) {
        let best = null, far = Infinity;
        for (const f of sim.fighters) {
            const d = Math.hypot(f.x - from.x, f.y - from.y);
            if (!f.down && d < far) { far = d; best = f; }
        }
        return best;
    }

    // One step. `judge` false: swings pass through and nothing is decided
    // (a duel's guest predicting between the host's snapshots).
    function step(sim, dt, { judge = true } = {}) {
        sim.time += dt; sim.tick++;
        for (const f of sim.fighters) fighterKit.tick(sim, f, dt);
        fighterKit.settle(sim, judge);
        dummyKit.tick(sim, dt);
        monsterKit.tick(sim, dt);
        for (const f of sim.fighters) f.h = space.groundHeight(f.x, f.y);
        if (!sim.result && judge) decide(sim);
    }
    function decide(sim) {
        if (sim.duel) {
            const up = sim.fighters.filter(f => !f.down);
            if (up.length > 1) return;
            sim.result = { winner: up[0]?.id ?? null, at: sim.time };
            combatKit.emit(sim, 'result', { winner: sim.result.winner });
            return;
        }
        const p = sim.player;
        const outcome = p.down ? 'lose' : sim.monsters.length && !sim.monsters.some(monsterKit.living) ? 'win' : null;
        if (outcome) { sim.result = { outcome, at: sim.time }; combatKit.emit(sim, 'result', { outcome }); }
    }
    // A duel given up by fighter `id`: the other one wins.
    function concede(sim, id) {
        if (!sim.duel || sim.result || !DUEL_IDS.includes(id)) return false;
        sim.result = { winner: DUEL_IDS.find(other => other !== id), at: sim.time, conceded: id };
        combatKit.emit(sim, 'result', { winner: sim.result.winner, conceded: id });
        return true;
    }
    // How the fight ended for fighter `id`: 'win' | 'lose' | 'draw', or null.
    function outcome(sim, id = 'player') {
        const r = sim.result;
        if (!r) return null;
        if (!sim.duel) return r.outcome;
        return r.winner === null ? 'draw' : r.winner === id ? 'win' : 'lose';
    }

    // The state as plain data (what a duel's host sends), and back. A
    // snapshot has everything but the terrain, the rigs and the events;
    // restoring keeps the world it is written into.
    const STATIC = new Set(['terrain', 'rigs', 'events']);
    function snapshot(sim) {
        const out = {};
        for (const [key, value] of Object.entries(sim)) if (!STATIC.has(key)) out[key] = value;
        return JSON.parse(JSON.stringify(out));
    }
    function restore(sim, snap) {
        const copy = JSON.parse(JSON.stringify(snap));
        for (const key of Object.keys(sim)) if (!STATIC.has(key)) sim[key] = copy[key];
        return sim;
    }
    // Take the events since the last call.
    function drain(sim) { return sim.events.splice(0); }
    return { BUTTONS, DUEL_IDS, create, command, nearestFighter, step, concede, outcome, snapshot, restore, drain };
})();
