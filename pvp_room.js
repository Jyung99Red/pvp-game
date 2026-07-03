// pvp_room.js - Room hosting/joining, based on room codes (PeerJS signaling, no manual SDP exchange)
// Depends on: pvp_net.js, pvp_logic.js (for startPVP)

const pvpRoom = (() => {
    // ── Room code ────────────────────────────────────────────────────────
    // 6 digits, enough to avoid short-term collisions, and easy to type and share

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

    // ── The opponent's real combat stats (synced both ways via the hello
    // message once connected: level + atk/def/spd/maxHp + derived multipliers,
    // see _buildLocalProfile in pvp_logic.js). Match history isn't sent yet.
    let _opponentProfile = null;

    // The single unified "start the fight" entry point: startPVP + switch to
    // the battle tab. All three places that can trigger a fight start (Host's
    // first connection / Guest receiving fight_start / Host re-initiating
    // after hello detects the opponent reconnected after a refresh) go
    // through this one function, so none of them can forget to pass the
    // opponent's profile. battleId only needs to be passed on the Guest side
    // (received via the fight_start message); Host doesn't pass one, letting
    // pvpLogic generate a fresh id itself.
    function _beginBattle(role, battleId) {
        pvpLogic.startPVP(role, _opponentProfile, battleId);
        ui.switchTab('pvp-battle');
    }

    // ── hello handshake: decide whether to start a brand new battle ────────
    //
    // Background (historical issue, already fixed): in an earlier version,
    // as long as the Host's own state.pvpBattle.active was true, it treated
    // any newly-incoming connection as "a genuine reconnect after a brief
    // drop" and called a function named resumeAfterReconnect to try to
    // restore the original battle, without sending fight_start again. But if
    // the other side had actually refreshed/closed the page and reconnected
    // with the same room code, its in-memory battle state was already wiped
    // -- it would never receive fight_start, and had no local state to
    // restore either, so it stayed stuck forever on "Connected to host,
    // waiting to start...".
    //
    // Current approach: that "resume the battle in place" path
    // (resumeAfterReconnect) has been removed entirely. After a disconnect
    // the only exit is returning to the lobby (giveUpToLobby) and going
    // through hostRoom/joinRoom again from scratch -- this hello handshake
    // only has one job: deciding whether a freshly (re-)established
    // connection should start a brand new battle. Rather than the weak
    // signal of "each side reports a boolean and we guess whether state is
    // consistent", it directly compares the precise battleId identifier:
    // matching ids mean both sides are genuinely still in the same battle
    // (e.g. a brief network blip mid-battle where the connection never
    // truly dropped); any mismatch (whatever the specific cause -- a
    // refresh, room code reuse, message reordering, or something we haven't
    // hit yet) is uniformly treated as "the other side just joined fresh",
    // and Host directly starts a brand new battle without trying to sync any
    // internal battle details.
    function _handleHello(msg) {
        // Record the opponent's profile regardless of whether this triggers
        // a "restart" -- including the most common case of "first connection,
        // neither side is fighting yet". If this were only recorded inside
        // the mismatch branch below, a normal first connection would never
        // enter that branch and the opponent's profile would never be received.
        if (msg.profile) _opponentProfile = msg.profile;

        const localBattleId  = pvpLogic.getCurrentBattleId();
        const remoteBattleId = msg.battleId || null;
        if (localBattleId === remoteBattleId) return; // Exact match, nothing to do

        if (localBattleId) pvpLogic.abortToLobby();
        uiPvp.hideDisconnectOverlay();
        setStatus('检测到对方重新进入，正在重新开始新一局...');

        // Only Host re-initiates; Guest passively waits for fight_start (handled by the existing branch)
        if (pvpNet.role === 'host') {
            _beginBattle('host');
            pvpNet.send({ msg: 'fight_start', battleId: pvpLogic.getCurrentBattleId() });
        }
    }

    // ── Network callbacks ──────────────────────────────────────────────────

    function _attachNetCallbacks() {
        pvpNet.on.status = (text) => setStatus(text);

        pvpNet.on.connOpen = () => {
            pvpNet.send({
                msg: 'hello',
                battleId: pvpLogic.getCurrentBattleId(),
                profile: pvpLogic.getMyCombatProfile()
            });
        };

        pvpNet.on.open = () => {
            setStatus('已连接，等待开始...');
            setStep('pvp-step-ready');

            if (pvpNet.role === 'host') {
                _beginBattle('host');
                pvpNet.send({ msg: 'fight_start', battleId: pvpLogic.getCurrentBattleId() });
            }
        };

        pvpNet.on.message = (msg) => {
            if (msg.msg === 'hello') {
                _handleHello(msg);
                return;
            }
            if (msg.msg === 'fight_start' && pvpNet.role === 'guest') {
                _beginBattle('guest', msg.battleId);
                return;
            }
            pvpLogic.receiveMessage(msg);
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

        // After typing a room code, Guest clicks "connect" (can also be called directly with an override)
        async joinRoom(roomCodeOverride) {
            const input = document.getElementById('pvp-room-code-input');
            const roomCode = (roomCodeOverride || (input && input.value) || '').trim();

            if (!/^\d{6}$/.test(roomCode)) {
                setStatus('房间号无效（应为6位数字），请重新输入');
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