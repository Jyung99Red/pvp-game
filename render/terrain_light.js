// Light baked into the terrain's drawing (render/terrain_mesh.js), worked
// out on the block grid; no three.js, so Node tests run it. Presentation
// only: nothing here is judged.
//
// Sky visibility: each face is as bright in the sky's light as the share
// of the sky it sees. Rays go out from the open cell in front of the face
// over the half of the sky it faces, and walk the block grid; those that
// get out (above every block, or `SKY.far` blocks off) are its sky. So a
// cave, the ground under a tree's crown, a narrow way between walls and
// the foot of a wall or a house are darker, the open field is not (user,
// 2026-10-06). Only the sky's light is dimmed: the sun's has its own
// shadows.
const terrainLight = (() => {
    // Rays per face (over the half of the sky above the horizon it faces),
    // how far they go (blocks), and how much of the sky's light a face that
    // sees no sky at all keeps.
    const SKY = { rays: 16, far: 8, floor: 0.15 };
    // How far beyond the map the grid goes: tree crowns and roofs hang over
    // its edge.
    const MARGIN = 3;
    // The faces' outward directions, by name (as render/terrain_mesh.js).
    const NORMALS = { top: [0, 1, 0], south: [0, 0, 1], north: [0, 0, -1], east: [1, 0, 0], west: [-1, 0, 0] };
    const SIDE = Object.keys(NORMALS);
    const sideOf = n => n[1] > 0 ? 0 : n[2] > 0 ? 1 : n[2] < 0 ? 2 : n[0] > 0 ? 3 : 4;

    // The opaque blocks as a dense grid: the terrain's columns (but gates
    // and fences, which light passes) and `extra` ([x, y, z] each: tree
    // crowns, roofs, lintels). Under the ground (y < 0) is solid; beyond
    // the grid's sides and above its top is open air.
    function blocks(t, extra = []) {
        const K = terrainKit.KIND, x0 = -MARGIN, z0 = -MARGIN, w = t.width + 2 * MARGIN, d = t.height + 2 * MARGIN;
        let h = 1;
        const more = [...extra];
        for (const [, y] of more) h = Math.max(h, y + 1);
        for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) if (terrainKit.isSolid(terrainKit.kindAt(t, c, r))) h = Math.max(h, terrainKit.levelAt(t, c, r));
        const cells = new Uint8Array(w * d * h), index = (c, y, r) => (y * d + r - z0) * w + c - x0;
        for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) {
            const k = terrainKit.kindAt(t, c, r);
            if (!terrainKit.isSolid(k) || k === K.gate || k === K.fence) continue;
            for (let y = 0, top = terrainKit.levelAt(t, c, r); y < top; y++) cells[index(c, y, r)] = 1;
        }
        for (const [x, y, z] of more) if (x >= x0 && z >= z0 && x < x0 + w && z < z0 + d && y >= 0) cells[index(x, y, z)] = 1;
        function solid(c, y, r) {
            if (y < 0) return true;
            if (y >= h || c < x0 || r < z0 || c >= x0 + w || r >= z0 + d) return false;
            return cells[index(c, y, r)] === 1;
        }
        return { x0, z0, w, d, h, cells, index, solid };
    }

    // Directions over the sky as a face looking along `n` sees it: spread
    // evenly by how much each counts to a face (more straight out than
    // aslant), and only those above the horizon.
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    function directions(n) {
        const up = [0, 1, 0], out = [];
        // A frame round n: a, b across it.
        const a = n[1] ? [1, 0, 0] : up, b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
        const total = n[1] ? SKY.rays : SKY.rays * 2;
        for (let i = 0; i < total; i++) {
            const u = (i + 0.5) / total, s = Math.sqrt(u), along = Math.sqrt(1 - u), phi = i * GOLDEN;
            const x = s * Math.cos(phi), z = s * Math.sin(phi);
            const v = [0, 1, 2].map(k => n[k] * along + a[k] * x + b[k] * z);
            if (v[1] > 0.02) out.push(v);
        }
        return out;
    }
    // Per way a face looks, its rays as [x, y, z, x, y, z, ...].
    const RAYS = SIDE.map(name => Float64Array.from(directions(NORMALS[name]).flat()));

    // The sky a face sees, 0..1, by the open cell (c, y, r) it looks out
    // into and the way it looks (`n`): the share of its rays that get out
    // of the grid's blocks within SKY.far, walked cell by cell. Worked out
    // once per cell and way, until the grid changes.
    function sky(g) {
        const seen = new Float32Array(g.w * g.d * g.h * SIDE.length).fill(-1), { cells, x0, z0, w, d, h } = g, far = SKY.far;
        // Does the ray from the middle of (c, y, r) along (dx, dy, dz), dy > 0, get out?
        function free(c, y, r, dx, dy, dz) {
            const sc = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1, ax = Math.abs(dx), az = Math.abs(dz);
            const ix = ax > 1e-9 ? 1 / ax : Infinity, iy = 1 / dy, iz = az > 1e-9 ? 1 / az : Infinity;
            let tx = ix / 2, ty = iy / 2, tz = iz / 2;
            for (;;) {
                if (tx < ty && tx < tz) { if (tx > far) return true; c += sc; tx += ix; }
                else if (ty < tz) { if (ty > far) return true; y++; ty += iy; if (y >= h) return true; }
                else { if (tz > far) return true; r += sz; tz += iz; }
                if (c >= x0 && r >= z0 && c < x0 + w && r < z0 + d && cells[(y * d + r - z0) * w + c - x0] === 1) return false;
            }
        }
        return function at(c, y, r, n) {
            if (y >= h || c < x0 || r < z0 || c >= x0 + w || r >= z0 + d) return 1;
            if (y < 0) return 0;
            const s = sideOf(n), i = g.index(c, y, r) * SIDE.length + s;
            if (seen[i] >= 0) return seen[i];
            const rays = RAYS[s], count = rays.length / 3;
            let open = 0;
            for (let k = 0; k < rays.length; k += 3) if (free(c, y, r, rays[k], rays[k + 1], rays[k + 2])) open++;
            return seen[i] = open / count;
        };
    }
    // How much of the sky's light a face keeps where it sees `share` of the sky.
    const skyShade = share => SKY.floor + (1 - SKY.floor) * share;

    // The sky light at each corner (`points`) of the face of block (c, y, r)
    // that looks along `n`: the mean of the open cells, of the four the
    // corner touches in the layer the face looks into, so it shades
    // smoothly from one face to the next. `skyAt` as from `sky`.
    function corners(g, skyAt, points, n, c, y, r) {
        const axes = [0, 1, 2].filter(k => n[k] === 0), at = [c + n[0], y + n[1], r + n[2]], mid = [c + 0.5, y + 0.5, r + 0.5];
        return points.map(p => {
            let sum = 0, count = 0;
            for (let m = 0; m < 4; m++) {
                const q = [...at];
                for (const [i, k] of axes.entries()) if (m >> i & 1) q[k] += p[k] > mid[k] ? 1 : -1;
                if (m && g.solid(q[0], q[1], q[2])) continue;
                sum += skyAt(q[0], q[1], q[2], n); count++;
            }
            return skyShade(sum / count);
        });
    }

    return { SKY, blocks, sky, corners, skyShade };
})();
