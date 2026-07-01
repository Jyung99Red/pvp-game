// ui_pvp.js - PVP battle UI renderer
// Pure read of state.pvpBattle. Never writes game state.

const uiPvp = (() => {

    function _pct(val, max) {
        return max > 0 ? Math.min(100, Math.max(0, (val / max) * 100)) : 0;
    }

    function _phaseLabel(phase) {
        const map = {
            idle:           '待机',
            charging:       '蓄力中...',
            strike_out:     '⚔️ 出击!',
            strike_recover: '后摇',
            guard_windup:   '举盾中...',
            guard_ready:    '🛡️ 格挡就绪',
            stunned:        '💫 硬直'
        };
        return map[phase] || phase;
    }

    function _setBar(id, pct) {
        const el = document.getElementById(id);
        if (el) el.style.width = pct + '%';
    }

    function _setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function _setClass(id, cls, on) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle(cls, on);
    }

    // ── PVP fighter node visuals ──
    // The charge icon transform and shield glow ring are one-shot effects
    // triggered at the exact moment of a state transition, not re-added
    // every frame (reflow would interrupt an animation already playing if
    // the class is re-applied while it's still on the element).
    // We track the previous frame's phase here purely for edge detection.
    const _prevPhase = { self: null, op: null };

    function _weaponNodeEl(key) {
        return document.getElementById(key === 'self' ? 'pvp-self-weapon-icon' : 'pvp-op-weapon-icon');
    }

    function _updateFighterFx(key, sideState, chargeProgress) {
        const nodeEl = _weaponNodeEl(key);
        const iconEl = nodeEl ? nodeEl.querySelector('.pvp-weapon-icon') : null;
        const phase  = sideState.phase;
        const prev   = _prevPhase[key];

        // While charging: driven continuously; the moment it leaves
        // 'charging' it's either a normal release/auto-fire (→ strike_out,
        // eased back to rest) or an interrupt (→ stunned directly, the
        // only path that goes charging→stunned — see pvp_logic.js
        // isInterrupt — so it gets the stutter-down FX instead)
        if (phase === 'charging') {
            fx.pvpChargeIcon(iconEl, chargeProgress);
        } else if (prev === 'charging') {
            if (phase === 'stunned') {
                fx.pvpChargeInterrupt(iconEl);
            } else {
                fx.pvpChargeRelease(iconEl);
            }
        }

        // Shield glow ring: fires once on entering windup/ready; leaving
        // it (whether released manually or knocked into stunned/blocked)
        // always does a one-shot "cancel fade-out" cleanup first
        if (phase === 'guard_windup' && prev !== 'guard_windup') {
            fx.shieldWindupEl(nodeEl, pvpConfig.guardWindupMs);
        } else if (phase === 'guard_ready' && prev !== 'guard_ready') {
            fx.shieldReadyEl(nodeEl, pvpConfig.guardMaxHoldMs);
        } else if ((prev === 'guard_windup' || prev === 'guard_ready') &&
                   phase !== 'guard_windup' && phase !== 'guard_ready') {
            fx.shieldCancelEl(nodeEl);
        }

        _prevPhase[key] = phase;
    }

    return {
        updateFrame() {
            const b = state.pvpBattle;
            if (!b || !b.active) return;

            const s  = b.self;
            const op = b.opponent;

            // ── Fighter node visuals (charge icon / shield glow ring) ──
            _updateFighterFx('self', s, s.phase === 'charging' ? s.chargeMs / pvpConfig.chargeMaxMs : 0);
            _updateFighterFx('op',   op, op.chargeProgress || 0);

            // ── Opponent ─────────────────────────────────────────────
            _setBar('pvp-op-hp',     _pct(op.hp, op.maxHp));
            _setText('pvp-op-hp-txt', `${op.hp} / ${op.maxHp}`);
            _setText('pvp-op-name',   op.displayName);
            _setText('pvp-op-phase',  _phaseLabel(op.phase));

            // Opponent charge bar (synced via charge_sync messages)
            const opChargeVisible = op.phase === 'charging';
            _setClass('pvp-op-charge-wrap', 'hidden', !opChargeVisible);
            if (opChargeVisible) {
                // Use chargeProgress (0→1) received from network
                _setBar('pvp-op-charge', (op.chargeProgress || 0) * 100);
            }

            // Opponent guard indicator
            _setClass('pvp-op-guard-icon', 'hidden', op.phase !== 'guard_ready');
            _setClass('pvp-op-phase-label', 'phase-windup',   op.phase === 'guard_windup');
            _setClass('pvp-op-phase-label', 'phase-guard',    op.phase === 'guard_ready');
            _setClass('pvp-op-phase-label', 'phase-striking', op.phase === 'strike_out');
            _setClass('pvp-op-phase-label', 'phase-stunned',  op.phase === 'stunned');

            // ── Self ─────────────────────────────────────────────────
            _setBar('pvp-self-hp',      _pct(s.hp, s.maxHp));
            _setText('pvp-self-hp-txt',  `${s.hp} / ${s.maxHp}`);
            _setText('pvp-self-phase',   _phaseLabel(s.phase));

            // Self charge bar (always shown, no longer toggled via
            // 'hidden' — this element holds a fixed spot so starting/
            // ending a charge never shifts the buttons below it; shows
            // 0% when not charging, for debugging, may be removed later)
            const selfChargeVisible = s.phase === 'charging';
            const progress = selfChargeVisible
                ? Math.min(s.chargeMs / pvpConfig.chargeMaxMs, 1)
                : 0;
            _setBar('pvp-self-charge', progress * 100);
            _setText('pvp-self-charge-txt', `蓄力 ${Math.round(progress * 100)}%`);

            // Colour coding: red before early threshold, yellow → green as charge fills
            const chargeEl = document.getElementById('pvp-self-charge');
            if (chargeEl) {
                const earlyPct = pvpConfig.earlyReleaseMs / pvpConfig.chargeMaxMs;
                chargeEl.classList.toggle('charge-early', selfChargeVisible && progress < earlyPct);
                chargeEl.classList.toggle('charge-normal', selfChargeVisible && progress >= earlyPct);
            }

            // AP dots
            const apEl = document.getElementById('pvp-self-ap');
            if (apEl) {
                apEl.textContent = '⭐'.repeat(s.actionPoints) + '☆'.repeat(pvpConfig.apMax - s.actionPoints);
            }

            // AP recovery bar
            _setBar('pvp-self-ap-bar', s.actionPoints >= pvpConfig.apMax ? 100 : s.actionProgress * 100);

            // ── Button states ────────────────────────────────────────
            const canCharge = s.phase === 'idle' && s.actionPoints >= 1;
            const canGuard  = s.phase === 'idle' && s.actionPoints >= 1;
            const isCharging = s.phase === 'charging';

            const btnCharge = document.getElementById('pvp-btn-charge');
            const btnGuard  = document.getElementById('pvp-btn-guard');
            if (btnCharge) {
                btnCharge.disabled = !canCharge && !isCharging;
                btnCharge.classList.toggle('btn-charging', isCharging);
            }
            if (btnGuard) {
                btnGuard.disabled = !canGuard;
                btnGuard.classList.toggle('btn-guard-active',
                    s.phase === 'guard_ready' || s.phase === 'guard_windup');
            }

            // ── Log ──────────────────────────────────────────────────
            const logEl = document.getElementById('pvp-log');
            if (logEl && b.log) {
                logEl.textContent = b.log.slice(0, 5).join('\n');
            }
        },

        // Called when a battle starts/restarts (including rematch): inject
        // both fighters' weapon icons, and clear any fx class/transform
        // left over from the previous battle — the DOM nodes are reused
        // between battles, so they don't reset themselves.
        initFighters() {
            const opNode   = document.getElementById('pvp-op-weapon-icon');
            const selfNode = document.getElementById('pvp-self-weapon-icon');
            if (opNode)   opNode.innerHTML   = renderIcon('weapon-atk', 'pvp-weapon-icon');
            if (selfNode) selfNode.innerHTML = renderIcon('weapon-atk', 'pvp-weapon-icon');

            [opNode, selfNode].forEach(node => {
                if (!node) return;
                node.classList.remove('shield-windup', 'shield-ready', 'shield-cancelled',
                                       'slashed', 'node-parry-glow', 'node-guard-shrink', 'node-shrink');
                const icon = node.querySelector('.pvp-weapon-icon');
                if (icon) { icon.style.transition = 'none'; icon.style.transform = ''; }
            });

            const clashEl = document.getElementById('pvp-clash-fx');
            if (clashEl) clashEl.classList.remove('pvp-clash-flash');

            _prevPhase.self = null;
            _prevPhase.op   = null;
        },

        // Fires the corresponding fx the moment a judgment result lands.
        // attackerIsSelf is already translated by the caller (pvp_logic.js)
        // before being passed in — both host and guest call this same
        // method, each passing "is the attacker me?" from their own
        // perspective.
        playExchangeFx(exchange, attackerIsSelf) {
            const selfNode = document.getElementById('pvp-self-weapon-icon');
            const opNode   = document.getElementById('pvp-op-weapon-icon');
            const attackerEl = attackerIsSelf ? selfNode : opNode;
            const defenderEl = attackerIsSelf ? opNode   : selfNode;

            // HP bar shake: shake the wrap of whoever actually took damage
            // (shaking the inner bar gets clipped by overflow:hidden, so
            // it's applied to the outer wrap instead)
            const selfHpWrap     = 'pvp-self-hp-wrap';
            const opHpWrap       = 'pvp-op-hp-wrap';
            const attackerHpWrap = attackerIsSelf ? selfHpWrap : opHpWrap;
            const defenderHpWrap = attackerIsSelf ? opHpWrap   : selfHpWrap;

            switch (exchange) {
                case 'hit':
                    fx.slash(defenderEl);
                    fx.shake(defenderHpWrap);
                    break;
                case 'interrupt':
                    fx.slash(defenderEl);
                    fx.enemyShrink(defenderEl);
                    fx.shake(defenderHpWrap);
                    break;
                case 'blocked':
                    fx.guardShrinkEl(defenderEl);
                    fx.shake(defenderHpWrap);   // blocking still costs HP, small shake as feedback
                    break;
                case 'parry':
                    fx.parryGlowEl(defenderEl);
                    fx.enemyShrink(attackerEl);
                    fx.shake(attackerHpWrap);   // attacker takes reflected damage
                    break;
                case 'clash':
                    fx.triggerId('pvp-clash-fx', 'pvp-clash-flash', 280);
                    fx.enemyShrink(attackerEl);
                    fx.enemyShrink(defenderEl);
                    fx.shake(attackerHpWrap);   // both sides take damage
                    fx.shake(defenderHpWrap);
                    break;
            }
        },

        showResult(winner) {
            const overlay = document.getElementById('pvp-result-overlay');
            if (!overlay) return;
            const titleEl = document.getElementById('pvp-result-title');
            if (titleEl) {
                titleEl.textContent = winner === 'self' ? '🏆 胜利！' : '💀 败北';
                titleEl.className = winner === 'self' ? 'result-win' : 'result-lose';
            }
            overlay.classList.remove('hidden');
        },

        hideResult() {
            const overlay = document.getElementById('pvp-result-overlay');
            if (overlay) overlay.classList.add('hidden');

            // Reset "rematch" sub-state so leftover display from the last
            // battle doesn't carry into the next one
            const waitEl = document.getElementById('pvp-rematch-waiting');
            if (waitEl) waitEl.classList.add('hidden');
            const btn = document.getElementById('pvp-btn-rematch');
            if (btn) btn.classList.remove('hidden');
        },

        showRematchRequest() {
            const el = document.getElementById('pvp-rematch-request');
            if (el) el.classList.remove('hidden');
        },

        hideRematchRequest() {
            const el = document.getElementById('pvp-rematch-request');
            if (el) el.classList.add('hidden');
        },

        showRematchWaiting() {
            const el = document.getElementById('pvp-rematch-waiting');
            if (el) el.classList.remove('hidden');
            // Once we've sent the request, the "rematch" button itself
            // shouldn't show anymore, to avoid confusing repeat clicks
            const btn = document.getElementById('pvp-btn-rematch');
            if (btn) btn.classList.add('hidden');
        },

        // Disconnect overlay: host can only passively wait (its own peer
        // listener stays alive), guest can actively reconnect
        showDisconnectOverlay() {
            const overlay = document.getElementById('pvp-disconnect-overlay');
            if (overlay) overlay.classList.remove('hidden');
        },

        hideDisconnectOverlay() {
            const overlay = document.getElementById('pvp-disconnect-overlay');
            if (overlay) overlay.classList.add('hidden');
        }
    };
})();