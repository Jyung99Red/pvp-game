// Props (rebuild-plan.md M5): the world entities that are neither fighters
// nor monsters (core/entity.js).
// - building: a house of `H` blocks with a door; the interact key in front
//   of the door rests (the hot spring) or opens the building's panel.
// - portal: a `P` opening between two `#` pillars; the interact key travels
//   to the region it leads to, once the boss it may wait on is down.
// - chest: opened by holding the interact key, once the boss guarding it is
//   down; it throws out its loot. Opened stays opened (the save).
// - drop: loot on the ground. It pops out, settles, and is picked up by
//   walking near it: it flies to the one who came close.
// A map lists its buildings, portals and chests next to its rows; each entry
// must sit on the letters that draw it, so a map cannot disagree with itself.
const propKit = (() => {
    const DIRS = Object.freeze({ north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] });
    const angleOf = side => Math.atan2(DIRS[side][1], DIRS[side][0]);
    const letter = (map, c, r) => map.rows[r]?.[c];
    const emit = (sim, type, data) => combatKit.emit(sim, type, data);
    const bossName = kind => gameConfig.monsters[kind]?.name || kind;
    const isBoss = kind => !!gameConfig.monsters[kind]?.boss;
    // Progress of the world (core/save.js): bosses down, chests opened, what
    // is carried. Duels and tests may have none.
    const progressOf = sim => sim.progress || (sim.progress = { bosses: {}, chests: {}, inventory: { gold: 0, items: {} } });
    const downed = (sim, kind) => !!progressOf(sim).bosses[kind];

    // ---- placing what a map lists ----
    // The cell in front of a building's door, and the door's own cell.
    function doorOf({ at: [c, r, w, d], door = 'south' }) {
        const mid = { north: [c + (w >> 1), r], south: [c + (w >> 1), r + d - 1], west: [c, r + (d >> 1)], east: [c + w - 1, r + (d >> 1)] }[door];
        if (!mid) throw new Error(`Unknown door side ${door}`);
        return { door: mid, front: [mid[0] + DIRS[door][0], mid[1] + DIRS[door][1]] };
    }
    // Entities for map `map` (as keyed in gameConfig.maps: `region`) on its
    // terrain, given the progress so far. Throws if a list and the letters
    // disagree.
    function place(map, terrain, progress, region) {
        const out = [], centre = (c, r) => terrainKit.cellCentre(terrain, c, r);
        const covered = new Set();
        (map.buildings || []).forEach((b, i) => {
            const B = gameConfig.buildings[b.kind], [c0, r0, w, d] = b.at || [];
            if (!B) throw new Error(`Unknown building ${b.kind}`);
            for (let r = r0; r < r0 + d; r++) for (let c = c0; c < c0 + w; c++) {
                if (letter(map, c, r) !== 'H') throw new Error(`${map.name}: building ${b.kind} needs H at ${c},${r}`);
                covered.add(`${c},${r}`);
            }
            const { door, front } = doorOf(b), side = b.door || 'south';
            // Checked against the map as drawn, not against later edits to it.
            const ground = terrainKit.cellOf(letter(map, front[0], front[1]) ?? '1');
            if (!ground || terrainKit.isSolid(ground[0])) throw new Error(`${map.name}: the door of ${b.kind} opens into a wall`);
            const at = centre(front[0], front[1]);
            out.push({
                id: `b${i}-${b.kind}`, type: 'building', kind: b.kind, name: B.name, x: at.x, y: at.y, h: 0, facing: angleOf(side), radius: 0, solid: false,
                footprint: { col: c0, row: r0, w, d }, door: side, doorCell: door
            });
        });
        map.rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'H' && !covered.has(`${c},${r}`)) throw new Error(`${map.name}: wall H at ${c},${r} belongs to no building`); }));
        const portals = new Set();
        for (const p of map.portals || []) {
            const [c, r] = p.at || [];
            if (letter(map, c, r) !== 'P') throw new Error(`${map.name}: portal to ${p.to} needs P at ${c},${r}`);
            if (!DIRS[p.facing]) throw new Error(`${map.name}: portal to ${p.to} faces ${p.facing}`);
            if (!gameConfig.maps[p.to]) throw new Error(`${map.name}: portal to unknown map ${p.to}`);
            if (p.requires && !isBoss(p.requires)) throw new Error(`${map.name}: portal waits on ${p.requires}, not a boss`);
            const [dx, dy] = DIRS[p.facing];
            if (letter(map, c - dy, r - dx) !== '#' || letter(map, c + dy, r + dx) !== '#') throw new Error(`${map.name}: portal to ${p.to} needs # pillars either side`);
            portals.add(`${c},${r}`);
            const at = centre(c, r);
            out.push({ id: `p-${p.to}`, type: 'portal', to: p.to, requires: p.requires || null, x: at.x, y: at.y, h: 0, facing: angleOf(p.facing), side: p.facing, radius: 0, solid: false });
        }
        for (const { col, row } of terrain.portals) if (!portals.has(`${col},${row}`)) throw new Error(`${map.name}: P at ${col},${row} is in no portal list`);
        const chests = new Set();
        for (const k of map.chests || []) {
            const [c, r] = k.at || [];
            if (letter(map, c, r) !== 'C') throw new Error(`${map.name}: chest needs C at ${c},${r}`);
            if (!gameConfig.loot[k.loot]) throw new Error(`${map.name}: chest with unknown loot ${k.loot}`);
            if (k.requires && !isBoss(k.requires)) throw new Error(`${map.name}: chest waits on ${k.requires}, not a boss`);
            chests.add(`${c},${r}`);
            const at = centre(c, r), id = `chest-${c}-${r}`, open = !!progress?.chests?.[`${region}/${id}`];
            out.push({
                id, type: 'chest', loot: k.loot, requires: k.requires || null, x: at.x, y: at.y, h: 0, facing: angleOf(k.facing || 'south'),
                radius: gameConfig.props.chestRadius, solid: true, open, t: open ? 99 : 0
            });
        }
        for (const { col, row } of terrain.chests) if (!chests.has(`${col},${row}`)) throw new Error(`${map.name}: C at ${col},${row} is in no chest list`);
        return out;
    }
    // Where someone arriving from region `from` stands: just inside the
    // portal that leads back there, facing into the region; null if none.
    function arrival(map, terrain, from) {
        const p = (map.portals || []).find(q => q.to === from);
        if (!p) return null;
        const at = terrainKit.cellCentre(terrain, p.at[0], p.at[1]), [dx, dy] = DIRS[p.facing], d = gameConfig.props.arriveDistance;
        return { x: at.x + dx * d, y: at.y + dy * d, facing: angleOf(p.facing) };
    }

    // ---- the interact key (core/interact.js) ----
    // What pressing the key on `e` would do for fighter `p`: { verb, name,
    // hold (seconds to hold the key; 0 is at once), ready, why (when not) }.
    // Nothing to do: null.
    function offer(sim, e, p) {
        let out = null;
        if (e.type === 'building') {
            const B = gameConfig.buildings[e.kind];
            out = { verb: B.verb, name: e.name, hold: 0, ready: true, why: '' };
        } else if (e.type === 'portal') {
            out = { verb: '前往', name: gameConfig.maps[e.to].name, hold: 0, ready: true, why: '' };
            if (e.requires && !downed(sim, e.requires)) Object.assign(out, { ready: false, why: `击败${bossName(e.requires)}后开启` });
        } else if (e.type === 'chest') {
            if (e.open) return null;
            out = { verb: '打开', name: '宝箱', hold: gameConfig.interact.chestHold, ready: true, why: '' };
            if (e.requires && !downed(sim, e.requires)) Object.assign(out, { ready: false, why: `${bossName(e.requires)}守着它` });
        }
        if (out && out.ready && interactKit.inCombat(sim, p)) Object.assign(out, { ready: false, why: '战斗中' });
        return out;
    }
    function use(sim, e, p) {
        if (e.type === 'building') {
            if (gameConfig.buildings[e.kind].action === 'rest') {
                p.hp = p.maxHp;
                emit(sim, 'rest', { side: p.id, target: e.id });
            } else emit(sim, 'open', { side: p.id, target: e.id, what: e.kind });
        } else if (e.type === 'portal') {
            emit(sim, 'travel', { side: p.id, target: e.id, to: e.to, from: sim.region });
        } else if (e.type === 'chest') {
            e.open = true; e.t = 0;
            progressOf(sim).chests[`${sim.region}/${e.id}`] = true;
            const ahead = gameConfig.props.chestRadius + 6;
            drop(sim, e.loot, e.x + Math.cos(e.facing) * ahead, e.y + Math.sin(e.facing) * ahead);
            emit(sim, 'chest_open', { side: p.id, target: e.id, at: space.toBlocks(e.x, e.y, 24) });
        }
    }

    // ---- loot ----
    // Roll loot table `table` and drop what comes up at (x, y): each entry
    // that hits pops out as one drop, in a direction of its own.
    function drop(sim, table, x, y) {
        const D = gameConfig.drops, out = [];
        for (const entry of gameConfig.loot[table] || []) {
            if (entityKit.random(sim) >= entry.chance) continue;
            const [lo, hi] = entry.amount, amount = lo + Math.floor(entityKit.random(sim) * (hi - lo + 1));
            const a = entityKit.random(sim) * Math.PI * 2, v = D.popSpeed[0] + entityKit.random(sim) * (D.popSpeed[1] - D.popSpeed[0]);
            out.push(entityKit.add(sim, {
                id: entityKit.nextId(sim, 'd'), type: 'drop', item: entry.item, amount, x, y, h: 0, facing: a,
                radius: D.radius, solid: false, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, pull: null
            }));
        }
        return out;
    }
    function collect(sim, e, f) {
        const bag = progressOf(sim).inventory;
        if (e.item === 'gold') bag.gold += e.amount;
        else bag.items[e.item] = (bag.items[e.item] || 0) + e.amount;
        emit(sim, 'pickup', { side: f.id, item: e.item, amount: e.amount, at: space.toBlocks(e.x, e.y, e.h) });
        entityKit.remove(sim, e);
    }
    function tickDrop(sim, e, dt) {
        const D = gameConfig.drops;
        e.t += dt;
        if (e.pull) {
            const f = sim.fighters.find(q => q.id === e.pull);
            if (!f || f.down) { e.pull = null; return; }
            const dx = f.x - e.x, dy = f.y - e.y, d = Math.hypot(dx, dy), go = Math.min(d, D.pullSpeed * dt);
            if (d > 1e-9) { e.x += dx / d * go; e.y += dy / d * go; }
            e.h = Math.min(D.pullHeight, e.h + D.pullHeight * dt * 8);
            if (d - go <= D.collectDistance) collect(sim, e, f);
            return;
        }
        if (e.t <= D.popSeconds + 1e-9) {
            terrainKit.moveCircle(sim.terrain, e, e.vx * dt, e.vy * dt);
            const u = Math.min(1, e.t / D.popSeconds);
            e.h = D.popHeight * 4 * u * (1 - u);
            return;
        }
        e.h = 0;
        if (e.t < D.restSeconds) return;
        let best = null, far = D.pickupRange;
        for (const f of sim.fighters) {
            const d = Math.hypot(f.x - e.x, f.y - e.y);
            if (!f.down && d <= far) { far = d; best = f; }
        }
        if (best) e.pull = best.id;
    }
    function tick(sim, dt) {
        for (const e of [...sim.entities]) {
            if (e.type === 'drop') tickDrop(sim, e, dt);
            else if (e.type === 'chest' && e.open && e.t < 99) e.t = Math.min(99, e.t + dt);
        }
    }
    return { DIRS, angleOf, place, arrival, offer, use, drop, tick, doorOf, progressOf };
})();
