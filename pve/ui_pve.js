// Formal PVE page adapter. Shared spatial view, isolated DOM and one listener group.
const uiPve = (() => {
    let view = null, input = null, version = 0, actionVersion = 0, abort = null, settings = null;
    let renderedAt = 0;
    const $ = id => document.getElementById(id);
    const _setClass = (id, name, enabled) => $(id)?.classList.toggle(name, enabled);
    return {
        initFight(eData) {
            this.destroy(); this.hideOverlays();
            const b = state.pveBattle, engine = b.spatial;
            $('pve-floor-label').textContent = `第 ${b.floor} 层${b.isBossFloor ? ' · 首领' : ''}`;
            $('pve-enemy-name').textContent = eData.name; $('pve-enemy-vital').textContent = eData.name;
            settings = combatSettings.attach($('view-battle'), () => engine); settings.apply(engine);
            view = uiSpatialBattle.create($('view-battle'), engine.config, 'pve-s-');
            version = engine.inputVersion; actionVersion = engine.actionInputVersion;
            input = combatInput.attach({ move: $('pve-s-move-pad'), action: $('pve-s-action-pad'), guard: $('pve-s-guard-pad'), skill: $('pve-s-skill-pad') }, {
                cancel: () => spatialEngine.cancelInputs(engine),
                press: (channel, cx, cy) => spatialEngine.press(engine, channel, cx, cy),
                drag: (channel, dx, dy, cx, cy) => spatialEngine.drag(engine, channel, dx, dy, cx, cy),
                release: (channel, cancelled) => {
                    const kind = spatialEngine.release(engine, channel, cancelled);
                    if (channel === 'skill' && kind) pveLogic.useSkill(kind);
                }
            });
            abort = new AbortController();
            window.addEventListener('blur', () => pveLogic.pause(), { signal: abort.signal });
            document.addEventListener('visibilitychange', () => { if (document.hidden) pveLogic.pause(); else pveLogic.restore(); }, { signal: abort.signal });
            window.addEventListener('pageshow', () => pveLogic.restore(), { signal: abort.signal });
            window.addEventListener('focus', () => pveLogic.restore(), { signal: abort.signal });
            $('pve-s-arena').addEventListener('contextlost', () => pveLogic.pause(), { signal: abort.signal });
            $('pve-s-arena').addEventListener('contextrestored', () => pveLogic.restore(), { signal: abort.signal });
            window.addEventListener('pagehide', () => pveLogic.pause(), { signal: abort.signal });
            this.updateFrame();
        },
        updateFrame(events = []) {
            const b = state.pveBattle;
            if (!view || !b?.spatial) return;
            if (b.spatial.inputVersion !== version) { input.clear(); version = b.spatial.inputVersion; }
            if (b.spatial.actionInputVersion !== actionVersion) { input.clear(true); actionVersion = b.spatial.actionInputVersion; }
            const at = performance.now(), dt = renderedAt ? Math.min(.1, Math.max(0, (at - renderedAt) / 1000)) : 0;
            renderedAt = at;
            view.render(b.spatial, events, dt);
            $('pve-self-sp').textContent = `${b.skillPoints} / 3`;
            for (const [kind, cost] of Object.entries(pveLogic.SKILL_COSTS)) {
                const node = $('pve-s-skill-pad').querySelector(`[data-skill="${kind}"]`);
                const unavailable = !b.spatial.running || b.waitingChoice || b.skillPoints < cost || (kind === 'heal' && b.player.hp >= b.player.maxHp);
                node.classList.toggle('unavailable', unavailable);
                node.setAttribute('aria-disabled', String(unavailable));
            }
            $('pve-buff-display').textContent = [b.spatial.time < b.buffs.chargeHasteUntil ? '疾速' : '', b.buffs.instantCharge ? '长按满蓄待发' : '', b.buffs.autoParry ? '弹反护体' : ''].filter(Boolean).join(' · ');
            $('pve-log').textContent = b.log.slice(0, 2).join('\n');
        },
        refresh() { view?.refresh(); this.updateFrame(); },
        clearInputs() { input?.clear(); },
        destroy() { renderedAt = 0; input?.destroy(); view?.destroy(); settings?.destroy(); abort?.abort(); input = null; view = null; settings = null; abort = null; },
        showPause(show) { $('pve-s-overlay').hidden = !show; this.updateFrame(); },
        showWinChoice(drops, exp, gold) {
            const lootEl = document.getElementById('pve-win-loot');
            if (lootEl) {
                let html = `🧪 EXP +${exp} &nbsp; 💰 +${gold}`;
                html += `<br><span style="color:#e9c46a;">本次探索累计 💰 ${state.world.runGold}</span>` +
                        `<span style="color:#888;font-size:11px;">（阵亡将全部丢失，回城才能入账）</span>`;
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


        showDefeat() { _setClass('pve-defeat-overlay', 'hidden', false); },
        showEmpty() { _setClass('pve-empty-overlay', 'hidden', false); },
        hideOverlays() {
            _setClass('pve-empty-overlay', 'hidden', true);
            _setClass('pve-win-overlay', 'hidden', true); _setClass('pve-defeat-overlay', 'hidden', true);
            if ($('pve-s-overlay')) $('pve-s-overlay').hidden = true;
        }
    };
})();
