// Browser smoke test (roadmap.md 4): the real page in headless Chromium
// as a landscape phone. Boots without console errors, draws the world, lays
// out the controls, covers portrait with the rotate hint, two real touch
// points (stick + A) drive the simulation together; the world (M5): from
// the base through a portal by touch, a fight, falling and home, walls in
// front cut open, a monster behind the player's back not drawn, the save
// across a reload. Two pages of one browser play
// a whole duel over ?link=local (design.md 8), one of them going to the
// background and back on the way.
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
                guardKind: document.querySelector('[data-button="guard"]').dataset.kind,
                offhandGrey: document.querySelector('[data-button="offhand"]').classList.contains('disabled'),
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
        assert.equal(info.buttons.attack.w, 84);
        assert.ok(info.interactIdle);
        assert.equal(info.guardKind, 'shield');
        assert.equal(info.offhandGrey, true, 'with the shield the offhand key is grey');
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
            return { a: c('[data-button="attack"]'), shield: c('[data-button="guard"]'), x0: window.game.sim.player.x };
        });
        const cdp = await context.newCDPSession(page);
        const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
        const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const stick = { x: 160, y: 300, id: 1 }, shield = { x: at.shield.x, y: at.shield.y, id: 2 }, a = { x: at.a.x, y: at.a.y, id: 3 };
        await touch('touchStart', [stick]);
        await touch('touchStart', [stick, shield]);
        await touch('touchMove', [{ ...stick, x: 220 }, shield]);
        // Moves are delivered with the next frame, which is slow here.
        await page.waitForFunction(() => window.game.sim.input.move.x > 0.99, null, { timeout: 10000 });
        const during = await page.evaluate(() => ({ move: window.game.sim.input.move, shield: window.game.sim.player.guard.state, pointers: window.game.input.state().pointers }));
        assert.ok(during.move.x > 0.99 && Math.abs(during.move.y) < 1e-9, JSON.stringify(during));
        assert.notEqual(during.shield, 'down');
        assert.deepEqual([...during.pointers].sort(), ['guard', 'stick']);
        // A third finger is ignored: two thumbs is the limit.
        await touch('touchStart', [{ ...stick, x: 220 }, shield, { ...a, id: 4 }]);
        await frame();
        assert.equal(await page.evaluate(() => window.game.sim.input.buttons.attack.held), false);
        const walked = await page.evaluate(() => { window.game.run(1); return window.game.sim.player.x; });
        // Slowly with the shield up (a little less while it turns and gets going).
        const slow = await page.evaluate(() => gameConfig.player.speed * gameConfig.combat.guard.moveMultiplier);
        assert.ok(walked - at.x0 > 0.6 * slow && walked - at.x0 < slow + 1, `walked ${walked - at.x0} with the shield up`);
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
            const g = window.game, y0 = g.sim.player.y, t0 = performance.now(), speed = gameConfig.player.speed;
            const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
            g.pause(false);
            await new Promise(resolve => setTimeout(resolve, 600));
            await frame(); await frame();
            g.pause(true);
            return { walked: y0 - g.sim.player.y, seconds: (performance.now() - t0) / 1000, speed };
        });
        assert.ok(real.walked > 1 && real.walked <= real.speed * 0.3 * real.seconds + 1, `real-time walk ${JSON.stringify(real)} ${errors.join(' / ')}`);
        await touch('touchEnd', []);
        await page.waitForFunction(() => window.game.input.state().pointers.length === 0, null, { timeout: 10000 }).catch(() => {});
        const released = await page.evaluate(() => ({ move: window.game.sim.input.move, shield: window.game.sim.player.guard.state, pointers: window.game.input.state().pointers }));
        assert.deepEqual(released.move, { x: 0, y: 0 });
        assert.equal(released.shield, 'down');
        assert.deepEqual(released.pointers, []);
        // Stick and a tap of the attack key: an A, and the body stands for it.
        await touch('touchStart', [stick]);
        await touch('touchMove', [{ ...stick, x: 220 }]);
        await page.waitForFunction(() => window.game.sim.input.move.x > 0.99, null, { timeout: 10000 });
        await touch('touchStart', [{ ...stick, x: 220 }, a]);
        await page.waitForFunction(() => window.game.sim.input.buttons.attack.held, null, { timeout: 10000 });
        await touch('touchEnd', [a]);
        await page.waitForFunction(() => window.game.sim.player.act !== null, null, { timeout: 10000 });
        assert.equal(await page.evaluate(() => window.game.sim.input.move.x), 1, 'the stick is still held');
        assert.equal(await page.evaluate(() => window.game.sim.player.act.move), 'slash');
        await touch('touchEnd', []);
        await page.waitForFunction(() => window.game.input.state().pointers.length === 0, null, { timeout: 10000 }).catch(() => {});
        await page.evaluate(() => window.game.run(1));
        // Desktop keys: D walks east, J is the attack key.
        await page.keyboard.down('KeyD');
        assert.equal(await page.evaluate(() => window.game.sim.input.move.x), 1);
        await page.keyboard.up('KeyD');
        await page.keyboard.press('KeyJ');
        assert.deepEqual(await page.evaluate(() => [window.game.sim.input.move.x, window.game.sim.input.buttons.attack.presses, window.game.sim.stats.attacks]), [0, 2, 2]);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('the world: the base, through the north gate by touch, a fight, falling and home again; walls in front go see-through; the save keeps it', { timeout: 300000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390, '');
    try {
        const start = await page.evaluate(() => {
            const g = window.game;
            g.view.render(g.sim, 0);
            return {
                map: g.map, monsters: g.sim.monsters.length, buildings: g.sim.entities.filter(e => e.type === 'building').map(e => e.kind).sort(),
                calls: g.view.info().calls, goal: document.querySelector('[data-hud="goal"]').textContent, banner: document.querySelector('[data-hud="region-title"]').textContent,
                key: document.querySelector('[data-hud="interact"]').textContent, idle: document.querySelector('[data-button="interact"]').classList.contains('idle')
            };
        });
        assert.deepEqual({ ...start, calls: undefined }, {
            map: 'base', monsters: 0, buildings: ['hotSpring', 'shop', 'smithy', 'storage'], calls: undefined, goal: '曙光据点 · 🪙 0', banner: '曙光据点', key: '交互', idle: true
        });
        assert.ok(start.calls > 0 && start.calls < 60, `${start.calls} draw calls: terrain is a mesh per chunk`);
        await shot(page, 'base');
        // The storage: the key names it, a tap opens the menu with the bag (one bag: the storage is it).
        const key = await page.evaluate(() => {
            const g = window.game, p = g.sim.player, s = g.sim.entities.find(e => e.kind === 'storage');
            Object.assign(p, { x: s.x, y: s.y + 30, facing: -Math.PI / 2 }); g.run(0.05);
            const r = document.querySelector('[data-button="interact"]').getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.waitForFunction(() => document.querySelector('[data-hud="interact"]').textContent === '进入' && document.querySelector('[data-hud="tag-name"]').textContent === '仓库', null, { timeout: 10000 });
        await page.touchscreen.tap(key.x, key.y);
        await page.waitForFunction(() => window.game.menu.isOpen(), null, { timeout: 10000 });
        // Worn: the three starter pieces, drawn from their models; the bag is otherwise empty.
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-menu-slots] [data-item]')].map(e => [e.dataset.item, e.querySelector('img.item-icon')?.src.startsWith('data:image/png') || false])),
            [['wooden_sword', true], ['wooden_shield', true], ['cloth_armor', true]]);
        assert.equal(await page.evaluate(() => document.querySelectorAll('[data-menu-bag] [data-item]').length), 0);
        await shot(page, 'storage');
        await page.click('[data-menu-act="close"]');
        // The north gate, by touch: off to the field, standing at the gate back.
        await page.evaluate(() => {
            const g = window.game, p = g.sim.player, gate = g.sim.entities.find(e => e.id === 'p-field');
            Object.assign(p, { x: gate.x, y: gate.y + 40, facing: -Math.PI / 2 }); g.run(0.05);
        });
        await page.waitForFunction(() => document.querySelector('[data-hud="interact"]').textContent === '前往', null, { timeout: 10000 });
        await page.touchscreen.tap(key.x, key.y);
        await page.waitForFunction(() => window.game.map === 'field', null, { timeout: 10000 });
        const field = await page.evaluate(() => {
            const g = window.game, s = g.sim, p = s.player, gate = s.entities.find(e => e.id === 'p-base');
            g.view.render(s, 0);
            return { kinds: [...new Set(s.monsters.map(m => m.kind))].sort(), near: Math.hypot(p.x - gate.x, p.y - gate.y), calls: g.view.info().calls, banner: document.querySelector('[data-hud="region-title"]').textContent };
        });
        assert.deepEqual(field.kinds, ['goblin', 'goblinChief', 'wolf']);
        assert.ok(field.near < 80, `arrived ${field.near} from the gate back`);
        assert.equal(field.banner, '晨雾原野');
        assert.ok(field.calls > 0 && field.calls < 100, `${field.calls} draw calls`);
        // Walk up to a goblin: it notices and a "!" shows over it; its windup shows its warning.
        const alert = await page.evaluate(() => {
            const g = window.game, s = g.sim, m = s.monsters.find(x => x.kind === 'goblin'), p = s.player;
            p.x = m.x - 120; p.y = m.y; p.facing = 0;
            g.run(0.05);
            return m.phase;
        });
        assert.equal(alert, 'alert');
        await page.waitForFunction(() => document.querySelectorAll('.mob:not([hidden]) .mob-alert:not([hidden])').length === 1, null, { timeout: 10000 });
        const fight = await page.evaluate(() => {
            const g = window.game, s = g.sim, m = s.monsters.find(x => x.phase === 'alert');
            for (let i = 0; i < 300 && m.phase !== 'windup'; i++) g.run(0.01);
            g.run(0.5);
            g.view.render(s, 0.016);
            const shown = () => g.view.scene.children.find(o => o.isMesh && o.visible && o.material?.color?.getHexString?.() === 'ff2a1a');
            const warning = shown(), p = s.player, seen = g.view.seen(m.id);
            // Sight (user, 2026-10-04): with the player's back to it, the
            // goblin and its warning are not drawn; facing it again they are.
            p.facing = Math.PI; g.view.render(s, 0.016);
            const behind = { seen: g.view.seen(m.id), warning: !!shown() };
            p.facing = 0; g.view.render(s, 0.016);
            return { phase: m.phase, opacity: warning ? warning.material.opacity : 0, seen, behind, again: g.view.seen(m.id), key: document.querySelector('[data-button="interact"]').className };
        });
        assert.equal(fight.phase, 'windup');
        assert.ok(fight.opacity > 0.1, `the warning shows through the windup: ${JSON.stringify(fight)}`);
        assert.deepEqual([fight.seen, fight.behind, fight.again], [true, { seen: false, warning: false }, true], 'a monster behind the player is not drawn');
        await page.waitForFunction(() => document.querySelector('[data-hud="target-name"]').textContent === '哥布林', null, { timeout: 10000 });
        await shot(page, 'field-windup');
        // A wall in front of the player is cut open round them: the pixel at
        // their chest is the shirt with the cut, the stone without it.
        const cut = await page.evaluate(() => {
            const g = window.game, s = g.sim, p = s.player;
            s.monsters = s.monsters.filter(m => m.boss);
            Object.assign(p, { x: 36.5 * 40, y: 13.4 * 40, facing: -Math.PI / 2, act: null, stun: 0, push: null });
            const gl = g.view.renderer.getContext(), N = 8, px = new Uint8Array(N * N * 4), ground = g.view.ground;
            // Share of bluish pixels in a small square at the chest (the cut
            // is a dither; it eases open while the wall hides the player, so
            // a second is drawn).
            const sample = on => {
                ground.cut.on.value = on;
                g.view.render(s, 1);
                const at = g.view.project([p.x / 40, 1.05, p.y / 40]), k = gl.drawingBufferWidth / innerWidth;
                gl.readPixels(Math.round(at.x * k) - N / 2, Math.round(gl.drawingBufferHeight - at.y * k) - N / 2, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
                let blue = 0;
                for (let i = 0; i < N * N; i++) if (px[i * 4 + 2] > px[i * 4] + 10 && px[i * 4 + 2] > px[i * 4 + 1]) blue++;
                return blue / (N * N);
            };
            const off = sample(0), on = sample(1);
            ground.cut.on.value = 1;
            return { off, on, open: ground.cut.open.value };
        });
        await shot(page, 'cutaway');
        assert.equal(cut.open, 1, 'the wall hides the player: the cut is open');
        assert.ok(cut.on > 0.5, `the blue shirt shows through the wall: ${JSON.stringify(cut)}`);
        assert.ok(cut.off < 0.1, `without the cut, the stone hides it: ${JSON.stringify(cut)}`);
        // Falling: the trip ends; home to the base, whole.
        await page.evaluate(() => {
            const g = window.game, s = g.sim, m = s.monsters[0], p = s.player;
            p.hp = 1; p.x = m.x - 60; p.y = m.y; p.facing = Math.PI; m.phase = 'chase'; m.wait = 0;
            for (let i = 0; i < 500 && !s.result; i++) g.run(0.01);
        });
        await page.waitForFunction(() => window.game.panel === 'lose', null, { timeout: 30000 });
        assert.equal(await page.evaluate(() => document.querySelector('[data-panel-title]').textContent), '倒下了');
        await shot(page, 'fallen');
        await page.click('[data-action="home"]');
        assert.deepEqual(await page.evaluate(() => [window.game.map, window.game.panel, window.game.sim.player.hp, window.game.sim.result]), ['base', null, 360, null]);
        // The menu: no way home from it (user, 2026-10-02); the settings
        // fold open, a tap moves one on; resetting asks first.
        await page.click('[data-menu]');
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.menu-side > [data-menu-act]')].map(b => b.textContent)), ['暂停', '联机对战', '设定', '重新开始冒险']);
        assert.equal(await page.evaluate(() => document.querySelector('[data-menu-settings]').hidden), true);
        await page.click('[data-menu-act="settings"]');
        await page.click('[data-setting="camera"]');
        assert.deepEqual(await page.evaluate(() => [document.querySelector('[data-menu-settings]').hidden, document.querySelector('[data-setting="camera"] b').textContent, JSON.parse(localStorage.getItem('blocky-rpg-settings')).camera]), [false, '远', 'far']);
        await page.click('[data-setting="camera"]'); await page.click('[data-setting="camera"]');
        await page.click('[data-menu-act="reset"]');
        assert.equal(await page.evaluate(() => document.querySelector('[data-panel-title]').textContent), '重新开始冒险？');
        await page.click('[data-action="resume"]');
        // Loot picked up is in the save and survives a reload.
        await page.evaluate(() => {
            const g = window.game;
            g.sim.progress.inventory.gold = 42; g.sim.progress.inventory.items.wolf_pelt = 2;
            g.persist();
        });
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => document.documentElement.dataset.clientState === 'ready' && window.game, null, { timeout: 120000 });
        assert.deepEqual(await page.evaluate(() => [window.game.map, window.game.sim.progress.inventory.gold, window.game.save.inventory.items.wolf_pelt]), ['base', 42, 2]);
        // Rebuilding a world frees the last one: GPU memory does not grow.
        const memory = await page.evaluate(() => {
            const g = window.game, out = [];
            g.pause(true);
            for (const id of ['clearing', 'field', 'clearing', 'field']) { g.load(id); g.view.render(g.sim, 0.016); out.push({ ...g.view.renderer.info.memory }); }
            return out;
        });
        assert.deepEqual(memory[2], memory[0]);
        assert.deepEqual(memory[3], memory[1]);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('items: the smithy makes iron armor, the bag puts it on (the model changes), the shop sells a potion that heals; a torch lights the dark cave', { timeout: 300000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390, '');
    try {
        const door = kind => page.evaluate(k => {
            const g = window.game, p = g.sim.player, s = g.sim.entities.find(e => e.kind === k);
            Object.assign(p, { x: s.x, y: s.y + 30, facing: -Math.PI / 2 }); g.run(0.05);
        }, kind);
        await page.evaluate(() => { const g = window.game; g.sim.progress.inventory.gold = 300; Object.assign(g.sim.progress.inventory.items, { goblin_ear: 4, wolf_pelt: 4, iron_ore: 6 }); });
        // The smithy, through its door.
        await door('smithy');
        await page.keyboard.press('KeyE'); await page.evaluate(() => window.game.run(0.02));
        await page.waitForFunction(() => window.game.screens.kind === 'smithy', null, { timeout: 10000 });
        await page.click('[data-row="iron_armor"]');
        await shot(page, 'smithy');
        await page.click('[data-act="craft"]');
        assert.equal(await page.evaluate(() => window.game.sim.progress.inventory.items.iron_armor), 1);
        await page.click('[data-screen-close]');
        // The shop: two potions.
        await door('shop');
        await page.keyboard.press('KeyE'); await page.evaluate(() => window.game.run(0.02));
        await page.waitForFunction(() => window.game.screens.kind === 'shop', null, { timeout: 10000 });
        await page.click('[data-row="potion"]'); await page.click('[data-act="buy"]'); await page.click('[data-act="buy"]');
        await page.click('[data-row="torch"]'); await page.click('[data-act="buy"]');
        await page.click('[data-screen-close]');
        // The bag in the menu: iron armor and a potion on (the figure shows
        // them at once); the base is rebuilt round the player in them when it closes.
        const before = await page.evaluate(() => ({ parts: window.game.sim.rigs.fighters.player.parts.length, x: window.game.sim.player.x }));
        await page.click('[data-menu]');
        await page.click('[data-menu-bag] [data-item="iron_armor"]'); await page.click('[data-act="equip"]');
        await page.click('[data-menu-bag] [data-item="potion"]'); await page.click('[data-act="equip"]');
        assert.match(await page.evaluate(() => document.querySelector('[data-menu-detail] .detail-note').textContent), /换上了药水/);
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-menu-slots] [data-item]')].map(e => e.dataset.item)), ['wooden_sword', 'potion', 'iron_armor']);
        await shot(page, 'bag');
        await page.click('[data-menu-act="close"]');
        const worn = await page.evaluate(() => { const g = window.game, p = g.sim.player; return { map: g.map, parts: g.sim.rigs.fighters.player.parts.length, x: p.x, maxHp: p.maxHp, def: p.def, offhand: p.loadout.offhand, saved: g.save.loadout.armor }; });
        assert.deepEqual({ ...worn, parts: undefined }, { map: 'base', parts: undefined, x: before.x, maxHp: 380, def: 11, offhand: 'potion', saved: 'iron_armor' });
        assert.ok(worn.parts > before.parts, 'the iron armor adds plates to the model');
        // No shield now: the guard key shows the blade; the offhand key the
        // potion and how many are left.
        await page.waitForFunction(() => document.querySelector('[data-button="guard"]').dataset.kind === 'weapon' && document.querySelector('[data-button="offhand"]').dataset.kind === 'potion' && !document.querySelector('[data-button="offhand"]').classList.contains('disabled') && document.querySelector('[data-hud="offhand-count"]').textContent === '2', null, { timeout: 10000 });
        // A drink with the offhand key (K) heals 30% of max HP.
        await page.evaluate(() => { window.game.sim.player.hp = 100; });
        await page.keyboard.press('KeyK');
        await page.evaluate(() => window.game.run(0.9));
        assert.deepEqual(await page.evaluate(() => [window.game.sim.player.hp, window.game.sim.progress.inventory.items.potion]), [214, 1]);
        // Outside the base the bag only shows: no changing gear. The menu
        // does not pause the world (user, 2026-10-02); its pause button does.
        await page.evaluate(() => window.game.load('field'));
        await page.click('[data-menu]');
        await page.click('[data-menu-bag] [data-item="wooden_shield"]');
        assert.deepEqual(await page.evaluate(() => [document.querySelector('[data-act="equip"]').disabled, document.querySelector('[data-menu-detail] .detail-note').textContent]), [true, '只能在据点里换装备']);
        // Real time for a few frames, then frozen again for the test.
        const ticks = () => page.evaluate(async () => {
            const g = window.game, t0 = g.sim.time, frame = () => new Promise(resolve => requestAnimationFrame(resolve));
            g.pause(false); await frame(); await frame(); await frame(); g.pause(true);
            return g.sim.time - t0;
        });
        const ticking = await ticks();
        assert.ok(ticking > 0, `the world goes on under the menu: ${ticking}`);
        await page.click('[data-menu-act="pause"]');
        assert.deepEqual(await page.evaluate(() => [window.game.menu.isOpen(), window.game.panel, document.querySelector('[data-panel-title]').textContent]), [false, 'pause', '暂停']);
        assert.equal(await ticks(), 0, 'paused, it stands still');
        await page.click('[data-action="resume"]');
        // The torch in the dark cave: the ground round the player is lit only while it burns.
        await page.evaluate(() => { const g = window.game; g.sim.progress.loadout.offhand = 'torch'; g.load('cave'); });
        const light = await page.evaluate(() => {
            const g = window.game, s = g.sim, p = s.player, gl = g.view.renderer.getContext(), N = 16, px = new Uint8Array(N * N * 4);
            s.monsters = [];
            // The ground sampled lies east of the player: facing it, so it is in sight (not shaded).
            p.facing = 0;
            const sample = () => {
                g.view.render(s, 0);
                const at = g.view.project([p.x / 40 + 1.2, 0, p.y / 40]), k = gl.drawingBufferWidth / innerWidth;
                gl.readPixels(Math.round(at.x * k) - N / 2, Math.round(gl.drawingBufferHeight - at.y * k) - N / 2, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
                let sum = 0;
                for (let i = 0; i < N * N; i++) sum += px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2];
                return sum / (N * N * 3);
            };
            const dark = sample();
            worldSim.command(s, { type: 'press', button: 'offhand' }); worldSim.command(s, { type: 'release', button: 'offhand' });
            g.run(0.02);
            return { dark, lit: sample(), on: p.lit };
        });
        await shot(page, 'cave');
        assert.ok(light.on && light.lit > light.dark * 2 && light.dark < 40, `the torch lights the cave floor: ${JSON.stringify(light)}`);
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
        await A.page.click('[data-menu]'); await A.page.click('[data-menu-act="duel"]');
        assert.equal(await text(A.page, '[data-room-title]'), '联机对战');
        await A.page.click('[data-room-action="host"]');
        await A.page.waitForFunction(() => document.querySelector('[data-room-status]').textContent.includes('等待'), null, { timeout: 20000 });
        const code = await A.page.evaluate(() => [...document.querySelectorAll('[data-room-code] i')].map(i => i.textContent).join(''));
        assert.match(code, /^\d{4}$/);
        await shot(A.page, 'room-host');
        // B picks the dagger first (each side picks its own weapon; the pick is remembered).
        await B.page.click('[data-menu]'); await B.page.click('[data-menu-act="duel"]');
        assert.equal(await B.page.evaluate(() => document.querySelector('[data-room-weapons]').hidden), false);
        await B.page.click('[data-weapon="assassin_dagger"]');
        await shot(B.page, 'room-weapons');
        assert.equal(await B.page.evaluate(() => [window.game.room.weapon, localStorage.getItem('pvp-weapon')].join()), 'assassin_dagger,assassin_dagger');
        await B.page.click('[data-room-action="join"]');
        assert.match(await text(B.page, '[data-room-note]'), /你用：短刃/);
        assert.equal(await B.page.evaluate(() => document.querySelector('[data-room-action="connect"]').disabled), true);
        for (const d of code) await B.page.click(`[data-key="${d}"]`);
        await shot(B.page, 'room-join');
        await B.page.click('[data-room-action="connect"]');
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel?.phase === 'countdown' || window.game.duel?.phase === 'fight', null, { timeout: 30000 });
        assert.deepEqual(await A.page.evaluate(() => [window.game.map, window.game.duel.selfId, window.game.room.isOpen()]), ['arena', 'host', false]);
        assert.deepEqual(await B.page.evaluate(() => [window.game.map, window.game.duel.selfId, window.game.duel.battle]), ['arena', 'guest', await A.page.evaluate(() => window.game.duel.battle)]);
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel.phase === 'fight', null, { timeout: 30000 });
        for (const { page } of [A, B]) assert.deepEqual(await page.evaluate(() => window.game.sim.fighters.map(f => f.loadout.main)), ['wooden_sword', 'assassin_dagger']);
        // The rival behind the north pillar is not drawn, and has no bar or
        // arrow; in sight it is -- ahead of the fighter, not behind its back
        // (the front 150 degrees; user, 2026-10-04).
        const seen = await A.page.evaluate(() => {
            const g = window.game, [h, r] = g.sim.fighters, look = () => { g.view.render(g.sim, 0.016); return g.view.seen('guest'); };
            Object.assign(h, { x: 500, y: 260, facing: 0 }); Object.assign(r, { x: 620, y: 260 });
            const hidden = look();
            Object.assign(r, { x: 500, y: 380 }); h.facing = Math.PI / 2;
            const shown = look();
            h.facing = -Math.PI / 2;
            return { hidden, shown, behind: look() };
        });
        assert.deepEqual(seen, { hidden: false, shown: true, behind: false });
        // The cut opens only for blocks that do hide the fighter: leaning
        // on the west wall sideways it stays shut; behind the south wall
        // it opens (user, 2026-10-04).
        const open = await A.page.evaluate(() => {
            const g = window.game, [h] = g.sim.fighters;
            const at = (x, y) => { Object.assign(h, { x: x * 40, y: y * 40 }); g.view.render(g.sim, 1); return g.view.ground.cut.open.value; };
            return { beside: at(4.31, 9.5), behind: at(12, 14.69) };
        });
        assert.deepEqual(open, { beside: 0, behind: 1 });
        // B's page goes to the background: the fight is held on both, and A
        // is told who it waits for; back, a countdown and the fight goes on.
        const hide = (page, hidden) => page.evaluate(flag => {
            Object.defineProperty(document, 'hidden', { value: flag, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        }, hidden);
        await hide(B.page, true);
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel.phase === 'hold', null, { timeout: 30000 });
        await A.page.waitForFunction(() => document.querySelector('[data-hud="banner"]').textContent.includes('对方暂时离开'), null, { timeout: 10000 });
        await shot(A.page, 'duel-hold');
        await hide(B.page, false);
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel.phase === 'countdown', null, { timeout: 30000 });
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel.phase === 'fight', null, { timeout: 30000 });
        assert.deepEqual(await A.page.evaluate(() => [window.game.panel, window.game.duel.endReason]), [null, null]);
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
        assert.deepEqual(await A.page.evaluate(() => [window.game.map, window.game.panel, window.game.duel]), ['base', null, null]);
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

// The move tuner (tune.html): a desktop page of its own, on the same boot.
test('the move tuner: boots clean, a typed number changes the key the game reads, kept as a draft, written out; a combo plays the tree', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
        const page = await context.newPage(), errors = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', e => errors.push(e.message));
        const open = async () => {
            await page.waitForFunction(() => document.documentElement.dataset.clientState === 'ready' && window.tune, null, { timeout: 120000 });
            await page.evaluate(() => window.tune.pause());
        };
        await page.goto(base + 'tune.html', { waitUntil: 'load' });
        await open();
        const info = await page.evaluate(() => ({ frozen: Object.isFrozen(gameConfig.combo.moves.slash), width: document.querySelector('[data-canvas]').width, move: window.tune.state.move, drawn: window.tune.view.renderer.info.render.triangles }));
        assert.deepEqual([info.frozen, info.move], [false, 'slash'], 'the config is unfrozen on this page only');
        assert.ok(info.width > 300 && info.drawn > 0, 'the view draws');

        // The file's own number, whatever the key has been tuned to.
        const was = await page.evaluate(() => window.tune.lab.original('slash.a').handR.rx);
        await page.click('[data-bone="handR"] .bone-head');
        const box = page.locator('[data-bone="handR"] [data-ch="rx"] [data-number]');
        await box.fill('1.5'); await box.press('Enter');
        assert.equal(await page.evaluate(() => playerMoves.moves.slash.a.handR.rx), 1.5);
        assert.match(await page.locator('[data-export]').inputValue(), /slash: \{\n {12}a: key\(\{ .*handR: \{ rx: 1\.5, ry: -1\.2[,} ]/);
        // The draft survives a reload; "还原这一项" puts the file's value back.
        await page.waitForTimeout(500);
        await page.reload({ waitUntil: 'load' });
        await open();
        assert.equal(await page.evaluate(() => playerMoves.moves.slash.a.handR.rx), 1.5);
        await page.click('[data-revert="this"]');
        assert.equal(await page.evaluate(() => playerMoves.moves.slash.a.handR.rx), was);
        assert.equal(await page.locator('[data-export]').inputValue(), '（还没有改动）');
        // One number put back by the button beside it: shown only while it differs from the file.
        const back = page.locator('[data-bone="handR"] [data-ch="rx"] [data-was]');
        assert.equal(await back.isVisible(), false);
        await box.fill('1.5'); await box.press('Enter');
        assert.match(await back.textContent(), new RegExp(`^原 ${String(was).replace('.', '\\.')} `));
        await back.click();
        assert.deepEqual(await page.evaluate(() => [playerMoves.moves.slash.a.handR.rx, window.tune.lab.changed('slash.a')]), [was, false]);
        assert.equal(await back.isVisible(), false);
        // The picked bone's own axes are drawn; the dashed line, the axis a
        // slider turns about, only while the pointer is on a slider.
        const lines = () => page.evaluate(() => {
            const all = window.tune.view.scene.children, own = all.find(c => c.isLineSegments && c.geometry.attributes.position.count === 6), p = own.geometry.attributes.position;
            return [window.tune.state.bone, own.visible, Math.hypot(p.getX(1) - p.getX(0), p.getY(1) - p.getY(0), p.getZ(1) - p.getZ(0)) > 0.3, all.find(c => c.material?.isLineDashedMaterial).visible];
        });
        await page.hover('[data-canvas]');
        await page.waitForTimeout(100);
        assert.deepEqual(await lines(), ['handR', true, true, false]);
        await page.hover('[data-bone="handR"] [data-ch="ry"] [data-slider]');
        await page.waitForTimeout(100);
        assert.deepEqual(await lines(), ['handR', true, true, true]);
        // Dragged on its Y, the wrist turns about its own y: all three numbers follow; Ctrl+Z takes the drag back.
        const handle = page.locator('[data-bone="handR"] [data-turn="y"]');
        await handle.scrollIntoViewIfNeeded();
        const at = await handle.boundingBox(), hx = at.x + at.width / 2, hy = at.y + at.height / 2;
        await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx + 40, hy, { steps: 4 }); await page.mouse.up();
        const hand = () => page.evaluate(() => ['rx', 'ry', 'rz'].map(c => playerMoves.moves.slash.a.handR[c] || 0));
        const before = await page.evaluate(() => ['rx', 'ry', 'rz'].map(c => window.tune.lab.original('slash.a').handR[c] || 0)), turned = await hand();
        assert.ok(turned.every((v, i) => Math.abs(v - before[i]) > 0.01), `${turned} from ${before}`);
        await page.keyboard.press('Control+z');
        assert.deepEqual(await hand(), before);
        // A draft made on older files (as if the code changed since): the
        // files win and the notice says so, until the old draft is asked for.
        // (First let the page's own save of its draft go by.)
        await page.waitForTimeout(500);
        await page.evaluate(() => {
            const pose = JSON.parse(JSON.stringify(playerMoves.moves.slash.a)), base = JSON.parse(JSON.stringify(pose));
            pose.handR.rx = 1.7; base.handR.rx += 0.3;
            localStorage.setItem('blockKnight.tune.draft', JSON.stringify({ version: 2, poses: { 'slash.a': { pose, base } }, timing: {} }));
        });
        await page.reload({ waitUntil: 'load' });
        await open();
        assert.equal(await page.evaluate(() => playerMoves.moves.slash.a.handR.rx), was);
        assert.match(await page.locator('[data-notice-text]').textContent(), /斜斩 a/);
        await page.click('[data-notice="restore"]');
        assert.equal(await page.evaluate(() => playerMoves.moves.slash.a.handR.rx), 1.7);
        await page.waitForTimeout(500);
        await page.reload({ waitUntil: 'load' });
        await open();
        assert.deepEqual(await page.evaluate(() => [playerMoves.moves.slash.a.handR.rx, document.querySelector('[data-notice]').hidden]), [1.7, true]);
        await page.click('[data-revert="this"]');

        await page.click('[data-mode="combo"]');
        await page.click('[data-inputs="aab"]');
        assert.deepEqual(await page.evaluate(() => window.tune.rec.occs.map(o => o.move)), ['slash', 'backslash', 'cleave']);
        await page.evaluate(() => { window.tune.time = window.tune.rec.keys['cleave.a']; });
        await page.waitForTimeout(200);
        await shot(page, 'tuner');
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});
