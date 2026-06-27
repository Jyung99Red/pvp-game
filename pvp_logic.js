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

    // ── Helpers ──────────────────────────────────────────────────────

    function _lerp(a, b, t) { return a + (b - a) * t; }

    function _calcChargeDamage(chargeMs) {
        const atk = player.getStats().atk;
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

    function _applyDefense(rawDmg) {
        // Flat reduction: each def point blocks 0.15 dmg, capped at 20% of raw dmg
        // Result: def has mild effect, atk stays dominant
        const def = player.getStats().def;
        const reduction = Math.min(rawDmg * 0.20, def * 0.15);
        return Math.max(1, Math.round(rawDmg - reduction));
    }

    function _parryWindow() {
        return pvpConfig.parryWindowMs * player.getJudgmentMultiplier();
    }

    function _apRecoveryMs() {
        const spd = player.getStats().spd || 10;
        return pvpConfig.apRecoveryMs * (10 / spd);
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
                side.actionProgress += dt / _apRecoveryMs();
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
            pvpNet.send({ msg: 'action', type: 'charge_release', chargeMs, t: pvpNet.now() });
            _resolveExchange(chargeMs, state.pvpBattle.self, state.pvpBattle.opponent);
        } else {
            pvpNet.send({ msg: 'action', type: 'charge_release', chargeMs, t: pvpNet.now() });
        }
    }

    // ── Exchange resolution (Host only) ──────────────────────────────
    // attacker / defender are the actual state objects (not fixed to host/guest)

    function _resolveExchange(attackerChargeMs, attacker, defender) {
        const rawDmg  = _calcChargeDamage(attackerChargeMs);
        const wallNow = Date.now();

        const isClash  = defender.phase === 'strike_out' &&
                         (wallNow - defender.lastStrikeT) <= pvpConfig.clashWindowMs;
        const timeSinceGuard = defender.lastGuardReadyT > 0
            ? (wallNow - defender.lastGuardReadyT) : Infinity;
        const isParry  = !isClash && defender.phase === 'guard_ready' &&
                         timeSinceGuard <= _parryWindow();
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
            attackerDmg   = _applyDefense(Math.round(_calcChargeDamage(defChargeMs) * 0.5));
            defenderDmg   = _applyDefense(Math.round(rawDmg * 0.5));
            attackerStunMs = pvpConfig.clashRecoveryMs;
            defenderStunMs = pvpConfig.clashRecoveryMs;
            exchange  = 'clash';
            logText   = `💥 对撞！双方各受伤害`;
        } else if (isParry) {
            const counterDmg = Math.max(1, Math.round(rawDmg * 0.5));
            attackerDmg    = _applyDefense(counterDmg);
            defenderDmg    = 0;
            attackerStunMs = pvpConfig.parryStunMs;
            defenderStunMs = 0;
            exchange   = 'parry';
            logText    = `✨ 弹反！反击 ${attackerDmg} 点，攻击方硬直`;
        } else if (isBlock) {
            const guardMult  = player.getGuardDamageMultiplier();
            const blockedDmg = Math.max(1, Math.round(_applyDefense(rawDmg) * 0.4 * guardMult));
            attackerDmg    = 0;
            defenderDmg    = blockedDmg;
            attackerStunMs = 0;
            defenderStunMs = 150;
            exchange   = 'blocked';
            logText    = `🛡️ 格挡！减为 ${defenderDmg} 点伤害`;
        } else {
            attackerDmg    = 0;
            defenderDmg    = _applyDefense(rawDmg);
            attackerStunMs = 0;
            defenderStunMs = 0;
            exchange   = 'hit';
            logText    = `⚔️ 命中！造成 ${defenderDmg} 点伤害`;
        }

        // Determine if the local player (b.self) is the attacker or defender.
        // host always calls this function, so attacker/defender are real objects.
        const b            = state.pvpBattle;
        const selfIsAttacker = (attacker === b.self);

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
        pvpNet.send({
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
            pvpNet.send({ msg: 'fight_end', winner: winner === 'self' ? 'host' : 'guest' });
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
            pvpNet.send({ msg: 'charge_sync', progress });
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

        pvpNet.send({ msg: 'action', type: 'charge_start', t: pvpNet.now() });
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
        pvpNet.send({ msg: 'action', type: 'guard_press', t: pvpNet.now() });
    }

    function _onGuardWindupComplete(side, now) {
        side.actionPoints--;
        side.lastGuardReadyT = now;   // wall-clock, for parry window
        _setPhase(side, 'guard_ready', pvpConfig.guardMaxHoldMs);
        pvpNet.send({ msg: 'action', type: 'guard_ready', t: pvpNet.now() });
    }

    function _onGuardRelease() {
        if (!state.pvpBattle) return;
        const side = state.pvpBattle.self;
        if (side.phase === 'guard_windup' || side.phase === 'guard_ready') {
            _setPhase(side, 'idle', 0);
            side.lastGuardReadyT = 0;
            pvpNet.send({ msg: 'action', type: 'guard_release', t: pvpNet.now() });
        }
    }

    // ── Network message handler ───────────────────────────────────────

    function _handleNetMessage(msg) {
        if (!state.pvpBattle) return;
        const b  = state.pvpBattle;
        const op = b.opponent;

        switch (msg.msg) {
            case 'action': {
                // correctedT aligns the remote timestamp to local wall-clock
                const correctedT = pvpNet.correctRemote(msg.t);

                switch (msg.type) {
                    case 'charge_start':
                        op.chargeStartT = correctedT;
                        op.chargeMs     = 0;
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
                if (_rematchRequestedBySelf) {
                    _rematchRequestedBySelf = false;
                    pvpNet.send({ msg: 'rematch_accept' });
                    pvpLogic.startPVP(pvpNet.role);
                } else {
                    uiPvp.showRematchRequest();
                }
                break;

            case 'rematch_accept':
                _rematchRequestedBySelf = false;
                pvpLogic.startPVP(pvpNet.role);
                break;
        }
    }

    // ── Public API ───────────────────────────────────────────────────

    return {
        startPVP(role) {
            if (_rAF) { cancelAnimationFrame(_rAF); _rAF = null; }
            _stopChargeSync();
            _rematchRequestedBySelf = false;
            uiPvp.hideResult();
            uiPvp.hideRematchRequest();

            const stats = player.getStats();
            state.pvpBattle = {
                active:   true,
                paused:   false,
                role,
                self:     _makeSideState(stats.maxHp),
                opponent: { ..._makeSideState(stats.maxHp), displayName: '对手', chargeProgress: 0 },
                net:      { clockOffset: pvpNet.clockOffset, rtt: pvpNet.rtt },
                log:      []
            };

            pvpNet.on.message = _handleNetMessage;
            _lastTime = performance.now();
            _rAF = requestAnimationFrame(_loop);

            uiPvp.initFighters();
            ui.switchTab('pvp-battle');
        },

        receiveMessage: _handleNetMessage,

        onChargePress()   { _onChargePress(Date.now());   _startChargeSync(); },
        onChargeRelease() { _onChargeRelease(Date.now()); _stopChargeSync();  },
        onGuardPress()    { _onGuardPress(Date.now());    },
        onGuardRelease()  { _onGuardRelease();            },

        requestRematch() {
            if (_rematchRequestedBySelf) return;
            _rematchRequestedBySelf = true;
            pvpNet.send({ msg: 'rematch_request' });
            uiPvp.showRematchWaiting();
        },

        acceptRematch() {
            _rematchRequestedBySelf = false;
            pvpNet.send({ msg: 'rematch_accept' });
            this.startPVP(pvpNet.role);
        },

        abortToLobby() {
            if (_rAF) { cancelAnimationFrame(_rAF); _rAF = null; }
            _stopChargeSync();
            _rematchRequestedBySelf = false;
            if (state.pvpBattle) state.pvpBattle.active = false;
            uiPvp.hideResult();
            uiPvp.hideRematchRequest();
        },

        pauseForDisconnect() {
            if (!state.pvpBattle || !state.pvpBattle.active) return;
            if (_rAF) { cancelAnimationFrame(_rAF); _rAF = null; }
            _stopChargeSync();
            const self = state.pvpBattle.self;
            if (['charging', 'guard_windup', 'guard_ready'].includes(self.phase)) {
                _setPhase(self, 'idle', 0);
                self.chargeMs        = 0;
                self.chargeStartT    = 0;
                self.lastGuardReadyT = 0;
            }
            state.pvpBattle.paused = true;
        },

        resumeAfterReconnect() {
            if (!state.pvpBattle || !state.pvpBattle.active) return;
            state.pvpBattle.paused = false;
            pvpNet.on.message = _handleNetMessage;
            _lastTime = performance.now();
            if (!_rAF) _rAF = requestAnimationFrame(_loop);
        }
    };
})();
