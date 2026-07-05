// combat_resolver.js - Shared combat core used by both PVP and PVE.
// Pure logic: no DOM, no network, no global game-state writes. The judgment
// (resolveExchange) reads the two side-state objects and returns a result;
// applying HP/stun/log/fx is the caller's job (pvp_logic broadcasts it to the
// Guest, pve_logic applies it locally).

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

const combatResolver = (() => {

    function _lerp(a, b, t) { return a + (b - a) * t; }

    function calcChargeDamage(chargeMs, atk) {
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

    function applyDefense(rawDmg, def) {
        // Flat reduction: each point of def blocks 0.15 damage, capped at
        // 20% of raw damage -- keeps def's effect mild, atk stays dominant
        const reduction = Math.min(rawDmg * 0.20, def * 0.15);
        return Math.max(1, Math.round(rawDmg - reduction));
    }

    function parryWindow(judgmentMultiplier) {
        return pvpConfig.parryWindowMs * (judgmentMultiplier || 1);
    }

    function apRecoveryMs(spd) {
        return pvpConfig.apRecoveryMs * (10 / (spd || 10));
    }

    // ── Exchange judgment (pure) ─────────────────────────────────────────
    // attacker/defender are side-state objects (see _makeSideState);
    // attackerStats/defenderStats are combat profiles
    // { atk, def, judgmentMultiplier, guardDamageMultiplier }.
    // wallNow is Date.now() at the call site -- lastStrikeT/lastGuardReadyT
    // are wall-clock stamps recorded on the judging machine, so the deltas
    // stay on one consistent local clock (see pvp_logic's clock-sync notes).
    // Reads state, writes NOTHING; the caller applies the returned result.
    function resolveExchange(attackerChargeMs, attacker, defender,
                             attackerStats, defenderStats, wallNow) {
        const rawDmg = calcChargeDamage(attackerChargeMs, attackerStats.atk);

        const isClash  = defender.phase === 'strike_out' &&
                         (wallNow - defender.lastStrikeT) <= pvpConfig.clashWindowMs;
        const timeSinceGuard = defender.lastGuardReadyT > 0
            ? (wallNow - defender.lastGuardReadyT) : Infinity;
        const isParry  = !isClash && defender.phase === 'guard_ready' &&
                         timeSinceGuard <= parryWindow(defenderStats.judgmentMultiplier);
        const isBlock  = !isClash && defender.phase === 'guard_ready' && !isParry;
        // Defender is mid-charge and gets hit by an attack that isn't a
        // clash/parry/block -- this counts as an interrupt: their charge is
        // forcibly cancelled (defenderStunMs knocks them out of 'charging')
        // on top of taking the hit.
        const isInterrupt = !isClash && !isParry && !isBlock && defender.phase === 'charging';

        // attackerDmg: damage the attacker takes (clash/parry can hurt the attacker too)
        // defenderDmg: damage the defender takes
        // logText: a ready-to-display string, no further translation needed
        let attackerDmg, defenderDmg, attackerStunMs, defenderStunMs, exchange, logText;

        if (isClash) {
            const defChargeMs = defender.lastChargeMs || pvpConfig.earlyReleaseMs;
            attackerDmg   = applyDefense(Math.round(calcChargeDamage(defChargeMs, defenderStats.atk) * 0.5), attackerStats.def);
            defenderDmg   = applyDefense(Math.round(rawDmg * 0.5), defenderStats.def);
            attackerStunMs = pvpConfig.clashRecoveryMs;
            defenderStunMs = pvpConfig.clashRecoveryMs;
            exchange  = 'clash';
            logText   = `💥 对撞！双方各受伤害`;
        } else if (isParry) {
            const counterDmg = Math.max(1, Math.round(rawDmg * 0.5));
            attackerDmg    = applyDefense(counterDmg, attackerStats.def);
            defenderDmg    = 0;
            attackerStunMs = pvpConfig.parryStunMs;
            defenderStunMs = 0;
            exchange   = 'parry';
            logText    = `✨ 弹反！反击 ${attackerDmg} 点，攻击方硬直`;
        } else if (isBlock) {
            const guardMult  = defenderStats.guardDamageMultiplier;
            const blockedDmg = Math.max(1, Math.round(applyDefense(rawDmg, defenderStats.def) * 0.4 * guardMult));
            attackerDmg    = 0;
            defenderDmg    = blockedDmg;
            attackerStunMs = 0;
            defenderStunMs = 150;
            exchange   = 'blocked';
            logText    = `🛡️ 格挡！减为 ${defenderDmg} 点伤害`;
        } else if (isInterrupt) {
            attackerDmg    = 0;
            defenderDmg    = applyDefense(rawDmg, defenderStats.def);
            attackerStunMs = 0;
            defenderStunMs = pvpConfig.interruptStunMs;
            exchange   = 'interrupt';
            logText    = `⚡ 打断！蓄力被打断，受到 ${defenderDmg} 点伤害`;
        } else {
            attackerDmg    = 0;
            defenderDmg    = applyDefense(rawDmg, defenderStats.def);
            attackerStunMs = 0;
            defenderStunMs = 0;
            exchange   = 'hit';
            logText    = `⚔️ 命中！造成 ${defenderDmg} 点伤害`;
        }

        return { exchange, attackerDmg, defenderDmg, attackerStunMs, defenderStunMs, logText };
    }

    return {
        makeSideState: _makeSideState,
        calcChargeDamage, applyDefense, parryWindow, apRecoveryMs,
        resolveExchange
    };
})();
