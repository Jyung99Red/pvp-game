// Starts the game once every script is loaded: simulation, 3D view, input
// and the frame loop, plus the landscape shell (fullscreen on Android's
// first touch). window.game is for tests and debugging:
// game.pause() stops the real-time clock, game.run(seconds) steps exactly.
const app = (() => {
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
    function start() {
        const root = document.getElementById('game'), canvas = root.querySelector('canvas');
        const sim = worldSim.create();
        let view = null, paused = false;
        try { view = worldView.create(canvas, sim); } catch (error) {
            console.error(error);
            fallback(root, '这台设备的浏览器没有开启 WebGL，3D 画面无法显示。');
        }
        // Drawing blends the state before the last step into the current one
        // (drawn only; every rule reads the simulation itself).
        const LERP = ['x', 'y', 'h', 'gait', 'moveBlend', 'runBlend'], copy = p => Object.fromEntries([...LERP, 'facing'].map(k => [k, p[k]]));
        let before = copy(sim.player);
        const loop = simLoop.create(dt => { before = copy(sim.player); worldSim.step(sim, dt); });
        function shown(alpha) {
            const p = sim.player, out = { ...p };
            for (const k of LERP) out[k] = before[k] + (p[k] - before[k]) * alpha;
            out.facing = space.lerpAngle(before.facing, p.facing, alpha);
            return out;
        }
        const input = inputLayer.attach(root, {
            move: (x, y) => worldSim.command(sim, { type: 'move', x, y }),
            press: button => worldSim.command(sim, { type: 'press', button }),
            release: button => worldSim.command(sim, { type: 'release', button })
        });
        // M1: nothing to interact with yet, so the key stays dim; the
        // offhand key greys out when nothing is carried there.
        root.querySelector('[data-button="interact"]').classList.add('idle');
        root.querySelector('[data-button="offhand"]').classList.toggle('disabled', !sim.player.loadout.offhand);

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
        let last = performance.now(), frames = 0, perfTime = 0;
        function frame(now) {
            const seconds = Math.max(0, (now - last) / 1000);
            last = now;
            if (!paused) loop.advance(seconds);
            // Portrait is covered by the rotate hint: skip drawing to save power.
            if (view && !portrait.matches) view.render(sim, Math.min(seconds, simLoop.MAX_FRAME), shown(paused ? 1 : loop.alpha()));
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
            sim, view, input,
            pause(flag = true) { paused = flag; loop.reset(); },
            run: seconds => loop.run(seconds)
        };
    }
    return { start };
})();
