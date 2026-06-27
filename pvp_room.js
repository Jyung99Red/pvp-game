// pvp_room.js - 房间创建/加入，基于房间号（PeerJS 信令，无需手动交换 SDP）
// 依赖: pvp_net.js, pvp_logic.js (用于 startPVP)

const pvpRoom = (() => {
    // ── 房间号 ──────────────────────────────────────────────────────
    // 6 位数字，足够避免短时间内碰撞，且适合扫码/手输

    function genRoomCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    // ── 状态辅助 ──────────────────────────────────────────────────

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

    // ── 网络回调 ──────────────────────────────────────────────────

    function _attachNetCallbacks() {
        pvpNet.on.status = (text) => setStatus(text);

        pvpNet.on.open = () => {
            // 战斗已经在进行中 → 这是断线重连恢复，不是第一次开始
            if (state.pvpBattle && state.pvpBattle.active) {
                pvpLogic.resumeAfterReconnect();
                uiPvp.hideDisconnectOverlay();
                setStatus('已重新连接');
                return;
            }

            // 第一次建立连接：时钟同步完成(host侧)，或数据通道打开(guest侧等待answer之后)
            setStatus('已连接，等待开始...');
            setStep('pvp-step-ready');

            if (pvpNet.role === 'host') {
                pvpNet.send({ msg: 'fight_start' });
                pvpLogic.startPVP('host');
                ui.switchTab('pvp-battle');
            }
        };

        pvpNet.on.message = (msg) => {
            if (msg.msg === 'fight_start' && pvpNet.role === 'guest') {
                pvpLogic.startPVP('guest');
                ui.switchTab('pvp-battle');
                return;
            }
            pvpLogic.receiveMessage(msg);
        };

        pvpNet.on.close = () => {
			console.log('[pvp] NETWORK CLOSE 触发了, wasBattling=', state.pvpBattle && state.pvpBattle.active);
            const wasBattling = state.pvpBattle && state.pvpBattle.active;

            if (wasBattling) {
                // 对战中掉线：冻结战斗状态，留在战斗界面，弹出断线遮罩
                // （而不是直接退回房间界面——避免战斗中突然被切走界面造成困惑）
                pvpLogic.pauseForDisconnect();
                uiPvp.showDisconnectOverlay(pvpNet.role);
            } else {
                // 还没开打就掉线（建连阶段失败/对方提前退出）：回到入口
                setStatus('连接断开');
                setStep('pvp-step-entry');
            }
        };

        pvpNet.on.error = (e) => {
            setStatus(`错误: ${e.message || e}`);
        };
    }

    // ── 公开 API ──────────────────────────────────────────────────

    return {
        // 玩家点击"创建房间"
        async hostRoom(_retriesLeft = 3) {
            setStep('pvp-step-hosting');
            setStatus('正在创建房间...');
            _attachNetCallbacks();

            const code = genRoomCode();

            try {
                await pvpNet.hostRoom(code);

                // 房间号展示
                const codeEl = document.getElementById('pvp-host-code');
                if (codeEl) codeEl.textContent = code;

                setStatus('等待对方输入房间号...');
                setStep('pvp-step-host-waiting');
            } catch (e) {
                // 房间号偶发冲突（极小概率）时自动换号重试，不需要用户感知
                if (e.type === 'unavailable-id' && _retriesLeft > 0) {
                    pvpNet.close();
                    return this.hostRoom(_retriesLeft - 1);
                }
                setStatus(`创建失败: ${e.message}`);
            }
        },

        // 玩家点击"加入房间"
        showJoinInput() {
            setStep('pvp-step-joining');
        },

        // 扫码或手输房间号后，guest 点击"连接"（也可由扫码回调直接调用）
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
                // 连接成功后，等待 host 端时钟同步完毕、发出 fight_start
                setStatus('已连接主机，等待开始...');
            } catch (e) {
                setStatus(`加入失败: ${e.message}`);
                setStep('pvp-step-joining');
            }
        },

        // 断线遮罩里点"重新连接"（仅 guest 可用，host 是被动等待）
        async attemptReconnect() {
            setStatus('正在重新连接...');

            try {
                await pvpNet.reconnect();
                // 成功后 pvpNet.reconnect() 的 resolve 即代表连接已建立；
                // guest 这一侧的 on.open 不会被底层触发（既有设计），这里直接手动恢复
                pvpLogic.resumeAfterReconnect();
                uiPvp.hideDisconnectOverlay();
                setStatus('已重新连接');
            } catch (e) {
                setStatus(`重连失败: ${e.message}`);
            }
        },

        // 断线遮罩里点"放弃，返回大厅"——彻底结束本局，不再尝试重连
        giveUpToLobby() {
            pvpLogic.abortToLobby();
            // Null out the close callback BEFORE calling pvpNet.close(), so that
            // peer.destroy()'s async 'close' event doesn't re-trigger lobby/step logic
            // and race with the explicit navigation below.
            pvpNet.on.close = null;
            pvpNet.close();
            uiPvp.hideDisconnectOverlay();
            setStep('pvp-step-entry');
            setStatus('');
            ui.switchTab('pvp-room');
        },

        // 重置房间状态，回到入口界面
        reset() {
            pvpNet.on.close = null;
            pvpNet.close();
            setStep('pvp-step-entry');
            setStatus('');
            const input = document.getElementById('pvp-room-code-input');
            if (input) input.value = '';
        }
    };
})();