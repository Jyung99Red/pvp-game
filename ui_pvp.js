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
            parry:          '✨ 弹反!',
            stunned:        '💫 硬直',
            blocked:        '格挡'
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

    return {
        updateFrame() {
            const b = state.pvpBattle;
            if (!b || !b.active) return;

            const s  = b.self;
            const op = b.opponent;

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

            // Self charge bar
            const selfChargeVisible = s.phase === 'charging';
            _setClass('pvp-self-charge-wrap', 'hidden', !selfChargeVisible);
            if (selfChargeVisible) {
                const progress = Math.min(s.chargeMs / pvpConfig.chargeMaxMs, 1);
                _setBar('pvp-self-charge', progress * 100);

                // Colour coding: red before early threshold, yellow → green as charge fills
                const chargeEl = document.getElementById('pvp-self-charge');
                if (chargeEl) {
                    const earlyPct = pvpConfig.earlyReleaseMs / pvpConfig.chargeMaxMs;
                    chargeEl.classList.toggle('charge-early', progress < earlyPct);
                    chargeEl.classList.toggle('charge-normal', progress >= earlyPct);
                }
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

            // 复位"再来一局"相关的子状态，避免带着上一局的残留显示进入下一局
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
            // 自己发起请求后，"再来一局"按钮本身不需要再展示，避免重复点击造成困惑
            const btn = document.getElementById('pvp-btn-rematch');
            if (btn) btn.classList.add('hidden');
        },

        // 断线遮罩：host 只能被动等待（自己的peer监听是持续的），guest 可以主动重连
        showDisconnectOverlay(role) {
            const overlay = document.getElementById('pvp-disconnect-overlay');
            if (!overlay) return;

            const titleEl = document.getElementById('pvp-disconnect-title');
            const reconnectBtn = document.getElementById('pvp-btn-reconnect');

            if (role === 'guest') {
                if (titleEl) titleEl.textContent = '⚠️ 连接已断开';
                if (reconnectBtn) reconnectBtn.classList.remove('hidden');
            } else {
                if (titleEl) titleEl.textContent = '⚠️ 对方已断开，等待重新连接...';
                if (reconnectBtn) reconnectBtn.classList.add('hidden');
            }

            overlay.classList.remove('hidden');
        },

        hideDisconnectOverlay() {
            const overlay = document.getElementById('pvp-disconnect-overlay');
            if (overlay) overlay.classList.add('hidden');
        }
    };
})();