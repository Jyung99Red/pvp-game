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

    // -- Player hand-node animation (left / right) --
    playerNode(hand, cls, duration = 300) {
        if (!hand) return;
        this.triggerId(`node-${hand}`, cls, duration);
    },

    // ════════════════════════════════
    //  FX methods
    // ════════════════════════════════

    // Plain slash (applied to the enemy or hero sprite)
    slash(el) { this.trigger(el, 'slashed', 400); },

    // SVG slash effect (fetches icons/fx/slash.svg and injects it, cached)
    _slashSVGCache: null,
    xSlash(el) {
        if (!el) return;
        const inject = (svgText) => {
            el.querySelectorAll('.fx-slash-svg').forEach(n => n.remove());
            const wrap = document.createElement('div');
            wrap.innerHTML = svgText;
            const svgEl = wrap.querySelector('svg');
            if (!svgEl) return;
            svgEl.classList.add('fx-slash-svg');
            // Force-restart the animation (clone the node so the browser re-triggers it)
            const clone = svgEl.cloneNode(true);
            el.appendChild(clone);
            setTimeout(() => clone.remove(), 500);
        };
        if (this._slashSVGCache) {
            inject(this._slashSVGCache);
        } else {
            fetch('icons/fx/slash.svg', { cache: 'force-cache' })
                .then(r => r.text())
                .then(text => { this._slashSVGCache = text; inject(text); })
                .catch(e => console.warn('[fx] slash.svg load failed', e));
        }
    },

    // Shake (HP bars, etc.)
    shake(id) { this.triggerId(id, 'shake', 300); },

    // Enemy weapon-node shrink (enemy side, on a normal block)
    enemyShrink(el) { this.trigger(el, 'node-shrink', 300); },

    // Player-node parry glow (perfect clash / perfect parry)
    parryGlow(hand) { this.playerNode(hand, 'node-parry-glow', 300); },

    // Player-node guard shrink (normal block)
    guardShrink(hand) { this.playerNode(hand, 'node-guard-shrink', 300); },

    // ════════════════════════════════
    //  PVP-only: element-direct variants
    //  (PVP node ids aren't the node-left/node-right "hand" shape,
    //   so they can't reuse playerNode()'s hand-based id lookup above)
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
    // (identical logic to the hand-based shieldWindup/shieldReady/shieldCancel below,
    //   just skips building the `node-${hand}` id lookup and takes the element directly)
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

    // Guard windup: glow border fills in ring by ring
    shieldWindup(hand, durationMs) {
        const el = document.getElementById(`node-${hand}`);
        if (!el) return;
        el.style.setProperty('--shield-windup-time', `${durationMs}ms`);
        el.classList.remove('shield-windup', 'shield-ready', 'shield-cancelled');
        void el.offsetWidth;
        el.classList.add('shield-windup');
    },

    // Charge complete, switch to the ready highlight
    shieldReady(hand, holdMs) {
        const el = document.getElementById(`node-${hand}`);
        if (!el) return;
        el.style.setProperty('--shield-hold-time', `${holdMs}ms`);
        el.classList.remove('shield-windup', 'shield-cancelled');
        void el.offsetWidth; // force reflow so the animation restarts from the beginning
        el.classList.add('shield-ready');
    },

    // Release/cancel: quick fade-out
    shieldCancel(hand) {
        const el = document.getElementById(`node-${hand}`);
        if (!el) return;
        el.classList.remove('shield-windup', 'shield-ready');
        el.classList.add('shield-cancelled');
        setTimeout(() => el?.classList.remove('shield-cancelled'), 200);
    },

    // Enemy enters windup: set the CSS variable and trigger windup-active
    enemyWindupStart(el, windupMs) {
        if (!el) return;
        el.style.setProperty('--windup-time', `${windupMs}ms`);
        el.classList.remove('windup-active');
        void el.offsetWidth;
        el.classList.add('windup-active');
    },

    // On battle end/victory: clean up the weapon node + leftover animations on both sprites
    clearBattleSprites() {
        this.clearWeaponNode(document.getElementById('enemy-weapon-node'));
        const enemySprite = document.getElementById('enemy-sprite');
        if (enemySprite) enemySprite.classList.remove('slashed');
    },

    // Clear all animation classes and dynamic SVG effects on the enemy weapon node
    clearWeaponNode(el) {
        if (!el) return;
        el.classList.remove('warning', 'pre-attack', 'windup-active', 'shake', 'node-shrink');
        el.querySelectorAll('.fx-slash-svg').forEach(n => n.remove());
    },

    // ════════════════════════════════
    //  Battle log output (unified prefix format)
    // ════════════════════════════════
    log: {
        encounter(enemyName)         { ui.log(`[遭遇] ${enemyName}`); },

        // Player actions
        attack(weaponName, dmg)      { ui.log(`[攻击] ${weaponName} 造成 ${dmg} 伤害`); },
        guard(weaponName)            { ui.log(`[防守] 举起 ${weaponName}`); },
        skill(hp)                    { ui.log(`[技能] 恢复 ${hp} HP`); },
        flee()                       { ui.log(`[撤退] 返回基地`); },
        retreat()                    { ui.log(`[撤离] 见好就收，返回基地`); },

        // Resolution outcomes
        clash(actName, dmg)          { ui.log(`[拼刀] ${actName} → 反击 ${dmg} 伤害`); },
        parry(actName, dmg)          { ui.log(`[弹反] ${actName} → 反弹 ${dmg} 伤害`); },
        block(actName, dmg)          { ui.log(`[格挡] ${actName} → 受到 ${dmg} 伤害`); },
        hit(actName, dmg)            { ui.log(`[受击] ${actName} 命中，受到 ${dmg} 伤害`); },

        // Battle settlement
        death()                      { ui.log(`[阵亡] 英雄倒下...`); },
        victory(enemyName, exp)      { ui.log(`[胜利] 击败 ${enemyName}，获得 ${exp} EXP`); },
        loot(names)                  { ui.log(`[掉落] ${names}`); },
        continueDeep()               { ui.log(`[前进] 继续深入...`); },
        exploreComplete()            { ui.log(`[返程] 探索完成，满载而归`); },
    }
};
