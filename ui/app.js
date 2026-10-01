// Starts the game once every script is loaded: simulation, 3D view, input
// and the frame loop, plus the landscape shell (fullscreen on Android's
// first touch), the menu and the result panel. The map comes from ?map=
// (field or clearing; the field by default); switching maps or restarting
// rebuilds the world in place, so fullscreen survives it.
// window.game is for tests and debugging: game.pause() stops the real-time
// clock, game.run(seconds) steps exactly, game.load(map) starts a map.
const app = (() => {
    const MAPS = ['field', 'clearing'];
    // How long the end of a fight plays on before the result is shown.
    const RESULT_DELAY = 1.4;
    function fallback(root, text) {
        const box = root.querySelector('[data-fallback]');
        box.textContent = text; box.hidden = false;
    }
    // Fullscreen needs a user gesture; for touch, pointerup is one and
    // pointerdown is not. Asked once; leaving fullscreen is respected.
    // iPhone Safari has no element fullscreen, so it is simply skipped.
    function fullscreenOnFirstTouch() {
        const ask = e => {
            if (e.pointerType !== 'touch') return;
            window.removeEventListener('pointerup', ask, true);
            const el = document.documentElement;
            if (document.fullscreenElement || typeof el.requestFullscreen !== 'function') return;
            el.requestFullscreen({ navigationUI: 'hide' })
                .then(() => screen.orientation?.lock?.('landscape'))
                .catch(() => { /* Refused or unsupported: the rotate hint still covers portrait. */ });
        };
        window.addEventListener('pointerup', ask, true);
    }
    const mapFromAddress = () => {
        const id = new URLSearchParams(window.location.search).get('map');
        return MAPS.includes(id) ? id : 'field';
    };
    const clockText = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

    function start() {
        const root = document.getElementById('game'), canvas = root.querySelector('canvas');
        let mapId = mapFromAddress(), sim = worldSim.create({ map: gameConfig.maps[mapId] });
        let view = null, paused = false, panel = null, resultSeen = null;
        try { view = worldView.create(canvas, sim); } catch (error) {
            console.error(error);
            fallback(root, '这台设备的浏览器没有开启 WebGL，3D 画面无法显示。');
        }
        // Drawing blends the state before the last step into the current one
        // (drawn only; every rule reads the simulation itself).
        const LERP = ['x', 'y', 'h', 'gait', 'moveBlend', 'runBlend'], copy = p => Object.fromEntries([...LERP, 'facing'].map(k => [k, p[k]]));
        const snapshot = () => ({ player: copy(sim.player), monsters: new Map(sim.monsters.map(m => [m.id, copy(m)])) });
        let before = snapshot();
        const loop = simLoop.create(dt => { before = snapshot(); worldSim.step(sim, dt); });
        function blend(now, then, alpha) {
            const out = { ...now };
            for (const k of LERP) if (Number.isFinite(then[k])) out[k] = then[k] + (now[k] - then[k]) * alpha;
            out.facing = space.lerpAngle(then.facing, now.facing, alpha);
            return out;
        }
        const shown = alpha => blend(sim.player, before.player, alpha);
        const shownMonsters = alpha => new Map(sim.monsters.map(m => [m.id, before.monsters.has(m.id) ? blend(m, before.monsters.get(m.id), alpha) : m]));

        const input = inputLayer.attach(root, {
            move: (x, y) => panel ? false : worldSim.command(sim, { type: 'move', x, y }),
            press: button => panel ? false : worldSim.command(sim, { type: 'press', button }),
            release: button => worldSim.command(sim, { type: 'release', button })
        });
        // Nothing to interact with yet, so that key stays dim; the offhand
        // key greys out when nothing is carried there.
        root.querySelector('[data-button="interact"]').classList.add('idle');
        const offhandKey = root.querySelector('[data-button="offhand"]');
        const display = hud.attach(root);

        // ---- the menu and the result panel ----
        const panelEl = root.querySelector('[data-panel]'), $p = sel => panelEl.querySelector(sel);
        const actions = Object.fromEntries([...panelEl.querySelectorAll('[data-action]')].map(b => [b.dataset.action, b]));
        function openPanel(kind) {
            panel = kind;
            input.releaseAll();
            const result = sim.result, S = sim.stats, total = sim.monsters.length;
            panelEl.classList.toggle('win', kind === 'win');
            panelEl.classList.toggle('lose', kind === 'lose');
            $p('[data-panel-title]').textContent = kind === 'win' ? '胜利' : kind === 'lose' ? '失败' : '暂停';
            $p('[data-panel-note]').textContent = kind === 'win' ? '野外的怪物都被打倒了。' : kind === 'lose' ? '生命耗尽。' : `当前场地：${gameConfig.maps[mapId].name}`;
            const stats = kind === 'menu' ? [] : [
                ['用时', clockText(result.at)], ['击倒', `${S.kills} / ${total}`], ['命中', S.hits],
                ['格挡', S.blocks], ['弹反', S.parries], ['受伤', S.hurt]
            ];
            $p('[data-panel-stats]').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
            actions.resume.hidden = kind !== 'menu';
            actions.restart.textContent = kind === 'menu' ? '重新开始' : '再来一次';
            actions.restart.classList.toggle('primary', kind !== 'menu');
            actions.resume.classList.toggle('primary', kind === 'menu');
            actions.field.hidden = mapId === 'field';
            actions.clearing.hidden = mapId === 'clearing';
            panelEl.hidden = false;
            (kind === 'menu' ? actions.resume : actions.restart).focus({ preventScroll: true });
        }
        function closePanel() {
            panel = null; panelEl.hidden = true; loop.reset();
        }
        function load(id = mapId) {
            if (!MAPS.includes(id)) throw new Error(`Unknown map ${id}`);
            input.releaseAll();
            mapId = id; sim = worldSim.create({ map: gameConfig.maps[id] });
            before = snapshot(); resultSeen = null;
            view?.load(sim);
            display.reset();
            offhandKey.classList.toggle('disabled', !sim.player.loadout.offhand);
            const url = new URL(window.location.href);
            url.searchParams.set('map', id);
            history.replaceState(null, '', url);
            closePanel();
        }
        offhandKey.classList.toggle('disabled', !sim.player.loadout.offhand);
        root.querySelector('[data-menu]').addEventListener('click', () => panel ? (panel === 'menu' && closePanel()) : openPanel('menu'));
        actions.resume.addEventListener('click', closePanel);
        actions.restart.addEventListener('click', () => load());
        actions.field.addEventListener('click', () => load('field'));
        actions.clearing.addEventListener('click', () => load('clearing'));
        window.addEventListener('keydown', e => {
            if (e.code !== 'Escape' || e.repeat) return;
            if (!panel) openPanel('menu'); else if (panel === 'menu') closePanel();
        });

        // Held controls survive a resize: going fullscreen on the first
        // touch must not drop a thumb that is still walking. A real rotation
        // cancels the touches by itself.
        function resize() {
            const r = root.getBoundingClientRect();
            view?.resize(r.width, r.height);
            input.place();
        }
        window.addEventListener('resize', resize);
        resize();
        fullscreenOnFirstTouch();

        const perf = root.querySelector('[data-perf]'), portrait = window.matchMedia('(orientation: portrait)');
        let clock = 0;
        let last = performance.now(), frames = 0, perfTime = 0;
        function frame(now) {
            const seconds = Math.max(0, (now - last) / 1000);
            last = now;
            if (!paused && !panel) loop.advance(seconds);
            clock += Math.min(seconds, simLoop.MAX_FRAME);
            const events = worldSim.drain(sim);
            for (const e of events) sfx.play(e);
            const alpha = paused || panel ? 1 : loop.alpha(), bodies = shownMonsters(alpha);
            display.events(events, clock);
            display.update(sim, view, clock, bodies);
            // Portrait is covered by the rotate hint: skip drawing to save power.
            if (view && !portrait.matches) view.render(sim, Math.min(seconds, simLoop.MAX_FRAME), shown(alpha), events, bodies);
            // The fight is decided: let it play out a moment, then the result.
            if (sim.result && !panel) {
                if (resultSeen === null) resultSeen = clock;
                else if (clock - resultSeen >= RESULT_DELAY) openPanel(sim.result.outcome);
            }
            frames++; perfTime += seconds;
            if (perfTime >= 0.5) {
                const info = view ? view.info() : { calls: 0, triangles: 0 };
                perf.textContent = `${Math.round(frames / perfTime)} 帧/秒 · 绘制 ${info.calls} 次 · ${(info.triangles / 1000).toFixed(1)}k 三角形`;
                frames = 0; perfTime = 0;
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        window.game = {
            get sim() { return sim; }, get map() { return mapId; }, get panel() { return panel; },
            view, input, load,
            pause(flag = true) { paused = flag; loop.reset(); },
            run: seconds => loop.run(seconds)
        };
    }
    return { start };
})();
