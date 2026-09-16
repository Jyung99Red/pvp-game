// Adventure lifecycle owns regional rewards and progression; spatialEngine owns
// all live combat HP/input/time.
const pveLogic = (() => {
    let _rAF = null, _lastTime = 0, _accumulator = 0, _nextId = 0;
    let _displayEvents = [], _pendingOutcome = null;
    let _random = Math.random;
    const SKILL_COSTS = Object.freeze({ ...spatialData.skillCosts });
    const _region = id => content.regions[id] || null;
    const _currentRegion = () => _region(state.progress.currentRegionId);
    const _bossDefeated = enemyId => !!state.progress.defeatedBosses[enemyId];
    const _exitOpen = exit => !exit.requiresBoss || _bossDefeated(exit.requiresBoss);

    function _rollDrops(enemyId) {
        const eData = content.enemies[enemyId];
        const dropped = [];
        if (eData.drops) {
            eData.drops.forEach(drop => {
                if (_random() <= drop.chance) {
                    const amt = drop.amount[0] + Math.floor(_random() * (drop.amount[1] - drop.amount[0] + 1));
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
        if (b.settled) return;
        b.settled = true;
        const eData = b.enemyData;
        state.inventory.exp += eData.exp;
        const goldReward = Math.round(eData.exp * gameConfig.adventure.goldPerExp);
        state.resources.gold += goldReward;
        const drops = _rollDrops(b.enemyId);
        fx.log.victory(eData.name, eData.exp);

        if (b.isBoss) {
            state.progress.defeatedBosses[b.enemyId] = true;
            for (const id of b.region.boss?.unlocks || []) state.progress.unlockedRegions[id] = true;
            fx.log.bossDefeated?.(eData.name);
            save.save(); // A boss clear changes permanent world topology immediately.
        }
        if (typeof adventureWorld !== 'undefined') adventureWorld.completeEncounter(b.mapEntityId);

        b.waitingChoice = true;
        _stopLoop();
        uiPve.clearInputs();
        _pendingOutcome = { type: 'victory', drops, exp: eData.exp, gold: goldReward, isBoss: b.isBoss };
    }

    function _onDefeat() {
        const b = state.pveBattle;
        if (b.settled) return;
        b.settled = true;
        fx.log.death();
        b.active = false;
        _stopLoop();
        uiPve.clearInputs();
        _pendingOutcome = { type: 'defeat' };
    }
    // Running out of leash is its own outcome: nobody won, no rewards, no
    // overlay -- the region simply resumes where it left off. One-shot guarded
    // because the accumulator can have substeps queued behind this one.
    function _onDisengage() {
        const b = state.pveBattle;
        if (b.settled || b.ended) return;
        b.settled = true; b.ended = true; b.active = false; b.waitingChoice = false;
        spatialEngine.pause(b.spatial); _stopLoop(); uiPve.destroy();
        if (typeof adventureWorld !== 'undefined') {
            adventureWorld.endCombat(b.mapEntityId, { disengaged: true, player: b.spatial.player, enemy: b.spatial.enemy });
        }
        // Without this the encounter guard blocks every later fight in the region.
        state.world.status = 'exploring';
        fx.log.disengaged(b.enemyData.name);
        uiPve.hideOverlays(); ui.switchTab('adventure'); ui.updateAdventure?.();
    }
    // Mirrors adventure_world's own leash rule so territory feels identical on
    // both sides of the encounter boundary. The engine's AI has no home
    // awareness, so the leash lives here as an overlay; PVP and training have
    // none, and the legacy arena leaves leash at 0.
    function _disengaged(engine, b) {
        if (!(b.leash > 0) || !b.home || !engine.enemy) return false;
        return Math.hypot(engine.enemy.x - b.home.x, engine.enemy.y - b.home.y) > b.leash &&
            Math.hypot(engine.enemy.x - engine.player.x, engine.enemy.y - engine.player.y) > b.alertRange;
    }


    function _stopLoop() {
        if (_rAF != null) cancelAnimationFrame(_rAF);
        _rAF = null; _accumulator = 0;
    }
    function _sync() {
        const b = state.pveBattle;
        state.player.currentHp = b.player.hp;
        // Keep the old outer mirror usable for callers/tests while the engine
        // owns the fractional clock during normal simulation.
        const externallyChanged = b._skillPointsMirror != null && b.skillPoints !== b._skillPointsMirror;
        if (externallyChanged) {
            b.spatial.skillPoints = Math.max(0, Math.min(b.spatial.config.skillPointMax, Math.floor(b.skillPoints)));
            b.spatial.skillProgress = Math.max(0, Math.min(.999999, b.skillProgress || 0));
        } else {
            b.skillPoints = b.spatial.skillPoints;
            b.skillProgress = b.spatial.skillProgress;
        }
        b._skillPointsMirror = b.skillPoints;
    }
    function _processEvents() {
        const b = state.pveBattle;
        const events = spatialEngine.drainEvents(b.spatial);
        for (const e of events) {
            const cost = e.type === 'skill_ready' && b.spatial.config.skills?.[e.kind]?.cost;
            if (cost && b.spatial.running && !b.settled && b.skillPoints >= cost && spatialEngine.useSkill(b.spatial, e.kind)) {
                b.spatial.skillPoints -= cost;
                b.skillPoints = b.spatial.skillPoints;
                events.push(...spatialEngine.drainEvents(b.spatial));
            }
        }
        _sync();
        _displayEvents.push(...events);
    }
    function _present() {
        const b = state.pveBattle;
        // `ended` covers the disengage path, which retires the fight without an
        // overlay and destroys the view -- nothing left to present.
        if (!b?.spatial || b.ended) return;
        const events = _displayEvents.splice(0);
        uiPve.updateFrame(events);
        if (_pendingOutcome) {
            const outcome = _pendingOutcome; _pendingOutcome = null;
            if (outcome.type === 'victory') uiPve.showWinChoice(outcome.drops, outcome.exp, outcome.gold, outcome.isBoss);
            else uiPve.showDefeat();
        }
    }
    function advance(seconds) {
        const b = state.pveBattle;
        if (!b?.active || b.waitingChoice || !b.spatial.running || !Number.isFinite(seconds)) return;
        // Fixed 10ms steps, bounded catch-up; visibility loss pauses explicitly.
        _accumulator += Math.max(0, Math.min(seconds, .1));
        while (_accumulator >= .01 - 1e-9 && b.spatial.running && !b.settled) {
            _accumulator = Math.max(0, _accumulator - .01);
            const engine = b.spatial;
            // The only seconds -> milliseconds boundary for arena effects.
            const events = arenaEffects.tick(b.arena, engine, 10);
            engine.apRateMult = b.arena?.apRateMult || 1;
            spatialEngine.step(engine, .01, true);
            for (const ev of events) {
                if (ev.text) { b.log.unshift(ev.text); b.log.length = Math.min(20, b.log.length); }
                if (ev.type === 'damage') spatialEngine.environment(engine, ev.playerDmg, ev.enemyDmg);
            }
            // Resolve all attacks and environment in the same step; defeat wins ties.
            spatialEngine.settle(engine);
            if (engine.running) {
                b.regenElapsed += .01;
                const recovery = gameConfig.progression.recovery;
                if (b.regenElapsed >= 1 - 1e-9) {
                    b.regenElapsed -= 1; b.regenTicks++;
                    spatialEngine.heal(engine, (b.regenTicks % recovery.passiveEveryTicks === 0 ? recovery.passiveHp : 0) +
                        Math.max(0, (state.base.buildings.hotSpring || 0) - recovery.hotSpringCombatPenalty));
                }
            }
            _sync(); _processEvents();
            if (engine.result === 'defeat') _onDefeat();
            else if (engine.result === 'victory') _onVictory();
            else if (_disengaged(engine, b)) _onDisengage();
        }
    }
    function _loop(now) {
        _rAF = null;
        const b = state.pveBattle;
        if (!b?.spatial?.running || b.waitingChoice) return;
        advance((now - _lastTime) / 1000); _lastTime = now;
        _present();
        if (b.spatial.running && !b.waitingChoice) _rAF = requestAnimationFrame(_loop);
    }
    function _beginFight(enemyId, region, isBoss, mapEntityId = null) {
        _stopLoop(); _displayEvents = []; _pendingOutcome = null; uiPve.destroy();
        const skillPoints = 0, skillProgress = 0;
        const eData = { ...content.enemies[enemyId] };
        // A live region scene fights in region space at the monster's own
        // position; with no scene (the dev shortcut and its headless tests) the
        // legacy arena stands in unchanged.
        const enlisted = typeof adventureWorld !== 'undefined' && adventureWorld.isActive()
            ? adventureWorld.enlist(enemyId, mapEntityId) : null;
        const engine = spatialEngine.create(enlisted ? enlisted.config : pveProfiles.create(enemyId, eData), _random);
        engine.skillPoints = skillPoints; engine.skillProgress = skillProgress;
        state.pveBattle = {
            battleId: ++_nextId, spatial: engine, active: true, waitingChoice: false, settled: false, ended: false,
            player: engine.player, enemy: engine.enemy, buffs: engine.buffs,
            enemyId, enemyData: eData, regionId: region.id, region, isBoss, mapEntityId, skillPoints, skillProgress,
            arena: arenaEffects.create(eData.arena), log: [], regenElapsed: 0, regenTicks: state.time.tick,
            _skillPointsMirror: skillPoints,
            // Leash disengage data. Left at 0 on the legacy arena, which is what
            // disables the rule there.
            home: enlisted?.home || null, leash: enlisted?.leash || 0, alertRange: enlisted?.alertRange || 0
        };
        state.world.status = 'fighting';
        fx.log.encounter(eData.name);
        if (typeof adventureWorld !== 'undefined') adventureWorld.deactivate();
        ui.switchTab('battle'); uiPve.initFight(eData);
        spatialEngine.start(engine); _lastTime = performance.now();
        _rAF = requestAnimationFrame(_loop);
        if (document.hidden) pause();
    }
    function pause() {
        const b = state.pveBattle;
        if (!b?.active || b.waitingChoice || !b.spatial.running) return;
        spatialEngine.pause(b.spatial); _stopLoop(); uiPve.clearInputs(); uiPve.showPause(true); _sync();
    }
    // Foreground/BFCache return must restore presentation without recreating a fight.
    function restore() {
        const b = state.pveBattle;
        if (!b?.spatial || b.ended || document.hidden) return;
        if (b.active && !b.waitingChoice && !b.spatial.result && b.spatial.started) {
            spatialEngine.pause(b.spatial); _stopLoop(); uiPve.clearInputs();
            uiPve.showPause(true); _sync();
        }
        uiPve.refresh();
    }
    function resume() {
        const b = state.pveBattle;
        if (!b?.active || b.waitingChoice || b.spatial.result || b.spatial.running) return;
        _stopLoop(); uiPve.refresh();
        spatialEngine.start(b.spatial); uiPve.showPause(false); _lastTime = performance.now();
        _rAF = requestAnimationFrame(_loop);
    }
    return {
        SKILL_COSTS, advance, pause, resume, restore,
        setRandom(random) { _random = random; },
        isRegionUnlocked(id) {
            return !!_region(id) && !!state.progress.unlockedRegions[id];
        },
        isBossDefeated(enemyId) {
            return _bossDefeated(enemyId);
        },
        openAdventure() {
            if (state.pveBattle?.active) return false;
            const region = _currentRegion();
            if (!region) return false;
            if (region.id !== 'a') state.world.status = 'exploring';
            ui.switchTab('adventure'); ui.updateAdventure?.();
            return true;
        },
        travel(toId) {
            if (state.pveBattle?.active) return false;
            const region = _currentRegion();
            const exit = region?.exits?.find(item => item.to === toId);
            if (!exit) return false;
            if (!_exitOpen(exit)) {
                ui.log('深渊裂隙被巨龙的力量封锁。');
                return false;
            }
            state.progress.unlockedRegions[toId] = true;
            state.world.arrivalFrom = region.id;
            state.progress.currentRegionId = toId;
            state.world.status = toId === 'a' ? 'base' : 'exploring';
            save.save();
            if (toId === 'a') { ui.switchTab('base'); ui.updateBase(); }
            else { ui.switchTab('adventure'); ui.updateAdventure?.(); }
            return true;
        },
        startEncounter(enemyId, mapEntityId = null) {
            if (state.world.status !== 'exploring' || state.pveBattle?.active) return false;
            const region = _currentRegion();
            if (!region) return false;
            const isBoss = region.boss?.enemyId === enemyId;
            const allowed = isBoss ? !_bossDefeated(enemyId) : region.encounters?.includes(enemyId);
            if (!allowed || !content.enemies[enemyId]) return false;
            _beginFight(enemyId, region, isBoss, mapEntityId);
            return true;
        },
        startRandomEncounter() {
            const region = _currentRegion(), pool = region?.encounters || [];
            if (!pool.length) return false;
            return this.startEncounter(pool[Math.floor(_random() * pool.length)]);
        },
        returnToRegion() {
            const b = state.pveBattle;
            if (!b || b.ended) return false;
            b.ended = true; b.active = false; b.waitingChoice = false;
            spatialEngine.pause(b.spatial); _stopLoop(); uiPve.destroy();
            if (typeof adventureWorld !== 'undefined') adventureWorld.returnFromCombat(b.mapEntityId, b.spatial.result === 'victory');
            state.world.status = 'exploring';
            uiPve.hideOverlays(); ui.switchTab('adventure'); ui.updateAdventure?.();
            return true;
        },
        safeRetreat() {
            if (!state.pveBattle?.waitingChoice) return;
            fx.log.retreat(); this.returnToRegion();
        },
        flee() {
            if (!state.pveBattle?.active) return;
            fx.log.flee(); this.returnToRegion();
        },
        endFight() {
            const b = state.pveBattle;
            if (!b || b.ended) return;
            b.ended = true; b.active = false; b.waitingChoice = false;
            spatialEngine.pause(b.spatial); _stopLoop(); uiPve.destroy();
            if (state.player.currentHp <= 0) state.player.currentHp = Math.max(1, Math.floor(player.getStats().maxHp * gameConfig.progression.recovery.reviveHpRatio));
            state.progress.currentRegionId = 'a'; state.world.status = 'base';
            state.world.arrivalFrom = null;
            uiPve.hideOverlays(); ui.switchTab('base'); ui.updateBase();
        },
        // Kept as a dev/test shortcut. It starts one normal B-area encounter,
        // not an endless floor run.
        enterDungeon() {
            if (state.progress.currentRegionId === 'a') this.travel('b');
            return this.startRandomEncounter();
        },
        useSkill(kind) {
            const b = state.pveBattle, cost = b?.spatial?.config.skills?.[kind]?.cost;
            if (!b?.active || b.waitingChoice || !b.spatial.running || !cost || b.skillPoints < cost) return;
            // Keep direct legacy/UI writes compatible while the engine owns
            // fractional time-based SP during simulation.
            b.spatial.skillPoints = b.skillPoints;
            b.spatial.skillProgress = b.skillProgress || 0;
            // Queued skills spend points only when executed, never when replaced/cancelled.
            if (spatialEngine.queueSkill(b.spatial, kind)) { _processEvents(); return; }
            if (!spatialEngine.useSkill(b.spatial, kind)) return;
            b.spatial.skillPoints -= cost; b.skillPoints = b.spatial.skillPoints; _sync(); _processEvents();
        }
    };
})();
