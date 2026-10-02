// Terrain drawn in 16 x 16 chunks (3d-migration-concept.md 12.1, 15): each
// chunk is one mesh of only the block faces that can be seen (a face
// against another block is left out), textured from one atlas, so a chunk
// is one draw and a change rebuilds only the chunks it touched (their
// revision moved: core/terrain.js `set`). Tree crowns, roofs and portal
// lintels are drawn-only blocks ("decor") worked out from the trees and the
// buildings and portals; flowers and tufts are baked in too. Ground faces
// darken where they meet a wall (corner shading), and each block gets a
// slight shade of its own. Presentation only: nothing here is judged.
//
// The material cuts a hole where blocks stand between the camera and the
// player (`cut`): fragments in a cylinder round the line from the camera to
// the player's chest, on the camera's side of the player along the ground,
// are dropped in a dither pattern, so the player shows through a wall or a
// roof in front, while walls behind stay whole.
const terrainMesh = (() => {
    const AO = [0.5, 0.68, 0.84, 1];
    // Whole-number hash of a cell to [0, 1): the same world every time, and
    // the same after one chunk is rebuilt.
    function hash(a, b, c = 0) {
        let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
        h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
        return ((h ^ h >>> 16) >>> 0) / 4294967296;
    }
    const GROUND = { 0: 'grassTop', 1: 'path', 5: 'cobble', 6: 'gravel' };
    // Tile and shade spread per solid kind (by name).
    const BLOCK = { stone: ['stone', 0.07], tree: ['bark', 0.05], wood: ['plank', 0.04], portal: ['portalStone', 0.06], brush: ['brush', 0.1] };

    // Drawn-only blocks: { 'x,y,z': { tile, tint } } for the whole map.
    function decor(sim) {
        const t = sim.terrain, K = terrainKit.KIND, out = new Map();
        const solidBlock = (c, y, r) => terrainKit.inside(t, c, r) && terrainKit.isSolid(terrainKit.kindAt(t, c, r)) && y < terrainKit.levelAt(t, c, r);
        const add = (x, y, z, tile, tint = null) => { if (!solidBlock(x, y, z)) out.set(`${x},${y},${z}`, { tile, tint }); };
        for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) {
            if (terrainKit.kindAt(t, c, r) !== K.tree) continue;
            const h = terrainKit.levelAt(t, c, r);
            for (let y = h - 2; y <= h + 1; y++) {
                const rad = y >= h ? 1 : 2;
                for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
                    if (dx === 0 && dz === 0 && y < h) continue;
                    if (Math.abs(dx) === rad && Math.abs(dz) === rad && (rad === 2 || y === h + 1 || hash(c + dx, y, r + dz) < 0.5)) continue;
                    if (y === h + 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
                    add(c + dx, y, r + dz, 'leaves');
                }
            }
        }
        // Roofs: two steps, overhanging east and west, so the door side
        // stays open to the camera and the roof stays low.
        for (const b of sim.entities) {
            if (b.type !== 'building') continue;
            const { col, row, w, d } = b.footprint, tint = palette[propModels.roofs[b.kind]] || null;
            for (let k = 0; k < 2; k++) {
                const c0 = col - 1 + k, c1 = col + w - k;
                for (let c = c0; c <= c1; c++) for (let r = row; r < row + d; r++) add(c, terrainKit.HOUSE_HEIGHT + k, r, 'roof', tint);
            }
        }
        // A lintel over each portal's opening and pillars.
        for (const p of sim.entities) {
            if (p.type !== 'portal') continue;
            const c = Math.floor(p.x / t.unit), r = Math.floor(p.y / t.unit), [dx, dy] = propKit.DIRS[p.side];
            for (const k of [-1, 0, 1]) add(c - dy * k, terrainKit.PORTAL_HEIGHT, r - dx * k, 'portalStone');
        }
        return out;
    }

    // ---- one chunk's geometry ----
    function builder() {
        const pos = [], nor = [], uv = [], col = [], idx = [];
        return {
            pos, nor, uv, col, idx,
            // A quad p0..p3 counter-clockwise seen from outside; p0-p1 the
            // bottom edge of the tile. `shades`: per-corner brightness.
            quad(p, n, rect, rgb, shades = [1, 1, 1, 1]) {
                const base = pos.length / 3, [u0, v0, u1, v1] = rect;
                for (let i = 0; i < 4; i++) {
                    pos.push(...p[i]); nor.push(...n);
                    col.push(rgb[0] * shades[i], rgb[1] * shades[i], rgb[2] * shades[i]);
                }
                uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
                // Split along the brighter diagonal so corner shade stays even.
                if (shades[0] + shades[2] < shades[1] + shades[3]) idx.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);
                else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            }
        };
    }
    // The six faces of a unit block at (x, y, z) (its low corner).
    const FACES = {
        top: { n: [0, 1, 0], at: (x, y, z) => [[x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z], [x, y + 1, z]] },
        south: { n: [0, 0, 1], d: [0, 1], at: (x, y, z) => [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]] },
        north: { n: [0, 0, -1], d: [0, -1], at: (x, y, z) => [[x + 1, y, z], [x, y, z], [x, y + 1, z], [x + 1, y + 1, z]] },
        east: { n: [1, 0, 0], d: [1, 0], at: (x, y, z) => [[x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1]] },
        west: { n: [-1, 0, 0], d: [-1, 0], at: (x, y, z) => [[x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]] }
    };
    const SIDES = ['south', 'north', 'east', 'west'];
    // A box of any size turned `turn` about its vertical axis (flowers).
    function smallBox(b, [cx, cy, cz], [sx, sy, sz], turn, rect, rgb) {
        const c = Math.cos(turn), s = Math.sin(turn), hx = sx / 2, hy = sy / 2, hz = sz / 2;
        const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
        const N = (x, y, z) => [x * c + z * s, y, -x * s + z * c];
        b.quad([P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz)], N(0, 1, 0), rect, rgb);
        b.quad([P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)], N(0, 0, 1), rect, rgb);
        b.quad([P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz)], N(0, 0, -1), rect, rgb);
        b.quad([P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz)], N(1, 0, 0), rect, rgb);
        b.quad([P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz)], N(-1, 0, 0), rect, rgb);
    }

    function create(T, scene, sim, tx) {
        const t = sim.terrain, K = terrainKit.KIND, tiles = tx.tiles, colour = new T.Color();
        // The cut: centre (the player's chest) and eye (the camera), blocks.
        const cut = { center: { value: new T.Vector3() }, eye: { value: new T.Vector3() }, radius: { value: 1.3 }, on: { value: 1 } };
        const material = new T.MeshLambertMaterial({ map: tx.atlas, vertexColors: true });
        // Hidden faces are left out, so the back faces three.js would cast
        // shadows with are often missing: cast with both sides.
        material.shadowSide = T.DoubleSide;
        material.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, { cutCenter: cut.center, cutEye: cut.eye, cutRadius: cut.radius, cutOn: cut.on });
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vCutPos;')
                .replace('#include <project_vertex>', '#include <project_vertex>\nvCutPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
varying vec3 vCutPos;
uniform vec3 cutCenter; uniform vec3 cutEye; uniform float cutRadius; uniform float cutOn;
float cutDither(vec2 p) {
    const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
    ivec2 i = ivec2(mod(p, 4.0));
    return (m[i.x + i.y * 4] + 0.5) / 16.0;
}`)
                .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (cutOn > 0.5 && vCutPos.y > 0.05) {
    vec3 axis = normalize(cutEye - cutCenter);
    vec3 rel = vCutPos - cutCenter;
    float along = dot(rel, axis);
    // Only what stands on the camera's side of the player, on the ground plane.
    float ahead = dot(rel.xz, normalize(axis.xz));
    float fade = (1.0 - smoothstep(cutRadius * 0.55, cutRadius, length(rel - axis * along))) * smoothstep(0.1, 0.35, ahead);
    if (fade * 0.85 > cutDither(gl_FragCoord.xy)) discard;
}`);
        };
        let deco = null, decoRev = -1;
        const chunks = new Map();
        // Where nothing standing is in the way: ground under open air.
        const column = (c, r) => terrainKit.inside(t, c, r) && terrainKit.isSolid(terrainKit.kindAt(t, c, r));
        // Does an opaque block fill (c, y, r)? The ground, a column, or decor.
        function opaque(c, y, r) {
            if (y < 0) return true;
            if (terrainKit.inside(t, c, r)) {
                const k = terrainKit.kindAt(t, c, r);
                if (terrainKit.isSolid(k) && k !== K.gate && y < terrainKit.levelAt(t, c, r)) return true;
            }
            return deco.has(`${c},${y},${r}`);
        }
        const tintOf = (base, c, y, r, vary) => { const k = 1 - vary + hash(c, y, r) * vary * 1.6; return [base[0] * k, base[1] * k, base[2] * k]; };
        const WHITE = [1, 1, 1];
        // Doors and windows on buildings: face overrides 'c,y,r,side' -> tile.
        function facades() {
            const out = new Map();
            for (const b of sim.entities) {
                if (b.type !== 'building') continue;
                const [dc, dr] = b.doorCell, { col, row, w, d } = b.footprint;
                out.set(`${dc},0,${dr},${b.door}`, 'door'); out.set(`${dc},1,${dr},${b.door}`, 'door');
                for (let c = col; c < col + w; c++) if (c !== dc && (c - col) % 2 === 1) out.set(`${c},1,${row + d - 1},south`, 'window');
                for (let r = row; r < row + d; r++) if ((r - row) % 2 === 1) { out.set(`${col},1,${r},west`, 'window'); out.set(`${col + w - 1},1,${r},east`, 'window'); }
            }
            return out;
        }
        let fronts = facades();
        // Spots kept free of flowers: spawns, homes, doors and portals.
        const clear = [...t.spawns, ...t.monsters, ...sim.entities.map(e => ({ col: Math.floor(e.x / t.unit), row: Math.floor(e.y / t.unit) }))];

        function build(i) {
            const b = builder(), { c0, r0, c1, r1 } = terrainKit.chunkCells(t, i);
            for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
                const k = terrainKit.kindAt(t, c, r), name = terrainKit.NAMES[k];
                if (!terrainKit.isSolid(k)) {
                    // Ground, shaded at corners that meet a wall.
                    const shades = [[0, 1], [1, 1], [1, 0], [0, 0]].map(([sx, sz]) => {
                        const dx = sx ? 1 : -1, dz = sz ? 1 : -1, s1 = column(c + dx, r), s2 = column(c, r + dz), corner = column(c + dx, r + dz);
                        return AO[s1 && s2 ? 0 : 3 - s1 - s2 - corner];
                    });
                    b.quad(FACES.top.at(c, -1, r), FACES.top.n, tiles[GROUND[k]], tintOf(WHITE, c, -1, r, 0.06), shades);
                    if (k === K.grass && hash(c, r, 7) < 0.18 && !clear.some(s => Math.abs(c - s.col) <= 1 && Math.abs(r - s.row) <= 1)) flower(b, c, r);
                    continue;
                }
                if (k === K.gate) continue;
                const [tile, vary] = BLOCK[name], level = terrainKit.levelAt(t, c, r);
                for (let y = 0; y < level; y++) {
                    const rgb = tintOf(WHITE, c, y, r, vary), own = k === K.stone && hash(c, y, r, 3) < 0.3 ? 'mossy' : tile;
                    if (y === level - 1 && !opaque(c, y + 1, r)) b.quad(FACES.top.at(c, y, r), FACES.top.n, tiles[k === K.tree ? 'barkTop' : own], rgb);
                    for (const side of SIDES) {
                        const F = FACES[side];
                        if (opaque(c + F.d[0], y, r + F.d[1])) continue;
                        b.quad(F.at(c, y, r), F.n, tiles[fronts.get(`${c},${y},${r},${side}`) || own], rgb);
                    }
                }
            }
            // Decor that belongs to this chunk (by the cell under it; decor
            // off the map's edge goes to the nearest chunk).
            const cx = i % t.cw, cz = Math.floor(i / t.cw);
            for (const [key, d] of deco) {
                const [x, y, z] = key.split(',').map(Number);
                if (Math.min(t.cw - 1, Math.max(0, Math.floor(x / 16))) !== cx || Math.min(t.ch - 1, Math.max(0, Math.floor(z / 16))) !== cz) continue;
                const base = d.tint ? colour.set(d.tint).toArray() : WHITE, rgb = tintOf(base, x, y, z, d.tile === 'leaves' ? 0.12 : 0.05);
                if (!opaque(x, y + 1, z)) b.quad(FACES.top.at(x, y, z), FACES.top.n, tiles[d.tile], rgb);
                for (const side of SIDES) {
                    const F = FACES[side];
                    if (!opaque(x + F.d[0], y, z + F.d[1])) b.quad(F.at(x, y, z), F.n, tiles[d.tile], rgb);
                }
            }
            return b;
        }
        // A tuft or a flower on grass cell (c, r): tiny boxes.
        function flower(b, c, r) {
            const x = c + 0.15 + hash(c, r, 11) * 0.7, z = r + 0.15 + hash(c, r, 12) * 0.7, turn = hash(c, r, 13) * Math.PI * 2;
            const stem = colour.set(palette.stem).toArray();
            if (hash(c, r, 14) < 0.55) {
                for (let k = 0; k < 3; k++) smallBox(b, [x + (k - 1) * 0.09, 0.12 + k % 2 * 0.04, z + (hash(c, r, 20 + k) - 0.5) * 0.1], [0.05, 0.24 + k % 2 * 0.08, 0.05], turn, tiles.white, stem);
            } else {
                smallBox(b, [x, 0.15, z], [0.05, 0.3, 0.05], turn, tiles.white, stem);
                const petal = [palette.flowerRed, palette.flowerYellow, palette.flowerWhite, palette.flowerViolet][hash(c, r, 15) * 4 | 0];
                smallBox(b, [x, 0.34, z], [0.15, 0.13, 0.15], turn, tiles.white, colour.set(petal).toArray());
            }
        }
        function mesh(b) {
            const g = new T.BufferGeometry();
            g.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));
            g.setAttribute('normal', new T.Float32BufferAttribute(b.nor, 3));
            g.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
            g.setAttribute('color', new T.Float32BufferAttribute(b.col, 3));
            g.setIndex(b.pos.length / 3 > 65535 ? new T.Uint32BufferAttribute(b.idx, 1) : new T.Uint16BufferAttribute(b.idx, 1));
            g.computeBoundingSphere();
            const m = new T.Mesh(g, material);
            m.castShadow = true; m.receiveShadow = true;
            return m;
        }
        // Rebuild every chunk whose revision moved (all of them the first time).
        function update() {
            if (decoRev !== t.rev) { deco = decor(sim); fronts = facades(); decoRev = t.rev; }
            let rebuilt = 0;
            t.chunks.forEach((chunk, i) => {
                const have = chunks.get(i);
                if (have && have.rev === chunk.rev) return;
                if (have) { scene.remove(have.mesh); have.mesh.geometry.dispose(); }
                const m = mesh(build(i));
                scene.add(m);
                chunks.set(i, { rev: chunk.rev, mesh: m });
                rebuilt++;
            });
            return rebuilt;
        }
        update();
        return {
            cut, material, update,
            meshes: () => [...chunks.values()].map(c => c.mesh),
            dispose() {
                for (const { mesh: m } of chunks.values()) { scene.remove(m); m.geometry.dispose(); }
                chunks.clear(); material.dispose();
            }
        };
    }
    return { create, decor, hash };
})();
