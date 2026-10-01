// Block terrain (3d-migration-concept.md 12.1): a grid where every cell has a
// kind and a height in blocks. Bodies move continuously over it. Cell
// (col, row) covers world x in [col, col + 1) * unit and y likewise; in 3D
// the block column stands on x..x+1, z..z+1. Collision reads the grid.
const terrainKit = (() => {
    const KIND = Object.freeze({ grass: 0, path: 1, stone: 2, tree: 3 });
    const SOLID = new Set([KIND.stone, KIND.tree]);
    const TREE_HEIGHT = 4;
    // Map letters that put a monster's home on a grass block.
    const MONSTERS = Object.freeze({ g: 'goblin', w: 'wolf' });

    function fromRows(rows, unit = gameConfig.world.unitsPerBlock) {
        const height = rows.length, width = rows[0]?.length || 0;
        if (!height || rows.some(r => r.length !== width)) throw new Error('Map rows must be non-empty and equal in length');
        const kind = new Uint8Array(width * height), level = new Uint8Array(width * height);
        let spawn = null, dummy = null;
        const monsters = [];
        rows.forEach((row, r) => [...row].forEach((ch, c) => {
            const i = r * width + c;
            if (ch === '.' || ch === '@' || ch === 'D' || MONSTERS[ch]) kind[i] = KIND.grass;
            else if (ch === ':') kind[i] = KIND.path;
            else if (ch === 'T') { kind[i] = KIND.tree; level[i] = TREE_HEIGHT; }
            else if (ch >= '1' && ch <= '9') { kind[i] = KIND.stone; level[i] = Number(ch); }
            else throw new Error(`Unknown map cell "${ch}" at ${c},${r}`);
            if (ch === '@') {
                if (spawn) throw new Error('A map has one spawn');
                spawn = { col: c, row: r };
            }
            if (ch === 'D') {
                if (dummy) throw new Error('A map has at most one training dummy');
                dummy = { col: c, row: r };
            }
            if (MONSTERS[ch]) monsters.push({ kind: MONSTERS[ch], col: c, row: r });
        }));
        if (!spawn) throw new Error('A map needs a spawn (@)');
        return { width, height, unit, kind, level, spawn, dummy, monsters };
    }
    const inside = (t, c, r) => c >= 0 && r >= 0 && c < t.width && r < t.height;
    function kindAt(t, c, r) { return inside(t, c, r) ? t.kind[r * t.width + c] : KIND.stone; }
    function levelAt(t, c, r) { return inside(t, c, r) ? t.level[r * t.width + c] : 0; }
    // Outside the map counts as wall.
    function solidAt(t, c, r) { return !inside(t, c, r) || SOLID.has(t.kind[r * t.width + c]); }
    function cellCentre(t, c, r) { return { x: (c + 0.5) * t.unit, y: (r + 0.5) * t.unit }; }
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
    return { KIND, TREE_HEIGHT, MONSTERS, fromRows, kindAt, levelAt, solidAt, cellCentre, blocked, lineClear, moveCircle };
})();
