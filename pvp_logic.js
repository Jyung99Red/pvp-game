// pvp_logic.js - PVP battle engine
// Rules:
//   - No document.* calls
//   - No Date.now() - time comes from arguments (now, dt)
//   - Host is the sole judgment authority
//   - Guest mirrors opponent state from network messages only

const pvpConfig = {
    // Charge attack
    chargeMaxMs:       3000,
    earlyReleaseMs:    500,
    earlyReleaseDmg:   1,
    minChargeDmg:      5,
    maxChargeDmg:      30,
    baseAtk:           10,    // reference atk for damage scaling

    // Defense
    guardWindupMs:     300,   // ms before guard becomes active
    guardMaxHoldMs:    3000,  // auto-cancel after this
    parryWindowMs:     200,   // base perfect-parry window (scaled by int)

    // Phase timers
    strikeRecoveryMs:  800,
    parryStunMs:       600,   // attacker stun duration after being parried
    clashRecoveryMs:   400,

    // AP
    apMax:             3,
    apRecoveryMs:      2000,  // ms per AP point (scaled by spd)

    // Clash detection window
    clashWindowMs:     100
};

// ── State initialiser ────────────────────────────────────────────────

function _makeSideState(maxHp) {
    return {
        hp:            maxHp,
        maxHp,
        phase:         'idle',
        phaseTimer:    0,
        chargeStartT:  0,
        chargeMs:      0,
        actionPoints:  pvpConfig.apMax,
        actionProgress: 0,
        lastStrikeT:   0,   // wall-clock ms when last strike_out began (Date.now())
        lastChargeMs:  0,   // chargeMs of the last fired attack (for clash dmg calc)
        lastGuardReadyT: 0  // wall-clock ms when guard became ready (Date.now())
    };
}

// PHASES: idle | charging | strike_out | strike_recover |
//         guard_windup | guard_ready | parry | stunned | blocked

const pvpLogic = (() => {
    let _rAF  = null;
    let _lastTime = 0;
    let _rematchRequestedBySelf = false;

    // 对方真实的战斗数值快照（atk/def/spd/maxHp + 衍生倍率），由 pvp_room.js
    // 在连接建立时通过 hello 消息发过来、再传进 startPVP。在拿到真实数据之前，
    // 兜底用自己的数值，避免没收到时直接报错（单设备自测场景也能跑）。
    //
    // 背景：在这次修复之前，_calcChargeDamage / _applyDefense / _apRecoveryMs /
    // _parryWindow 全部直接调 player.getStats()——这个函数读的永远是"本机这台
    // 设备上的角色"，不管这次算的是不是对方的攻击/防御。结果是：无论谁出招，
    // 伤害用的都是判定方（host）本机角色的 atk/def，跟攻击者实际等级/装备完全
    // 对不上，对手的等级、HP上限在UI上也只是从本机角色数值镜像出来的假数字。
    let _opponentProfile = null;

    // 当前这一局的唯一标识。每次 startPVP() 都会生成一个新的（host生成、
    // guest 从 fight_start/rematch_accept 消息里拿到同一个），战斗内的每条
    // 网络消息都带着它——比"双方各报一个布尔值猜测状态是否一致"更可靠：
    // 不管是刷新重连、消息延迟乱序、还是别的没遇到过的边缘情况，只要编号
    // 对不上就是对不上，不需要为每一种具体场景单独写一条判断。
    let _battleId = null;
    let _pendingRematchBattleId = null; // 对方在 rematch_request 里提议的id（只有对方是host时才会有）

    function _genBattleId() {
        return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    // 战斗内消息（action / charge_sync / result / fight_end）统一从这里发，
    // 自动带上当前 battleId，不用每个发送点自己记得加这个字段。
    function _sendBattleMsg(payload) {
        pvpNet.send({ ...payload, battleId: _battleId });
    }

    function _buildLocalProfile() {
        const stats = player.getStats();
        return {
            level: state.player.level,
            maxHp: stats.maxHp,
            atk:   stats.atk,
            def:   stats.def,
            spd:   stats.spd,
            judgmentMultiplier:    player.getJudgmentMultiplier(),
            guardDamageMultiplier: player.getGuardDamageMultiplier()
        };
    }

    // ── Helpers ──────────────────────────────────────────────────────

    function _lerp(a, b, t) { return a + (b - a) * t; }

    function _calcChargeDamage(chargeMs, atk) {
        // <500ms: fixed 1 dmg (tap penalty)
        if (chargeMs < pvpConfig.earlyReleaseMs) return pvpConfig.earlyReleaseDmg;
        // 500ms->3000ms: linear 0.3x->1.1x atk
        const t = Math.min(
            (chargeMs - pvpConfig.earlyReleaseMs) /
            (pvpConfig.chargeMaxMs - pvpConfig.earlyReleaseMs),
            1.0
        );
        const ratio = _lerp(0.3, 1.1, t);
        return Math.max(1, Math.round(atk * ratio));
    }

    function _applyDefense(rawDmg, def) {
        // Flat reduction: each def point blocks 0.15 dmg, capped at 20% of raw dmg
        // Result: def has mild effect, atk stays dominant
        const reduction = Math.min(rawDmg * 0.20, def * 0.15);
        return Math.max(1, Math.round(rawDmg - reduction));
    }

    function _parryWindow(judgmentMultiplier) {
        return pvpConfig.parryWindowMs * (judgmentMultiplier || 1);
    }

    function _apRecoveryMs(spd) {
        return pvpConfig.apRecoveryMs * (10 / (spd || 10));
    }

    function _setPhase(side, phase, timerMs) {
        side.phase      = phase;
        side.phaseTimer = timerMs || 0;
    }

    // ── Tick: advance one side's state ───────────────────────────────

    function _tickSide(side, dt, now, isSelf) {
        // AP recovery (not while actively doing something)
        if (!['charging', 'guard_windup', 'guard_ready'].includes(side.phase)) {
            if (side.actionPoints < pvpConfig.apMax) {
                const spd = isSelf ? player.getStats().spd : _opponentProfile.spd;
                side.actionProgress += dt / _apRecoveryMs(spd);
                if (side.actionProgress >= 1) {
                    side.actionPoints++;
                    side.actionProgress = side.actionPoints < pvpConfig.apMax
                        ? side.actionProgress - 1 : 0;
                }
            } else {
                side.actionProgress = 0;
            }
        }

        // Phase timer countdown
        if (side.phaseTimer > 0) {
            side.phaseTimer = Math.max(0, side.phaseTimer - dt);
        }
		
		if (side.phase === 'charging') {
			side.chargeMs = now - side.chargeStartT;
			if (side.chargeMs >= pvpConfig.chargeMaxMs) {
				side.chargeMs = pvpConfig.chargeMaxMs;
				if (isSelf) _fireCharge(side, true);
			}
		}

        // Phase auto-transitions when timer hits 0
        if (side.phaseTimer === 0) {
            switch (side.phase) {
                case 'strike_out':     _setPhase(side, 'strike_recover', pvpConfig.strikeRecoveryMs); break;
                case 'strike_recover': _setPhase(side, 'idle', 0); break;
                case 'guard_windup':   _setPhase(side, 'idle', 0); break;
                case 'guard_ready':    _setPhase(side, 'idle', 0); break;
                case 'parry':          _setPhase(side, 'idle', 0); break;
                case 'stunned':        _setPhase(side, 'idle', 0); break;
                case 'blocked':        _setPhase(side, 'idle', 0); break;
            }
        }

    }

    // ── Fire charge ───────────────────────────────────────────────────

    function _fireCharge(side, isAuto) {
        const chargeMs    = isAuto ? pvpConfig.chargeMaxMs : side.chargeMs;
        console.log('[pvp] fireCharge: chargeMs=', chargeMs, 'isAuto=', isAuto, 'role=', pvpNet.role);
        side.lastChargeMs = chargeMs;
        side.chargeMs     = 0;
        side.chargeStartT = 0;
        side.lastStrikeT  = Date.now();
        _setPhase(side, 'strike_out', 16);

        if (pvpNet.role === 'host') {
            // Host 是判定权威，自己不需要靠这条消息来判定，但 guest 那边显示的
            // "对手"状态完全依赖网络消息驱动——如果不广播，guest 看到的 host
            // 会一直卡在最后一次 charge_sync 收到的"蓄力中"，直到下一个动作
            // 消息把它覆盖掉。这里补发一条，复用 guest 攻击时已经验证正确的
            // 接收处理逻辑（_handleNetMessage 的 'charge_release' case）。
            _sendBattleMsg({ msg: 'action', type: 'charge_release', chargeMs, t: pvpNet.now() });
            _resolveExchange(chargeMs, state.pvpBattle.self, state.pvpBattle.opponent);
        } else {
            _sendBattleMsg({ msg: 'action', type: 'charge_release', chargeMs, t: pvpNet.now() });
        }
    }

    // ── Exchange resolution (Host only) ──────────────────────────────
    // attacker / defender are the actual state objects (not fixed to host/guest)

    function _resolveExchange(attackerChargeMs, attacker, defender) {
        const b = state.pvpBattle;
        const attackerIsSelf = (attacker === b.self);
        const attackerStats  = attackerIsSelf ? _buildLocalProfile() : _opponentProfile;
        const defenderStats  = attackerIsSelf ? _opponentProfile     : _buildLocalProfile();

        const rawDmg  = _calcChargeDamage(attackerChargeMs, attackerStats.atk);
        const wallNow = Date.now();

        const isClash  = defender.phase === 'strike_out' &&
                         (wallNow - defender.lastStrikeT) <= pvpConfig.clashWindowMs;
        const timeSinceGuard = defender.lastGuardReadyT > 0
            ? (wallNow - defender.lastGuardReadyT) : Infinity;
        const isParry  = !isClash && defender.phase === 'guard_ready' &&
                         timeSinceGuard <= _parryWindow(defenderStats.judgmentMultiplier);
        const isBlock  = !isClash && defender.phase === 'guard_ready' && !isParry;

        console.log('[pvp] resolveExchange: atkCharge=', attackerChargeMs,
            'defPhase=', defender.phase,
            'defLastStrike=', defender.lastStrikeT,
            'wallNow=', wallNow,
            'Δstrike=', defender.lastStrikeT ? wallNow - defender.lastStrikeT : '∞',
            '→', isClash ? 'CLASH' : isParry ? 'PARRY' : isBlock ? 'BLOCK' : 'HIT');

        // ── Result fields ─────────────────────────────────────────────
        // attackerDmg: damage attacker receives
        // defenderDmg: damage defender receives
        // logText: ready-to-display string, no further translation needed

        let attackerDmg, defenderDmg, attackerStunMs, defenderStunMs, exchange, logText;

        if (isClash) {
            const defChargeMs = defender.lastChargeMs || pvpConfig.earlyReleaseMs;
            attackerDmg   = _applyDefense(Math.round(_calcChargeDamage(defChargeMs, defenderStats.atk) * 0.5), attackerStats.def);
            defenderDmg   = _applyDefense(Math.round(rawDmg * 0.5), defenderStats.def);
            attackerStunMs = pvpConfig.clashRecoveryMs;
            defenderStunMs = pvpConfig.clashRecoveryMs;
            exchange  = 'clash';
            logText   = `💥 对撞！双方各受伤害`;
        } else if (isParry) {
            const counterDmg = Math.max(1, Math.round(rawDmg * 0.5));
            attackerDmg    = _applyDefense(counterDmg, attackerStats.def);
            defenderDmg    = 0;
            attackerStunMs = pvpConfig.parryStunMs;
            defenderStunMs = 0;
            exchange   = 'parry';
            logText    = `✨ 弹反！反击 ${attackerDmg} 点，攻击方硬直`;
        } else if (isBlock) {
            const guardMult  = defenderStats.guardDamageMultiplier;
            const blockedDmg = Math.max(1, Math.round(_applyDefense(rawDmg, defenderStats.def) * 0.4 * guardMult));
            attackerDmg    = 0;
            defenderDmg    = blockedDmg;
            attackerStunMs = 0;
            defenderStunMs = 150;
            exchange   = 'blocked';
            logText    = `🛡️ 格挡！减为 ${defenderDmg} 点伤害`;
        } else {
            attackerDmg    = 0;
            defenderDmg    = _applyDefense(rawDmg, defenderStats.def);
            attackerStunMs = 0;
            defenderStunMs = 0;
            exchange   = 'hit';
            logText    = `⚔️ 命中！造成 ${defenderDmg} 点伤害`;
        }

        // Determine if the local player (b.self) is the attacker or defender.
        // host always calls this function, so attacker/defender are real objects.
        const selfIsAttacker = attackerIsSelf;

        // Apply HP
        attacker.hp = Math.max(0, attacker.hp - attackerDmg);
        defender.hp = Math.max(0, defender.hp - defenderDmg);

        // Apply stuns
        if (attackerStunMs > 0) _setPhase(attacker, 'stunned', attackerStunMs);
        if (defenderStunMs > 0) _setPhase(defender, 'stunned', defenderStunMs);

        // Log (host side)
        _pushLog(logText);

        // 视觉反馈：哪怕这一下是致命一击，也要先把动画打出来——
        // 下面如果直接因为HP归零提前return，guest端会连这条result消息都收不到，
        // 等于看不到最后一下的特效，直接跳到结算画面。所以这里先播放、
        // 再广播，最后才做生死判定。
        uiPvp.playExchangeFx(exchange, selfIsAttacker);

        // Broadcast to guest — send enough for guest to apply HP/log/fx.
        // attackerIsHost 让 guest 端能正确翻译"出手的是己方还是对手"。
        _sendBattleMsg({
            msg:          'result',
            exchange,
            logText,
            hostHp:       b.self.hp,
            guestHp:      b.opponent.hp,
            hostStunMs:   selfIsAttacker ? attackerStunMs : defenderStunMs,
            guestStunMs:  selfIsAttacker ? defenderStunMs : attackerStunMs,
            attackerIsHost: selfIsAttacker,
        });

        // Check end (放在广播之后，确保致命一击的特效/log已经送达guest)
        if (attacker.hp <= 0 || defender.hp <= 0) {
            _endBattle();
            return;
        }
    }

    // ── Apply result on guest side ────────────────────────────────────

    function _applyResultGuest(msg) {
        const b = state.pvpBattle;
        // Host sends absolute HP values — use them directly, no translation needed
        b.self.hp     = msg.guestHp;
        b.opponent.hp = msg.hostHp;

        if (msg.guestStunMs > 0) _setPhase(b.self,     'stunned', msg.guestStunMs);
        if (msg.hostStunMs  > 0) _setPhase(b.opponent, 'stunned', msg.hostStunMs);

        _pushLog(msg.logText);
        uiPvp.playExchangeFx(msg.exchange, !msg.attackerIsHost);

        if (b.self.hp <= 0 || b.opponent.hp <= 0) _endBattle();
    }

    // ── Log ──────────────────────────────────────────────────────────

    function _pushLog(text) {
        const log = state.pvpBattle.log;
        log.unshift(text);
        if (log.length > 20) log.pop();
    }

    // ── Battle lifecycle ─────────────────────────────────────────────

    function _endBattle() {
        if (_rAF) { cancelAnimationFrame(_rAF); _rAF = null; }
        _stopChargeSync();
        const b = state.pvpBattle;
        b.active = false;

        const winner = b.self.hp <= 0 ? 'opponent' : 'self';
        if (pvpNet.role === 'host') {
            _sendBattleMsg({ msg: 'fight_end', winner: winner === 'self' ? 'host' : 'guest' });
        }
        _onFightEnd(winner);
    }

    function _onFightEnd(winner) {
        if (_rAF) { cancelAnimationFrame(_rAF); _rAF = null; }
        _stopChargeSync();
        if (state.pvpBattle) state.pvpBattle.active = false;
        uiPvp.showResult(winner);
    }

    // ── Charge sync ──────────────────────────────────────────────────

    let _chargeSyncInterval = null;

    function _startChargeSync() {
        _chargeSyncInterval = setInterval(() => {
            const side = state.pvpBattle && state.pvpBattle.self;
            if (!side || side.phase !== 'charging') { _stopChargeSync(); return; }
            const progress = Math.min(side.chargeMs / pvpConfig.chargeMaxMs, 1);
            _sendBattleMsg({ msg: 'charge_sync', progress });
        }, 100);
    }

    function _stopChargeSync() {
        if (_chargeSyncInterval) { clearInterval(_chargeSyncInterval); _chargeSyncInterval = null; }
    }

    // ── Main loop ────────────────────────────────────────────────────

    function _loop(currentTime) {
        if (!state.pvpBattle || !state.pvpBattle.active) return;
        const dt  = Math.min(currentTime - _lastTime, 100); // cap dt to avoid huge jumps
        _lastTime = currentTime;
        const now = Date.now();
        const b   = state.pvpBattle;

        // Guard windup → guard_ready transition (needs to fire before tick zeroes the timer)
        if (b.self.phase === 'guard_windup' && b.self.phaseTimer <= dt) {
            _onGuardWindupComplete(b.self, now);
        }

        _tickSide(b.self,     dt, now, true);
		_tickSide(b.opponent, dt, now, false);

        uiPvp.updateFrame();

        _rAF = requestAnimationFrame(_loop);
    }

    // ── Input handlers ───────────────────────────────────────────────

    function _onChargePress(now) {
        const side = state.pvpBattle && state.pvpBattle.self;
        console.log('[pvp] chargePress: paused=', state.pvpBattle?.paused,
            'phase=', side?.phase, 'AP=', side?.actionPoints);
        if (!state.pvpBattle || state.pvpBattle.paused) return;
        if (side.actionPoints < 1)  return;
        if (side.phase !== 'idle')  return;

        side.actionPoints--;
        side.chargeStartT = now;
        side.chargeMs     = 0;
        _setPhase(side, 'charging', 0);
        console.log('[pvp] chargePress→charging: startT=', now);

        _sendBattleMsg({ msg: 'action', type: 'charge_start', t: pvpNet.now() });
    }

    function _onChargeRelease(now) {
        if (!state.pvpBattle) return;
        const side = state.pvpBattle.self;
        console.log('[pvp] chargeRelease: phase=', side.phase, 'chargeMs=', side.chargeMs);
        if (side.phase !== 'charging') return;
        _fireCharge(side, false);
    }

    function _onGuardPress(now) {
        if (!state.pvpBattle || state.pvpBattle.paused) return;
        const side = state.pvpBattle.self;
        if (side.phase === 'charging') return;
        if (side.phase !== 'idle')     return;
        if (side.actionPoints < 1)     return;

        _setPhase(side, 'guard_windup', pvpConfig.guardWindupMs);
        _sendBattleMsg({ msg: 'action', type: 'guard_press', t: pvpNet.now() });
    }

    function _onGuardWindupComplete(side, now) {
        side.actionPoints--;
        side.lastGuardReadyT = now;   // wall-clock, for parry window
        _setPhase(side, 'guard_ready', pvpConfig.guardMaxHoldMs);
        _sendBattleMsg({ msg: 'action', type: 'guard_ready', t: pvpNet.now() });
    }

    function _onGuardRelease() {
        if (!state.pvpBattle) return;
        const side = state.pvpBattle.self;
        if (side.phase === 'guard_windup' || side.phase === 'guard_ready') {
            _setPhase(side, 'idle', 0);
            side.lastGuardReadyT = 0;
            _sendBattleMsg({ msg: 'action', type: 'guard_release', t: pvpNet.now() });
        }
    }

    // ── Network message handler ───────────────────────────────────────

    function _handleNetMessage(msg) {
        if (!state.pvpBattle) return;
        const b  = state.pvpBattle;
        const op = b.opponent;

        // action/charge_sync/result/fight_end 都是"某一场具体对局"内部的消息——
        // 先比对battleId，不一致就说明这条消息来自我们已经不在同一场对局的
        // 状态（对方刷新重连、消息延迟到了新一局开始之后……不管具体是哪种
        // 情况），直接丢弃，不去猜该怎么硬套到当前这场战斗上。
        const BATTLE_SCOPED = { action: 1, charge_sync: 1, result: 1, fight_end: 1 };
        if (BATTLE_SCOPED[msg.msg] && msg.battleId !== _battleId) {
            console.warn('[pvp] 丢弃battleId不匹配的消息:', msg.msg, msg.battleId, '当前=', _battleId);
            return;
        }

        switch (msg.msg) {
            case 'action': {
                // correctedT aligns the remote timestamp to local wall-clock
                const correctedT = pvpNet.correctRemote(msg.t);

                switch (msg.type) {
                    case 'charge_start':
                        op.chargeStartT   = correctedT;
                        op.chargeMs       = 0;
                        // 清掉上一轮蓄力结束时残留的进度值（比如上次松手前是100%），
                        // 否则新一轮蓄力刚开始的这一帧会先显示上次的残留值，
                        // 直到下一条 charge_sync 消息（~100ms后）才刷新成真实进度，
                        // 视觉上就是"先闪一下满条，再跳回真实值继续填"。
                        op.chargeProgress = 0;
                        _setPhase(op, 'charging', 0);
                        break;

                    case 'charge_release':
                        op.lastChargeMs = msg.chargeMs;
                        // Use local Date.now() for lastStrikeT so clash detection
                        // (wallNow - lastStrikeT) stays on one consistent clock.
                        op.lastStrikeT  = Date.now();
                        _setPhase(op, 'strike_out', 16);

                        if (pvpNet.role === 'host') {
                            // Guest attacked → guest=attacker, host=defender
                            _resolveExchange(msg.chargeMs, b.opponent, b.self);
                        }
                        break;

                    case 'guard_press':
                        _setPhase(op, 'guard_windup', pvpConfig.guardWindupMs);
                        break;

                    case 'guard_ready':
                        // 与 charge_release 的 lastStrikeT 处理方式保持一致：
                        // 使用本地收到消息时的 Date.now()，而不是依赖跨设备时钟
                        // 同步换算出来的 correctedT。correctRemote 一旦有偏差（哪怕
                        // 只是几百毫秒），就会让 timeSinceGuard 算出极小值甚至负数，
                        // 导致对手举盾后无论过去多久，攻击都被误判为弹反。
                        op.lastGuardReadyT = Date.now();
                        _setPhase(op, 'guard_ready', pvpConfig.guardMaxHoldMs);
                        break;

                    case 'guard_release':
                        if (op.phase === 'guard_windup' || op.phase === 'guard_ready') {
                            _setPhase(op, 'idle', 0);
                            op.lastGuardReadyT = 0;
                        }
                        break;
                }
                break;
            }

            case 'charge_sync':
                op.chargeProgress = msg.progress;
                break;

            case 'result':
                if (pvpNet.role === 'guest') {
                    _applyResultGuest(msg);
                }
                break;

            case 'fight_end':
                if (pvpNet.role === 'guest') {
                    _onFightEnd(msg.winner === 'guest' ? 'self' : 'opponent');
                }
                break;

            case 'rematch_request':
                if (msg.profile) _opponentProfile = msg.profile;
                _pendingRematchBattleId = msg.battleId || null;
                if (_rematchRequestedBySelf) {
                    // 双方几乎同时点了"再来一局"——以 host 这一端生成的id为准，
                    // guest 这种情况下用的是上面刚记下的对方提案（不完全可靠，
                    // 极少数情况下双方仍可能生成不一致；但只要不一致，下一条
                    // 战斗消息就会被上面的battleId校验直接丢弃并能感知到，
                    // 不会悄悄算错——这正是这套机制要保证的下限）。
                    _rematchRequestedBySelf = false;
                    const battleId = (pvpNet.role === 'host') ? _genBattleId() : _pendingRematchBattleId;
                    pvpNet.send({ msg: 'rematch_accept', profile: _buildLocalProfile(), battleId });
                    pvpLogic.startPVP(pvpNet.role, null, battleId);
                } else {
                    uiPvp.showRematchRequest();
                }
                break;

            case 'rematch_accept':
                _rematchRequestedBySelf = false;
                if (msg.profile) _opponentProfile = msg.profile;
                pvpLogic.startPVP(pvpNet.role, null, msg.battleId);
                break;
        }
    }

    // ── Public API ───────────────────────────────────────────────────

    return {
        startPVP(role, opponentProfile, battleId) {
            if (_rAF) { cancelAnimationFrame(_rAF); _rAF = null; }
            _stopChargeSync();
            _rematchRequestedBySelf = false;
            uiPvp.hideResult();
            uiPvp.hideRematchRequest();

            // host 没传 battleId 时自己生成一个新的；guest 必须用传进来的
            // （从 fight_start / rematch_accept 消息里拿到），不能自己生成，
            // 否则双方各算各的，battleId 根本对不上。
            _battleId = battleId || _genBattleId();

            // 优先用刚传进来的对方资料；没传(比如重赛时内部直接调用)就用上一局
            // 已经存下来的；两者都没有(比如单设备自测、hello还没收到)才兜底用自己的。
            _opponentProfile = opponentProfile || _opponentProfile || _buildLocalProfile();
            const selfProfile = _buildLocalProfile();

            state.pvpBattle = {
                active:   true,
                paused:   false,
                role,
                battleId: _battleId,
                self:     _makeSideState(selfProfile.maxHp),
                opponent: {
                    ..._makeSideState(_opponentProfile.maxHp),
                    displayName: _opponentProfile.level != null ? `对手 Lv.${_opponentProfile.level}` : '对手',
                    level: _opponentProfile.level,
                    chargeProgress: 0
                },
                net:      { clockOffset: pvpNet.clockOffset, rtt: pvpNet.rtt },
                log:      []
            };

            _lastTime = performance.now();
            _rAF = requestAnimationFrame(_loop);

            uiPvp.initFighters();
            ui.switchTab('pvp-battle');
        },

        // 给 pvp_room.js 在连接建立时通过 hello 消息发给对方用的——
        // 对方拿到这份数据后传进它自己那边的 startPVP(role, opponentProfile, battleId)
        getMyCombatProfile() {
            return _buildLocalProfile();
        },

        // 给 pvp_room.js 比对"我们俩是不是在同一场对局里"用，以及发 fight_start
        // 时附带这个id给 guest
        getCurrentBattleId() {
            return _battleId;
        },

        receiveMessage: _handleNetMessage,

        onChargePress()   { _onChargePress(Date.now());   _startChargeSync(); },
        onChargeRelease() { _onChargeRelease(Date.now()); _stopChargeSync();  },
        onGuardPress()    { _onGuardPress(Date.now());    },
        onGuardRelease()  { _onGuardRelease();            },

        requestRematch() {
            if (_rematchRequestedBySelf) return;
            _rematchRequestedBySelf = true;
            // 只有 host 有资格"提案"battleId（host才是判定权威）；guest发起
            // 请求时不提案，等 host accept 时再统一生成。
            const battleId = (pvpNet.role === 'host') ? _genBattleId() : null;
            if (battleId) _pendingRematchBattleId = battleId;
            pvpNet.send({ msg: 'rematch_request', profile: _buildLocalProfile(), battleId });
            uiPvp.showRematchWaiting();
        },

        acceptRematch() {
            _rematchRequestedBySelf = false;
            const battleId = (pvpNet.role === 'host') ? _genBattleId() : _pendingRematchBattleId;
            pvpNet.send({ msg: 'rematch_accept', profile: _buildLocalProfile(), battleId });
            this.startPVP(pvpNet.role, null, battleId);
        },

        abortToLobby() {
            if (_rAF) { cancelAnimationFrame(_rAF); _rAF = null; }
            _stopChargeSync();
            _rematchRequestedBySelf = false;
            if (state.pvpBattle) state.pvpBattle.active = false;
            _battleId = null;
            uiPvp.hideResult();
            uiPvp.hideRematchRequest();
        },
    };
})();