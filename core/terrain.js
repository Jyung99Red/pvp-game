// Block terrain (3d-migration-concept.md 12.1, 15): a grid where every cell
// has a kind and a height in blocks, kept in 16 x 16 chunks so a change
// rebuilds one chunk's drawing, not the world. Bodies move continuously over
// it; collision and sight read the grid. Cell (col, row) covers world x in
// [col, col + 1) * unit and y likewise; in 3D the block column stands on
// x..x+1, z..z+1. The ground is flat (3d-migration-concept.md 6: no height
// differences yet); solid kinds stand as columns `level` blocks high.
//
// The terrain can change at run time (`set`, reserved for placing and
// breaking blocks). Changes are kept as `edits` against the map they were
// generated from, so a save stores only what differs.
const terrainKit = (() => {
    const CHUNK = 16, MAX_LEVEL = 15;
    // `portal` is a portal's pillar; `gate` the glowing opening between two
    // pillars, which nobody walks through (the interact key travels).
    const KIND = Object.freeze({ grass: 0, path: 1, stone: 2, tree: 3, wood: 4, cobble: 5, gravel: 6, portal: 7, gate: 8 });
    const NAMES = Object.freeze(Object.fromEntries(Object.entries(KIND).map(([name, k]) => [k, name])));
    const SOLID = new Set([KIND.stone, KIND.tree, KIND.wood, KIND.portal, KIND.gate]);
    const TREE_HEIGHT = 4, HOUSE_HEIGHT = 3, PORTAL_HEIGHT = 3;
    // Map letters that put a monster's home on a grass block.
    const MONSTERS = Object.freeze({ g: 'goblin', w: 'wolf', G: 'goblinChief', K: 'wolfKing' });
    // Letters that mark a spot on grass: the spawn, the training dummy, a chest.
    const MARKS = new Set(['.', '@', 'D', 'C', ...Object.keys(MONSTERS)]);
    // How far, in cells, a change shows beyond its own cell when drawn (a
    // tree's crown, a neighbour's hidden face): chunks that near are redrawn.
    const REACH = 3;

    // One map letter as [kind, level].
    function cellOf(ch) {
        if (MARKS.has(ch)) return [KIND.grass, 0];
        if (ch === ':') return [KIND.path, 0];
        if (ch === 'P') return [KIND.gate, PORTAL_HEIGHT];
        if (ch === '=') return [KIND.cobble, 0];
        if (ch === ';') return [KIND.gravel, 0];
        if (ch === 'T') return [KIND.tree, TREE_HEIGHT];
        if (ch === 'H') return [KIND.wood, HOUSE_HEIGHT];
        if (ch === '#') return [KIND.portal, PORTAL_HEIGHT];
        if (ch >= '1' && ch <= '9') return [KIND.stone, Number(ch)];
        return null;
    }

    // Rows run north (screen top) to south, one letter per cell:
    // `.` grass, `:` path, `=` cobble, `;` gravel, `1`-`9` stone wall of
    // that many blocks, `T` tree, `H` a building's wall, `#` a portal's
    // pillar, `P` a portal's opening, `C` a chest, `@` a
    // spawn, `D` the training dummy, and the monster letters (MONSTERS).
    // A portal's opening is solid: it is used from in front, not walked into.
    // Markers are collected for the world to place what stands on them.
    function fromRows(rows, unit = gameConfig.world.unitsPerBlock) {
        const height = rows.length, width = rows[0]?.length || 0;
        if (!height || rows.some(r => r.length !== width)) throw new Error('Map rows must be non-empty and equal in length');
        const cw = Math.ceil(width / CHUNK), ch = Math.ceil(height / CHUNK);
        const t = {
            width, height, unit, cw, ch, rows: [...rows], rev: 0, edits: {},
            chunks: Array.from({ length: cw * ch }, () => ({ kind: new Uint8Array(CHUNK * CHUNK), level: new Uint8Array(CHUNK * CHUNK), rev: 0 })),
            spawn: null, spawns: [], dummy: null, monsters: [], portals: [], chests: []
        };
        rows.forEach((row, r) => [...row].forEach((letter, c) => {
            const cell = cellOf(letter);
            if (!cell) throw new Error(`Unknown map cell "${letter}" at ${c},${r}`);
            write(t, c, r, cell[0], cell[1]);
            if (letter === '@') t.spawns.push({ col: c, row: r });
            else if (letter === 'D') {
                if (t.dummy) throw new Error('A map has at most one training dummy');
                t.dummy = { col: c, row: r };
            } else if (letter === 'P') t.portals.push({ col: c, row: r });
            else if (letter === 'C') t.chests.push({ col: c, row: r });
            else if (MONSTERS[letter]) t.monsters.push({ kind: MONSTERS[letter], col: c, row: r });
        }));
        if (!t.spawns.length) throw new Error('A map needs a spawn (@)');
        // `spawn` is the first; a duel uses the first two, in reading order.
        t.spawn = t.spawns[0];
        return t;
    }

    const inside = (t, c, r) => c >= 0 && r >= 0 && c < t.width && r < t.height;
    const chunkAt = (t, c, r) => t.chunks[(r >> 4) * t.cw + (c >> 4)];
    const slot = (c, r) => ((r & 15) << 4) | (c & 15);
    function write(t, c, r, kind, level) { const k = chunkAt(t, c, r), i = slot(c, r); k.kind[i] = kind; k.level[i] = level; }
    function kindAt(t, c, r) { return inside(t, c, r) ? chunkAt(t, c, r).kind[slot(c, r)] : KIND.stone; }
    function levelAt(t, c, r) { return inside(t, c, r) ? chunkAt(t, c, r).level[slot(c, r)] : 0; }
    // Outside the map counts as wall.
    function solidAt(t, c, r) { return !inside(t, c, r) || SOLID.has(chunkAt(t, c, r).kind[slot(c, r)]); }
    const isSolid = kind => SOLID.has(kind);
    function cellCentre(t, c, r) { return { x: (c + 0.5) * t.unit, y: (r + 0.5) * t.unit }; }

    // ---- changes at run time ----
    // Chunk index of a cell, and the cells a chunk covers.
    function chunkIndex(t, c, r) { return (r >> 4) * t.cw + (c >> 4); }
    function chunkCells(t, i) {
        const c0 = (i % t.cw) * CHUNK, r0 = Math.floor(i / t.cw) * CHUNK;
        return { c0, r0, c1: Math.min(t.width, c0 + CHUNK), r1: Math.min(t.height, r0 + CHUNK) };
    }
    // Make cell (c, r) `kind` (a name or a KIND number), `level` blocks
    // high: solid kinds 1..MAX_LEVEL, ground kinds 0. Every chunk whose
    // drawing it can touch gets a new revision. Returns whether anything
    // changed.
    function set(t, c, r, kind, level = 0) {
        const k = typeof kind === 'string' ? KIND[kind] : kind;
        if (!inside(t, c, r) || NAMES[k] === undefined || !Number.isInteger(level)) return false;
        if (SOLID.has(k) ? level < 1 || level > MAX_LEVEL : level !== 0) return false;
        if (kindAt(t, c, r) === k && levelAt(t, c, r) === level) return false;
        write(t, c, r, k, level);
        const [k0, l0] = cellOf(t.rows[r][c]), key = `${c},${r}`;
        if (k0 === k && l0 === level) delete t.edits[key]; else t.edits[key] = [NAMES[k], level];
        const touched = new Set();
        for (let dr = -REACH; dr <= REACH; dr++) for (let dc = -REACH; dc <= REACH; dc++) {
            if (inside(t, c + dc, r + dr)) touched.add(chunkIndex(t, c + dc, r + dr));
        }
        for (const i of touched) t.chunks[i].rev++;
        t.rev++;
        return true;
    }
    // The changes as a list [[col, row, kind name, level]], for a save; and
    // back. Entries that do not fit the map are skipped.
    function edits(t) {
        return Object.entries(t.edits).map(([key, [kind, level]]) => { const [c, r] = key.split(',').map(Number); return [c, r, kind, level]; });
    }
    function applyEdits(t, list) {
        let n = 0;
        for (const e of Array.isArray(list) ? list : []) if (Array.isArray(e) && set(t, e[0], e[1], e[2], e[3])) n++;
        return n;
    }

    // ---- bodies against the grid ----
    // Does a circle at (x, y) overlap any solid cell?
    function blocked(t, x, y, radius) {
        const u = t.unit;
        for (let r = Math.floor((y - radius) / u); r <= Math.floor((y + radius) / u); r++) {
            for (let c = Math.floor((x - radius) / u); c <= Math.floor((x + radius) / u); c++) {
                if (!solidAt(t, c, r)) continue;
                const nx = Math.max(c * u, Math.min(x, (c + 1) * u)), ny = Math.max(r * u, Math.min(y, (r + 1) * u));
                if ((x - nx) ** 2 + (y - ny) ** 2 < radius * radius - 1e-9) return true;
            }
        }
        return false;
    }
    // Push a circle out of every solid cell it overlaps, each time along the
    // line from the cell's nearest point: flat walls give a slide along them,
    // block corners a slide around them.
    function pushOut(t, body, obstacles = []) {
        const u = t.unit, radius = body.radius;
        for (let pass = 0; pass < 4; pass++) {
            let moved = false;
            // Other bodies are circles: step out along the line between centres.
            for (const o of obstacles) {
                const dx = body.x - o.x, dy = body.y - o.y, d = Math.hypot(dx, dy), gap = radius + o.radius;
                if (d >= gap) continue;
                if (d > 1e-9) { body.x += dx / d * (gap - d); body.y += dy / d * (gap - d); } else body.x += gap;
                moved = true;
            }
            for (let r = Math.floor((body.y - radius) / u); r <= Math.floor((body.y + radius) / u); r++) {
                for (let c = Math.floor((body.x - radius) / u); c <= Math.floor((body.x + radius) / u); c++) {
                    if (!solidAt(t, c, r)) continue;
                    const nx = Math.max(c * u, Math.min(body.x, (c + 1) * u)), ny = Math.max(r * u, Math.min(body.y, (r + 1) * u));
                    const d = Math.hypot(body.x - nx, body.y - ny);
                    if (d >= radius) continue;
                    if (d > 1e-9) {
                        body.x += (body.x - nx) / d * (radius - d); body.y += (body.y - ny) / d * (radius - d);
                    } else {
                        // Centre inside the block: leave by the nearest face.
                        const exits = [[c * u - radius - body.x, 0], [(c + 1) * u + radius - body.x, 0], [0, r * u - radius - body.y], [0, (r + 1) * u + radius - body.y]];
                        const [ex, ey] = exits.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
                        body.x += ex; body.y += ey;
                    }
                    moved = true;
                }
            }
            if (!moved) return;
        }
    }
    // Is the straight line between two ground points free of solid blocks?
    // Sampled every eighth of a block; heights are not considered (a blow
    // across any wall does not land: 3d-migration-concept.md 10, item 4).
    function lineClear(t, x0, y0, x1, y1) {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (t.unit / 8)));
        for (let i = 1; i < n; i++) {
            const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
            if (solidAt(t, Math.floor(x / t.unit), Math.floor(y / t.unit))) return false;
        }
        return true;
    }
    // Can a fighter standing at one point see one at the other? Only blocks
    // at least `eye` high (or trees) are in the way: a knee-high stone hides
    // nobody, though a blow across it still does not land (lineClear).
    function sightClear(t, x0, y0, x1, y1, eye = 2) {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (t.unit / 8)));
        for (let i = 1; i < n; i++) {
            const c = Math.floor((x0 + (x1 - x0) * i / n) / t.unit), r = Math.floor((y0 + (y1 - y0) * i / n) / t.unit);
            if (solidAt(t, c, r) && (!inside(t, c, r) || levelAt(t, c, r) >= eye)) return false;
        }
        return true;
    }
    // Move a circle body by (dx, dy), sliding along walls and round corners
    // and around other bodies (`obstacles`: circles { x, y, radius }).
    // Sub-steps keep every step under half the radius, so thin corners
    // cannot be skipped.
    function moveCircle(t, body, dx, dy, obstacles = []) {
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (body.radius / 2)));
        for (let i = 0; i < steps; i++) {
            body.x += dx / steps; body.y += dy / steps;
            pushOut(t, body, obstacles);
        }
    }
    return {
        CHUNK, MAX_LEVEL, KIND, NAMES, TREE_HEIGHT, HOUSE_HEIGHT, PORTAL_HEIGHT, MONSTERS,
        cellOf, fromRows, inside, kindAt, levelAt, solidAt, isSolid, cellCentre,
        chunkIndex, chunkCells, set, edits, applyEdits,
        blocked, lineClear, sightClear, moveCircle
    };
})();
