// Browser smoke test (rebuild-plan.md 5): the real page in headless Chromium
// as a landscape phone. Boots without console errors, draws the world, lays
// out the controls, covers portrait with the rotate hint, and two real
// touch points (stick + A) drive the simulation together.
//
// Skipped when Playwright is not available. It is looked up as
// PLAYWRIGHT_MODULE (a path), then `playwright`, `playwright-core`, then the
// cloud container's global install. PLAYWRIGHT_CHANNEL=chrome (or msedge)
// uses an installed browser instead of Playwright's own. SMOKE_SHOTS=<dir>
// saves screenshots there.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.join(__dirname, '..');

function findPlaywright() {
    for (const id of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
        try { return require(id); } catch (_) { /* try the next one */ }
    }
    return null;
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
    const server = http.createServer((req, res) => {
        const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        const target = file.endsWith(path.sep) ? path.join(file, 'index.html') : file;
        if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
        fs.createReadStream(target).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let browser = null, server = null, base = '', skip = '';
before(async () => {
    const pw = findPlaywright();
    if (!pw) { skip = 'Playwright is not installed'; return; }
    try {
        browser = await pw.chromium.launch({
            channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        });
    } catch (error) { skip = `no browser to launch (${error.message.split('\n')[0]})`; return; }
    server = await serve();
    base = `http://127.0.0.1:${server.address().port}/`;
});
after(async () => { await browser?.close(); server?.close(); });

async function openPhone(width, height) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await context.newPage(), errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.clientState === 'ready' && window.game, null, { timeout: 120000 });
    // Freeze real time: the test steps the simulation itself.
    await page.evaluate(() => window.game.pause(true));
    return { context, page, errors };
}
async function shot(page, name) {
    if (!process.env.SMOKE_SHOTS) return;
    fs.mkdirSync(process.env.SMOKE_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SMOKE_SHOTS, `${name}.png`) });
}

test('landscape phone: boots clean, draws the world, controls laid out', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390);
    try {
        const info = await page.evaluate(() => {
            const g = window.game, rect = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2, w: r.width, h: r.height }; };
            const buttons = {};
            document.querySelectorAll('[data-button]').forEach(el => { buttons[el.dataset.button] = rect(el); });
            // Sample the frame right after drawing it, before it is presented.
            g.view.render(g.sim, 0);
            const gl = g.view.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4), samples = [];
            for (const [fx, fy] of [[0.5, 0.15], [0.3, 0.3], [0.7, 0.3], [0.25, 0.75], [0.75, 0.75]]) {
                gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
                samples.push(Array.from(px));
            }
            return {
                buttons, samples, drawing: [w, h],
                rotateHint: getComputedStyle(document.querySelector('.rotate-hint')).display,
                interactIdle: document.querySelector('[data-button="interact"]').classList.contains('idle'),
                offhandDisabled: document.querySelector('[data-button="offhand"]').classList.contains('disabled'),
                calls: g.view.info().calls, threeRevision: THREE.REVISION
            };
        });
        await shot(page, 'landscape');
        assert.deepEqual(errors, []);
        assert.equal(info.threeRevision, '186');
        assert.equal(info.rotateHint, 'none');
        assert.ok(info.samples.filter(([r, g, b]) => g > r && g > b).length >= 3, `grass-green pixels expected: ${JSON.stringify(info.samples)}`);
        assert.ok(info.calls > 0 && info.calls < 200, `${info.calls} draw calls`);
        assert.deepEqual(info.drawing, [844 * 2, 390 * 2]);
        const list = Object.entries(info.buttons);
        assert.equal(list.length, 4);
        for (const [id, b] of list) assert.ok(b.x - b.r >= 0 && b.x + b.r <= 844 && b.y - b.r >= 0 && b.y + b.r <= 390, `${id} on screen`);
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const [ia, a] = list[i], [ib, b] = list[j];
            assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 10 - 0.5, `${ia} and ${ib} overlap`);
        }
        assert.equal(info.buttons.a.w, 84);
        assert.ok(info.interactIdle && !info.offhandDisabled);
    } finally { await context.close(); }
});

test('two thumbs: stick and A at once through real touch points', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390);
    try {
        const at = await page.evaluate(() => {
            const c = el => { const r = document.querySelector(el).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
            return { a: c('[data-button="a"]'), b: c('[data-button="b"]'), x0: window.game.sim.player.x };
        });
        const cdp = await context.newCDPSession(page);
        const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
        const stick = { x: 160, y: 300, id: 1 }, a = { x: at.a.x, y: at.a.y, id: 2 }, b = { x: at.b.x, y: at.b.y, id: 3 };
        await touch('touchStart', [stick]);
        await touch('touchStart', [stick, a]);
        await touch('touchMove', [{ ...stick, x: 220 }, a]);
        // Moves are delivered with the next frame, which is slow here.
        await page.waitForFunction(() => window.game.sim.input.move.x > 0.99, null, { timeout: 10000 });
        const during = await page.evaluate(() => ({ move: window.game.sim.input.move, a: window.game.sim.input.buttons.a.held, pointers: window.game.input.state().pointers }));
        assert.ok(during.move.x > 0.99 && Math.abs(during.move.y) < 1e-9, JSON.stringify(during));
        assert.equal(during.a, true);
        assert.deepEqual([...during.pointers].sort(), ['a', 'stick']);
        // A third finger is ignored: two thumbs is the limit.
        await touch('touchStart', [{ ...stick, x: 220 }, a, b]);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => window.game.sim.input.buttons.b.held), false);
        const walked = await page.evaluate(() => { window.game.run(1); return window.game.sim.player.x; });
        assert.ok(Math.abs(walked - at.x0 - 115) < 1e-6, `walked ${walked - at.x0}`);
        await shot(page, 'two-thumbs');
        // A resize (going fullscreen does one) keeps the held stick alive.
        await page.setViewportSize({ width: 844, height: 380 });
        await page.waitForFunction(() => innerHeight === 380);
        await touch('touchMove', [{ ...stick, x: 160, y: 240 }, a]);
        await page.waitForFunction(() => window.game.sim.input.move.y < -0.99, null, { timeout: 10000 }).catch(() => {});
        const afterResize = await page.evaluate(() => ({ move: window.game.sim.input.move, pointers: window.game.input.state().pointers }));
        assert.ok(afterResize.move.y < -0.99, `stick after resize: ${JSON.stringify(afterResize)}`);
        // Real time: unpaused, the frame loop walks the body on its own.
        const real = await page.evaluate(async () => {
            const g = window.game, y0 = g.sim.player.y, t0 = performance.now();
            g.pause(false);
            await new Promise(resolve => setTimeout(resolve, 600));
            g.pause(true);
            return { walked: y0 - g.sim.player.y, seconds: (performance.now() - t0) / 1000 };
        });
        assert.ok(real.walked > 5 && real.walked <= 115 * real.seconds + 1, `real-time walk ${JSON.stringify(real)} ${errors.join(" / ")}`);
        await touch('touchEnd', []);
        await page.waitForFunction(() => window.game.input.state().pointers.length === 0, null, { timeout: 10000 }).catch(() => {});
        const released = await page.evaluate(() => ({ move: window.game.sim.input.move, a: window.game.sim.input.buttons.a, pointers: window.game.input.state().pointers }));
        assert.deepEqual(released.move, { x: 0, y: 0 });
        assert.equal(released.a.held, false); assert.equal(released.a.presses, 1);
        assert.deepEqual(released.pointers, []);
        // Desktop keys: D walks east, J is A.
        await page.keyboard.down('KeyD');
        assert.equal(await page.evaluate(() => window.game.sim.input.move.x), 1);
        await page.keyboard.up('KeyD');
        await page.keyboard.press('KeyJ');
        assert.deepEqual(await page.evaluate(() => [window.game.sim.input.move.x, window.game.sim.input.buttons.a.presses]), [0, 2]);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('portrait shows only the rotate hint', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(390, 844);
    try {
        const hint = await page.evaluate(() => {
            const el = document.querySelector('.rotate-hint'), r = el.getBoundingClientRect(), s = getComputedStyle(el);
            return { display: s.display, w: r.width, h: r.height, text: el.textContent };
        });
        await shot(page, 'portrait');
        assert.equal(hint.display, 'grid');
        assert.deepEqual([hint.w, hint.h], [390, 844]);
        assert.match(hint.text, /横/);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});
