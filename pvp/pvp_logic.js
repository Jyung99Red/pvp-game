// Host-authoritative spatial PVP. Guest predicts local motion; never judges hits.
const pvpLogic = (() => {
    const VERSION = 2, D = spatialDuel;
    let frame = null, lastFrame = 0, accumulator = 0, lastReceive = 0, lastSend = 0;
    let battleId = null, inputSeq = 0, receivedSeq = 0, snapshotSeq = 0, appliedSnapshot = -1;
    let pending = [], eventId = 0, seenEvent = 0, history = [], localReady = false, remoteReady = false, latency = 25;
    let selfRematch = false, otherRematch = false, rematchProfile = null, previousOpponent = null;
    const seenBattles = new Set();
    const now = () => performance.now();
    const id = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
    const localIndex = () => state.pvpBattle?.role === 'host' ? 0 : 1;
    const send = payload => pvpNet.send({ ...payload, version: VERSION, battleId, eventAck: seenEvent });
    function stopFrame() { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
    function collect() {
        const b = state.pvpBattle;
        if (!b) return [];
        const events = b.duel.events.splice(0);
        if (b.role === 'host') {
            for (const e of events) history.push({ ...e, id: ++eventId });
            history = history.slice(-128);
        }
        return events;
    }
    function aliases() {
        const b = state.pvpBattle, i = localIndex();
        b.spatial = b.duel.sides[i]; b.self = b.spatial.player; b.opponent = b.duel.sides[1 - i].player;
    }
    function publish() {
        const b = state.pvpBattle;
        send({ msg: 'duel_snapshot', serial: ++snapshotSeq, ack: receivedSeq,
            snapshot: D.snapshot(b.duel), countdown: b.countdown, events: history });
    }
    function finish(result) {
        const b = state.pvpBattle;
        if (!b || b.shownResult) return;
        b.shownResult = true; b.active = false;
        stopFrame(); uiPvp.clearInputs();
        uiPvp.showResult(result === 'draw' ? 'draw' : result === b.role ? 'self' : 'opponent');
    }
    function initialize(role, profiles, nextId) {
        stopFrame(); uiPvp.destroy();
        battleId = nextId; seenBattles.add(nextId);
        if (seenBattles.size > 128) seenBattles.delete(seenBattles.values().next().value);
        state.pvpBattle = { role, battleId, active: true, duel: D.create(profiles), countdown: 1.5, ready: false, shownResult: false };
        inputSeq = receivedSeq = snapshotSeq = eventId = seenEvent = 0; appliedSnapshot = -1;
        pending = []; history = []; accumulator = 0; latency = 25; selfRematch = otherRematch = false; rematchProfile = null;
        localReady = role === 'guest'; remoteReady = false;
        lastReceive = lastFrame = lastSend = now();
        aliases(); ui.switchTab('pvp-battle'); uiPvp.initFighters();
        frame = requestAnimationFrame(loop);
    }
    function startPVP(role, opponentProfile) {
        if (role !== 'host') return false;
        const profiles = [spatialProfiles.normalize(spatialProfiles.local()), spatialProfiles.normalize(opponentProfile || previousOpponent)];
        const previousBattleId = battleId, nextId = id(); previousOpponent = profiles[1];
        initialize('host', profiles, nextId);
        send({ msg: 'duel_start', previousBattleId, profiles }); return true;
    }
    function ready() {
        const b = state.pvpBattle;
        if (b.role === 'host' && localReady && remoteReady && !b.ready) {
            b.ready = true; send({ msg: 'duel_go' }); publish();
        }
    }
    function advance(seconds) {
        const b = state.pvpBattle;
        if (!b?.active || !b.ready) return;
        accumulator += Math.min(Math.max(seconds, 0), .25);
        while (accumulator >= .01 - 1e-9 && b.active) {
            accumulator -= .01;
            if (b.role === 'host') {
                if (b.countdown > 0) b.countdown = Math.max(0, b.countdown - .01);
                else D.step(b.duel);
            } else if (b.countdown <= 0) D.predict(b.duel, 1, .01);
            const events = collect(); uiPvp.updateFrame(events);
            if (b.role === 'host' && b.duel.result) { publish(); finish(b.duel.result); }
        }
    }
    function loop(t) {
        frame = null;
        const b = state.pvpBattle;
        if (!b?.active) return;
        if (document.hidden || t - lastFrame > 1000 || now() - lastReceive > 5000) { interrupt(); return; }
        advance((t - lastFrame) / 1000); lastFrame = t;
        uiPvp.updateFrame();
        if (!b.active) return;
        if (now() - lastSend >= (b.role === 'host' ? 50 : 250)) {
            if (b.role === 'host' && b.ready) publish(); else send({ msg: 'duel_heartbeat' });
            lastSend = now();
        }
        frame = requestAnimationFrame(loop);
    }
    function input(command) {
        const b = state.pvpBattle;
        if (!command || !b?.active || !b.ready || (command.type !== 'settings' && (b.countdown > 0 || uiPvp.settingsOpen?.()))) return false;
        if (b.role === 'host') {
            const accepted = D.input(b.duel, 0, command); uiPvp.updateFrame(collect()); return accepted;
        }
        if (pending.length >= 256) { interrupt(); return false; }
        const accepted = D.predictInput(b.duel, 1, command);
        if (command.type === 'press' && !accepted) { collect(); return false; }
        const entry = { seq: ++inputSeq, command, at: now() };
        pending.push(entry); send({ msg: 'duel_input', seq: entry.seq, command });
        // Releases/settings/skills still reach authority when local prediction rejects them.
        collect(); uiPvp.updateFrame(); return true;
    }
    function applySnapshot(msg) {
        const b = state.pvpBattle;
        if (!Number.isSafeInteger(msg.serial) || msg.serial <= appliedSnapshot || !Number.isSafeInteger(msg.ack) || msg.ack < 0 || msg.ack > inputSeq ||
            !Number.isFinite(msg.countdown) || msg.countdown < 0 || msg.countdown > 1.5 || !Array.isArray(msg.events) || !D.validSnapshot(b.duel, msg.snapshot)) return;
        appliedSnapshot = msg.serial;
        const acknowledged = pending.filter(p => p.seq <= msg.ack);
        if (acknowledged.length) latency = Math.min(150, Math.max(0, (now() - acknowledged[acknowledged.length - 1].at) / 2));
        const replayFrom = now() - latency;
        pending = pending.filter(p => p.seq > msg.ack);
        D.restore(b.duel, msg.snapshot); b.countdown = msg.countdown;
        // Reapply unacknowledged inputs in order, with bounded local time between them.
        let cursor = Math.max(now() - 250, replayFrom);
        const predictTo = t => { let remain = Math.max(0, t - cursor) / 1000; while (remain > 1e-6) { const dt = Math.min(.01, remain); D.predict(b.duel, 1, dt); remain -= dt; } cursor = Math.max(cursor, t); };
        if (!b.duel.result && b.countdown <= 0) {
            for (const p of pending) { predictTo(p.at); D.predictInput(b.duel, 1, p.command); }
            predictTo(now());
        }
        b.duel.events.length = 0; aliases();
        const events = (msg.events || []).filter(e => e.id > seenEvent);
        for (const e of events) seenEvent = Math.max(seenEvent, e.id);
        uiPvp.updateFrame(events);
        if (b.duel.result) finish(b.duel.result);
    }
    function receiveMessage(msg) {
        if (!msg || typeof msg !== 'object' || msg.version !== VERSION) return;
        if (msg.msg === 'duel_start') {
            if (pvpNet.role !== 'guest' || typeof msg.battleId !== 'string' || seenBattles.has(msg.battleId)) return;
            if (battleId && (state.pvpBattle?.active || msg.previousBattleId !== battleId || !selfRematch)) return;
            try {
                if (!Array.isArray(msg.profiles) || msg.profiles.length !== 2) return;
                const profiles = msg.profiles.map(spatialProfiles.normalize);
                previousOpponent = profiles[0]; initialize('guest', profiles, msg.battleId);
                send({ msg: 'duel_ready', controls: state.pvpBattle.spatial.controls });
            } catch (_) { interrupt(); }
            return;
        }
        const b = state.pvpBattle;
        if (!b || msg.battleId !== battleId) return;
        lastReceive = now();
        if (b.role === 'host' && Number.isSafeInteger(msg.eventAck) && msg.eventAck >= 0 && msg.eventAck <= eventId) history = history.filter(e => e.id > msg.eventAck);
        if (msg.msg === 'duel_rematch' && !b.active && b.duel.result) {
            try { rematchProfile = spatialProfiles.normalize(msg.profile); } catch (_) { return; }
            otherRematch = true; uiPvp.showRematchRequest(); maybeRematch(); return;
        }
        if (!b.active) return;
        switch (msg.msg) {
            case 'duel_ready': if (b.role === 'host') {
                D.input(b.duel, 1, { type: 'settings', ...msg.controls });
                localReady = remoteReady = true; ready();
            } break;
            case 'duel_go': if (b.role === 'guest') b.ready = true; break;
            case 'duel_input':
                if (b.role !== 'host' || !Number.isSafeInteger(msg.seq) || msg.seq !== receivedSeq + 1) break;
                receivedSeq = msg.seq;
                if (b.ready && (b.countdown <= 0 || ['cancel', 'settings'].includes(msg.command?.type))) D.input(b.duel, 1, msg.command);
                uiPvp.updateFrame(collect()); break;
            case 'duel_snapshot': if (b.role === 'guest') applySnapshot(msg); break;
            case 'duel_surrender':
                if (b.role === 'host') { D.end(b.duel, 'host'); uiPvp.updateFrame(collect()); publish(); finish('host'); }
                break;
            case 'duel_abort': interrupt(false); break;
        }
    }
    function maybeRematch() {
        if (selfRematch && otherRematch && pvpNet.role === 'host') startPVP('host', rematchProfile);
    }
    function requestRematch() {
        const b = state.pvpBattle;
        if (!b || b.active || !b.duel.result || selfRematch) return;
        selfRematch = true;
        send({ msg: 'duel_rematch', profile: spatialProfiles.local() }); uiPvp.showRematchWaiting(); maybeRematch();
    }
    function cancelLocal() {
        const b = state.pvpBattle;
        if (!b?.active) return;
        // Cancellation must bypass menu/countdown input gating.
        if (b.role === 'host') D.input(b.duel, 0, { type: 'cancel' });
        else { const command = { type: 'cancel' }; pending.push({ seq: ++inputSeq, command, at: now() }); send({ msg: 'duel_input', seq: inputSeq, command }); D.input(b.duel, 1, command); }
    }
    function interrupt(notifyPeer = true) {
        const b = state.pvpBattle;
        if (!b?.active) return;
        if (notifyPeer) send({ msg: 'duel_abort' });
        b.active = false; b.duel.sides.forEach(spatialEngine.pause); stopFrame(); uiPvp.clearInputs(); uiPvp.showDisconnectOverlay();
    }
    function surrender() {
        const b = state.pvpBattle;
        if (!b?.active) return;
        cancelLocal();
        if (b.role === 'host') { D.end(b.duel, 'guest'); uiPvp.updateFrame(collect()); publish(); finish('guest'); }
        else send({ msg: 'duel_surrender' });
    }
    function abortToLobby() {
        const b = state.pvpBattle;
        if (b) { b.active = false; b.duel?.sides.forEach(spatialEngine.pause); }
        stopFrame(); uiPvp.destroy(); uiPvp.hideResult(); uiPvp.hideRematchRequest();
        battleId = null; pending = []; selfRematch = otherRematch = false;
    }
    return { VERSION, SKILL_COSTS: D.SKILL_COSTS, startPVP, receiveMessage, advance, input, cancelLocal, interrupt,
        surrender, requestRematch, acceptRematch: requestRematch, abortToLobby,
        getMyCombatProfile: spatialProfiles.local, getCurrentBattleId: () => battleId };
})();
