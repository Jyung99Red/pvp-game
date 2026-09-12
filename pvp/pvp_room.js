// pvp_room.js - Room hosting/joining, based on room codes (PeerJS signaling, no manual SDP exchange)
// Depends on: pvp_net.js, pvp_logic.js (for startPVP)

const pvpRoom = (() => {
    // ── Room code ────────────────────────────────────────────────────────
    // 6 digits, enough to avoid short-term collisions, and easy to scan/type

    function genRoomCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    // ── Room code local memory (localStorage, auto-fills it back after a refresh / accidental close) ──
    // This only saves the user from remembering the number, it does NOT mean
    // the internal battle state can actually be restored -- the resume/give-up
    // logic for battle state lives in _handleHello below.

    const _LAST_ROOM_KEY = 'pvp_lastRoom';
    const _LAST_ROOM_MAX_AGE_MS = 20 * 60 * 1000; // Stop auto-filling after 20 minutes, the room has likely expired by then

    function _saveLastRoom(role, code) {
        try {
            localStorage.setItem(_LAST_ROOM_KEY, JSON.stringify({ role, code, ts: Date.now() }));
        } catch (_) { /* Silently skip if localStorage is unavailable (private mode etc.), doesn't affect the main flow */ }
    }

    function _loadLastRoom() {
        try {
            const raw = localStorage.getItem(_LAST_ROOM_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || Date.now() - data.ts > _LAST_ROOM_MAX_AGE_MS) return null;
            return data;
        } catch (_) { return null; }
    }

    function _clearLastRoom() {
        try { localStorage.removeItem(_LAST_ROOM_KEY); } catch (_) {}
    }

    // ── Status helpers ──────────────────────────────────────────────────

    function setStatus(text) {
        document.querySelectorAll('.pvp-status-text').forEach(el => {
            el.textContent = text;
        });
    }

    function setStep(stepId) {
        document.querySelectorAll('.pvp-step').forEach(el => {
            el.classList.toggle('hidden', el.id !== stepId);
        });
    }

    let _opponentProfile = null, _networkReady = false, _compatible = false;
    function _tryStart() {
        if (pvpNet.role !== 'host' || !_networkReady || !_compatible || !_opponentProfile || pvpLogic.getCurrentBattleId()) return;
        pvpLogic.startPVP('host', _opponentProfile);
    }
    function _attachNetCallbacks() {
        pvpNet.on.status = text => setStatus(text);
        pvpNet.on.connOpen = () => {
            _opponentProfile = null; _networkReady = false; _compatible = false;
            pvpNet.send({ msg: 'hello', version: pvpLogic.VERSION, profile: pvpLogic.getMyCombatProfile() });
        };
        pvpNet.on.open = () => {
            _networkReady = true;
            if (_compatible) { setStatus('已连接，准备空间对战…'); setStep('pvp-step-ready'); }
            _tryStart();
        };
        pvpNet.on.message = msg => {
            if (!msg || typeof msg !== 'object') return;
            if (msg.msg === 'hello') {
                if (msg.version !== pvpLogic.VERSION) { setStatus('双方游戏版本不同，请双方刷新页面后重新加入。'); return; }
                try { _opponentProfile = spatialProfiles.normalize(msg.profile); }
                catch (_) { setStatus('对方战斗属性无效，请重新加入。'); return; }
                _compatible = true; _tryStart(); return;
            }
            if (_compatible) pvpLogic.receiveMessage(msg);
        };

        pvpNet.on.close = () => {
            const wasBattling = state.pvpBattle && state.pvpBattle.active;
            if (wasBattling) {
                // Fast-paced battle mode -- a disconnect is a disconnect, no
                // attempt to resume the current battle. Show the overlay to
                // let the player know; both sides rejoin the same room code
                // to start a new battle (the room code is already saved in
                // localStorage, so it gets auto-filled back in).
                pvpLogic.abortToLobby();
                uiPvp.showDisconnectOverlay();
            } else {
                setStatus('连接断开');
                setStep('pvp-step-entry');
            }
        };

        pvpNet.on.error = (e) => {
            setStatus(`错误: ${e.message || e}`);
        };
    }

    // ── Public API ──────────────────────────────────────────────────────

    return {
        // Player clicked "create room"
        async hostRoom(_retriesLeft = 3) {
            setStep('pvp-step-hosting');
            setStatus('正在创建房间...');
            _attachNetCallbacks();

            const code = genRoomCode();

            try {
                await pvpNet.hostRoom(code);

                // Display the room code
                const codeEl = document.getElementById('pvp-host-code');
                if (codeEl) codeEl.textContent = code;

                _saveLastRoom('host', code);

                setStatus('等待对方输入房间号...');
                setStep('pvp-step-host-waiting');
            } catch (e) {
                // Occasional room code collisions (very rare) auto-retry with a new code, transparently to the user
                if (e.type === 'unavailable-id' && _retriesLeft > 0) {
                    pvpNet.close();
                    return this.hostRoom(_retriesLeft - 1);
                }
                setStatus(`创建失败: ${e.message}`);
            }
        },

        // Player clicked "join room"
        showJoinInput() {
            setStep('pvp-step-joining');

            // If they disconnected recently (within 20 minutes) while acting
            // as Guest, auto-fill the room code back in -- saves the user
            // from having to remember/dig up the number themselves
            const last = _loadLastRoom();
            const input = document.getElementById('pvp-room-code-input');
            if (input && last && last.role === 'guest' && !input.value) {
                input.value = last.code;
                setStatus('已自动填入上次的房间号，确认无误后点击连接');
            }
        },

        // After scanning or typing a room code, Guest clicks "connect" (can also be called directly from a scan callback)
        async joinRoom(roomCodeOverride) {
            const input = document.getElementById('pvp-room-code-input');
            const roomCode = (roomCodeOverride || (input && input.value) || '').trim();

            if (!/^\d{4,8}$/.test(roomCode)) {
                setStatus('房间号无效，请重新输入或扫码');
                return;
            }

            setStatus('正在连接房间...');
            _attachNetCallbacks();
            setStep('pvp-step-joining-wait');

            try {
                await pvpNet.joinRoom(roomCode);
                // Once connected, wait for Host's clock sync to finish and fight_start to be sent
                _saveLastRoom('guest', roomCode);
                setStatus('已连接主机，等待开始...');
            } catch (e) {
                setStatus(`加入失败: ${e.message}`);
                setStep('pvp-step-joining');
            }
        },

        // Clicking "return to lobby" on the disconnect overlay -- ends the
        // current battle for good, the only exit / restart entry point
        giveUpToLobby() {
            pvpLogic.abortToLobby();
            // Must null out the close callback before calling pvpNet.close():
            // peer.destroy() asynchronously fires its own 'close' event, and
            // if we don't detach it first, that event would re-run the lobby
            // navigation logic in on.close above, clashing with the explicit
            // navigation a few lines down (running it twice, state bouncing
            // back and forth).
            pvpNet.on.close = null;
            pvpNet.close();
            _clearLastRoom();
            uiPvp.hideDisconnectOverlay();
            setStep('pvp-step-entry');
            setStatus('');
            ui.switchTab('pvp-room');
        },

        // Reset room state, return to the entry screen
        reset() {
            pvpLogic.abortToLobby();
            pvpNet.on.close = null;
            pvpNet.close();
            _clearLastRoom();
            setStep('pvp-step-entry');
            setStatus('');
            const input = document.getElementById('pvp-room-code-input');
            if (input) input.value = '';
        }
    };
})();
