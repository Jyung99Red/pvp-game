// Training-page composition: fixed preset, lifecycle and result overlay.
(() => {
    const L = spatialEngine, $ = id => document.getElementById(id);
    let battle = L.create(), previous = performance.now(), frameId, inputVersion = 0, actionVersion = 0;
    const settings = combatSettings.attach(document, () => battle); settings.apply(battle);
    let view = uiSpatialBattle.create(document);
    const input = combatInput.attach({ move: $('move-pad'), action: $('action-pad'), guard: $('guard-pad'), skill: $('skill-pad') }, {
        cancel: () => L.cancelInputs(battle),
        press: (channel, cx, cy) => L.press(battle, channel, cx, cy),
        drag: (channel, dx, dy, cx, cy) => L.drag(battle, channel, dx, dy, cx, cy),
        release: (channel, cancelled) => {
            const kind = L.release(battle, channel, cancelled);
            if (channel === 'skill' && kind && !L.queueSkill(battle, kind)) L.useSkill(battle, kind);
        }
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
            $('overlay-copy').textContent = '左手拖动走位、轻点轻击。右手按住重击或防御，拖动只转向；取消与自动朝向可在下方设置。';
            $('summary').textContent = '切换窗口会自动暂停 · 触摸已安全释放';
            $('start').textContent = '继续练习';
        }
    }
    $('start').addEventListener('click', () => {
        input.clear(); L.cancelInputs(battle);
        if (battle.result) { battle = L.create(); settings.apply(battle); view.destroy(); view = uiSpatialBattle.create(document); }
        L.start(battle); previous = performance.now(); $('overlay').hidden = true;
    });
    function pause() {
        if (!battle.running) return;
        L.pause(battle); showOverlay('pause');
    }
    $('pause').addEventListener('click', pause);
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else restore(); });
    window.addEventListener('pagehide', () => { pause(); cancelAnimationFrame(frameId); frameId = null; });
    window.addEventListener('pageshow', restore);
    window.addEventListener('focus', restore);
    $('arena').addEventListener('contextlost', pause);
    $('arena').addEventListener('contextrestored', restore);
    function restore() {
        if (document.hidden) return;
        pause(); view.refresh(); previous = performance.now();
        if (frameId == null) frameId = requestAnimationFrame(frame);
    }
    function frame(now) {
        L.step(battle, (now - previous) / 1000); previous = now;
        if (inputVersion !== battle.inputVersion) { input.clear(); inputVersion = battle.inputVersion; }
        if (actionVersion !== battle.actionInputVersion) { input.clear(true); actionVersion = battle.actionInputVersion; }
        const events = L.drainEvents(battle);
        for (const e of events) if (e.type === 'skill_ready') L.useSkill(battle, e.kind);
        events.push(...L.drainEvents(battle));
        view.render(battle, events);
        if (battle.result && $('overlay').hidden) showOverlay('result');
        frameId = requestAnimationFrame(frame);
    }
    frameId = requestAnimationFrame(frame);
})();
