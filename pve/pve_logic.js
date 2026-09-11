// Dungeon lifecycle owns rewards; spatialEngine owns all live combat HP/input/time.
const pveLogic = (() => {
    let _rAF = null, _lastTime = 0, _accumulator = 0, _nextId = 0;
    let _random = Math.random;
    const SKILL_COSTS = { heal: 2, haste: 2, full: 2, parry: 3 };
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
        return pool[Math.floor(_random() * pool.length)];
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
        uiPve.clearInputs();
        uiPve.updateFrame();
        uiPve.showWinChoice(drops, eData.exp, goldReward);
    }

    function _onDefeat() {
        const b = state.pveBattle;
        if (b.settled) return;
        b.settled = true;
        state.world.runGold = 0;
        fx.log.death();
        b.active = false;
        _stopLoop();
        uiPve.clearInputs();
        uiPve.updateFrame();
        uiPve.showDefeat();
    }


    function _stopLoop() {
        if (_rAF != null) cancelAnimationFrame(_rAF);
        _rAF = null; _accumulator = 0;
    }
    function _sync() { state.player.currentHp = state.pveBattle.player.hp; }
    function _processEvents() {
        const b = state.pveBattle;
        const events = spatialEngine.drainEvents(b.spatial);
        for (const e of events) {
            if ((e.type === 'hit' && e.side === 'player') || e.type === 'parry') b.skillPoints = Math.min(3, b.skillPoints + 1);
        }
        for (const e of events) {
            const cost = e.type === 'skill_ready' && SKILL_COSTS[e.kind];
            if (cost && b.spatial.running && !b.settled && b.skillPoints >= cost && spatialEngine.useSkill(b.spatial, e.kind)) {
                b.skillPoints -= cost;
                events.push(...spatialEngine.drainEvents(b.spatial));
            }
        }
        _sync();
        uiPve.updateFrame(events);
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
                if (b.regenElapsed >= 1 - 1e-9) {
                    b.regenElapsed -= 1; b.regenTicks++;
                    spatialEngine.heal(engine, (b.regenTicks % 2 === 0 ? 1 : 0) + Math.max(0, (state.base.buildings.hotSpring || 0) - 1));
                }
            }
            _sync(); _processEvents();
            if (engine.result === 'defeat') _onDefeat();
            else if (engine.result === 'victory') _onVictory();
        }
    }
    function _loop(now) {
        _rAF = null;
        const b = state.pveBattle;
        if (!b?.spatial?.running || b.waitingChoice) return;
        advance((now - _lastTime) / 1000); _lastTime = now;
        if (b.spatial.running && !b.waitingChoice) _rAF = requestAnimationFrame(_loop);
    }
    function _beginFight(enemyId, eData, floor, fresh) {
        _stopLoop(); uiPve.destroy();
        const skillPoints = fresh ? 0 : state.pveBattle?.skillPoints || 0;
        const engine = spatialEngine.create(pveProfiles.create(enemyId, eData), _random);
        state.pveBattle = {
            battleId: ++_nextId, spatial: engine, active: true, waitingChoice: false, settled: false, ended: false,
            player: engine.player, enemy: engine.enemy, buffs: engine.buffs,
            enemyId, enemyData: eData, floor, isBossFloor: _isBossFloor(floor), skillPoints,
            arena: arenaEffects.create(eData.arena), log: [], regenElapsed: 0, regenTicks: state.time.tick
        };
        state.world.status = 'fighting';
        fx.log.encounter(eData.name);
        ui.switchTab('battle'); uiPve.initFight(eData, fresh);
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
        enterDungeon() {
            if (state.world.status !== 'base' || state.pveBattle?.active) return;
            const floor = state.progress.checkpointFloor;
            state.world.currentFloor = floor; state.world.runGold = 0;
            const id = _pickFloorEnemyId(floor); _beginFight(id, _scaledEnemyData(id, floor), floor, true);
        },
        continueNext() {
            const b = state.pveBattle;
            if (!b?.active || !b.waitingChoice || b.ended) return;
            b.waitingChoice = false;
            const floor = ++state.world.currentFloor;
            fx.log.continueDeep();
            const id = _pickFloorEnemyId(floor); _beginFight(id, _scaledEnemyData(id, floor), floor, false);
        },
        safeRetreat() {
            if (!state.pveBattle?.waitingChoice) return;
            fx.log.retreat(); this.endFight(true);
        },
        flee() {
            if (!state.pveBattle?.active) return;
            fx.log.flee(); this.endFight(true);
        },
        endFight(win) {
            const b = state.pveBattle;
            if (!b || b.ended) return;
            b.ended = true; b.active = false; b.waitingChoice = false;
            spatialEngine.pause(b.spatial); _stopLoop(); uiPve.destroy();
            const alive = win && b.player.hp > 0;
            const carried = state.world.runGold || 0;
            if (carried > 0) {
                if (alive) { state.resources.gold += carried; fx.log.goldBank(carried); }
                else fx.log.goldLost(carried);
            }
            state.world.runGold = 0;
            if (state.player.currentHp <= 0) state.player.currentHp = Math.max(1, Math.floor(player.getStats().maxHp * .1));
            state.world.status = 'base'; state.world.currentFloor = 0;
            uiPve.hideOverlays(); ui.switchTab('base'); ui.updateBase();
        },
        useSkill(kind) {
            const b = state.pveBattle, cost = SKILL_COSTS[kind];
            if (!b?.active || b.waitingChoice || !b.spatial.running || !cost || b.skillPoints < cost) return;
            // Queued skills spend points only when executed, never when replaced/cancelled.
            if (spatialEngine.queueSkill(b.spatial, kind)) { _processEvents(); return; }
            if (!spatialEngine.useSkill(b.spatial, kind)) return;
            b.skillPoints -= cost; _sync(); _processEvents();
        }
    };
})();
