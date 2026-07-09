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
//   - Fight chaining (drops, exp, death→10% HP) ported from the old
//     battle.js semantics; floor-to-floor progression (this file's
//     enterDungeon/continueNext) replaces the old fixed-area system.

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
            guardDamageMultiplier: player.getGuardDamageMultiplier(),
            earlyReleaseMs:    player.getChargeThresholdMs(),
            parryWindowBaseMs: player.getParryWindowBaseMs(),
            critChance:  player.getCritChance(),
            guardThorns: player.getGuardThorns(),
            apMax:       player.getApMax()
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
            guardDamageMultiplier: o.guardDamageMultiplier || 1,
            earlyReleaseMs:    o.earlyReleaseMs    || pvpConfig.earlyReleaseMs,
            parryWindowBaseMs: o.parryWindowBaseMs || pvpConfig.parryWindowMs,
            critChance:  o.critChance  || 0,
            guardThorns: o.guardThorns || 0,
            apMax:       o.apMax       || pvpConfig.apMax
        };
    }

    // ── Roguelike floors ─────────────────────────────────────────────────
    // Every content.bossFloorInterval'th floor (9, 18, 27...) is a boss
    // floor, rotating through content.bossRotation. Other floors draw one
    // enemy at random from the tier whose maxFloor covers the ABSOLUTE
    // floor number (floors past the last tier keep drawing from it).
    // Only hp/atk/def/exp scale with floor depth -- timing fields (acts,
    // baseMsCharge, ai overrides) come through unscaled via the spread.

    function _isBossFloor(floor) {
        return floor % content.bossFloorInterval === 0;
    }

    function _pickFloorEnemyId(floor) {
        if (_isBossFloor(floor)) {
            const idx = Math.floor(floor / content.bossFloorInterval) - 1;
            return content.bossRotation[idx % content.bossRotation.length];
        }
        const tier = content.floorPools.find(t => floor <= t.maxFloor) || content.floorPools[content.floorPools.length - 1];
        const pool = tier.pool;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function _scaledEnemyData(baseId, floor) {
        const base  = content.enemies[baseId];
        const scale = 1 + (floor - 1) * 0.08;
        return {
            ...base,
            hp:  Math.round(base.hp  * scale),
            atk: Math.round(base.atk * scale),
            def: Math.round(base.def * scale),
            exp: Math.round(base.exp * scale)
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
            guardHoldMs:   o.guardHoldMs   || [500, 1400],
            // Phase 3: boss-fight toolkit -- every enemy defaults to "off",
            // only content.enemies[key].ai overrides turn these on.
            comboChance:     o.comboChance     != null ? o.comboChance : 0,
            comboDelayMs:    o.comboDelayMs    || [150, 350],
            comboMax:        o.comboMax        != null ? o.comboMax : 1,
            enrageThreshold: o.enrageThreshold != null ? o.enrageThreshold : 0,
            enrageAtkMult:   o.enrageAtkMult   || 1.3,
            enrageSpdMult:   o.enrageSpdMult   || 1.2
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
        return Math.min(Math.max(base, _enemyProfile.earlyReleaseMs + 100), pvpConfig.chargeMaxMs);
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

    function _tickSide(side, dt, now, spd, onAutoFire, chargeRate = 1, apRateMult = 1) {
        const apCap = side.apMax || pvpConfig.apMax;
        // AP recovery (paused while charging or guarding);
        // apRateMult > 1 = arena ap_surge effect speeding both sides up
        if (!['charging', 'guard_windup', 'guard_ready'].includes(side.phase)) {
            if (side.actionPoints < apCap) {
                side.actionProgress += (dt * apRateMult) / combatResolver.apRecoveryMs(spd);
                if (side.actionProgress >= 1) {
                    side.actionPoints++;
                    side.actionProgress = side.actionPoints < apCap
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
            // chargeRate > 1 = the haste skill buff: charge fills faster
            side.chargeMs = (now - side.chargeStartT) * chargeRate;
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

        // Enrage: edge-triggered once when HP drops at/below the threshold.
        // Multiplies the enemy's real combat profile (not just AI timing),
        // so it actually hits harder/faster, not just "acts" more aggressive.
        if (!ai.enraged && ai.params.enrageThreshold > 0 && e.hp / e.maxHp <= ai.params.enrageThreshold) {
            ai.enraged = true;
            _enemyProfile.atk = Math.round(ai.baseAtk * ai.params.enrageAtkMult);
            _enemyProfile.spd = ai.baseSpd * ai.params.enrageSpdMult;
            _pushLog(`⚡ ${content.enemies[b.enemyId].name} 陷入狂暴！`);
        }

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
            const eData  = content.enemies[b.enemyId];
            const act    = _rollAct(ai.params.actWeights);
            const jitter = 1 + (Math.random() * 2 - 1) * ai.params.chargeJitter;
            ai.currentAct     = act;
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

        let r = combatResolver.resolveExchange(
            chargeMs, side, defender, aStats, dStats, Date.now());

        // Auto-parry buff: an enemy attack that would land clean (hit or
        // interrupt) is re-judged against a synthetic guard_ready defender,
        // so the resolver computes a proper parry (counter damage + attacker
        // stun). The real player side isn't touched -- parry deals the
        // defender no damage and no stun, so an ongoing player charge
        // continues unbroken, which is the whole point of the buff.
        if (!attackerIsPlayer && b.buffs.autoParry > 0 &&
            (r.exchange === 'hit' || r.exchange === 'interrupt')) {
            b.buffs.autoParry--;
            const wallNow = Date.now();
            const ghost = Object.assign({}, defender, { phase: 'guard_ready', lastGuardReadyT: wallNow });
            r = combatResolver.resolveExchange(chargeMs, side, ghost, aStats, dStats, wallNow);
            _pushLog('🔮 弹反护体生效！');
        }

        _applyExchange(r, attackerIsPlayer);

        // AI post-strike think delay (reuses the act's old recoveryMs as
        // extra downtime after heavy attacks), or a short combo follow-up
        // instead. No need to special-case "was this attack parried/clashed":
        // parry/clash stun the enemy for 1000/600ms, both far longer than
        // comboDelayMs, and _aiThink only decides while phase === 'idle' --
        // so a successful parry/clash already breaks the chain for free.
        if (!attackerIsPlayer && b.active) {
            const eData = content.enemies[b.enemyId];
            const rec = (b.ai.currentAct && eData.acts &&
                         eData.acts[b.ai.currentAct] &&
                         eData.acts[b.ai.currentAct].recoveryMs) || 0;

            const canChain = b.ai.comboCount < b.ai.params.comboMax && Math.random() < b.ai.params.comboChance;
            if (canChain) {
                b.ai.comboCount++;
                b.ai.thinkTimer = _rand(b.ai.params.comboDelayMs);
            } else {
                b.ai.comboCount = 0;
                b.ai.thinkTimer = _rand(b.ai.params.decideDelayMs) + rec;
            }
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

    // Apply the events arenaEffects.tick() emitted this frame: log lines
    // and environmental damage. Same death rules as exchanges (defeat
    // takes priority when a burn tick kills both).
    function _applyArenaEvents(events) {
        const b = state.pveBattle;
        for (const ev of events) {
            if (!b.active || b.waitingChoice) return;
            if (ev.text) _pushLog(ev.text);
            if (ev.type === 'damage') {
                b.player.hp = Math.max(0, b.player.hp - ev.playerDmg);
                b.enemy.hp  = Math.max(0, b.enemy.hp  - ev.enemyDmg);
                // Player HP authority: write back like any exchange does
                state.player.currentHp = b.player.hp;
                if (b.player.hp <= 0) { _onDefeat();  return; }
                if (b.enemy.hp  <= 0) { _onVictory(); return; }
            }
        }
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
        const eData = b.enemyData; // the scaled data used for this fight (exp reflects floor depth)
        state.inventory.exp += eData.exp;
        // Gold accumulates into world.runGold (at risk!) rather than being
        // paid out immediately -- it's banked into resources only on making
        // it back to base alive, and lost entirely on death. This is what
        // makes "继续深入 vs 携宝回城" an actual decision.
        const goldReward = Math.round(eData.exp * 0.6);
        state.world.runGold += goldReward;
        const drops = _rollDrops(b.enemyId);
        fx.log.victory(eData.name, eData.exp);

        // Checkpoint: only advances when a boss floor is cleared, and only
        // forward (retreating after re-clearing an earlier boss floor
        // shouldn't move the checkpoint backward -- it can't anyway since
        // floor only increases within a run, but the guard is cheap insurance).
        if (b.isBossFloor && b.floor + 1 > state.progress.checkpointFloor) {
            state.progress.checkpointFloor = b.floor + 1;
            fx.log.checkpoint(b.floor);
        }

        b.waitingChoice = true;
        _stopLoop();
        uiPve.updateFrame();
        uiPve.showWinChoice(drops, eData.exp, goldReward);
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

            // Arena effects tick first so this frame's apRateMult is fresh;
            // their damage/log events are applied after the exchanges below
            // (a fire() may already have ended the fight)
            const arenaEvents = arenaEffects.tick(
                b.arena, { player: b.player, enemy: b.enemy }, dt);
            const apRateMult = b.arena ? b.arena.apRateMult : 1;

            const hasteRate = now < b.buffs.chargeHasteUntil ? 1.5 : 1;
            _tickSide(b.player, dt, now, _selfProfile.spd,  () => _fire(b.player, true), hasteRate, apRateMult);
            _tickSide(b.enemy,  dt, now, _enemyProfile.spd, () => _fire(b.enemy, true), 1, apRateMult);

            _aiThink(dt, now);
            // AI releases its charge at the decided target duration
            if (b.enemy.phase === 'charging' && b.ai.targetChargeMs > 0 &&
                b.enemy.chargeMs >= b.ai.targetChargeMs) {
                _fire(b.enemy, false);
            }

            if (b.active && !b.waitingChoice) _applyArenaEvents(arenaEvents);
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

    // Shared fight-start body -- floor is already resolved by the caller
    // (enterDungeon / continueNext) into an enemyId + scaled eData.
    function _beginFight(enemyId, eData, floor, isFreshEntry) {
        _stopLoop();

        // Skill points carry across floors within a run (continueNext);
        // only a fresh dungeon entry (i.e. leaving/returning to base first) resets them.
        const carriedSkillPoints = isFreshEntry ? 0 : (state.pveBattle ? state.pveBattle.skillPoints : 0);

        _selfProfile  = _buildLocalProfile();
        _enemyProfile = _buildEnemyProfile(eData);

        const playerSide = combatResolver.makeSideState(_selfProfile.maxHp, _selfProfile.apMax);
        // HP persists across fights within a run (currentHp is authority)
        playerSide.hp = Math.min(state.player.currentHp, _selfProfile.maxHp);

        state.pveBattle = {
            active: true,
            waitingChoice: false,
            startFreezeUntil: isFreshEntry ? Date.now() + 1000 : 0,
            enemyId,
            enemyData: eData,
            floor,
            isBossFloor: _isBossFloor(floor),
            player: playerSide,
            enemy:  combatResolver.makeSideState(_enemyProfile.maxHp, _enemyProfile.apMax),
            enemyProfile: _enemyProfile,
            // Battlefield effects from content.enemies[key].arena (null for
            // most enemies; currently only bosses define any)
            arena: arenaEffects.create(eData.arena),
            skillPoints: carriedSkillPoints,
            // Skill buffs (see useSkill): haste = faster charge fill until
            // the timestamp; instantCharge = next charge press is instantly
            // full; autoParry = charges that convert an incoming clean hit
            // into a parry (deliberately does NOT break the player's own
            // ongoing charge -- a parried attacker deals no interrupt)
            buffs: { chargeHasteUntil: 0, instantCharge: false, autoParry: 0 },
            ai: {
                params: _aiParams(eData),
                targetChargeMs: 0,
                thinkTimer: 600,   // initial hesitation before the first move
                guardReleaseAt: 0,
                currentAct: null,
                comboCount: 0,
                enraged: false,
                baseAtk: _enemyProfile.atk,
                baseSpd: _enemyProfile.spd
            },
            log: []
        };

        state.world.status = 'fighting';
        fx.log.encounter(eData.name);
        uiPve.initFight(eData, isFreshEntry);
        ui.switchTab('battle');

        _lastTime = performance.now();
        _rAF = requestAnimationFrame(_loop);
    }

    // ── Public API ────────────────────────────────────────────────────────

    return {
        // Always resumes from the saved checkpoint floor -- a run never
        // starts at floor 1 once a boss floor has been cleared.
        enterDungeon() {
            const floor = state.progress.checkpointFloor;
            state.world.currentFloor = floor;
            state.world.runGold = 0;
            const enemyId = _pickFloorEnemyId(floor);
            _beginFight(enemyId, _scaledEnemyData(enemyId, floor), floor, true);
        },

        continueNext() {
            uiPve.hideOverlays();
            const floor = ++state.world.currentFloor;
            fx.log.continueDeep();
            const enemyId = _pickFloorEnemyId(floor);
            _beginFight(enemyId, _scaledEnemyData(enemyId, floor), floor, false);
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

            // Run-gold settlement: banked on making it back alive, lost on death
            const carried = state.world.runGold || 0;
            if (carried > 0) {
                if (win) {
                    state.resources.gold += carried;
                    fx.log.goldBank(carried);
                } else {
                    fx.log.goldLost(carried);
                }
            }
            state.world.runGold = 0;

            if (state.player.currentHp <= 0) {
                state.player.currentHp = Math.max(1, Math.floor(player.getStats().maxHp * 0.1));
            }
            state.world.status = 'base';
            state.world.currentFloor = 0;
            uiPve.hideOverlays();
            ui.switchTab('base');
            ui.updateBase();
        },

        SKILL_COSTS: { heal: 3, haste: 1, full: 2, parry: 2 },

        useSkill(kind) {
            const b = state.pveBattle;
            if (!b || !b.active || b.waitingChoice) return;
            const cost = this.SKILL_COSTS[kind];
            if (!cost || b.skillPoints < cost) return;

            switch (kind) {
                case 'heal': {
                    const healAmt = Math.floor(player.getStats().maxHp * 0.3);
                    player.heal(healAmt);
                    b.player.hp = Math.min(state.player.currentHp, b.player.maxHp);
                    fx.log.skill(healAmt);
                    break;
                }
                case 'haste':
                    b.buffs.chargeHasteUntil = Date.now() + 10000;
                    _pushLog('⚡ 疾速！10秒内蓄力速度提升 50%');
                    break;
                case 'full':
                    if (b.buffs.instantCharge) return; // already queued, don't waste pips
                    b.buffs.instantCharge = true;
                    _pushLog('🔥 蓄势待发！下一次攻击直接满蓄力');
                    break;
                case 'parry':
                    if (b.buffs.autoParry >= 1) return; // cap at one charge
                    b.buffs.autoParry = 1;
                    _pushLog('🔮 弹反护体！下一次受击将自动弹反');
                    break;
                default:
                    return;
            }
            b.skillPoints -= cost;
        },

        // ── Player input (same two-button model as PVP) ───────────────────

        onChargePress() {
            if (!_inputOk()) return;
            const b = state.pveBattle;
            const side = b.player;
            if (side.actionPoints < 1) return;
            if (side.phase !== 'idle') return;
            side.actionPoints--;
            side.chargeStartT = Date.now();
            side.chargeMs     = 0;
            // Instant-full-charge buff: backdate the charge start so the
            // very next tick reads full charge and auto-fires
            if (b.buffs.instantCharge) {
                b.buffs.instantCharge = false;
                side.chargeStartT = Date.now() - pvpConfig.chargeMaxMs;
            }
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
