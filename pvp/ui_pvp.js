// Spatial PVP presentation and local pointer ownership. Rules stay in spatialDuel.
const uiPvp = (() => {
    const $ = id => document.getElementById(id);
    let view = null, input = null, settings = null, abort = null, version = 0, actionVersion = 0;
    let menu = false, remote = null, renderedAt = 0;
    const toggle = (id, show) => $(id)?.classList.toggle('hidden', !show);
    function initFighters() {
        destroy(); hideResult(); hideRematchRequest(); hideDisconnectOverlay();
        menu = false; $('pvp-s-overlay').hidden = true;
        const b = state.pvpBattle, local = b.spatial, i = b.role === 'host' ? 0 : 1;
        const root = $('view-pvp-battle');
        settings = combatSettings.attach(root, () => state.pvpBattle?.spatial,
            values => pvpLogic.input({ type: 'settings', ...values }));
        settings.apply(local);
        const config = { ...local.config, opponentConfig: b.duel.sides[1 - i].config, enemyName: `对手 Lv.${b.duel.profiles[1 - i].level}` };
        $('pvp-enemy-vital').textContent = config.enemyName;
        $('pvp-enemy-name').textContent = '蓝色是你 · 红色是对手';
        view = uiSpatialBattle.create(root, config, 'pvp-s-');
        version = local.inputVersion; actionVersion = local.actionInputVersion;
        input = combatInput.attach({ move: $('pvp-s-move-pad'), action: $('pvp-s-action-pad'), guard: $('pvp-s-guard-pad'), skill: $('pvp-s-skill-pad') }, {
            cancel: () => pvpLogic.cancelLocal(),
            press: (channel, ...values) => pvpLogic.input({ type: 'press', channel, values }),
            drag: (channel, ...values) => pvpLogic.input({ type: 'drag', channel, values }),
            release: (channel, cancelled) => pvpLogic.input({ type: 'release', channel, cancelled })
        });
        abort = new AbortController(); const options = { signal: abort.signal };
        window.addEventListener('blur', () => { pvpLogic.cancelLocal(); input?.clear(); }, options);
        document.addEventListener('visibilitychange', () => { if (document.hidden) pvpLogic.interrupt(); else refresh(); }, options);
        window.addEventListener('pagehide', () => pvpLogic.interrupt(), options);
        window.addEventListener('pageshow', refresh, options);
        window.addEventListener('focus', refresh, options);
        $('pvp-s-arena').addEventListener('contextlost', () => pvpLogic.interrupt(), options);
        $('pvp-s-arena').addEventListener('contextrestored', refresh, options);
        updateFrame();
    }
    function updateFrame(events = []) {
        const b = state.pvpBattle;
        if (!view || !b?.spatial) return;
        const local = b.spatial, i = b.role === 'host' ? 0 : 1;
        // Update versions before releasing capture, since release sends another command.
        if (local.inputVersion !== version) { version = local.inputVersion; input?.clear(); }
        if (local.actionInputVersion !== actionVersion) { actionVersion = local.actionInputVersion; input?.clear(true); }
        const at = performance.now(), dt = Math.min(.1, Math.max(0, (at - renderedAt) / 1000)); renderedAt = at;
        const target = b.opponent;
        if (!remote || spatialCombat.distance(remote, target) > 90 || b.duel.result) remote = { x: target.x, y: target.y, facing: target.facing };
        else {
            const weight = 1 - Math.exp(-dt * 22);
            remote.x += (target.x - remote.x) * weight; remote.y += (target.y - remote.y) * weight;
            remote.facing += spatialCombat.angleDelta(target.facing, remote.facing) * weight;
        }
        view.render({ ...local, enemy: { ...target, ...remote } }, events.map(e => ({ ...e, side: e.actor === i ? 'player' : 'enemy' })), dt);
        $('pvp-floor-label').textContent = !b.ready ? '等待双方准备' : b.countdown > 0 ? `准备 · ${Math.ceil(b.countdown)}` : '空间对战';
        $('pvp-self-sp').textContent = `${local.skillPoints} / 3`;
        for (const [kind, cost] of Object.entries(pvpLogic.SKILL_COSTS)) {
            const node = $('pvp-s-skill-pad').querySelector(`[data-skill="${kind}"]`);
            const unavailable = !b.active || b.countdown > 0 || local.skillPoints < cost || (kind === 'heal' && local.player.hp >= local.player.maxHp);
            node.classList.toggle('unavailable', unavailable); node.setAttribute('aria-disabled', String(unavailable));
        }
        $('pvp-buff-display').textContent = [local.time < local.buffs.chargeHasteUntil ? '疾速' : '', local.buffs.instantCharge ? '满蓄待发' : '', local.buffs.autoParry ? '弹反护体' : ''].filter(Boolean).join(' · ');
    }
    function refresh() { view?.refresh(); updateFrame(); }
    function destroy() {
        input?.destroy(); view?.destroy(); settings?.destroy(); abort?.abort();
        input = view = settings = abort = null; remote = null; menu = false; renderedAt = 0;
    }
    function showSettings(show) {
        pvpLogic.cancelLocal(); input?.clear(); menu = show; $('pvp-s-overlay').hidden = !show;
    }
    function showResult(winner) {
        $('pvp-s-overlay').hidden = true; menu = false;
        $('pvp-result-title').textContent = winner === 'draw' ? '平局' : winner === 'self' ? '胜利！' : '败北';
        toggle('pvp-result-overlay', true);
    }
    function hideResult() { toggle('pvp-result-overlay', false); toggle('pvp-rematch-waiting', false); toggle('pvp-btn-rematch', true); }
    function hideRematchRequest() { toggle('pvp-rematch-request', false); }
    function hideDisconnectOverlay() { toggle('pvp-disconnect-overlay', false); }
    return { initFighters, updateFrame, refresh, destroy, showSettings, settingsOpen: () => menu,
        clearInputs: () => input?.clear(), showResult, hideResult, hideRematchRequest, hideDisconnectOverlay,
        showRematchRequest: () => toggle('pvp-rematch-request', true),
        showRematchWaiting() { toggle('pvp-rematch-waiting', true); toggle('pvp-btn-rematch', false); toggle('pvp-rematch-request', false); },
        showDisconnectOverlay() { $('pvp-s-overlay').hidden = true; menu = false; toggle('pvp-disconnect-overlay', true); }
    };
})();
