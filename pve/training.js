// Training-page composition: fixed preset, lifecycle and result overlay.
(() => {
    const L = spatialEngine, $ = id => document.getElementById(id);
    let battle = L.create(), previous = performance.now(), frameId, inputVersion = 0;
    let view = uiSpatialBattle.create(document);
    const input = combatInput.attach({ action: $('action-pad'), guard: $('guard-pad') }, {
        press: channel => L.press(battle, channel),
        drag: (channel, dx, dy) => L.drag(battle, channel, dx, dy),
        release: (channel, cancelled) => L.release(battle, channel, cancelled)
    });
    function showOverlay(kind) {
        input.clear();
        $('overlay').hidden = false;
        if (kind === 'result') {
            $('overlay-title').textContent = battle.result === 'victory' ? '掌握节奏。' : '再读一次招。';
            $('overlay-copy').textContent = battle.result === 'victory' ? '岩角兽已击败。试试更少受伤、更准的反击。' : '侧移躲重扫，退开躲践踏；来不及走就面向怪物举盾。';
            const s = battle.stats;
            $('summary').textContent = `用时 ${Math.floor(battle.elapsed)} 秒 · 命中 ${s.hits}/${s.attacks} · 避开 ${s.dodges} · 格挡 ${s.blocks} · 弹反 ${s.parries}`;
            $('start').textContent = '重新练习';
        } else {
            $('overlay-title').textContent = '已暂停';
            $('overlay-copy').textContent = '拖动走位，点击轻击。长按蓄力后，上划松手出招，原地松手取消。';
            $('summary').textContent = '切换窗口会自动暂停 · 触摸已安全释放';
            $('start').textContent = '继续练习';
        }
    }
    $('start').addEventListener('click', () => {
        input.clear(); L.cancelInputs(battle);
        if (battle.result) { battle = L.create(); view.destroy(); view = uiSpatialBattle.create(document); }
        L.start(battle); previous = performance.now(); $('overlay').hidden = true;
    });
    function pause() {
        if (!battle.running) return;
        L.pause(battle); showOverlay('pause');
    }
    $('pause').addEventListener('click', pause);
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    window.addEventListener('pagehide', () => { pause(); cancelAnimationFrame(frameId); input.destroy(); view.destroy(); }, { once: true });
    window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
    function frame(now) {
        L.step(battle, (now - previous) / 1000); previous = now;
        if (inputVersion !== battle.inputVersion) { input.clear(); inputVersion = battle.inputVersion; }
        view.render(battle, L.drainEvents(battle));
        if (battle.result && $('overlay').hidden) showOverlay('result');
        frameId = requestAnimationFrame(frame);
    }
    frameId = requestAnimationFrame(frame);
})();
