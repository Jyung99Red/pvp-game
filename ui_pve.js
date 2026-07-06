// ui_pve.js - PVE battle UI renderer (clone of ui_pvp.js for the PVE view)
// Pure read of state.pveBattle. Never writes game state.

const uiPve = (() => {

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

    // One-shot FX edge detection (see ui_pvp.js for rationale)
    const _prevPhase = { self: null, enemy: null };

    function _weaponNodeEl(key) {
        return document.getElementById(key === 'self' ? 'pve-self-weapon-icon' : 'pve-enemy-weapon-icon');
    }

    function _updateFighterFx(key, sideState, chargeProgress) {
        const nodeEl = _weaponNodeEl(key);
        const iconEl = nodeEl ? nodeEl.querySelector('.pvp-weapon-icon') : null;
        const phase  = sideState.phase;
        const prev   = _prevPhase[key];

        if (phase === 'charging') {
            fx.pvpChargeIcon(iconEl, chargeProgress);
        } else if (prev === 'charging') {
            if (phase === 'stunned') {
                fx.pvpChargeInterrupt(iconEl);
            } else {
                fx.pvpChargeRelease(iconEl);
            }
        }

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
            const b = state.pveBattle;
            if (!b) return;

            const s = b.player;
            const e = b.enemy;
            const frozen = Date.now() < b.startFreezeUntil;

            // ── Fighter node visuals ──
            _updateFighterFx('self',  s, s.phase === 'charging' ? s.chargeMs / pvpConfig.chargeMaxMs : 0);
            _updateFighterFx('enemy', e, e.phase === 'charging' ? e.chargeMs / pvpConfig.chargeMaxMs : 0);

            // ── Enemy ─────────────────────────────────────────────────
            _setBar('pve-enemy-hp',      _pct(e.hp, e.maxHp));
            _setText('pve-enemy-hp-txt', `${e.hp} / ${e.maxHp}`);
            _setText('pve-enemy-phase',  frozen ? '⏳ 遭遇...' : _phaseLabel(e.phase));
            _setText('pve-enemy-status', b.ai && b.ai.enraged ? '⚡ 狂暴' : '');
            _setClass('pve-enemy-weapon-icon', 'warning', !!(b.ai && b.ai.enraged));

            // Enemy charge bar: locally simulated, read directly
            const eCharging = e.phase === 'charging';
            const eProgress = eCharging ? Math.min(e.chargeMs / pvpConfig.chargeMaxMs, 1) : 0;
            _setBar('pve-enemy-charge', eProgress * 100);
            const eChargeEl = document.getElementById('pve-enemy-charge');
            if (eChargeEl) {
                const earlyPct = (b.enemyProfile ? b.enemyProfile.earlyReleaseMs : pvpConfig.earlyReleaseMs) / pvpConfig.chargeMaxMs;
                eChargeEl.classList.toggle('charge-early',  eCharging && eProgress < earlyPct);
                eChargeEl.classList.toggle('charge-normal', eCharging && eProgress >= earlyPct);
            }

            _setClass('pve-enemy-guard-icon', 'hidden', e.phase !== 'guard_ready');

            // ── Self ─────────────────────────────────────────────────
            _setBar('pve-self-hp',      _pct(s.hp, s.maxHp));
            _setText('pve-self-hp-txt',  `${s.hp} / ${s.maxHp}`);
            _setText('pve-self-phase',   frozen ? '⏳ 准备...' : _phaseLabel(s.phase));

            const selfCharging = s.phase === 'charging';
            const progress = selfCharging
                ? Math.min(s.chargeMs / pvpConfig.chargeMaxMs, 1)
                : 0;
            _setBar('pve-self-charge', progress * 100);
            _setText('pve-self-charge-txt', `蓄力 ${Math.round(progress * 100)}%`);

            const chargeEl = document.getElementById('pve-self-charge');
            if (chargeEl) {
                const earlyPct = player.getChargeThresholdMs() / pvpConfig.chargeMaxMs;
                chargeEl.classList.toggle('charge-early',  selfCharging && progress < earlyPct);
                chargeEl.classList.toggle('charge-normal', selfCharging && progress >= earlyPct);
            }

            // AP dots + recovery bar
            const apEl = document.getElementById('pve-self-ap');
            if (apEl) {
                apEl.textContent = '⭐'.repeat(s.actionPoints) + '☆'.repeat(pvpConfig.apMax - s.actionPoints);
            }
            _setBar('pve-self-ap-bar', s.actionPoints >= pvpConfig.apMax ? 100 : s.actionProgress * 100);

            // ── Buttons ──────────────────────────────────────────────
            const canAct     = !frozen && b.active && !b.waitingChoice;
            const canCharge  = canAct && s.phase === 'idle' && s.actionPoints >= 1;
            const canGuard   = canAct && s.phase === 'idle' && s.actionPoints >= 1;
            const isCharging = s.phase === 'charging';

            const btnCharge = document.getElementById('pve-btn-charge');
            const btnGuard  = document.getElementById('pve-btn-guard');
            if (btnCharge) {
                btnCharge.disabled = !canCharge && !isCharging;
                btnCharge.classList.toggle('btn-charging', isCharging);
            }
            if (btnGuard) {
                btnGuard.disabled = !canGuard;
                btnGuard.classList.toggle('btn-guard-active',
                    s.phase === 'guard_ready' || s.phase === 'guard_windup');
            }

            // Skill button + skill-point pips
            const spEl = document.getElementById('pve-self-sp');
            if (spEl) spEl.textContent = '✨'.repeat(b.skillPoints) + '·'.repeat(3 - b.skillPoints);
            const btnSkill = document.getElementById('pve-btn-skill');
            if (btnSkill) btnSkill.disabled = !canAct || b.skillPoints < 3;

            // ── Log ──────────────────────────────────────────────────
            const logEl = document.getElementById('pve-log');
            if (logEl && b.log) {
                logEl.textContent = b.log.slice(0, 5).join('\n');
            }
        },

        // Battle start/restart: inject icons, clear leftover fx classes
        // (DOM nodes are reused between fights and don't reset themselves)
        initFight(eData, isFirst) {
            const b = state.pveBattle;
            _setText('pve-floor-label', b ? `第 ${b.floor} 层${b.isBossFloor ? ' · 👑 首领' : ''}` : '');

            const enemyNode = document.getElementById('pve-enemy-weapon-icon');
            const selfNode  = document.getElementById('pve-self-weapon-icon');
            if (enemyNode) enemyNode.innerHTML = renderIcon('monster-atk', 'pvp-weapon-icon');
            if (selfNode)  selfNode.innerHTML  = renderIcon('weapon-atk', 'pvp-weapon-icon');

            [enemyNode, selfNode].forEach(node => {
                if (!node) return;
                node.classList.remove('shield-windup', 'shield-ready', 'shield-cancelled',
                                       'slashed', 'node-parry-glow', 'node-guard-shrink', 'node-shrink');
                const icon = node.querySelector('.pvp-weapon-icon');
                if (icon) { icon.style.transition = 'none'; icon.style.transform = ''; }
            });

            const clashEl = document.getElementById('pve-clash-fx');
            if (clashEl) clashEl.classList.remove('pvp-clash-flash');

            _setText('pve-enemy-name', eData.name);
            const sprite = document.getElementById('pve-enemy-sprite');
            if (sprite) {
                sprite.innerHTML = eData.iconKey
                    ? renderIcon(eData.iconKey, 'sprite-icon')
                    : '👹';
            }

            this.hideOverlays();

            _prevPhase.self  = null;
            _prevPhase.enemy = null;

            // Fade in on first battle entry; clear leftover animation otherwise
            const battleView = document.getElementById('view-battle');
            if (battleView) {
                battleView.style.animation = 'none';
                if (isFirst) {
                    void battleView.offsetWidth;
                    battleView.style.animation = 'fadeInDark 1s ease-out forwards';
                }
            }
        },

        // attackerIsSelf: is the player the attacker in this exchange
        playExchangeFx(exchange, attackerIsSelf) {
            const selfNode  = document.getElementById('pve-self-weapon-icon');
            const enemyNode = document.getElementById('pve-enemy-weapon-icon');
            const attackerEl = attackerIsSelf ? selfNode  : enemyNode;
            const defenderEl = attackerIsSelf ? enemyNode : selfNode;

            const selfHpWrap     = 'pve-self-hp-wrap';
            const enemyHpWrap    = 'pve-enemy-hp-wrap';
            const attackerHpWrap = attackerIsSelf ? selfHpWrap  : enemyHpWrap;
            const defenderHpWrap = attackerIsSelf ? enemyHpWrap : selfHpWrap;

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
                    fx.shake(defenderHpWrap);
                    break;
                case 'parry':
                    fx.parryGlowEl(defenderEl);
                    fx.enemyShrink(attackerEl);
                    fx.shake(attackerHpWrap);
                    break;
                case 'clash':
                    fx.triggerId('pve-clash-fx', 'pvp-clash-flash', 280);
                    fx.enemyShrink(attackerEl);
                    fx.enemyShrink(defenderEl);
                    fx.shake(attackerHpWrap);
                    fx.shake(defenderHpWrap);
                    break;
            }
        },

        showWinChoice(drops, exp, gold) {
            const lootEl = document.getElementById('pve-win-loot');
            if (lootEl) {
                let html = `🧪 EXP +${exp} &nbsp; 💰 +${gold}`;
                if (drops && drops.length) {
                    html += '<br>' + drops.map(d => {
                        const m = content.materials[d.id];
                        return `${m.icon} ${m.name} ×${d.amt}`;
                    }).join('　');
                }
                lootEl.innerHTML = html;
            }
            _setClass('pve-win-overlay', 'hidden', false);
        },

        showDefeat() {
            _setClass('pve-defeat-overlay', 'hidden', false);
        },

        hideOverlays() {
            _setClass('pve-win-overlay',    'hidden', true);
            _setClass('pve-defeat-overlay', 'hidden', true);
        }
    };
})();
