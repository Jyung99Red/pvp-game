// fx.js - Centralized battle FX triggers and battle log output

const fx = {

    // -- Core: trigger a CSS class animation, auto cleanup --
    trigger(el, cls, duration) {
        if (!el) return;
        el.classList.remove(cls);
        void el.offsetWidth; // force reflow
        el.classList.add(cls);
        setTimeout(() => el?.classList.remove(cls), duration);
    },

    // -- Trigger via element id --
    triggerId(id, cls, duration) {
        this.trigger(document.getElementById(id), cls, duration);
    },

    // ════════════════════════════════
    //  FX methods
    // ════════════════════════════════

    // Plain slash (applied to a fighter node)
    slash(el) { this.trigger(el, 'slashed', 400); },

    // Shake (HP bars, etc.)
    shake(id) { this.triggerId(id, 'shake', 300); },

    // Weapon-node shrink (on a normal block / clash)
    enemyShrink(el) { this.trigger(el, 'node-shrink', 300); },

    // ════════════════════════════════
    //  Element-direct fighter-node variants (used by PVP and PVE views)
    // ════════════════════════════════

    // Charge icon: every frame, drive lift/rotate/scale continuously from t(0-1), no transition --
    // stays locked to the real charge progress with no drift; t is computed and passed in by the caller.
    pvpChargeIcon(el, t) {
        if (!el) return;
        const tt = Math.max(0, Math.min(t, 1));
        const LIFT_PX = 14, ROTATE_DEG = 28, SCALE_MAX = 0.15;
        el.style.transition = 'none';
        el.style.transform =
            `translateY(${-LIFT_PX * tt}px) rotate(${-ROTATE_DEG * tt}deg) scale(${1 + SCALE_MAX * tt})`;
        // The fuller the charge, the redder: white -> red linear interpolation, only lowering the G/B channels
        // Note: the icon paths use fill="currentColor", so the actual color is
        // driven by the CSS color property -- setting el.style.fill has no effect.
        const shade = Math.round(255 * (1 - tt));
        el.style.color = `rgb(255, ${shade}, ${shade})`;
    },

    // The moment of release/striking: a one-shot ease-out back to the resting pose instead of snapping instantly.
    // Duration is fixed (independent of charge time), so transition is used instead of keyframes.
    pvpChargeRelease(el, duration = 280) {
        if (!el) return;
        el.style.transition = `transform ${duration}ms ease-out, color ${duration}ms ease-out`;
        el.style.transform = '';
        el.style.color = '';
        setTimeout(() => { if (el) el.style.transition = ''; }, duration);
    },

    // Charge got interrupted by an incoming hit: snap downward in a few
    // discrete jumps (transition:none between each, so it reads as a
    // frame-skipped stutter rather than a smooth motion), then linearly
    // ease position + color back to the resting pose.
    pvpChargeInterrupt(el, stutterStepMs = 40, returnMs = 220) {
        if (!el) return;
        const DOWN_PX = 10, STEPS = 4;
        for (let i = 1; i <= STEPS; i++) {
            setTimeout(() => {
                if (!el) return;
                el.style.transition = 'none';
                el.style.transform = `translateY(${DOWN_PX * (i / STEPS)}px)`;
            }, stutterStepMs * (i - 1));
        }
        setTimeout(() => {
            if (!el) return;
            el.style.transition = `transform ${returnMs}ms linear, color ${returnMs}ms linear`;
            el.style.transform = '';
            el.style.color = '';
            setTimeout(() => { if (el) el.style.transition = ''; }, returnMs);
        }, stutterStepMs * STEPS);
    },

    // Perfect-parry glow / normal-block shrink -- element-direct variants
    parryGlowEl(el, duration = 300)   { this.trigger(el, 'node-parry-glow', duration); },
    guardShrinkEl(el, duration = 300) { this.trigger(el, 'node-guard-shrink', duration); },

    // Guard windup/ready/cancel -- element-direct variants
    shieldWindupEl(el, durationMs) {
        if (!el) return;
        el.style.setProperty('--shield-windup-time', `${durationMs}ms`);
        el.classList.remove('shield-windup', 'shield-ready', 'shield-cancelled');
        void el.offsetWidth;
        el.classList.add('shield-windup');
    },
    shieldReadyEl(el, holdMs) {
        if (!el) return;
        el.style.setProperty('--shield-hold-time', `${holdMs}ms`);
        el.classList.remove('shield-windup', 'shield-cancelled');
        void el.offsetWidth;
        el.classList.add('shield-ready');
    },
    shieldCancelEl(el) {
        if (!el) return;
        el.classList.remove('shield-windup', 'shield-ready');
        el.classList.add('shield-cancelled');
        setTimeout(() => el?.classList.remove('shield-cancelled'), 200);
    },

    // ════════════════════════════════
    //  Battle log output (unified prefix format)
    // ════════════════════════════════
    log: {
        encounter(enemyName)         { ui.log(`[遭遇] ${enemyName}`); },

        // Player actions
        skill(hp)                    { ui.log(`[技能] 恢复 ${hp} HP`); },
        flee()                       { ui.log(`[撤退] 返回基地`); },
        retreat()                    { ui.log(`[撤离] 见好就收，返回基地`); },

        // Battle settlement
        death()                      { ui.log(`[阵亡] 英雄倒下...`); },
        victory(enemyName, exp)      { ui.log(`[胜利] 击败 ${enemyName}，获得 ${exp} EXP`); },
        loot(names)                  { ui.log(`[掉落] ${names}`); },
        continueDeep()               { ui.log(`[前进] 继续深入...`); },
        exploreComplete()            { ui.log(`[返程] 探索完成，满载而归`); },
    }
};
