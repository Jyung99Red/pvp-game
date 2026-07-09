// combat_resolver.js - Shared combat core used by both PVP and PVE.
// Pure logic: no DOM, no network, no global game-state writes. The judgment
// (resolveExchange) reads the two side-state objects and returns a result;
// applying HP/stun/log/fx is the caller's job (pvp_logic broadcasts it to the
// Guest, pve_logic applies it locally).

const pvpConfig = {
    // Charge attack
    chargeMaxMs:       2000,
    earlyReleaseMs:    300,
    earlyReleaseDmg:   1,

    // Defense
    guardWindupMs:     200,   // Guard startup delay before guard_ready actually engages
    guardMaxHoldMs:    2000,  // Max hold duration; auto-cancels back to idle past this
    parryWindowMs:     200,   // Base perfect-parry window, scaled by judgmentMultiplier

    // Phase timers
    strikeRecoveryMs:  300,
    parryStunMs:       1000,  // Stun duration applied to the attacker after being parried
    clashRecoveryMs:   600,
    interruptStunMs:   300,   // Stun duration applied to a defender whose charge gets interrupted by an incoming hit

    // AP (action points)
    apMax:             5,
    apRecoveryMs:      2000,  // Base recovery time per AP point, scaled by 10/spd

    // Crit (rolled on clean hits/interrupts; chance comes from the
    // attacker's profile: luck stat + crit_chance item effects)
    critMult:          1.5,

    // Clash detection window, fixed value, not affected by any stat
    clashWindowMs:     100
};

// ── State initialiser ────────────────────────────────────────────────────

function _makeSideState(maxHp, apMax = pvpConfig.apMax) {
    return {
        hp:            maxHp,
        maxHp,
        phase:         'idle',
        phaseTimer:    0,
        chargeStartT:  0,
        chargeMs:      0,
        actionPoints:  apMax,
        apMax,
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

    function calcChargeDamage(chargeMs, atk, earlyReleaseMs = pvpConfig.earlyReleaseMs) {
        // Charge < threshold: fixed 1 damage (penalty for "tap-attack" rushing)
        if (chargeMs < earlyReleaseMs) return pvpConfig.earlyReleaseDmg;
        // threshold -> 3000ms: linear interpolation 0.3x atk -> 1.1x atk
        const t = Math.min(
            (chargeMs - earlyReleaseMs) /
            (pvpConfig.chargeMaxMs - earlyReleaseMs),
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

    function parryWindow(judgmentMultiplier, baseMs = pvpConfig.parryWindowMs) {
        return baseMs * (judgmentMultiplier || 1);
    }

    function apRecoveryMs(spd) {
        return pvpConfig.apRecoveryMs * (10 / (spd || 10));
    }

    // ── Exchange rule registry ───────────────────────────────────────────
    // Each rule: { name, priority, when(ctx), resolve(ctx) }.
    // resolveExchange walks the rules in descending priority and applies the
    // first whose when(ctx) returns true; equal priorities keep registration
    // order. The built-in judgments are registered below (clash 400 > parry
    // 300 > block 200 > interrupt 100 > hit 0); a new mechanic is one
    // registerExchangeRule() call, no resolver edit needed. Later rules can
    // rely on earlier ones having NOT matched (e.g. block only sees
    // guard_ready cases that fell outside the parry window).
    //
    // ctx (read-only for rules): { chargeMs, rawDmg, attacker, defender,
    //   attackerStats, defenderStats, wallNow }.
    // A rule's resolve() must return the full result shape:
    //   { exchange, attackerDmg, defenderDmg, attackerStunMs, defenderStunMs,
    //     logText, crit }
    // -- the result travels verbatim over the PVP `result` message, so any
    // extra fields a custom rule adds will reach the Guest too.

    const _rules = [];

    function registerExchangeRule(rule) {
        _rules.push(rule);
        _rules.sort((a, b) => b.priority - a.priority);
    }

    function _rollCrit(stats) {
        return Math.random() < (stats.critChance || 0);
    }

    registerExchangeRule({
        name: 'clash', priority: 400,
        when(ctx) {
            return ctx.defender.phase === 'strike_out' &&
                   (ctx.wallNow - ctx.defender.lastStrikeT) <= pvpConfig.clashWindowMs;
        },
        resolve(ctx) {
            const defChargeMs = ctx.defender.lastChargeMs || ctx.defenderStats.earlyReleaseMs;
            const attackerDmg = applyDefense(
                Math.round(calcChargeDamage(defChargeMs, ctx.defenderStats.atk, ctx.defenderStats.earlyReleaseMs) * 0.5),
                ctx.attackerStats.def);
            const defenderDmg = applyDefense(Math.round(ctx.rawDmg * 0.5), ctx.defenderStats.def);
            return {
                exchange: 'clash', attackerDmg, defenderDmg,
                attackerStunMs: pvpConfig.clashRecoveryMs,
                defenderStunMs: pvpConfig.clashRecoveryMs,
                logText: `💥 对撞！双方各受伤害`, crit: false
            };
        }
    });

    registerExchangeRule({
        name: 'parry', priority: 300,
        when(ctx) {
            if (ctx.defender.phase !== 'guard_ready') return false;
            const timeSinceGuard = ctx.defender.lastGuardReadyT > 0
                ? (ctx.wallNow - ctx.defender.lastGuardReadyT) : Infinity;
            return timeSinceGuard <= parryWindow(
                ctx.defenderStats.judgmentMultiplier, ctx.defenderStats.parryWindowBaseMs);
        },
        resolve(ctx) {
            const counterDmg  = Math.max(1, Math.round(ctx.rawDmg * 0.5));
            const attackerDmg = applyDefense(counterDmg, ctx.attackerStats.def);
            return {
                exchange: 'parry', attackerDmg, defenderDmg: 0,
                attackerStunMs: pvpConfig.parryStunMs, defenderStunMs: 0,
                logText: `✨ 弹反！反击 ${attackerDmg} 点，攻击方硬直`, crit: false
            };
        }
    });

    registerExchangeRule({
        // guard_ready outside the parry window (parry already claimed the
        // inside-window case at higher priority)
        name: 'block', priority: 200,
        when(ctx) { return ctx.defender.phase === 'guard_ready'; },
        resolve(ctx) {
            const guardMult  = ctx.defenderStats.guardDamageMultiplier;
            const blockedDmg = Math.max(1, Math.round(
                applyDefense(ctx.rawDmg, ctx.defenderStats.def) * 0.4 * guardMult));
            // Thorns (guard_thorns effect): a successful block reflects a
            // share of the attack's raw damage back at the attacker
            const thorns      = ctx.defenderStats.guardThorns || 0;
            const attackerDmg = thorns > 0
                ? applyDefense(Math.round(ctx.rawDmg * thorns), ctx.attackerStats.def) : 0;
            return {
                exchange: 'blocked', attackerDmg, defenderDmg: blockedDmg,
                attackerStunMs: 0, defenderStunMs: 150,
                logText: `🛡️ 格挡！减为 ${blockedDmg} 点伤害` +
                         (attackerDmg > 0 ? `，🌵 荆棘反伤 ${attackerDmg} 点` : ''),
                crit: false
            };
        }
    });

    registerExchangeRule({
        // Defender is mid-charge and gets hit by an attack that isn't a
        // clash/parry/block -- this counts as an interrupt: their charge is
        // forcibly cancelled (defenderStunMs knocks them out of 'charging')
        // on top of taking the hit.
        name: 'interrupt', priority: 100,
        when(ctx) { return ctx.defender.phase === 'charging'; },
        resolve(ctx) {
            const crit = _rollCrit(ctx.attackerStats);
            let defenderDmg = applyDefense(ctx.rawDmg, ctx.defenderStats.def);
            if (crit) defenderDmg = Math.round(defenderDmg * pvpConfig.critMult);
            return {
                exchange: 'interrupt', attackerDmg: 0, defenderDmg,
                attackerStunMs: 0, defenderStunMs: pvpConfig.interruptStunMs,
                logText: crit
                    ? `💥 暴击打断！蓄力被打断，受到 ${defenderDmg} 点伤害`
                    : `⚡ 打断！蓄力被打断，受到 ${defenderDmg} 点伤害`,
                crit
            };
        }
    });

    registerExchangeRule({
        // Clean hit -- the always-true fallback at the bottom of the chain
        name: 'hit', priority: 0,
        when() { return true; },
        resolve(ctx) {
            const crit = _rollCrit(ctx.attackerStats);
            let defenderDmg = applyDefense(ctx.rawDmg, ctx.defenderStats.def);
            if (crit) defenderDmg = Math.round(defenderDmg * pvpConfig.critMult);
            return {
                exchange: 'hit', attackerDmg: 0, defenderDmg,
                attackerStunMs: 0, defenderStunMs: 0,
                logText: crit
                    ? `💥 暴击！造成 ${defenderDmg} 点伤害`
                    : `⚔️ 命中！造成 ${defenderDmg} 点伤害`,
                crit
            };
        }
    });

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
        const ctx = {
            chargeMs: attackerChargeMs,
            rawDmg: calcChargeDamage(attackerChargeMs, attackerStats.atk, attackerStats.earlyReleaseMs),
            attacker, defender, attackerStats, defenderStats, wallNow
        };
        for (const rule of _rules) {
            if (rule.when(ctx)) return rule.resolve(ctx);
        }
        // Unreachable: the built-in 'hit' rule always matches
    }

    return {
        makeSideState: _makeSideState,
        calcChargeDamage, applyDefense, parryWindow, apRecoveryMs,
        resolveExchange, registerExchangeRule
    };
})();
