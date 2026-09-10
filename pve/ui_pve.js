// Formal PVE page adapter. Shared spatial view, isolated DOM and one listener group.
const uiPve = (() => {
    let view = null, input = null, version = 0, abort = null;
    const $ = id => document.getElementById(id);
    const _setClass = (id, name, enabled) => $(id)?.classList.toggle(name, enabled);
    return {
        initFight(eData) {
            this.destroy(); this.hideOverlays();
            const b = state.pveBattle, engine = b.spatial;
            $('pve-floor-label').textContent = `第 ${b.floor} 层${b.isBossFloor ? ' · 首领' : ''}`;
            $('pve-enemy-name').textContent = eData.name; $('pve-enemy-vital').textContent = eData.name;
            view = uiSpatialBattle.create($('view-battle'), engine.config, 'pve-s-');
            version = engine.inputVersion;
            input = combatInput.attach({ action: $('pve-s-action-pad'), guard: $('pve-s-guard-pad') }, {
                press: channel => spatialEngine.press(engine, channel),
                drag: (channel, dx, dy) => spatialEngine.drag(engine, channel, dx, dy),
                release: (channel, cancelled) => spatialEngine.release(engine, channel, cancelled)
            });
            abort = new AbortController();
            window.addEventListener('blur', () => pveLogic.pause(), { signal: abort.signal });
            document.addEventListener('visibilitychange', () => { if (document.hidden) pveLogic.pause(); }, { signal: abort.signal });
            window.addEventListener('pagehide', () => pveLogic.pause(), { signal: abort.signal });
            this.updateFrame();
        },
        updateFrame(events = []) {
            const b = state.pveBattle;
            if (!view || !b?.spatial) return;
            if (b.spatial.inputVersion !== version) { input.clear(); version = b.spatial.inputVersion; }
            view.render(b.spatial, events);
            $('pve-self-sp').textContent = `${b.skillPoints} / 3`;
            for (const [kind, cost] of Object.entries(pveLogic.SKILL_COSTS)) {
                $('pve-skill-' + kind).disabled = !b.spatial.running || b.waitingChoice || b.skillPoints < cost;
            }
            $('pve-buff-display').textContent = [b.spatial.time < b.buffs.chargeHasteUntil ? '疾速' : '', b.buffs.instantCharge ? '长按满蓄待发' : '', b.buffs.autoParry ? '弹反护体' : ''].filter(Boolean).join(' · ');
            $('pve-log').textContent = b.log.slice(0, 2).join('\n');
        },
        clearInputs() { input?.clear(); },
        destroy() { input?.destroy(); view?.destroy(); abort?.abort(); input = null; view = null; abort = null; },
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
