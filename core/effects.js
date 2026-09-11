// Stats equipment can contribute (drives getStats() aggregation loop).
const STAT_REGISTRY = {
    atk: {},
    def: {},
    spd: {},
    int: {}
};

// One entry per item-effect `type` used in content.items[*].effects[].
// apply(mult, value) folds this effect into an accumulating multiplier —
// mirrors the `mult *= (...)` pattern used by player.js's multiplier getters.
// label(value) renders the effect's display HTML for the item modal.
const EFFECT_REGISTRY = {
    spatial_move_speed: {
        apply(mult, value) { return mult * Math.max(0, 1 + value); },
        label(value) { return `<span class="effect-tag effect-buff">移动速度 ${value >= 0 ? '+' : ''}${Math.round(value * 100)}%</span>`; }
    },
    spatial_turn_speed: {
        apply(mult, value) { return mult * Math.max(0, 1 + value); },
        label(value) { return `<span class="effect-tag effect-buff">转向速度 ${value >= 0 ? '+' : ''}${Math.round(value * 100)}%</span>`; }
    },
    charge_move_speed: {
        apply(mult, value) { return mult * Math.max(0, 1 + value); },
        label(value) { return `<span class="effect-tag effect-buff">蓄力移速 ${value >= 0 ? '+' : ''}${Math.round(value * 100)}%</span>`; }
    },
    charge_turn_speed: {
        apply(mult, value) { return mult * Math.max(0, 1 + value); },
        label(value) { return `<span class="effect-tag effect-buff">蓄力转速 ${value >= 0 ? '+' : ''}${Math.round(value * 100)}%</span>`; }
    },
    action_speed_penalty: {
        appliesTo: 'actionSpeed',
        apply(mult, value) { return mult * (1 + value); },
        label(value) { return `<span class="effect-tag effect-penalty">⏱ 行动慢 ${value*100}%</span>`; }
    },
    passive_speed_boost: {
        appliesTo: 'actionSpeed',
        apply(mult, value) { return mult * (1 - value); },
        label(value) { return `<span class="effect-tag effect-passive">⚡ 速度 +${value*100}%（永久）</span>`; }
    },
    guard_damage_reduce: {
        appliesTo: 'guardDamage',
        apply(mult, value) { return mult * (1 - value); },
        label(value) { return `<span class="effect-tag effect-buff">🛡 格挡减伤 ${value*100}%</span>`; }
    },
    // Per-weapon/shield combat-timing overrides — absolute values, not
    // multiplicative buffs, so no apply(); read via
    // player.getFirstEquippedEffectValue instead of _applyEffectPass.
    charge_threshold_ms: {
        label(value) { return `<span class="effect-tag effect-info">⏱ 蓄力阈值 ${value}ms</span>`; }
    },
    parry_window_ms: {
        label(value) { return `<span class="effect-tag effect-info">🎯 弹反窗口 ${value}ms</span>`; }
    },
    crit_chance: {
        label(value) { return `<span class="effect-tag effect-buff">💥 暴击率 +${value*100}%</span>`; }
    },
    guard_thorns: {
        label(value) { return `<span class="effect-tag effect-buff">🌵 格挡反伤 ${value*100}%</span>`; }
    },
    ap_max_bonus: {
        label(value) { return `<span class="effect-tag effect-passive">⭐ 行动力上限 +${value}</span>`; }
    }
};
