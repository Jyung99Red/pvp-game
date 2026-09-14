// Shared resource formulas; editable coefficients live in game_config.js.
const combatRules = Object.freeze({
    chargeThresholdMs: gameConfig.resources.chargeThresholdMs,
    // Weapons declare an explicit offset instead of a discrete template, so a
    // new weapon is one number in game_config.js. The clamp keeps a bad data
    // edit inside the playable band.
    weaponChargeThresholdMs(offsetMs) {
        const R = gameConfig.resources, range = R.chargeThresholdRangeMs;
        const offset = Number.isFinite(offsetMs) ? offsetMs : 0;
        return Math.min(range.max, Math.max(range.min, Math.round(R.chargeThresholdMs + offset)));
    },
    parryWindowMs: gameConfig.resources.parryWindowMs,
    apMax: gameConfig.resources.apMax,
    apRecoveryMs(focus) {
        const R = gameConfig.resources;
        return R.apRecoveryMs * (R.focusBaseline / Math.max(R.minFocus, focus || R.focusBaseline));
    },
    spRecoveryMs(focus) {
        const R = gameConfig.resources;
        return R.spRecoveryMs * (R.focusBaseline / Math.max(R.minFocus, focus || R.focusBaseline));
    }
});
