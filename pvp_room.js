// pvp_room.js - 房间创建/加入，基于房间号（PeerJS 信令，无需手动交换 SDP）
// 依赖: pvp_net.js, pvp_logic.js (用于 startPVP)

const pvpRoom = (() => {
    // ── 房间号 ──────────────────────────────────────────────────────
    // 6 位数字，足够避免短时间内碰撞，且适合扫码/手输

    function genRoomCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    // ── 房间号本地记忆（localStorage，刷新/误关页面后用来自动填回） ──
    // 只是为了不让用户记数字，不代表真的能恢复战斗内部状态——
    // 战斗状态的恢复/放弃逻辑见下面的 _handleHello。

    const _LAST_ROOM_KEY = 'pvp_lastRoom';
    const _LAST_ROOM_MAX_AGE_MS = 20 * 60 * 1000; // 超过20分钟不再自动填，大概率房间已经失效

    function _saveLastRoom(role, code) {
        try {
            localStorage.setItem(_LAST_ROOM_KEY, JSON.stringify({ role, code, ts: Date.now() }));
        } catch (_) { /* localStorage 不可用（隐私模式等）时静默跳过，不影响主流程 */ }
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

    // ── 对方等级（联机时随 hello 消息互相同步，仅等级，战绩暂时不发） ──
    let _opponentLevel = null;

    function _applyOpponentLevel() {
        if (state.pvpBattle && state.pvpBattle.opponent && _opponentLevel != null) {
            state.pvpBattle.opponent.level = _opponentLevel;
            state.pvpBattle.opponent.displayName = `对手 Lv.${_opponentLevel}`;
        }
    }

    // 统一的"开战"入口：startPVP + 套用对方等级 + 切到战斗界面，
    // 三处会触发开战的地方（host 首次连接 / guest 收到 fight_start / hello 探测到对方
    // 刷新重进后 host 重新发起）都走这一个函数，避免漏掉某一处忘记套等级显示。
    function _beginBattle(role) {
        pvpLogic.startPVP(role);
        _applyOpponentLevel();
        ui.switchTab('pvp-battle');
    }

    // ── hello 握手：修复"刷新页面后重连，卡在等待开始不动"的问题 ──────
    //
    // 背景：原来 host 端只在自己 state.pvpBattle.active 为 true 时，把任何新连接
    // 都当成"短暂断线后的真重连"，直接走 resumeAfterReconnect，不会再发 fight_start。
    // 但如果对方是刷新/关闭页面后用同一个房间号重新连进来的，它内存里的战斗状态
    // 已经清空了——既不会收到 fight_start，也没有本地状态可以恢复，于是永远卡在
    // "已连接主机，等待开始..."。
    //
    // 修复思路：数据通道刚打开（不等时钟同步）双方都立刻报一下"我这边现在是否
    // 还有活跃的对局"（顺带把自己的等级也带过去）。如果双方报的活跃状态不一致，
    // 说明其中一方的战斗状态已经丢了——不去尝试同步战斗内部细节（HP/相位/计时器
    // 太多状态，跨端同步风险大），直接放弃这一局，由 host 重新发起一局全新的对局。
    function _handleHello(msg) {
        // 等级不管有没有触发"重新开战"都先记下来，包括最常见的"第一次连接，
        // 双方都没在打"这种情况——如果放在下面的 mismatch 分支里才记，
        // 正常首次连接根本不会进 if，等级就永远收不到了。
        if (typeof msg.level === 'number') _opponentLevel = msg.level;

        const iHaveActiveBattle = !!(state.pvpBattle && state.pvpBattle.active);
        if (iHaveActiveBattle === msg.hasActiveBattle) return; // 状态一致，不用处理

        if (iHaveActiveBattle) pvpLogic.abortToLobby();
        uiPvp.hideDisconnectOverlay();
        setStatus('检测到对方重新进入，正在重新开始新一局...');

        // 只有 host 负责重新发起；guest 被动等 fight_start（走原有那条分支）
        if (pvpNet.role === 'host') {
            pvpNet.send({ msg: 'fight_start' });
            _beginBattle('host');
        }
    }

    // ── 网络回调 ──────────────────────────────────────────────────

    function _attachNetCallbacks() {
        pvpNet.on.status = (text) => setStatus(text);

        pvpNet.on.connOpen = () => {
            pvpNet.send({
                msg: 'hello',
                hasActiveBattle: !!(state.pvpBattle && state.pvpBattle.active),
                level: state.player.level
            });
        };

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
                _beginBattle('host');
            }
        };

        pvpNet.on.message = (msg) => {
            if (msg.msg === 'hello') {
                _handleHello(msg);
                return;
            }
            if (msg.msg === 'fight_start' && pvpNet.role === 'guest') {
                _beginBattle('guest');
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

                _saveLastRoom('host', code);

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

            // 如果最近(20分钟内)掉线过、且当时是 guest 身份，自动把房间号填回去，
            // 不用用户自己回忆/翻聊天记录找数字
            const last = _loadLastRoom();
            const input = document.getElementById('pvp-room-code-input');
            if (input && last && last.role === 'guest' && !input.value) {
                input.value = last.code;
                setStatus('已自动填入上次的房间号，确认无误后点击连接');
            }
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
                _saveLastRoom('guest', roomCode);
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
            _clearLastRoom();
            uiPvp.hideDisconnectOverlay();
            setStep('pvp-step-entry');
            setStatus('');
            ui.switchTab('pvp-room');
        },

        // 重置房间状态，回到入口界面
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