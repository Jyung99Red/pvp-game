// pvp_logic.js - PVP battle engine: state machine + damage formulas + Host judgment authority + network message handling
// Hard constraints:
//   - No document.* calls, pure logic layer, never touches the DOM
//   - Frame advancement relies on the external tick's (now, dt), not on reading
//     Date.now() inside the main loop -- EXCEPT lastStrikeT / lastGuardReadyT,
//     the two timestamps used specifically for clash/parry window checks.
//     Those intentionally read Date.now() directly and skip network clock
//     correction; see the comments at the matching spots in _fireCharge /
//     _handleNetMessage for why.
//   - Host is the sole judgment authority; every exchange result is computed
//     in this file's _resolveExchange
//   - Guest never judges locally, it only mirrors state from the Host's
//     broadcast result messages

const pvpConfig = {
    // Charge attack
    chargeMaxMs:       3000,
    earlyReleaseMs:    500,
    earlyReleaseDmg:   1,

    // Defense
    guardWindupMs:     300,   // Guard startup delay before guard_ready actually engages
    guardMaxHoldMs:    2000,  // Max hold duration; auto-cancels back to idle past this
    parryWindowMs:     200,   // Base perfect-parry window, scaled by judgmentMultiplier

    // Phase timers
    strikeRecoveryMs:  300,
    parryStunMs:       1000,  // Stun duration applied to the attacker after being parried
    clashRecoveryMs:   600,
    interruptStunMs:   250,   // Stun duration applied to a defender whose charge gets interrupted by an incoming hit

    // AP (action points)
    apMax:             3,
    apRecoveryMs:      2000,  // Base recovery time per AP point, scaled by 10/spd

    // Clash detection window, fixed value, not affected by any stat
    clashWindowMs:     100
};

// ── State initialiser ────────────────────────────────────────────────────

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
        lastStrikeT:   0,   // Wall-clock time (Date.now()) when strike_out last began; clash detection
        lastChargeMs:  0,   // Charge duration of the last fired attack; used for clash damage calc
        lastGuardReadyT: 0  // Wall-clock time (Date.now()) when guard became ready; parry detection
    };
}

// PHASES: idle | charging | strike_out | strike_recover |
//         guard_windup | guard_ready | stunned
// Parry/block outcomes both resolve through 'stunned' (with different
// durations); see the `exchange` result type in _resolveExchange below for
// the actual hit/block/parry/clash outcome.

const pvpLogic = (() => {
    let _rAF  = null;
    let _lastTime = 0;
    let _rematchRequestedBySelf = false;

    // A snapshot of the opponent's real combat stats (atk/def/spd/maxHp +
    // derived multipliers), sent over by pvp_room.js via the 'hello' message
    // when the connection is established, then passed into startPVP(). Until
    // real data arrives, this falls back to the local player's own stats so
    // nothing throws (also makes single-device self-testing work).
    //
    // Background: before this was fixed, _calcChargeDamage / _applyDefense /
    // _apRecoveryMs / _parryWindow all called player.getStats() directly --
    // that function always reads "the character on this device", regardless
    // of whether the calculation was actually for the opponent's attack or
    // defense. The result: no matter who attacked, damage was computed from
    // the judging side's (Host's) own local atk/def, completely disconnected
    // from the real attacker's level/gear, and the opponent's level/max HP
    // shown in the UI were just fake numbers mirrored from the local character.
    let _opponentProfile = null;

    // The unique id of the current battle. A fresh one is generated on every
    // startPVP() call (Host generates it, Guest receives the same one via the
    // fight_start/rematch_accept message), and every in-battle network
    // message carries it. More reliable than "each side reports a boolean and
    // we guess whether state is consistent" -- whether the cause is a page
    // refresh + reconnect, out-of-order delivery, or some other edge case we
    // haven't hit yet, a mismatched id is simply a mismatch; no need to write
    // a separate check for every concrete scenario.
    let _battleId = null;
    let _pendingRematchBattleId = null; // The id the opponent proposed in rematch_request (only set when they're Host)

    function _genBattleId() {
        return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    // All in-battle messages (action / charge_sync / result / fight_end) go
    // out through here, which automatically attaches the current battleId --
    // so no individual send site has to remember to add that field itself.
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

    // ── Helpers ──────────────────────────────────────────────────────────

    function _lerp(a, b, t) { return a + (b - a) * t; }

    function _calcChargeDamage(chargeMs, atk) {
        // Charge < 500ms: fixed 1 damage (penalty for "tap-attack" rushing)
        if (chargeMs < pvpConfig.earlyReleaseMs) return pvpConfig.earlyReleaseDmg;
        // 500ms -> 3000ms: linear interpolation 0.3x atk -> 1.1x atk
        const t = Math.min(
            (chargeMs - pvpConfig.earlyReleaseMs) /
            (pvpConfig.chargeMaxMs - pvpConfig.earlyReleaseMs),
            1.0
        );
        const ratio = _lerp(0.3, 1.1, t);
        return Math.max(1, Math.round(atk * ratio));
    }

    function _applyDefense(rawDmg, def) {
        // Flat reduction: each point of def blocks 0.15 damage, capped at
        // 20% of raw damage -- keeps def's effect mild, atk stays dominant
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

    // ── Tick: advance one side's (self or opponent) state by one frame ───

    function _tickSide(side, dt, now, isSelf) {
        // AP recovery (paused while charging or guarding)
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

        // Phase auto-transitions when the timer hits 0
        if (side.phaseTimer === 0) {
            switch (side.phase) {
                case 'strike_out':     _setPhase(side, 'strike_recover', pvpConfig.strikeRecoveryMs); break;
                case 'strike_recover': _setPhase(side, 'idle', 0); break;
                case 'guard_windup':   _setPhase(side, 'idle', 0); break;
                case 'guard_ready':    _setPhase(side, 'idle', 0); break;
                case 'stunned':        _setPhase(side, 'idle', 0); break;
            }
        }

    }

    // ── Fire charge (charge finished, either released early or auto-fired at 3s) ──

    function _fireCharge(side, isAuto) {
        const chargeMs    = isAuto ? pvpConfig.chargeMaxMs : side.chargeMs;
        console.log('[pvp] fireCharge: chargeMs=', chargeMs, 'isAuto=', isAuto, 'role=', pvpNet.role);
        side.lastChargeMs = chargeMs;
        side.chargeMs     = 0;
        side.chargeStartT = 0;
        // Uses local Date.now() directly here, not pvpNet.now()/correctRemote's
        // network-aligned time -- lastStrikeT is only ever compared against
        // "a timestamp received locally on this machine" (see the isClash
        // check in _resolveExchange and the same-named field on the op side
        // in _handleNetMessage). As long as both sides each consistently use
        // their own local wall clock, the resulting time delta is self-consistent
        // and won't be skewed by clock-sync error or the window before sync
        // completes -- belt and suspenders.
        side.lastStrikeT  = Date.now();
        _setPhase(side, 'strike_out', 16);

        if (pvpNet.role === 'host') {
            // Host is the judgment authority and doesn't need this message to
            // judge its own side (it calls _resolveExchange directly below),
            // but the Guest's view of "the opponent" is entirely driven by
            // network messages -- if this charge_release isn't broadcast, the
            // Guest will see Host stuck on the last "charging" state received
            // via charge_sync until the next action message overwrites it.
            // Sending one here reuses the receive-side handling already
            // verified correct for Guest attacks (the 'charge_release' case
            // in _handleNetMessage).
            _sendBattleMsg({ msg: 'action', type: 'charge_release', chargeMs, t: pvpNet.now() });
            _resolveExchange(chargeMs, state.pvpBattle.self, state.pvpBattle.opponent);
        } else {
            // Guest never judges locally -- it just forwards the action to
            // Host, whose _handleNetMessage calls _resolveExchange and
            // broadcasts the result back via a 'result' message
            _sendBattleMsg({ msg: 'action', type: 'charge_release', chargeMs, t: pvpNet.now() });
        }
    }

    // ── Exchange resolution (Host only) ───────────────────────────────────
    // attacker / defender are real state object references (self or opponent),
    // not hardcoded to host/guest -- whoever fired the attack is the attacker,
    // regardless of role

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
        // Defender is mid-charge and gets hit by an attack that isn't a
        // clash/parry/block -- this counts as an interrupt: their charge is
        // forcibly cancelled (defenderStunMs below knocks them out of the
        // 'charging' phase) on top of taking the hit. The AP they already
        // spent pressing charge is simply gone, same as any other attack
        // that landed -- no separate AP bookkeeping needed here.
        const isInterrupt = !isClash && !isParry && !isBlock && defender.phase === 'charging';

        console.log('[pvp] resolveExchange: atkCharge=', attackerChargeMs,
            'defPhase=', defender.phase,
            'defLastStrike=', defender.lastStrikeT,
            'wallNow=', wallNow,
            'Δstrike=', defender.lastStrikeT ? wallNow - defender.lastStrikeT : '∞',
            '→', isClash ? 'CLASH' : isParry ? 'PARRY' : isBlock ? 'BLOCK' : isInterrupt ? 'INTERRUPT' : 'HIT');

        // ── Result fields ───────────────────────────────────────────────
        // attackerDmg: damage the attacker takes (clash/parry can hurt the attacker too)
        // defenderDmg: damage the defender takes
        // logText: a ready-to-display string, no further translation needed

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
        } else if (isInterrupt) {
            attackerDmg    = 0;
            defenderDmg    = _applyDefense(rawDmg, defenderStats.def);
            attackerStunMs = 0;
            defenderStunMs = pvpConfig.interruptStunMs;
            exchange   = 'interrupt';
            logText    = `⚡ 打断！蓄力被打断，受到 ${defenderDmg} 点伤害`;
        } else {
            attackerDmg    = 0;
            defenderDmg    = _applyDefense(rawDmg, defenderStats.def);
            attackerStunMs = 0;
            defenderStunMs = 0;
            exchange   = 'hit';
            logText    = `⚔️ 命中！造成 ${defenderDmg} 点伤害`;
        }

        // Whether the local player (b.self) is the attacker or the defender --
        // _resolveExchange is only ever called on the Host side, so attacker/
        // defender here are real state object references
        const selfIsAttacker = attackerIsSelf;

        // Apply HP
        attacker.hp = Math.max(0, attacker.hp - attackerDmg);
        defender.hp = Math.max(0, defender.hp - defenderDmg);

        // Apply stuns
        if (attackerStunMs > 0) _setPhase(attacker, 'stunned', attackerStunMs);
        if (defenderStunMs > 0) _setPhase(defender, 'stunned', defenderStunMs);

        // Log it (Host side)
        _pushLog(logText);

        // Play the fx first, even for a killing blow -- if we returned early
        // below because HP hit 0, the Guest wouldn't even receive this result
        // message, meaning they'd never see the final hit's fx and would jump
        // straight to the result screen. So: play first, broadcast, and only
        // then check for death.
        uiPvp.playExchangeFx(exchange, selfIsAttacker);

        // Broadcast to Guest -- includes everything Guest needs to apply
        // HP/log/fx. attackerIsHost lets the Guest side correctly translate
        // "did I attack, or did the opponent".
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

        // Death check goes after the broadcast, to make sure the killing
        // blow's fx/log have already reached the Guest before ending the fight
        if (attacker.hp <= 0 || defender.hp <= 0) {
            _endBattle();
            return;
        }
    }

    // ── Apply result on the Guest side ─────────────────────────────────────

    function _applyResultGuest(msg) {
        const b = state.pvpBattle;
        // Host sends absolute HP values -- Guest applies them directly, no
        // delta math or translation needed
        b.self.hp     = msg.guestHp;
        b.opponent.hp = msg.hostHp;

        if (msg.guestStunMs > 0) _setPhase(b.self,     'stunned', msg.guestStunMs);
        if (msg.hostStunMs  > 0) _setPhase(b.opponent, 'stunned', msg.hostStunMs);

        _pushLog(msg.logText);
        uiPvp.playExchangeFx(msg.exchange, !msg.attackerIsHost);

        if (b.self.hp <= 0 || b.opponent.hp <= 0) _endBattle();
    }

    // ── Log ─────────────────────────────────────────────────────────────

    function _pushLog(text) {
        const log = state.pvpBattle.log;
        log.unshift(text);
        if (log.length > 20) log.pop();
    }

    // ── Battle lifecycle ──────────────────────────────────────────────────

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

    // ── Charge progress sync (broadcast to the opponent every 100ms) ──────

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

    // ── Main loop (driven by requestAnimationFrame) ────────────────────────

    function _loop(currentTime) {
        if (!state.pvpBattle || !state.pvpBattle.active) return;
        const dt  = Math.min(currentTime - _lastTime, 100); // Cap per-frame dt to avoid big jumps after a tab switch / lag spike
        _lastTime = currentTime;
        const now = Date.now();
        const b   = state.pvpBattle;

        // The guard_windup -> guard_ready transition has to fire before
        // _tickSide zeroes the timer this frame, otherwise it's one frame
        // late and the guard_ready logic (e.g. the ready timestamp) lags behind
        if (b.self.phase === 'guard_windup' && b.self.phaseTimer <= dt) {
            _onGuardWindupComplete(b.self, now);
        }

        _tickSide(b.self,     dt, now, true);
		_tickSide(b.opponent, dt, now, false);

        uiPvp.updateFrame();

        _rAF = requestAnimationFrame(_loop);
    }

    // ── Input handlers (called from the UI's button events) ───────────────

    function _onChargePress(now) {
        const side = state.pvpBattle && state.pvpBattle.self;
        console.log('[pvp] chargePress: phase=', side?.phase, 'AP=', side?.actionPoints);
        if (!state.pvpBattle) return;
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
        if (!state.pvpBattle) return;
        const side = state.pvpBattle.self;
        if (side.phase === 'charging') return;
        if (side.phase !== 'idle')     return;
        if (side.actionPoints < 1)     return;

        _setPhase(side, 'guard_windup', pvpConfig.guardWindupMs);
        _sendBattleMsg({ msg: 'action', type: 'guard_press', t: pvpNet.now() });
    }

    function _onGuardWindupComplete(side, now) {
        side.actionPoints--;
        side.lastGuardReadyT = now;   // Wall-clock time, used for the parry window
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

    // ── Network message handler (called on both Guest and Host, branches by role) ──

    function _handleNetMessage(msg) {
        if (!state.pvpBattle) return;
        const b  = state.pvpBattle;
        const op = b.opponent;

        // action/charge_sync/result/fight_end are all messages scoped to "one
        // specific battle" -- check battleId first; a mismatch means this
        // message came from a state we're no longer in (the opponent
        // refreshed and reconnected, the message was delayed past the start
        // of a new battle... whatever the specific cause), so just drop it
        // rather than guessing how to force-fit it onto the current battle.
        const BATTLE_SCOPED = { action: 1, charge_sync: 1, result: 1, fight_end: 1, surrender: 1 };
        if (BATTLE_SCOPED[msg.msg] && msg.battleId !== _battleId) {
            console.warn('[pvp] dropping message with mismatched battleId:', msg.msg, msg.battleId, 'current=', _battleId);
            return;
        }

        switch (msg.msg) {
            case 'action': {
                // correctedT converts the remote timestamp into its local wall-clock equivalent
                const correctedT = pvpNet.correctRemote(msg.t);

                switch (msg.type) {
                    case 'charge_start':
                        op.chargeStartT   = correctedT;
                        op.chargeMs       = 0;
                        // Clear out any leftover progress from the previous
                        // charge cycle (e.g. it was at 100% right before being
                        // released) -- otherwise the first frame of the new
                        // charge would briefly show that stale value until the
                        // next charge_sync message (~100ms later) refreshes it
                        // to the real progress, visually flashing a full bar
                        // before snapping back down.
                        op.chargeProgress = 0;
                        _setPhase(op, 'charging', 0);
                        break;

                    case 'charge_release':
                        op.lastChargeMs = msg.chargeMs;
                        // Same as elsewhere: use local Date.now() rather than
                        // correctedT, so clash detection (wallNow - lastStrikeT)
                        // is computed on one consistent local clock on each
                        // side, without introducing network clock-sync error.
                        op.lastStrikeT  = Date.now();
                        _setPhase(op, 'strike_out', 16);

                        if (pvpNet.role === 'host') {
                            // Guest attacked -> Guest is the attacker, Host (self) is the defender
                            _resolveExchange(msg.chargeMs, b.opponent, b.self);
                        }
                        break;

                    case 'guard_press':
                        _setPhase(op, 'guard_windup', pvpConfig.guardWindupMs);
                        break;

                    case 'guard_ready':
                        // Consistent with how charge_release handles lastStrikeT:
                        // use the local Date.now() at receive time, not
                        // correctedT derived from cross-device clock sync.
                        // Any drift in correctRemote -- even just a couple
                        // hundred ms -- would make timeSinceGuard come out
                        // tiny or even negative, causing an attack to be
                        // misjudged as a parry no matter how long the
                        // opponent had actually been guarding.
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

            // Unlike fight_end, this isn't a Host-arbitrated judgment --
            // whoever surrenders unilaterally declares themselves the
            // loser, so both Host and Guest handle it the same way here.
            case 'surrender':
                _onFightEnd('self');
                break;

            case 'rematch_request':
                if (msg.profile) _opponentProfile = msg.profile;
                _pendingRematchBattleId = msg.battleId || null;
                if (_rematchRequestedBySelf) {
                    // Both sides hit "rematch" at almost the same time --
                    // defer to whichever id Host generated. On the Guest side
                    // this uses the proposal just recorded above (not fully
                    // bulletproof; in rare cases the two sides could still end
                    // up with different ids, but as long as they differ, the
                    // next battle message gets dropped by the battleId check
                    // above and the mismatch is visible -- never silently
                    // miscalculated. That's the floor this mechanism is meant
                    // to guarantee).
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

    // ── Public API ──────────────────────────────────────────────────────

    return {
        startPVP(role, opponentProfile, battleId) {
            if (_rAF) { cancelAnimationFrame(_rAF); _rAF = null; }
            _stopChargeSync();
            _rematchRequestedBySelf = false;
            uiPvp.hideResult();
            uiPvp.hideRematchRequest();

            // Host generates a fresh id when none was passed in; Guest must
            // use the one it was given (from fight_start / rematch_accept) --
            // it can't generate its own, or the two sides would never agree
            // on a battleId.
            _battleId = battleId || _genBattleId();

            // Prefer the opponent profile just passed in; if none was given
            // (e.g. an internal call during a rematch), fall back to whatever
            // was saved from the previous battle; if neither is available
            // (single-device self-testing, or hello hasn't arrived yet), fall
            // back to the local player's own stats.
            _opponentProfile = opponentProfile || _opponentProfile || _buildLocalProfile();
            const selfProfile = _buildLocalProfile();

            state.pvpBattle = {
                active:   true,
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

        // Used by pvp_room.js to send to the opponent via the 'hello' message
        // once a connection is established -- the opponent passes this data
        // into their own startPVP(role, opponentProfile, battleId)
        getMyCombatProfile() {
            return _buildLocalProfile();
        },

        // Used by pvp_room.js to check "are we both in the same battle",
        // and attached to the fight_start message sent to Guest
        getCurrentBattleId() {
            return _battleId;
        },

        receiveMessage: _handleNetMessage,

        onChargePress()   { _onChargePress(Date.now());   _startChargeSync(); },
        onChargeRelease() { _onChargeRelease(Date.now()); _stopChargeSync();  },
        onGuardPress()    { _onGuardPress(Date.now());    },
        onGuardRelease()  { _onGuardRelease();            },

        surrender() {
            const b = state.pvpBattle;
            if (!b || !b.active) return;
            if (!confirm('确定要投降认输吗？这场对战将直接判负')) return;
            _sendBattleMsg({ msg: 'surrender' });
            _onFightEnd('opponent');
        },

        requestRematch() {
            if (_rematchRequestedBySelf) return;
            _rematchRequestedBySelf = true;
            // Only Host is allowed to "propose" a battleId (Host is the
            // judgment authority); when Guest initiates the request it
            // doesn't propose one, and waits for Host to generate it on accept.
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