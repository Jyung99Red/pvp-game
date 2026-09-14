// Shared player defaults and resource recovery. Spatial engines own all hits/timing.
const combatRules = Object.freeze({
    chargeThresholdMs: 300,
    weaponChargeThresholdMs: Object.freeze({ basic: 300, heavy: 350, light: 280 }),
    parryWindowMs: 200,
    apMax: 5,
    apRecoveryMs(focus) { return 2000 * (10 / Math.max(.1, focus || 10)); },
    spRecoveryMs(focus) { return 3000 * (10 / Math.max(.1, focus || 10)); }
});
