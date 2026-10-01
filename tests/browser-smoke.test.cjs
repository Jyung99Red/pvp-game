// Browser smoke test (rebuild-plan.md 5): the real page in headless Chromium
// as a landscape phone. Boots without console errors, draws the world, lays
// out the controls, covers portrait with the rotate hint, two real touch
// points (stick + A) drive the simulation together, and a field fight runs
// to its result panel, from where the menu switches maps. Two pages of one
// browser play a whole duel over ?link=local (rebuild-plan.md M4).
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

async function openPage(context, query) {
    const page = await context.newPage(), errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + query, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.clientState === 'ready' && window.game, null, { timeout: 120000 });
    return { page, errors };
}
async function openPhone(width, height, query = '?map=clearing') {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const { page, errors } = await openPage(context, query);
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
        // A real-time fight: the frame loop runs, J is A, the dummy swings back.
        await page.evaluate(() => { const g = window.game, d = g.sim.dummy; g.sim.player.x = d.x - 60; g.sim.player.y = d.y; g.sim.player.facing = 0; g.pause(false); });
        for (let i = 0; i < 3; i++) { await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
        // Software rendering can leave most of a second between frames, and
        // a frame runs at most MAX_FRAME of simulation: wait for the hit.
        await page.waitForFunction(() => window.game.sim.stats.hits >= 1, null, { timeout: 15000 }).catch(() => {});
        const fight = await page.evaluate(() => { window.game.pause(true); return { ...window.game.sim.stats, hp: window.game.sim.dummy.hp }; });
        assert.ok(fight.attacks >= 1 && fight.hits >= 1, `fight ${JSON.stringify(fight)}`);
        await shot(page, 'fight');
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('two thumbs through real touch points: stick with the shield, then stick with A', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390);
    try {
        const at = await page.evaluate(() => {
            window.game.sim.dummy.wait = 1e9; // keep the dummy out of it
            const c = el => { const r = document.querySelector(el).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
            return { a: c('[data-button="a"]'), b: c('[data-button="b"]'), shield: c('[data-button="offhand"]'), x0: window.game.sim.player.x };
        });
        const cdp = await context.newCDPSession(page);
        const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
        const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const stick = { x: 160, y: 300, id: 1 }, shield = { x: at.shield.x, y: at.shield.y, id: 2 }, a = { x: at.a.x, y: at.a.y, id: 3 }, b = { x: at.b.x, y: at.b.y, id: 4 };
        await touch('touchStart', [stick]);
        await touch('touchStart', [stick, shield]);
        await touch('touchMove', [{ ...stick, x: 220 }, shield]);
        // Moves are delivered with the next frame, which is slow here.
        await page.waitForFunction(() => window.game.sim.input.move.x > 0.99, null, { timeout: 10000 });
        const during = await page.evaluate(() => ({ move: window.game.sim.input.move, shield: window.game.sim.player.guard.state, pointers: window.game.input.state().pointers }));
        assert.ok(during.move.x > 0.99 && Math.abs(during.move.y) < 1e-9, JSON.stringify(during));
        assert.notEqual(during.shield, 'down');
        assert.deepEqual([...during.pointers].sort(), ['offhand', 'stick']);
        // A third finger is ignored: two thumbs is the limit.
        await touch('touchStart', [{ ...stick, x: 220 }, shield, b]);
        await frame();
        assert.equal(await page.evaluate(() => window.game.sim.input.buttons.b.held), false);
        const walked = await page.evaluate(() => { window.game.run(1); return window.game.sim.player.x; });
        assert.ok(Math.abs(walked - at.x0 - 115 * 0.3) < 1, `walked ${walked - at.x0} with the shield up`);
        await shot(page, 'two-thumbs');
        // A resize (going fullscreen does one) keeps the held stick alive.
        await page.setViewportSize({ width: 844, height: 380 });
        await page.waitForFunction(() => innerHeight === 380);
        await touch('touchMove', [{ ...stick, x: 160, y: 240 }, shield]);
        await page.waitForFunction(() => window.game.sim.input.move.y < -0.99, null, { timeout: 10000 }).catch(() => {});
        const afterResize = await page.evaluate(() => ({ move: window.game.sim.input.move, pointers: window.game.input.state().pointers }));
        assert.ok(afterResize.move.y < -0.99, `stick after resize: ${JSON.stringify(afterResize)}`);
        // Real time: unpaused, the frame loop walks the body on its own.
        // Frames can be most of a second apart here, so after the clock has
        // run, wait for two more frames: the game's own frame comes first.
        const real = await page.evaluate(async () => {
            const g = window.game, y0 = g.sim.player.y, t0 = performance.now();
            const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
            g.pause(false);
            await new Promise(resolve => setTimeout(resolve, 600));
            await frame(); await frame();
            g.pause(true);
            return { walked: y0 - g.sim.player.y, seconds: (performance.now() - t0) / 1000 };
        });
        assert.ok(real.walked > 1 && real.walked <= 115 * 0.3 * real.seconds + 1, `real-time walk ${JSON.stringify(real)} ${errors.join(' / ')}`);
        await touch('touchEnd', []);
        await page.waitForFunction(() => window.game.input.state().pointers.length === 0, null, { timeout: 10000 }).catch(() => {});
        const released = await page.evaluate(() => ({ move: window.game.sim.input.move, shield: window.game.sim.player.guard.state, pointers: window.game.input.state().pointers }));
        assert.deepEqual(released.move, { x: 0, y: 0 });
        assert.equal(released.shield, 'down');
        assert.deepEqual(released.pointers, []);
        // Stick and A: A starts its move at once and the body stands for it.
        await touch('touchStart', [stick]);
        await touch('touchMove', [{ ...stick, x: 220 }]);
        await page.waitForFunction(() => window.game.sim.input.move.x > 0.99, null, { timeout: 10000 });
        await touch('touchStart', [{ ...stick, x: 220 }, a]);
        await page.waitForFunction(() => window.game.sim.player.act !== null, null, { timeout: 10000 });
        assert.equal(await page.evaluate(() => window.game.sim.player.act.move), 'slash');
        await touch('touchEnd', []);
        await page.waitForFunction(() => window.game.input.state().pointers.length === 0, null, { timeout: 10000 }).catch(() => {});
        await page.evaluate(() => window.game.run(1));
        // Desktop keys: D walks east, J is A.
        await page.keyboard.down('KeyD');
        assert.equal(await page.evaluate(() => window.game.sim.input.move.x), 1);
        await page.keyboard.up('KeyD');
        await page.keyboard.press('KeyJ');
        assert.deepEqual(await page.evaluate(() => [window.game.sim.input.move.x, window.game.sim.input.buttons.a.presses, window.game.sim.stats.attacks]), [0, 2, 2]);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('the field: monsters drawn, a fight to the result panel, the menu switches maps', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390, '');
    try {
        const start = await page.evaluate(() => {
            const g = window.game;
            g.view.render(g.sim, 0);
            return { map: g.map, kinds: g.sim.monsters.map(m => m.kind).sort(), calls: g.view.info().calls, goal: document.querySelector('[data-hud="goal"]').textContent, dummy: !!g.sim.dummy };
        });
        assert.equal(start.map, 'field', 'the field is the default map');
        assert.deepEqual(start.kinds, ['goblin', 'goblin', 'wolf', 'wolf']);
        assert.equal(start.dummy, false);
        assert.ok(start.calls > 0 && start.calls < 80, `${start.calls} draw calls: a character is one skinned mesh`);
        assert.match(start.goal, /4 \/ 4/);
        // Walk up to a goblin: it notices and a "!" shows over it.
        const alert = await page.evaluate(() => {
            const g = window.game, s = g.sim, m = s.monsters.find(x => x.kind === 'goblin'), p = s.player;
            p.x = m.x - 120; p.y = m.y; p.facing = 0;
            g.run(0.05);
            return m.phase;
        });
        assert.equal(alert, 'alert');
        await page.waitForFunction(() => document.querySelectorAll('.mob:not([hidden]) .mob-alert:not([hidden])').length === 1, null, { timeout: 10000 });
        // It chases and winds up, with its warning on the ground.
        const fight = await page.evaluate(() => {
            const g = window.game, s = g.sim, m = s.monsters.find(x => x.kind === 'goblin');
            for (let i = 0; i < 300 && m.phase !== 'windup'; i++) g.run(0.01);
            g.run(0.5);
            g.view.render(s, 0.016);
            const warning = g.view.scene.children.find(o => o.isMesh && o.visible && o.material?.color?.getHexString?.() === 'ff2a1a');
            return { phase: m.phase, opacity: warning ? warning.material.opacity : 0 };
        });
        assert.equal(fight.phase, 'windup');
        assert.ok(fight.opacity > 0.1, `the warning shows through the windup: ${JSON.stringify(fight)}`);
        await page.waitForFunction(() => document.querySelector('[data-hud="target-name"]').textContent === '哥布林', null, { timeout: 10000 });
        await shot(page, 'field-windup');
        // Cut every monster down: the result panel comes up with the stats.
        await page.evaluate(() => {
            const g = window.game, s = g.sim;
            for (const m of s.monsters) { m.hp = 1; m.atk = 0; }
            for (let k = 0; k < 20 && !s.result; k++) {
                const m = s.monsters.find(x => x.phase !== 'dead'), p = s.player;
                Object.assign(m, { phase: 'patrol', t: 0, rest: 99 });
                Object.assign(p, { x: m.x - 50, y: m.y, facing: 0, push: null, stun: 0, act: null });
                g.run(0.01);
                worldSim.command(s, { type: 'press', button: 'a' }); worldSim.command(s, { type: 'release', button: 'a' });
                g.run(0.4);
            }
        });
        await page.waitForFunction(() => window.game.panel === 'win', null, { timeout: 30000 });
        const result = await page.evaluate(() => ({
            title: document.querySelector('[data-panel-title]').textContent,
            stats: document.querySelector('[data-panel-stats]').textContent,
            buttons: [...document.querySelectorAll('[data-panel] [data-action]')].filter(b => !b.hidden).map(b => b.textContent),
            kills: window.game.sim.stats.kills
        }));
        await shot(page, 'field-win');
        assert.equal(result.title, '胜利');
        assert.equal(result.kills, 4);
        assert.match(result.stats, /击倒4 \/ 4/);
        assert.deepEqual(result.buttons, ['再来一次', '去训练场']);
        // To the training ground, in place: no reload, the dummy is there, the address says so.
        await page.click('[data-action="clearing"]');
        const training = await page.evaluate(() => ({ map: window.game.map, dummy: !!window.game.sim.dummy, monsters: window.game.sim.monsters.length, panel: window.game.panel, url: location.search }));
        assert.deepEqual(training, { map: 'clearing', dummy: true, monsters: 0, panel: null, url: '?map=clearing' });
        await page.waitForFunction(() => document.querySelector('[data-hud="goal"]').hidden && document.querySelector('[data-hud="target-name"]').textContent === '训练木桩', null, { timeout: 10000 });
        // The menu key pauses; from there to the field again, then a loss.
        await page.click('[data-menu]');
        assert.equal(await page.evaluate(() => window.game.panel), 'menu');
        assert.equal(await page.evaluate(() => document.querySelector('[data-panel-title]').textContent), '暂停');
        await shot(page, 'menu');
        await page.click('[data-action="field"]');
        await page.evaluate(() => {
            const g = window.game, s = g.sim, m = s.monsters.find(x => x.kind === 'wolf'), p = s.player;
            p.hp = 1; p.x = m.x - 50; p.y = m.y; p.facing = Math.PI; m.phase = 'chase'; m.wait = 0;
            for (let i = 0; i < 400 && !s.result; i++) g.run(0.01);
        });
        await page.waitForFunction(() => window.game.panel === 'lose', null, { timeout: 30000 });
        assert.equal(await page.evaluate(() => document.querySelector('[data-panel-title]').textContent), '失败');
        await shot(page, 'field-lose');
        await page.click('[data-action="restart"]');
        assert.deepEqual(await page.evaluate(() => [window.game.map, window.game.panel, window.game.sim.player.hp, window.game.sim.result]), ['field', null, 360, null]);
        // Rebuilding a world frees the last one: GPU memory does not grow.
        const memory = await page.evaluate(() => {
            const g = window.game, out = [];
            for (const id of ['clearing', 'field', 'clearing', 'field']) { g.load(id); g.view.render(g.sim, 0.016); out.push({ ...g.view.renderer.info.memory }); }
            return out;
        });
        assert.deepEqual(memory[2], memory[0]);
        assert.deepEqual(memory[3], memory[1]);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('two phones in one browser (?link=local): a room code, a duel to a result, a rematch, then one leaves', { timeout: 300000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    try {
        const A = await openPage(context, '?link=local&map=clearing'), B = await openPage(context, '?link=local&map=clearing');
        const text = (page, sel) => page.evaluate(s => document.querySelector(s).textContent, sel);
        // A creates a room; B types its code on the keypad and joins.
        await A.page.click('[data-menu]'); await A.page.click('[data-action="duel"]');
        assert.equal(await text(A.page, '[data-room-title]'), '联机对战');
        await A.page.click('[data-room-action="host"]');
        await A.page.waitForFunction(() => document.querySelector('[data-room-status]').textContent.includes('等待'), null, { timeout: 20000 });
        const code = await A.page.evaluate(() => [...document.querySelectorAll('[data-room-code] i')].map(i => i.textContent).join(''));
        assert.match(code, /^\d{4}$/);
        await shot(A.page, 'room-host');
        await B.page.click('[data-menu]'); await B.page.click('[data-action="duel"]'); await B.page.click('[data-room-action="join"]');
        assert.equal(await B.page.evaluate(() => document.querySelector('[data-room-action="connect"]').disabled), true);
        for (const d of code) await B.page.click(`[data-key="${d}"]`);
        await shot(B.page, 'room-join');
        await B.page.click('[data-room-action="connect"]');
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel?.phase === 'countdown' || window.game.duel?.phase === 'fight', null, { timeout: 30000 });
        assert.deepEqual(await A.page.evaluate(() => [window.game.map, window.game.duel.selfId, window.game.room.isOpen()]), ['arena', 'host', false]);
        assert.deepEqual(await B.page.evaluate(() => [window.game.map, window.game.duel.selfId, window.game.duel.battle]), ['arena', 'guest', await A.page.evaluate(() => window.game.duel.battle)]);
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel.phase === 'fight', null, { timeout: 30000 });
        // The rival behind the north pillar is not drawn, and has no bar or arrow; in sight it is.
        const seen = await A.page.evaluate(() => {
            const g = window.game, [h, r] = g.sim.fighters, look = () => { g.view.render(g.sim, 0.016); return g.view.seen('guest'); };
            Object.assign(h, { x: 500, y: 260 }); Object.assign(r, { x: 620, y: 260 });
            const hidden = look();
            Object.assign(r, { x: 500, y: 380 });
            return { hidden, shown: look() };
        });
        assert.deepEqual(seen, { hidden: false, shown: true });
        // A knock-out: the host cuts the guest down; one result on each phone.
        await A.page.evaluate(() => {
            const [h, r] = window.game.sim.fighters;
            Object.assign(h, { x: 500, y: 380, facing: 0 }); Object.assign(r, { x: 560, y: 380, facing: Math.PI, hp: 1 });
        });
        await A.page.keyboard.press('KeyJ');
        await A.page.waitForFunction(() => window.game.panel === 'duelResult', null, { timeout: 60000 });
        await B.page.waitForFunction(() => window.game.panel === 'duelResult', null, { timeout: 60000 });
        assert.equal(await text(A.page, '[data-panel-title]'), '胜利');
        assert.equal(await text(B.page, '[data-panel-title]'), '失败');
        await shot(A.page, 'duel-win'); await shot(B.page, 'duel-lose');
        // A rematch: B asks, A sees it and agrees; both count down again.
        await B.page.click('[data-action="rematch"]');
        await A.page.waitForFunction(() => document.querySelector('[data-panel-note]').textContent.includes('对方想再来一局'), null, { timeout: 30000 });
        await A.page.click('[data-action="rematch"]');
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.panel === null && ['countdown', 'fight'].includes(window.game.duel?.phase) && window.game.sim.fighters.every(f => f.hp === f.maxHp), null, { timeout: 30000 });
        // A leaves from the menu: back to the field; B is told.
        await A.page.click('[data-menu]');
        assert.equal(await text(A.page, '[data-panel-title]'), '对战中');
        await A.page.click('[data-action="leave"]');
        assert.deepEqual(await A.page.evaluate(() => [window.game.map, window.game.panel, window.game.duel]), ['field', null, null]);
        await B.page.waitForFunction(() => window.game.panel === 'duelEnded', null, { timeout: 30000 });
        assert.match(await text(B.page, '[data-panel-note]'), /对方离开了房间/);
        await shot(B.page, 'duel-ended');
        assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
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
