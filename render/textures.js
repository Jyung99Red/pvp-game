// Procedural 16x16 pixel textures, drawn by code at start and sampled
// nearest-neighbour (3d-migration-concept.md 2). Presentation only.
const renderTextures = (() => {
    // Seeded so the world looks the same on every load.
    function rng(seed) {
        let a = seed | 0;
        return () => {
            a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
    const shade = (c, k) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;

    function create(T, seed = 20261001) {
        const rnd = rng(seed), P = palette;
        function texture(draw) {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
            draw(canvas.getContext('2d'));
            const t = new T.CanvasTexture(canvas);
            t.magFilter = T.NearestFilter; t.minFilter = T.NearestMipmapLinearFilter;
            t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace;
            return t;
        }
        function speckle(g, hex, lo, hi, x0 = 0, y0 = 0, w = 16, h = 16) {
            const c = rgbOf(hex);
            for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { g.fillStyle = shade(c, lo + (hi - lo) * rnd()); g.fillRect(x, y, 1, 1); }
        }
        function dots(g, hex, k, n) {
            const c = rgbOf(hex);
            for (let i = 0; i < n; i++) { g.fillStyle = shade(c, k); g.fillRect(rnd() * 16 | 0, rnd() * 16 | 0, 1, 1); }
        }
        const cracks = [[0, 5, 7, 1], [6, 0, 1, 5], [9, 8, 7, 1], [11, 9, 1, 7], [3, 11, 1, 5], [0, 11, 3, 1], [12, 2, 4, 1]];
        return {
            grassTop: texture(g => { speckle(g, P.grass, 0.82, 1.08); dots(g, P.grass, 0.68, 14); dots(g, P.grassLight, 1, 8); }),
            grassSide: texture(g => {
                speckle(g, P.dirt, 0.78, 1.06); dots(g, P.dirt, 0.6, 10); dots(g, '#a0a0a0', 0.9, 4);
                for (let x = 0; x < 16; x++) speckle(g, P.grass, 0.8, 1.05, x, 0, 1, 2 + (rnd() * 3 | 0));
            }),
            dirt: texture(g => { speckle(g, P.dirt, 0.78, 1.06); dots(g, P.dirt, 0.6, 12); dots(g, '#a0a0a0', 0.9, 5); }),
            path: texture(g => { speckle(g, P.path, 0.82, 1.08); dots(g, P.pebble, 1, 10); dots(g, P.path, 0.7, 10); }),
            stone: texture(g => {
                speckle(g, P.stone, 0.8, 1.06);
                g.fillStyle = shade(rgbOf(P.stoneDark), 1);
                for (const [x, y, w, h] of cracks) g.fillRect(x, y, w, h);
                dots(g, P.stoneLight, 1, 8);
            }),
            mossy: texture(g => {
                speckle(g, P.stone, 0.8, 1.06);
                g.fillStyle = shade(rgbOf(P.stoneDark), 1);
                for (const [x, y, w, h] of cracks.slice(0, 4)) g.fillRect(x, y, w, h);
                for (let i = 0; i < 4; i++) speckle(g, P.moss, 0.8, 1.1, rnd() * 12 | 0, rnd() * 12 | 0, 3 + (rnd() * 3 | 0), 2 + (rnd() * 3 | 0));
            }),
            bark: texture(g => {
                const c = rgbOf(P.bark);
                for (let x = 0; x < 16; x++) {
                    const col = 0.8 + 0.25 * ((x * 7) % 5) / 4;
                    for (let y = 0; y < 16; y++) { g.fillStyle = shade(c, col * (0.9 + rnd() * 0.15)); g.fillRect(x, y, 1, 1); }
                }
            }),
            leaves: texture(g => { speckle(g, P.leaves, 0.7, 1.12); dots(g, P.leavesDark, 1, 22); dots(g, P.leavesLight, 1, 10); }),
            // Fine grain on character boxes, tinted by the box colour.
            grain: texture(g => { speckle(g, '#ffffff', 0.84, 1.0); dots(g, '#ffffff', 0.74, 10); })
        };
    }
    return { rng, create };
})();
