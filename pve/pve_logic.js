// Adventure lifecycle owns regional rewards and progression; spatialEngine owns
// all live combat HP/input/time.
const pveLogic = (() => {
    let _rAF = null, _lastTime = 0, _accumulator = 0, _nextId = 0;
    let _displayEvents = [], _pendingDefeat = false;
    // Whether the pause overlay is up. Only `pause`/`resume` own it; it exists
    // so a caller that froze the session for its own reason (a camp modal) can
    // tell whether releasing that freeze would stomp a deliberate pause.
    let _paused = false;
    let _random = Math.random;
    const SKILL_COSTS = Object.freeze({ ...spatialData.skillCosts });
    const _region = id => content.regions[id] || null;
    const _currentRegion = () => _region(state.progress.currentRegionId);
    const _bossDefeated = enemyId => !!state.progress.defeatedBosses[enemyId];
    const _exitOpen = exit => !exit.requiresBoss || _bossDefeated(exit.requiresBoss);
    // Region a IS the base. The status is what grants full hot-spring regen,
    // what lets `startEncounter` fire, and what gates the training post.
    const _statusFor = id => id === 'a' ? 'base' : 'exploring';
    // adventure_world is absent from the scene-less dev/test harness, where the
    // legacy arena stands in and there is no region to hand back to.
    const _hasField = () => typeof adventureWorld !== 'undefined' && adventureWorld.isActive();

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

    // A training fight ends either way without rewards or death: HP was never
    // written back, so the region resumes exactly as it was.
    function _endTraining(outcome) {
        const b = state.pveBattle;
        if (b.settled) return;
        b.settled = true;
        const s = b.spatial.stats;
        adventureWorld.notice(`训练结束 · ${outcome} · 用时 ${Math.floor(b.spatial.elapsed)} 秒 · 命中 ${s.hits}/${s.attacks} · 格挡 ${s.blocks} · 弹反 ${s.parries}`, 8);
        _returnToRegion();
    }
    function _onVictory() {
        const b = state.pveBattle;
        if (b.training) { _endTraining('木桩已击倒'); return; }
        if (b.settled) return;
        b.settled = true;
        const eData = b.enemyData;
        state.inventory.exp += eData.exp;
        const goldReward = Math.round(eData.exp * gameConfig.adventure.goldPerExp);
        state.resources.gold += goldReward;
        const drops = _rollDrops(b.enemyId);
        fx.log.victory(eData.name, eData.exp);   // stays in the log; the toast mirrors it

        if (b.isBoss) {
            state.progress.defeatedBosses[b.enemyId] = true;
            for (const id of b.region.boss?.unlocks || []) state.progress.unlockedRegions[id] = true;
            fx.log.bossDefeated?.(eData.name);
            save.save(); // A boss clear changes permanent world topology immediately.
        }
        if (typeof adventureWorld !== 'undefined') {
            adventureWorld.completeEncounter(b.mapEntityId);
            // Rewards are banked on the spot and the region is handed straight
            // back, so there is no result screen to dismiss -- the summary goes
            // into the region's own log line instead, where the fight just was.
            const loot = drops.map(d => `${content.materials[d.id].name}×${d.amt}`).join(' · ');
            adventureWorld.notice([
                `击败 ${eData.name} · EXP +${eData.exp} · 金币 +${goldReward}`, loot,
                b.isBoss ? '首领已击败，新的区域入口已开启。' : ''
            ].filter(Boolean).join(' · '), 6);
        }
        _returnToRegion();
    }

    function _onDefeat() {
        const b = state.pveBattle;
        if (b.training) { _endTraining('被击倒'); return; }
        if (b.settled) return;
        b.settled = true;
        fx.log.death();
        b.active = false;
        _stopLoop();
        uiAdventure.clearInputs();
        _pendingDefeat = true;
    }
    // Running out of leash is its own outcome: nobody won, no rewards, no
    // overlay -- the region simply resumes where it left off. One-shot guarded
    // because the accumulator can have substeps queued behind this one.
    function _onDisengage() {
        const b = state.pveBattle;
        if (b.settled || b.ended) return;
        b.settled = true; b.ended = true; b.active = false;
        spatialEngine.pause(b.spatial); _stopLoop();
        if (typeof adventureWorld !== 'undefined') {
            adventureWorld.endCombat(b.mapEntityId, { disengaged: true, player: b.spatial.player, enemy: b.spatial.enemy });
        }
        // Without this the encounter guard blocks every later fight in the region.
        state.world.status = _statusFor(b.region.id);
        fx.log.disengaged(b.enemyData.name);
        uiAdventure.hideOverlays();
        _returnToField();
    }
    // Hand the region back to the player. There is no tab to switch to any more:
    // the same view that drew the fight draws the walk, so this only swaps the
    // shared view's config back and resumes the region loop.
    function _returnToField() {
        if (_hasField()) uiAdventure.endFight();
    }
    // Retire the fight and put the walk back on screen. A closure rather than
    // only a method because `_onVictory` runs from inside `advance`.
    function _returnToRegion() {
        const b = state.pveBattle;
        if (!b || b.ended) return false;
        b.ended = true; b.active = false;
        spatialEngine.pause(b.spatial); _stopLoop();
        // The fight moved the player inside its own engine, so the region's own
        // body has to be told where they actually ended up -- without this the
        // walk resumes wherever the encounter started, which reads as the
        // character being yanked back a few steps.
        if (typeof adventureWorld !== 'undefined') {
            adventureWorld.returnFromCombat(b.mapEntityId, b.spatial.result === 'victory', b.spatial.player);
        }
        state.world.status = _statusFor(b.region.id);
        uiAdventure.hideOverlays(); _returnToField();
        return true;
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
        if (!b.training) state.player.currentHp = b.player.hp;
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
    // Render the frame that just advanced and raise any pending outcome overlay.
    // Called from `advance` itself rather than from the loop that drives it, so
    // BOTH drivers present -- the page adapter's single rAF and the scene-less
    // fallback loop -- and neither can forget to.
    function _present() {
        const b = state.pveBattle;
        // `ended` covers the disengage path, which retires the fight without an
        // overlay and hands the region straight back -- nothing left to present.
        if (!b?.spatial || b.ended) return;
        const events = _displayEvents.splice(0);
        uiAdventure.updateFrame(events);
        // Only a defeat still has an outcome to raise: a victory banks its
        // rewards and hands the region straight back in `_onVictory`.
        if (_pendingDefeat) { _pendingDefeat = false; uiAdventure.showDefeat(); }
    }
    function advance(seconds) {
        const b = state.pveBattle;
        if (!b?.active || !b.spatial.running || !Number.isFinite(seconds)) return;
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
                    spatialEngine.heal(engine, ((b.regenTicks % recovery.passiveEveryTicks === 0 ? recovery.passiveHp : 0) +
                        Math.max(0, (state.base.buildings.hotSpring || 0) - recovery.hotSpringCombatPenalty)) * gameConfig.balance.hpScale);
                }
            }
            _sync(); _processEvents();
            if (engine.result === 'defeat') _onDefeat();
            else if (engine.result === 'victory') _onVictory();
            else if (_disengaged(engine, b)) _onDisengage();
        }
        _present();
    }
    // DANGER: this is the SCENE-LESS fallback loop only. In the browser the region
    // session is stepped by `uiAdventure`, which owns the single rAF for walking
    // and fighting both; a second live loop would double-advance the same fight.
    // It survives for the dev shortcut and the headless tests, which mount no
    // adapter -- `_beginFight` is the only place allowed to start it.
    function _loop(now) {
        _rAF = null;
        const b = state.pveBattle;
        if (!b?.spatial?.running) return;
        advance((now - _lastTime) / 1000); _lastTime = now;
        if (b.spatial.running) _rAF = requestAnimationFrame(_loop);
    }
    function _beginFight(enemyId, region, isBoss, mapEntityId = null, training = false) {
        _stopLoop(); _displayEvents = []; _pendingDefeat = false;
        const skillPoints = 0, skillProgress = 0;
        const eData = { ...content.enemies[enemyId] };
        // A live region scene fights in region space at the monster's own
        // position; with no scene (the dev shortcut and its headless tests) the
        // legacy arena stands in unchanged. Training always needs the scene.
        const enlisted = training ? adventureWorld.enlistTraining(enemyId) : _hasField() ? adventureWorld.enlist(enemyId, mapEntityId) : null;
        const engine = spatialEngine.create(enlisted ? enlisted.config : pveProfiles.create(enemyId, eData), _random);
        engine.skillPoints = skillPoints; engine.skillProgress = skillProgress;
        state.pveBattle = {
            battleId: ++_nextId, spatial: engine, active: true, settled: false, ended: false,
            player: engine.player, enemy: engine.enemy, buffs: engine.buffs,
            enemyId, enemyData: eData, regionId: region.id, region, isBoss, mapEntityId, skillPoints, skillProgress, training,
            arena: arenaEffects.create(eData.arena), log: [], regenElapsed: 0, regenTicks: state.time.tick,
            _skillPointsMirror: skillPoints,
            // Leash disengage data. Left at 0 on the legacy arena, which is what
            // disables the rule there.
            home: enlisted?.home || null, leash: enlisted?.leash || 0, alertRange: enlisted?.alertRange || 0
        };
        state.world.status = 'fighting';
        fx.log.encounter(eData.name);
        spatialEngine.start(engine); _lastTime = performance.now();
        // A live region scene is stepped by the page adapter, which owns the one
        // rAF for walking AND fighting -- starting a second loop here would
        // double-advance the fight. This branch is the scene-less dev/test path
        // only: no adapter mounted, and nothing to present to.
        if (_hasField()) uiAdventure.beginFight(eData);
        else _rAF = requestAnimationFrame(_loop);
        if (document.hidden) pause();
    }
    // The pause overlay is shared by both modes. Out of combat it still has to
    // open: the settings it hosts write to whichever engine is live, so they
    // apply to walking too.
    function pause() {
        const b = state.pveBattle;
        if (b?.active) {
            if (b.spatial.running) { spatialEngine.pause(b.spatial); _sync(); }
        } else if (_hasField()) {
            adventureWorld.pauseField();
        } else {
            return;
        }
        _paused = true;
        _stopLoop(); uiAdventure.clearInputs(); uiAdventure.setPaused(true); uiAdventure.showPause(true);
    }
    // Foreground/BFCache return must restore presentation without recreating a fight.
    function restore() {
        const b = state.pveBattle;
        if (b?.ended || document.hidden) return;
        if (b?.active && !b.spatial.result) pause();
        uiAdventure.refresh();
    }
    function resume() {
        const b = state.pveBattle;
        _paused = false;
        uiAdventure.showPause(false);
        if (b?.active && !b.spatial.result) {
            if (!b.spatial.running) {
                _stopLoop(); uiAdventure.refresh();
                spatialEngine.start(b.spatial); _lastTime = performance.now();
                if (!_hasField()) _rAF = requestAnimationFrame(_loop);
            }
        } else if (_hasField()) {
            adventureWorld.startField();
        }
        uiAdventure.setPaused(false);
        uiAdventure.refresh();
    }
    return {
        SKILL_COSTS, advance, pause, resume, restore,
        isPaused: () => _paused,
        setRandom(random) { _random = random; },
        isRegionUnlocked(id) {
            return !!_region(id) && !!state.progress.unlockedRegions[id];
        },
        isBossDefeated(enemyId) {
            return _bossDefeated(enemyId);
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
            state.world.status = _statusFor(toId);
            save.save();
            if (toId === 'a') { ui.switchTab('base'); ui.updateBase(); }
            else { ui.switchTab('adventure'); ui.updateAdventure?.(); }
            return true;
        },
        // The interact key: what the move pad's tap does while a structure is in
        // reach (the adapter is the only caller -- nothing in the simulation may
        // open a panel on its own). `kind` is dispatched explicitly here rather
        // than looked up from the data, so the set of reachable UI calls stays
        // readable from this one place.
        interact() {
            if (state.pveBattle?.active) return false;
            if (typeof adventureWorld === 'undefined' || !adventureWorld.isActive()) return false;
            const target = adventureWorld.scene()?.interaction;
            if (!target) return false;
            switch (target.kind) {
                case 'hotSpring': {
                    // The walking engine carries its own copy of the body, so it
                    // has to be healed too or the next fight starts from the old HP.
                    const field = adventureWorld.scene()?.field;
                    state.player.currentHp = player.getStats().maxHp;
                    if (field) field.player.hp = field.player.maxHp;
                    ui.log(`♨️ ${target.label}：体力已完全恢复`);
                    return true;
                }
                // Neither facility exists before it is built. The build panel is
                // then the only way forward -- and with the old base page gone,
                // this is its only door as well.
                case 'smithy':
                case 'shop': {
                    if ((state.base.buildings[target.kind] || 0) === 0) { ui.openBuildingModal(); return true; }
                    if (target.kind === 'smithy') ui.openSmithyModal(); else ui.openShopModal();
                    return true;
                }
                case 'storage': ui.openInventoryModal(); return true;
                case 'build': ui.openBuildingModal(); return true;
                case 'training': return this.startTraining();
                default: return false;
            }
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
        // The base's training post: a formal fight against a dummy, with the
        // same move table, parameters and equipment -- but no rewards and no
        // death. The combo tree is shown while it runs.
        startTraining() {
            if (state.world.status !== 'base' || state.pveBattle?.active || !_hasField()) return false;
            const enemyId = gameConfig.adventure.trainingEnemyId;
            if (!content.enemies[enemyId]) return false;
            _beginFight(enemyId, _currentRegion(), false, null, true);
            return true;
        },
        startRandomEncounter() {
            const region = _currentRegion(), pool = region?.encounters || [];
            if (!pool.length) return false;
            return this.startEncounter(pool[Math.floor(_random() * pool.length)]);
        },
        returnToRegion() { return _returnToRegion(); },
        flee() {
            if (!state.pveBattle?.active) return;
            fx.log.flee(); this.returnToRegion();
        },
        endFight() {
            const b = state.pveBattle;
            if (!b || b.ended) return;
            b.ended = true; b.active = false;
            spatialEngine.pause(b.spatial); _stopLoop();
            if (state.player.currentHp <= 0) state.player.currentHp = Math.max(1, Math.floor(player.getStats().maxHp * gameConfig.progression.recovery.reviveHpRatio));
            state.progress.currentRegionId = 'a'; state.world.status = 'base';
            state.world.arrivalFrom = null;
            // Leaving to base unmounts the region session, which is what tears the
            // shared view down -- there is no per-fight destroy any more.
            uiAdventure.hideOverlays(); ui.switchTab('base'); ui.updateBase();
        },
        // Kept as a dev/test shortcut. It starts one normal B-area encounter,
        // not an endless floor run.
        enterDungeon() {
            if (state.progress.currentRegionId === 'a') this.travel('b');
            return this.startRandomEncounter();
        },
        useSkill(kind) {
            const b = state.pveBattle, cost = b?.spatial?.config.skills?.[kind]?.cost;
            if (!b?.active || !b.spatial.running || !cost || b.skillPoints < cost) return;
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
