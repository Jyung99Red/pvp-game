// pve_logic.js - PVE battle engine on the shared PVP combat core.
// Same charge/guard/parry mechanics as PVP (combat_resolver.js), but the
// opponent is an AI-simulated enemy driven by content.enemies data instead
// of network messages. No DOM access; rendering goes through uiPve.
//
// Differences from pvp_logic:
//   - No network: both sides tick locally, exchanges resolve immediately.
//   - Enemy side is driven by a small AI state machine (_aiThink); its
//     defaults derive from the enemy's baseMsCharge/acts fields, and any
//     value can be overridden per-enemy via content.enemies[key].ai = {...}.
//   - Player HP authority is state.player.currentHp (tick.js heals it
//     mid-fight via the hot spring): copied in every frame, written back
//     after every exchange/heal.
//   - Fight chaining (area encounters, drops, exp, death→10% HP) ported
//     from the old battle.js semantics.

const pveLogic = (() => {
    let _rAF = null;
    let _lastTime = 0;
    let _selfProfile = null;
    let _enemyProfile = null;

    function _buildLocalProfile() {
        const stats = player.getStats();
        return {
            level: state.player.level,
            maxHp: stats.maxHp,
            atk:   stats.atk,
            def:   stats.def,
            spd:   stats.spd,
            judgmentMultiplier:    player.getJudgmentMultiplier(),
            guardDamageMultiplier: player.getGuardDamageMultiplier()
        };
    }

    function _buildEnemyProfile(eData) {
        const o = eData.ai || {};
        return {
            maxHp: eData.hp,
            atk:   eData.atk,
            def:   eData.def,
            spd:   o.spd || 10,
            judgmentMultiplier:    o.judgmentMultiplier || 1,
            guardDamageMultiplier: o.guardDamageMultiplier || 1
        };
    }

    // ── AI parameters ────────────────────────────────────────────────────
    // Derived from existing enemy fields; every knob overridable via
    // content.enemies[key].ai (the Phase-3 monster-redesign extension point).

    function _aiParams(eData) {
        const o = eData.ai || {};
        return {
            actWeights:    o.actWeights    || { act1: 0.5, act2: 0.5 },
            chargeJitter:  o.chargeJitter  != null ? o.chargeJitter : 0.15,
            decideDelayMs: o.decideDelayMs || [300, 800],
            guardReactMs:  o.guardReactMs  != null ? o.guardReactMs : 1100,
            guardChance:   o.guardChance   != null ? o.guardChance : 0.3,
            guardHoldMs:   o.guardHoldMs   || [500, 1400]
        };
    }

    function _rand(range) { return range[0] + Math.random() * (range[1] - range[0]); }

    function _rollAct(weights) {
        const total = Object.values(weights).reduce((a, b) => a + b, 0);
        let roll = Math.random() * total;
        for (const act in weights) {
            roll -= weights[act];
            if (roll <= 0) return act;
        }
        return 'act1';
    }

    // Target charge duration for an act: baseMsCharge scaled by the act's
    // dmgMult (heavier act = longer charge = more damage via the charge lerp),
    // clamped safely above the tap-penalty threshold.
    function _chargeMsFor(eData, act) {
        const mult = (eData.acts && eData.acts[act] && eData.acts[act].dmgMult) || 1;
        const base = (eData.baseMsCharge || 1500) * mult;
        return Math.min(Math.max(base, pvpConfig.earlyReleaseMs + 100), pvpConfig.chargeMaxMs);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    function _setPhase(side, phase, timerMs) {
        side.phase      = phase;
        side.phaseTimer = timerMs || 0;
    }

    function _pushLog(text) {
        const log = state.pveBattle.log;
        log.unshift(text);
        if (log.length > 20) log.pop();
    }

    function _gainSkillPoint() {
        const b = state.pveBattle;
        b.skillPoints = Math.min(3, b.skillPoints + 1);
    }

    // ── Tick one side per frame (clone of pvp_logic._tickSide, spd passed in) ──

    function _tickSide(side, dt, now, spd, onAutoFire) {
        // AP recovery (paused while charging or guarding)
        if (!['charging', 'guard_windup', 'guard_ready'].includes(side.phase)) {
            if (side.actionPoints < pvpConfig.apMax) {
                side.actionProgress += dt / combatResolver.apRecoveryMs(spd);
                if (side.actionProgress >= 1) {
                    side.actionPoints++;
                    side.actionProgress = side.actionPoints < pvpConfig.apMax
                        ? side.actionProgress - 1 : 0;
                }
            } else {
                side.actionProgress = 0;
            }
        }

        if (side.phaseTimer > 0) {
            side.phaseTimer = Math.max(0, side.phaseTimer - dt);
        }

        if (side.phase === 'charging') {
            side.chargeMs = now - side.chargeStartT;
            if (side.chargeMs >= pvpConfig.chargeMaxMs) {
                side.chargeMs = pvpConfig.chargeMaxMs;
                onAutoFire();
            }
        }

        if (side.phaseTimer === 0) {
            switch (side.phase) {
                case 'strike_out':     _setPhase(side, 'strike_recover', pvpConfig.strikeRecoveryMs); break;
                case 'strike_recover': _setPhase(side, 'idle', 0); break;
                case 'guard_windup':   _setPhase(side, 'idle', 0); break;
                case 'guard_ready':    _setPhase(side, 'idle', 0); break;
                case 'stunned':        _setPhase(side, 'idle', 0); break;
            }
        }
    }

    // Guard windup completed → guard engages. Runs for BOTH sides here
    // (in PVP only self does this locally; the opponent is network-mirrored,
    // but our enemy is locally simulated and needs its own parry window).
    function _guardWindupComplete(side, now) {
        side.actionPoints--;
        side.lastGuardReadyT = now;   // Wall-clock, used for the parry window
        _setPhase(side, 'guard_ready', pvpConfig.guardMaxHoldMs);
    }

    // ── AI decision state machine (runs each frame) ──────────────────────

    function _aiThink(dt, now) {
        const b  = state.pveBattle;
        const e  = b.enemy;
        const ai = b.ai;

        // Timed guard release
        if ((e.phase === 'guard_windup' || e.phase === 'guard_ready') && now >= ai.guardReleaseAt) {
            _setPhase(e, 'idle', 0);
            e.lastGuardReadyT = 0;
            ai.thinkTimer = _rand(ai.params.decideDelayMs);
            return;
        }

        if (e.phase !== 'idle' || e.actionPoints < 1) return;

        ai.thinkTimer -= dt;
        if (ai.thinkTimer > 0) return;

        const p = b.player;
        if (p.phase === 'charging' && p.chargeMs >= ai.params.guardReactMs &&
            Math.random() < ai.params.guardChance) {
            // Raise guard against the player's long charge
            // (AP is spent at windup completion, same as the player flow)
            _setPhase(e, 'guard_windup', pvpConfig.guardWindupMs);
            ai.guardReleaseAt = now + pvpConfig.guardWindupMs + _rand(ai.params.guardHoldMs);
        } else {
            // Attack: pick an act, charge toward its target duration
            const eData  = content.enemies[b.enemyId];
            const act    = _rollAct(ai.params.actWeights);
            const jitter = 1 + (Math.random() * 2 - 1) * ai.params.chargeJitter;
            ai.currentAct    = act;
            ai.targetChargeMs = Math.min(_chargeMsFor(eData, act) * jitter, pvpConfig.chargeMaxMs);
            e.actionPoints--;
            e.chargeStartT = now;
            e.chargeMs     = 0;
            _setPhase(e, 'charging', 0);
        }
    }

    // ── Fire + resolve (both sides funnel through here; no network) ──────

    function _fire(side, isAuto) {
        const b = state.pveBattle;
        const chargeMs    = isAuto ? pvpConfig.chargeMaxMs : side.chargeMs;
        side.lastChargeMs = chargeMs;
        side.chargeMs     = 0;
        side.chargeStartT = 0;
        side.lastStrikeT  = Date.now();
        _setPhase(side, 'strike_out', 16);

        const attackerIsPlayer = (side === b.player);
        const defender = attackerIsPlayer ? b.enemy : b.player;
        const aStats   = attackerIsPlayer ? _selfProfile  : _enemyProfile;
        const dStats   = attackerIsPlayer ? _enemyProfile : _selfProfile;

        const r = combatResolver.resolveExchange(
            chargeMs, side, defender, aStats, dStats, Date.now());
        _applyExchange(r, attackerIsPlayer);

        // AI post-strike think delay (reuses the act's old recoveryMs as
        // extra downtime after heavy attacks)
        if (!attackerIsPlayer && b.active) {
            const eData = content.enemies[b.enemyId];
            const rec = (b.ai.currentAct && eData.acts &&
                         eData.acts[b.ai.currentAct] &&
                         eData.acts[b.ai.currentAct].recoveryMs) || 0;
            b.ai.thinkTimer = _rand(b.ai.params.decideDelayMs) + rec;
        }
    }

    function _applyExchange(r, attackerIsPlayer) {
        const b = state.pveBattle;
        const atkSide = attackerIsPlayer ? b.player : b.enemy;
        const defSide = attackerIsPlayer ? b.enemy  : b.player;

        atkSide.hp = Math.max(0, atkSide.hp - r.attackerDmg);
        defSide.hp = Math.max(0, defSide.hp - r.defenderDmg);

        if (r.attackerStunMs > 0) _setPhase(atkSide, 'stunned', r.attackerStunMs);
        if (r.defenderStunMs > 0) _setPhase(defSide, 'stunned', r.defenderStunMs);

        _pushLog(r.logText);
        uiPve.playExchangeFx(r.exchange, attackerIsPlayer);

        // Player HP authority: write back after every exchange
        state.player.currentHp = b.player.hp;

        // Skill points: landing an attack (hit/interrupt/clash) or parrying
        // as defender — mirrors the old "weapon hit or parry" sources
        if (attackerIsPlayer && ['hit', 'interrupt', 'clash'].includes(r.exchange)) _gainSkillPoint();
        if (!attackerIsPlayer && r.exchange === 'parry') _gainSkillPoint();

        // Death first (a clash can kill both — defeat takes priority)
        if (b.player.hp <= 0) { _onDefeat();  return; }
        if (b.enemy.hp  <= 0) { _onVictory(); return; }
    }

    // ── Victory / defeat / drops ──────────────────────────────────────────

    function _rollDrops(enemyId) {
        const eData = content.enemies[enemyId];
        const dropped = [];
        if (eData.drops) {
            eData.drops.forEach(drop => {
                if (Math.random() <= drop.chance) {
                    const amt = drop.amount[0] + Math.floor(Math.random() * (drop.amount[1] - drop.amount[0] + 1));
                    state.inventory.materials[drop.id] = (state.inventory.materials[drop.id] || 0) + amt;
                    dropped.push({ id: drop.id, amt });
                }
            });
        }
        if (dropped.length) {
            const names = dropped.map(d => `${content.materials[d.id].name}×${d.amt}`).join('  ');
            fx.log.loot(names);
        }
        return dropped;
    }

    function _onVictory() {
        const b = state.pveBattle;
        const eData = content.enemies[b.enemyId];
        state.inventory.exp += eData.exp;
        const drops = _rollDrops(b.enemyId);
        fx.log.victory(eData.name, eData.exp);
        b.waitingChoice = true;
        _stopLoop();
        uiPve.updateFrame();
        uiPve.showWinChoice(drops, eData.exp);
    }

    function _onDefeat() {
        const b = state.pveBattle;
        fx.log.death();
        b.active = false;
        _stopLoop();
        uiPve.updateFrame();
        uiPve.showDefeat();
    }

    function _stopLoop() {
        if (_rAF) { cancelAnimationFrame(_rAF); _rAF = null; }
    }

    // ── Main loop ─────────────────────────────────────────────────────────

    function _loop(currentTime) {
        const b = state.pveBattle;
        if (!b || !b.active || b.waitingChoice) return;
        const dt  = Math.min(currentTime - _lastTime, 100);
        _lastTime = currentTime;
        const now = Date.now();

        if (now >= b.startFreezeUntil) {
            // Player HP authority: pick up regen/heals from tick.js
            b.player.hp = Math.min(state.player.currentHp, b.player.maxHp);

            // guard_windup → guard_ready edge, BOTH sides (see _guardWindupComplete)
            if (b.player.phase === 'guard_windup' && b.player.phaseTimer <= dt) _guardWindupComplete(b.player, now);
            if (b.enemy.phase  === 'guard_windup' && b.enemy.phaseTimer  <= dt) _guardWindupComplete(b.enemy, now);

            _tickSide(b.player, dt, now, _selfProfile.spd,  () => _fire(b.player, true));
            _tickSide(b.enemy,  dt, now, _enemyProfile.spd, () => _fire(b.enemy, true));

            _aiThink(dt, now);
            // AI releases its charge at the decided target duration
            if (b.enemy.phase === 'charging' && b.ai.targetChargeMs > 0 &&
                b.enemy.chargeMs >= b.ai.targetChargeMs) {
                _fire(b.enemy, false);
            }
        }

        uiPve.updateFrame();

        if (b.active && !b.waitingChoice) {
            _rAF = requestAnimationFrame(_loop);
        }
    }

    // ── Input gate ────────────────────────────────────────────────────────

    function _inputOk() {
        const b = state.pveBattle;
        return b && b.active && !b.waitingChoice && Date.now() >= b.startFreezeUntil;
    }

    // ── Public API ────────────────────────────────────────────────────────

    return {
        startFight(enemyKey) {
            _stopLoop();
            const eData = content.enemies[enemyKey];
            if (!eData) return;

            _selfProfile  = _buildLocalProfile();
            _enemyProfile = _buildEnemyProfile(eData);
            const isFirst = state.world.currentFightIndex === 0;

            const playerSide = combatResolver.makeSideState(_selfProfile.maxHp);
            // HP persists across fights within a run (currentHp is authority)
            playerSide.hp = Math.min(state.player.currentHp, _selfProfile.maxHp);

            state.pveBattle = {
                active: true,
                waitingChoice: false,
                startFreezeUntil: isFirst ? Date.now() + 1000 : 0,
                enemyId: enemyKey,
                player: playerSide,
                enemy:  combatResolver.makeSideState(_enemyProfile.maxHp),
                skillPoints: 0,
                ai: {
                    params: _aiParams(eData),
                    targetChargeMs: 0,
                    thinkTimer: 600,   // initial hesitation before the first move
                    guardReleaseAt: 0,
                    currentAct: null
                },
                log: []
            };

            state.world.status = 'fighting';
            fx.log.encounter(eData.name);
            uiPve.initFight(eData, isFirst);
            ui.switchTab('battle');

            _lastTime = performance.now();
            _rAF = requestAnimationFrame(_loop);
        },

        continueNext() {
            const area = content.areas[state.world.currentArea];
            state.world.currentFightIndex++;
            uiPve.hideOverlays();
            if (state.world.currentFightIndex < area.encounters.length) {
                fx.log.continueDeep();
                this.startFight(area.encounters[state.world.currentFightIndex]);
            } else {
                fx.log.exploreComplete();
                this.endFight(true);
            }
        },

        safeRetreat() {
            fx.log.retreat();
            this.endFight(true);
        },

        flee() {
            const b = state.pveBattle;
            if (!b || !b.active) return;
            if (Date.now() < b.startFreezeUntil) return;  // blocked during entry freeze
            fx.log.flee();
            this.endFight(true);
        },

        endFight(win) {
            const b = state.pveBattle;
            if (b) { b.active = false; b.waitingChoice = false; }
            _stopLoop();
            if (state.player.currentHp <= 0) {
                state.player.currentHp = Math.max(1, Math.floor(player.getStats().maxHp * 0.1));
            }
            state.world.status = 'base';
            uiPve.hideOverlays();
            ui.switchTab('base');
            ui.updateBase();
        },

        useSkill() {
            const b = state.pveBattle;
            if (!b || !b.active || b.waitingChoice) return;
            if (b.skillPoints < 3) return;
            b.skillPoints -= 3;
            const healAmt = Math.floor(player.getStats().maxHp * 0.3);
            player.heal(healAmt);
            b.player.hp = Math.min(state.player.currentHp, b.player.maxHp);
            fx.log.skill(healAmt);
        },

        // ── Player input (same two-button model as PVP) ───────────────────

        onChargePress() {
            if (!_inputOk()) return;
            const side = state.pveBattle.player;
            if (side.actionPoints < 1) return;
            if (side.phase !== 'idle') return;
            side.actionPoints--;
            side.chargeStartT = Date.now();
            side.chargeMs     = 0;
            _setPhase(side, 'charging', 0);
        },

        onChargeRelease() {
            const b = state.pveBattle;
            if (!b || !b.active || b.waitingChoice) return;
            const side = b.player;
            if (side.phase !== 'charging') return;
            _fire(side, false);
        },

        onGuardPress() {
            if (!_inputOk()) return;
            const side = state.pveBattle.player;
            if (side.phase !== 'idle') return;
            if (side.actionPoints < 1) return;
            _setPhase(side, 'guard_windup', pvpConfig.guardWindupMs);
        },

        onGuardRelease() {
            const b = state.pveBattle;
            if (!b || !b.active) return;
            const side = b.player;
            if (side.phase === 'guard_windup' || side.phase === 'guard_ready') {
                _setPhase(side, 'idle', 0);
                side.lastGuardReadyT = 0;
            }
        }
    };
})();
