// Starts the game once every script is loaded: simulation, 3D view, input
// and the frame loop, plus the landscape shell (fullscreen on Android's
// first touch), the menu and the result panel. The map comes from ?map=
// (field or clearing; the field by default); switching maps or restarting
// rebuilds the world in place, so fullscreen survives it. A duel
// (rebuild-plan.md M4) starts from the room screen (ui/room.js): its world
// belongs to the duel session (core/duel.js), which this loop feeds with
// time and controls; panels never pause it.
// window.game is for tests and debugging: game.pause() stops the real-time
// clock, game.run(seconds) steps exactly, game.load(map) starts a map,
// game.duel is the duel session (or null).
const app = (() => {
    const MAPS = ['field', 'clearing'];
    // How long the end of a fight plays on before the result is shown.
    const RESULT_DELAY = 1.4;
    // Why a duel ended, for the panel ('closed' is this phone leaving).
    const ENDED = {
        incompatible: '两台手机上的游戏版本不同。请两边都刷新页面，再重新连接。',
        timeout: '很久没收到对方的消息，连接中断了。',
        lost: '和对方的连接断开了。',
        aborted: '对局中断了：有一方切到了后台，或关掉了页面。',
        left: '对方离开了房间。'
    };
    // Panel buttons and their usual labels.
    const LABELS = { resume: '继续', restart: '重新开始', rematch: '再来一局', field: '去野外', clearing: '去训练场', duel: '联机对战', surrender: '认输', leave: '离开对战' };
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
        // The duel under way: { session, link, code, outcome, resultAt, shown, ended }.
        let duel = null;
        try { view = worldView.create(canvas, sim); } catch (error) {
            console.error(error);
            fallback(root, '这台设备的浏览器没有开启 WebGL，3D 画面无法显示。');
        }
        // Drawing blends the state before the last step into the current one
        // (drawn only; every rule reads the simulation itself).
        const LERP = ['x', 'y', 'h', 'gait', 'moveBlend', 'runBlend'], copy = p => Object.fromEntries([...LERP, 'facing'].map(k => [k, p[k]]));
        const snapshot = () => new Map([...sim.fighters, ...sim.monsters].map(b => [b.id, copy(b)]));
        let before = snapshot();
        const loop = simLoop.create(dt => { before = snapshot(); worldSim.step(sim, dt); });
        function blend(now, then, alpha) {
            const out = { ...now };
            for (const k of LERP) if (Number.isFinite(then[k])) out[k] = then[k] + (now[k] - then[k]) * alpha;
            out.facing = space.lerpAngle(then.facing, now.facing, alpha);
            return out;
        }
        const shownBodies = alpha => new Map([...sim.fighters, ...sim.monsters].map(b => [b.id, before.has(b.id) ? blend(b, before.get(b.id), alpha) : b]));
        // A duel's fighters: blended between the session's last two live
        // steps, plus the guest's snapshot corrections easing out.
        function duelBodies(s) {
            const alpha = s.alpha(), out = new Map();
            for (const f of s.sim.fighters) {
                const then = s.before(f.id), o = s.offset(f.id), b = then ? blend(f, then, alpha) : { ...f };
                b.x += o.x; b.y += o.y; b.facing += o.facing;
                out.set(f.id, b);
            }
            return out;
        }
        const world = () => duel?.session.sim || sim;
        const selfId = () => duel ? duel.session.selfId : 'player';
        const live = () => !!duel && !duel.ended;

        const act = cmd => duel ? duel.session.command(cmd) : worldSim.command(sim, cmd);
        const input = inputLayer.attach(root, {
            move: (x, y) => blocked() ? false : act({ type: 'move', x, y }),
            press: button => blocked() ? false : act({ type: 'press', button }),
            release: button => act({ type: 'release', button })
        });
        // Nothing to interact with yet, so that key stays dim; the offhand
        // key greys out when nothing is carried there.
        root.querySelector('[data-button="interact"]').classList.add('idle');
        const offhandKey = root.querySelector('[data-button="offhand"]');
        const display = hud.attach(root);
        const room = roomScreen.attach(root, { connected: beginDuel, closed: () => openPanel('menu') });
        function blocked() { return !!panel || room.isOpen(); }

        // ---- the menu and the result panels ----
        const panelEl = root.querySelector('[data-panel]'), $p = sel => panelEl.querySelector(sel);
        const actions = Object.fromEntries([...panelEl.querySelectorAll('[data-action]')].map(b => [b.dataset.action, b]));
        const otherMap = () => mapId === 'field' ? 'clearing' : 'field';
        // Per panel: title, note, stats, and the buttons shown (the first is
        // the main one), each with its label if not the usual one.
        function content(kind) {
            const w = world(), me = w.fighters.find(f => f.id === selfId()) || sim.player, S = me.stats;
            if (kind === 'menu') {
                return { title: '暂停', note: `当前场地：${gameConfig.maps[mapId].name}`, stats: [], buttons: [['resume'], ['restart'], [otherMap()], ['duel']] };
            }
            if (kind === 'win' || kind === 'lose') {
                return {
                    title: kind === 'win' ? '胜利' : '失败', tone: kind, note: kind === 'win' ? '野外的怪物都被打倒了。' : '生命耗尽。',
                    stats: [['用时', clockText(sim.result.at)], ['击倒', `${sim.monsters.filter(m => m.phase === 'dead').length} / ${sim.monsters.length}`], ['命中', S.hits],
                        ['格挡', S.blocks], ['弹反', S.parries], ['受伤', S.hurt]],
                    buttons: [['restart', '再来一次'], [otherMap()]]
                };
            }
            const s = duel.session;
            if (kind === 'duelMenu') return { title: '对战中', note: `竞技场 · 房间 ${duel.code} · 对局不会暂停`, stats: [], buttons: [['resume'], ['surrender'], ['leave']] };
            if (kind === 'duelResult') {
                const o = duel.outcome, r = w.result;
                const why = r.conceded ? (r.conceded === me.id ? '你认输了。' : '对方认输了。') : o === 'draw' ? '双方同时倒下。' : '';
                const waiting = s.rematchSent ? '等待对方同意…' : s.rematchAsked ? '对方想再来一局。' : '';
                return {
                    title: o === 'win' ? '胜利' : o === 'lose' ? '失败' : '平局', tone: o, note: [why, waiting].filter(Boolean).join(' '),
                    stats: [['用时', clockText(r.at)], ['命中', S.hits], ['受伤', S.hurt], ['格挡', S.blocks], ['弹反', S.parries], ['剩余生命', me.hp]],
                    buttons: [['rematch', s.rematchSent ? '等待对方…' : null], ['leave', '离开']], disable: s.rematchSent ? ['rematch'] : []
                };
            }
            return { title: '联机结束', note: ENDED[duel.ended] || '', stats: [], buttons: [['field', '回到野外'], ['clearing']] };
        }
        function openPanel(kind) {
            panel = kind;
            input.releaseAll();
            const c = content(kind), order = c.buttons.map(([id]) => id);
            panelEl.classList.toggle('win', c.tone === 'win');
            panelEl.classList.toggle('lose', c.tone === 'lose');
            $p('[data-panel-title]').textContent = c.title;
            $p('[data-panel-note]').textContent = c.note;
            $p('[data-panel-stats]').innerHTML = c.stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
            for (const [id, button] of Object.entries(actions)) {
                const at = order.indexOf(id);
                button.hidden = at < 0;
                button.classList.toggle('primary', at === 0);
                button.disabled = !!c.disable?.includes(id);
                button.style.order = String(at);
                button.textContent = (at >= 0 && c.buttons[at][1]) || LABELS[id];
            }
            panelEl.hidden = false;
            actions[order[0]].focus({ preventScroll: true });
        }
        function closePanel() {
            panel = null; panelEl.hidden = true; loop.reset();
        }

        function load(id = mapId) {
            if (!MAPS.includes(id)) throw new Error(`Unknown map ${id}`);
            leaveDuel();
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

        // ---- a duel ----
        let lastBeat = null;
        function beginDuel({ link, role, code, on }) {
            input.releaseAll();
            const session = duelKit.create({
                role, now: () => performance.now() / 1000, send: msg => link.send(msg),
                on: {
                    start: next => {
                        Object.assign(duel, { outcome: null, resultAt: null, shown: false });
                        view?.load(next, { selfId: session.selfId });
                        display.reset(); lastBeat = null;
                        offhandKey.classList.toggle('disabled', !next.fighters[session.self].loadout.offhand);
                        if (panel) closePanel();
                    },
                    result: outcome => { duel.outcome = outcome; duel.resultAt = clock; },
                    rematch: () => { if (panel === 'duelResult') openPanel('duelResult'); },
                    end: reason => {
                        link.close();
                        if (!duel || duel.session !== session) return;
                        duel.ended = reason;
                        if (reason !== 'closed') openPanel('duelEnded');
                    }
                }
            });
            duel = { session, link, code, outcome: null, resultAt: null, shown: false, ended: null };
            on.message = msg => session.receive(msg);
            on.close = () => session.lost();
            session.open();
        }
        // Leave whatever duel there is, for good.
        function leaveDuel() {
            const d = duel;
            duel = null;
            if (d && !d.ended) d.session.leave();
            d?.link.close();
        }

        offhandKey.classList.toggle('disabled', !sim.player.loadout.offhand);
        function menuKey() {
            if (room.isOpen()) return;
            if (!panel) openPanel(live() ? 'duelMenu' : 'menu');
            else if (panel === 'menu' || panel === 'duelMenu') closePanel();
        }
        root.querySelector('[data-menu]').addEventListener('click', menuKey);
        window.addEventListener('keydown', e => { if (e.code === 'Escape' && !e.repeat) menuKey(); });
        actions.resume.addEventListener('click', closePanel);
        actions.restart.addEventListener('click', () => load());
        actions.field.addEventListener('click', () => load('field'));
        actions.clearing.addEventListener('click', () => load('clearing'));
        actions.duel.addEventListener('click', () => { closePanel(); room.open(); });
        actions.surrender.addEventListener('click', () => { duel?.session.surrender(); closePanel(); });
        actions.leave.addEventListener('click', () => load('field'));
        // Asking first shows "waiting"; agreeing starts the match at once.
        actions.rematch.addEventListener('click', () => { if (duel?.session.rematch() && duel.session.phase === 'over') openPanel('duelResult'); });
        // A duel cannot wait for a phone in the background: going there ends
        // the match (the other phone is told); closing the page leaves.
        document.addEventListener('visibilitychange', () => { if (document.hidden && live()) duel.session.abort(); });
        window.addEventListener('pagehide', () => { if (live()) duel.session.leave(); });

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
            clock += Math.min(seconds, simLoop.MAX_FRAME);
            let events, bodies;
            const s = duel?.session;
            if (s) {
                events = s.frame(seconds);
                bodies = s.sim ? duelBodies(s) : null;
                // The countdown beeps each second, and once more at the start.
                const beat = s.phase === 'countdown' ? Math.ceil(s.countdown - 1e-6) : s.phase === 'fight' ? 0 : null;
                if (beat !== null && beat !== lastBeat && (lastBeat !== null || beat > 0)) sfx.tick(beat === 0);
                lastBeat = beat;
            } else {
                if (!paused && !blocked()) loop.advance(seconds);
                events = worldSim.drain(sim);
                bodies = shownBodies(paused || blocked() ? 1 : loop.alpha());
            }
            const w = world(), me = selfId();
            for (const e of events) sfx.play(e, me, worldSim.outcome(w, me));
            display.events(events, clock);
            display.update(w, view, clock, bodies, { self: me, duel: s ? { countdown: s.countdown, phase: s.phase } : null });
            // Portrait is covered by the rotate hint: skip drawing to save power.
            if (view && !portrait.matches) view.render(w, Math.min(seconds, simLoop.MAX_FRAME), { bodies, events });
            // The fight is decided: let it play out a moment, then the result.
            if (duel) {
                if (duel.outcome && !duel.shown && !duel.ended && clock - duel.resultAt >= RESULT_DELAY) { duel.shown = true; openPanel('duelResult'); }
            } else if (sim.result && !panel) {
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
            get sim() { return world(); }, get map() { return duel ? 'arena' : mapId; }, get panel() { return panel; },
            get duel() { return duel?.session || null; }, room,
            view, input, load,
            pause(flag = true) { paused = flag; loop.reset(); },
            run: seconds => loop.run(seconds)
        };
    }
    return { start };
})();
