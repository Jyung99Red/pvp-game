// Shared resource formulas; editable coefficients live in game_config.js.
const combatRules = Object.freeze({
    chargeThresholdMs: gameConfig.resources.chargeThresholdMs,
    weaponChargeThresholdMs: gameConfig.resources.weaponChargeThresholdMs,
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
