// Shared progression -> human actor adapter. Profiles are frozen per match.
const spatialProfiles = (() => {
    const MODES = Object.freeze({
        fair: Object.freeze({ id: 'fair', label: '公平对决', description: '双方使用统一属性' }),
        progression: Object.freeze({ id: 'progression', label: '养成对战', description: '使用当前装备与等级属性' })
    });
    const FAIR_PROFILE = Object.freeze({
        level: 1, maxHp: 120, atk: 30, def: 8, spd: 10, apMax: 5,
        critChance: 0, guardThorns: 0, earlyReleaseMs: 300, parryWindowBaseMs: 180,
        judgmentMultiplier: 1, guardDamageMultiplier: 1,
        motion: Object.freeze({ move: 1, turn: 1, chargeMove: 1, chargeTurn: 1 })
    });
    function local() {
        return { ...player.getStats(), level: state.player.level,
            judgmentMultiplier: player.getJudgmentMultiplier(), guardDamageMultiplier: player.getGuardDamageMultiplier(),
            earlyReleaseMs: player.getChargeThresholdMs(), parryWindowBaseMs: player.getParryWindowBaseMs(),
            critChance: player.getCritChance(), guardThorns: player.getGuardThorns(),
            apMax: player.getApMax(), motion: player.getSpatialMotion() };
    }
    function normalize(p) {
        if (!p || typeof p !== 'object') throw new Error('缺少对战属性');
        const ranges = { level: [1, 100000], maxHp: [1, 1e9], atk: [0, 1e9], def: [0, 1e9], spd: [.1, 1e6],
            judgmentMultiplier: [0, 100], guardDamageMultiplier: [0, 100], earlyReleaseMs: [0, 1900],
            parryWindowBaseMs: [0, 10000], critChance: [0, 1], guardThorns: [0, 100], apMax: [1, 100] };
        const out = {};
        for (const [key, [min, max]] of Object.entries(ranges)) {
            if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new Error('无效对战属性: ' + key);
            out[key] = p[key];
        }
        out.apMax = Math.floor(out.apMax); out.motion = {};
        for (const key of ['move', 'turn', 'chargeMove', 'chargeTurn']) {
            const v = p.motion?.[key] ?? 1;
            if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('无效移动属性');
            out.motion[key] = v;
        }
        return out;
    }
    function fair() { return normalize({ ...FAIR_PROFILE, motion: { ...FAIR_PROFILE.motion } }); }
    function isFair(p) {
        try {
            const n = normalize(p), f = fair();
            return ['level', 'maxHp', 'atk', 'def', 'spd', 'judgmentMultiplier', 'guardDamageMultiplier',
                'earlyReleaseMs', 'parryWindowBaseMs', 'critChance', 'guardThorns', 'apMax'].every(key => n[key] === f[key]) &&
                ['move', 'turn', 'chargeMove', 'chargeTurn'].every(key => n.motion[key] === f.motion[key]);
        } catch (_) { return false; }
    }
    function forMode(mode, progression = local()) {
        return mode === 'fair' ? fair() : normalize(progression);
    }
    function apply(C, stats, hp = stats.maxHp) {
        const clamp = spatialCombat.clamp;
        C.motion = { ...stats.motion };
        Object.assign(C.player, { maxHp: stats.maxHp, hp: clamp(hp, 0, stats.maxHp), def: stats.def });
        C.apMax = Math.max(1, Math.floor(stats.apMax));
        C.apRegen = 1000 / combatResolver.apRecoveryMs(Math.max(.1, stats.spd));
        C.fullCharge = 2; C.chargeThreshold = clamp(stats.earlyReleaseMs / 1000, 0, 1.9);
        C.parryWindow = clamp(stats.parryWindowBaseMs * stats.judgmentMultiplier / 1000, 0, 1);
        C.blockMultiplier = clamp(.4 * stats.guardDamageMultiplier, 0, 1);
        C.critChance = clamp(stats.critChance, 0, 1); C.guardThorns = Math.max(0, stats.guardThorns);
        C.parryDamage = Math.max(1, Math.round(stats.atk * .5));
        C.light.damage = Math.max(1, Math.round(stats.atk * .3));
        C.heavy.damage = stats.atk * .3; C.heavy.chargeBonus = stats.atk * .8;
        return C;
    }
    return { MODES, FAIR_PROFILE, local, fair, isFair, forMode, normalize, apply };
})();
