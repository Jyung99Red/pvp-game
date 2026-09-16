// Region page adapter. Owns the single rAF, the single shared spatial view, the
// single input group and the region's DOM for one region session.
//
// Walking and fighting are the same loop reading a different engine: the solo
// region preset while exploring, the fight's own engine from contact to
// resolution. That is what removes the cut between the overworld and a battle --
// same canvas, same camera, same pads, no tab switch, no teardown.
const uiAdventure = (() => {
    let view = null, input = null, settings = null, abort = null;
    let version = 0, actionVersion = 0, renderedAt = 0, lastAt = 0;
    let raf = null, mounted = false, paused = false, hint = null;
    const $ = id => document.getElementById(id);
    const root = () => $('view-adventure');
    const _setClass = (id, name, enabled) => $(id)?.classList.toggle(name, enabled);
    // Walking reads the solo preset; fighting reads the fight's own. Every shared
    // surface -- input dispatch, combat settings, the rendered snapshot -- points
    // at whichever of the two is live, so neither mode needs its own plumbing.
    const field = () => adventureWorld.scene()?.field || null;
    const isFighting = () => !!(state.pveBattle && state.pveBattle.active);
    const active = () => (isFighting() ? state.pveBattle.spatial : field());

    // One class on the root drives the whole fight-only HUD group (vitals, legend,
    // enemy state, clock), so there is no per-node show/hide to keep in sync. The
    // topbar centre doubles as the region label, which is why the resting text is
    // set here rather than left to the markup.
    function setFightHud(fighting) {
        root()?.classList.toggle('walking', !fighting);
        if (fighting) return;
        const region = content.regions[state.progress.currentRegionId];
        $('adv-floor-label').textContent = region ? region.name : '区域地图';
        $('adv-enemy-name').textContent = '探索中';
    }
    // Region hints are written here rather than in adventure_world, which owns no
    // DOM. A notice (a blocked gate) outranks the region's resting line.
    function syncHint() {
        const scene = adventureWorld.scene();
        if (!scene) return;
        const text = scene.notice || scene.hint;
        if (text === hint) return;
        hint = text;
        $('adventure-hint').textContent = text;
    }
    // The move pad is the only movement control in both modes, so the label has
    // to stop advertising an attack while there is nothing to attack.
    function setLabels(eData) {
        const b = state.pveBattle;
        $('adv-floor-label').textContent = `${b.region.name}${b.isBoss ? ' · 首领' : ''}`;
        $('adv-enemy-name').textContent = eData.name;
        $('adv-enemy-vital').textContent = eData.name;
    }
    function syncSkillPad(engine) {
        const b = state.pveBattle, pad = $('adv-s-skill-pad');
        if (!pad) return;
        for (const [kind, skill] of Object.entries(engine.config.skills || spatialData.skills)) {
            const node = pad.querySelector(`[data-skill="${kind}"]`);
            if (!node) continue;
            // A solo engine never banks SP, so walking leaves every skill
            // unavailable without needing a special case here.
            const unavailable = !engine.running || !b?.active || b.waitingChoice ||
                b.skillPoints < skill.cost || (kind === 'heal' && b.player.hp >= b.player.maxHp);
            node.classList.toggle('unavailable', unavailable);
            node.setAttribute('aria-disabled', String(unavailable));
        }
    }
    function updateFrame(events = []) {
        const engine = active();
        if (!view || !engine) return;
        if (engine.inputVersion !== version) { input?.clear(); version = engine.inputVersion; }
        if (engine.actionInputVersion !== actionVersion) { input?.clear(true); actionVersion = engine.actionInputVersion; }
        const at = performance.now(), dt = renderedAt ? Math.min(.1, Math.max(0, (at - renderedAt) / 1000)) : 0;
        renderedAt = at;
        view.render(engine, events, dt);
        const b = state.pveBattle;
        if (isFighting()) {
            const spMax = b.spatial.config.skillPointMax;
            $('adv-self-sp').textContent = `${b.skillPoints} / ${spMax}${b.skillPoints < spMax && b.skillProgress > 0 ? ` · ${Math.floor(b.skillProgress * 100)}%` : ''}`;
            $('adv-buff-display').textContent = [b.spatial.time < b.buffs.chargeHasteUntil ? '疾速' : '', b.buffs.instantCharge ? '长按满蓄待发' : '', b.buffs.autoParry ? '弹反护体' : ''].filter(Boolean).join(' · ');
            $('adv-s-log').textContent = b.log.slice(0, 2).join('\n');
        } else {
            $('adv-self-sp').textContent = '0 / 3';
            $('adv-buff-display').textContent = '';
            $('adv-s-log').textContent = '';
        }
        syncSkillPad(engine);
        syncHint();
    }
    function hideOverlays() {
        _setClass('adv-win-overlay', 'hidden', true); _setClass('adv-defeat-overlay', 'hidden', true);
        if ($('adv-s-overlay')) $('adv-s-overlay').hidden = true;
    }
    function _frame(now) {
        raf = null;
        if (!mounted || paused) return;
        // `lastAt` is seeded on the first frame after a start, so a resume never
        // bills the region for the wall-clock time it spent paused.
        const dt = lastAt ? Math.min(.1, Math.max(0, (now - lastAt) / 1000)) : 0;
        lastAt = now;
        // The world keeps stepping in both modes: a fight happens inside the
        // region rather than replacing it, so patrols carry on around the duel.
        // `adventureWorld` is what stops that from starting a second fight.
        adventureWorld.stepWorld(dt);
        if (isFighting()) pveLogic.advance(dt);      // presents itself through updateFrame
        else updateFrame();
        if (mounted && !paused) raf = requestAnimationFrame(_frame);
    }
    function startLoop() {
        if (raf != null || !mounted) return;
        paused = false; lastAt = 0;
        raf = requestAnimationFrame(_frame);
    }
    function stopLoop() {
        if (raf != null) cancelAnimationFrame(raf);
        raf = null;
    }
    function _attach() {
        abort?.abort(); abort = new AbortController();
        const signal = abort.signal;
        input = combatInput.attach({
            move: $('adv-s-move-pad'), guard: $('adv-s-guard-pad'), skill: $('adv-s-skill-pad')
        }, {
            // Both modes route through the same three calls; `active()` is read per
            // event, so a fight starting or ending mid-gesture retargets cleanly.
            cancel: () => { const e = active(); if (e) spatialEngine.cancelInputs(e); },
            press: (channel, cx, cy) => { const e = active(); return !!e && spatialEngine.press(e, channel, cx, cy); },
            drag: (channel, dx, dy, cx, cy) => { const e = active(); if (e) spatialEngine.drag(e, channel, dx, dy, cx, cy); },
            release: (channel, cancelled) => {
                const e = active();
                if (!e) return;
                const kind = spatialEngine.release(e, channel, cancelled);
                if (channel === 'skill' && kind) pveLogic.useSkill(kind);
            }
        });
        window.addEventListener('blur', () => pveLogic.pause(), { signal });
        document.addEventListener('visibilitychange', () => { if (document.hidden) pveLogic.pause(); else pveLogic.restore(); }, { signal });
        window.addEventListener('pageshow', () => pveLogic.restore(), { signal });
        window.addEventListener('focus', () => pveLogic.restore(), { signal });
        $('adventure-world').addEventListener('contextlost', () => pveLogic.pause(), { signal });
        $('adventure-world').addEventListener('contextrestored', () => pveLogic.restore(), { signal });
        window.addEventListener('pagehide', () => pveLogic.pause(), { signal });
    }
    return {
        // Enter a region session. Re-entering the same region reuses the scene;
        // travelling rebuilds it, which is what re-runs the arrival spawn.
        mount() {
            const rootEl = $('view-adventure');
            if (!rootEl) return false;
            // Always `enter`, even when already mounted: it is what rebuilds the
            // scene when the region changed, and travelling reaches the new map
            // through this same tab.
            if (!adventureWorld.enter()) return false;
            const engine = field();
            if (mounted) {
                view.useConfig(engine.config);
                settings.apply(engine);
                version = engine.inputVersion; actionVersion = engine.actionInputVersion;
                input?.clear();
                renderedAt = 0;
                startLoop(); updateFrame();
                return true;
            }
            mounted = true; renderedAt = 0; hint = null;
            view = uiSpatialBattle.create(rootEl, engine.config, 'adv-s-', {
                canvasId: 'adventure-world', layer: { world: (ctx, offer) => adventureWorld.worldLayer(ctx, offer) }
            });
            // One listener group per session, never per fight: combatInput has no
            // handled flag, so a second attach over the same pads would dispatch
            // every gesture to the engine twice.
            settings = combatSettings.attach(rootEl, () => active());
            settings.apply(engine);
            version = engine.inputVersion; actionVersion = engine.actionInputVersion;
            _attach();
            setFightHud(false);
            startLoop();
            updateFrame();
            return true;
        },
        // Leave the tab. The scene and the world survive; only the loop and the
        // listeners go, so walking resumes exactly where it stopped.
        unmount() {
            mounted = false; stopLoop();
            input?.destroy(); view?.destroy(); settings?.destroy(); abort?.abort();
            input = null; view = null; settings = null; abort = null;
            adventureWorld.leave();
            setFightHud(false);
        },
        // Contact: swap the shared view onto the fight's engine. The player and the
        // monster have not moved, and both presets carry the same camera, so this
        // is a config swap and nothing else -- no cut, no zoom jump, no camera jump.
        beginFight(eData) {
            const b = state.pveBattle;
            if (!view || !b?.spatial) return;
            adventureWorld.pauseField();
            hideOverlays();
            view.useConfig(b.spatial.config);
            settings.apply(b.spatial);
            version = b.spatial.inputVersion; actionVersion = b.spatial.actionInputVersion;
            input?.clear();
            setFightHud(true);
            setLabels(eData);
            renderedAt = 0;
            startLoop();
        },
        // Fight resolved (win, flee, disengage or death): hand the region back.
        endFight() {
            adventureWorld.resumeField();
            const engine = field();
            if (!engine) return;
            view?.useConfig(engine.config);
            settings?.apply(engine);
            version = engine.inputVersion; actionVersion = engine.actionInputVersion;
            input?.clear();
            setFightHud(false);
            renderedAt = 0;
            startLoop();
            updateFrame();
        },
        updateFrame, syncHint,
        refresh() { view?.refresh(); updateFrame(); },
        clearInputs() { input?.clear(); },
        // The pause overlay is reachable while walking too: the settings it hosts
        // write to whichever engine is live, so they apply to both modes.
        setPaused(value) {
            if (!mounted) return;
            if (value) { stopLoop(); paused = true; } else startLoop();
        },
        showPause(show) { if ($('adv-s-overlay')) $('adv-s-overlay').hidden = !show; updateFrame(); },
        showWinChoice(drops, exp, gold, isBoss) {
            const lootEl = document.getElementById('adv-win-loot');
            if (lootEl) {
                let html = `🧪 EXP +${exp} &nbsp; 💰 +${gold}`;
                html += `<br><span style="color:#e9c46a;">奖励已立即入账</span>`;
                if (isBoss) html += `<br><span style="color:#b9d69d;">首领已击败，新的区域入口已开启。</span>`;
                if (drops && drops.length) {
                    html += '<br>' + drops.map(d => {
                        const m = content.materials[d.id];
                        return `${m.icon} ${m.name} ×${d.amt}`;
                    }).join('　');
                }
                lootEl.innerHTML = html;
            }
            _setClass('adv-win-overlay', 'hidden', false);
        },
        showDefeat() { _setClass('adv-defeat-overlay', 'hidden', false); },
        hideOverlays
    };
})();
