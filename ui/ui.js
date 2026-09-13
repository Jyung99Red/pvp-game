window.devCheat = function() {
    player._applyLevelStats(); 
    state.resources.gold += 50;
    ui.log(`🛠️ 测试作弊生效：直升 Lv.${state.player.level}，金币+50`);
    ui.updateBase();
};

const ui = {
    init() {
        save.load();   // Read the local save back into state first, then render the UI

        // Build building list
        this.updateBuildingList();

        // (PVE battle buttons are inline-wired in partials/pve-battle.html,
        //  same pattern as the PVP view — no init-time bindings needed)

        this.initPanels();

        this.updateBase();
        this.updateEquip();
        this.switchTab('base');
        tick.start();
        save.startAutosave();
        this.log("系统已加载。");
    },
	
    _panels: [],
    _inventoryFilter: 'all',
    _inventorySearch: '',
    _htmlCache: new Map(),
    _setHtml(id, html) {
        const node = document.getElementById(id);
        if (node && this._htmlCache.get(id) !== html) {
            node.innerHTML = html; this._htmlCache.set(id, html);
        }
    },
    initPanels() {
        // Cached entry shells may still contain the old inline overlays. The
        // fresh base partial now owns all base panels as well as their markup.
        document.querySelectorAll('#inventory-overlay:not(.camp-overlay), #modal-overlay:not(.camp-overlay), #smithy-overlay:not(.camp-overlay), #shop-overlay:not(.camp-overlay)').forEach(node => node.remove());
        document.querySelectorAll('.camp-overlay').forEach(overlay => {
            overlay.addEventListener('click', e => { if (e.target === overlay) this.closePanel(overlay.id); });
        });
        document.addEventListener('keydown', e => {
            const top = this._panels.at(-1);
            if (!top) return;
            if (e.key === 'Escape') { e.preventDefault(); this.closePanel(top.id); }
            if (e.key !== 'Tab') return;
            const dialog = document.getElementById(top.id);
            const nodes = [...dialog.querySelectorAll('button:not(:disabled), input, [tabindex="0"]')].filter(n => n.getClientRects().length);
            const first = nodes[0], last = nodes.at(-1);
            if (!first) { e.preventDefault(); dialog.querySelector('[role="dialog"]').focus(); }
            else if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { e.preventDefault(); first.focus(); }
        });
    },
    _syncPanels() {
        const top = this._panels.at(-1)?.id;
        document.querySelectorAll('.camp-overlay').forEach(node => {
            const depth = this._panels.findIndex(p => p.id === node.id);
            node.classList.toggle('open', depth >= 0);
            node.style.zIndex = 100 + Math.max(0, depth);
            node.inert = node.id !== top;
            node.setAttribute('aria-hidden', String(node.id !== top));
        });
        document.body.classList.toggle('camp-modal-open', !!top);
        document.querySelectorAll('.view-section, .nav-bar').forEach(node => { node.inert = !!top; });
    },
    openPanel(id) {
        if (!this._panels.some(p => p.id === id)) this._panels.push({ id, trigger: document.activeElement });
        this._syncPanels();
        document.getElementById(id).querySelector('.dialog-close')?.focus({ preventScroll: true });
    },
    closePanel(id) {
        const at = this._panels.findIndex(p => p.id === id);
        if (at < 0) return;
        const [closed] = this._panels.splice(at);
        this._syncPanels();
        if (closed.trigger?.isConnected && !closed.trigger.closest('[inert]')) closed.trigger.focus({ preventScroll: true });
        else if (this._panels.length) document.getElementById(this._panels.at(-1).id).querySelector('.dialog-close')?.focus();
    },
    openInventoryModal() { this.updateEquip(); this.openPanel('inventory-overlay'); },
    closeInventoryModal() { this.closePanel('inventory-overlay'); },
    openBuildingModal() { this.updateBuildingList(); this.openPanel('building-overlay'); },
    closeBuildingModal() { this.closePanel('building-overlay'); },

    // Enter the dungeon: always resumes from the saved checkpoint floor
    // (see state.progress.checkpointFloor / pve_logic.js's enterDungeon)
    enterDungeon() {
        if (state.world.status !== 'base') return;
        pveLogic.enterDungeon();
    },

    enterTraining() {
        if (state.world.status !== 'base' || (state.pvpBattle && state.pvpBattle.active) || pvpNet.role) return;
        save.save();
        location.href = 'training.html';
    },

    switchTab(tabId) {
        if (state.pveBattle && state.pveBattle.active && tabId !== 'battle') { ui.log("正在战斗中！"); return; }

        // While a PVP match is active or a connection is being set up, block switching to other main tabs to avoid accidental taps breaking the connection
        // pvp-battle itself isn't a nav-btn (only reachable via code), so what's intercepted here is the "leave" action
        if (state.pvpBattle && state.pvpBattle.active && tabId !== 'pvp-battle') {
            ui.log("PVP 对战中，无法切换界面！");
            return;
        }
        if (pvpNet.role && !(state.pvpBattle && state.pvpBattle.active) && tabId !== 'pvp-room' && tabId !== 'pvp-battle') {
            // Already hosted/joined a room but the match hasn't started yet (mid-state waiting for the opponent's connection)
            ui.log("正在建立PVP连接，请先取消或等待连接完成");
            return;
        }

        state.world.currentTab = tabId;
        if (tabId !== 'base') document.getElementById('camp-toast')?.replaceChildren();
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        document.getElementById(`view-${tabId}`).classList.remove('hidden');
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
        
        // Safely check and activate the corresponding tab element if it exists
        const tabEl = document.getElementById(`tab-${tabId}`);
        if (tabEl) {
            tabEl.classList.add('active');
        }

        if (tabId === 'base') this.updateEquip();
        if (tabId === 'battle' && !(state.pveBattle && state.pveBattle.active)) {
            document.getElementById('pve-enemy-name').innerText = "当前无战斗";
            uiPve.hideOverlays();
            uiPve.showEmpty?.();
        }

        // Mapping hooks for PVP view transitions
        if (tabId === 'pvp-room') {
            // Placeholder: run any initializations on switching to the PVP Room
        }
        if (tabId === 'pvp-battle') {
            // Placeholder: run any initializations on switching to the PVP Battle Arena
        }
    },

    _buildingUpgradeCost(key) {
        const lv = state.base.buildings[key] || 0;
        return { res: 'gold', amt: 50 * Math.pow(lv + 1, 2), icon: '💰', resName: '金币' };
    },

    updateBuildingList() {
        const defs = {
            hotSpring: { mark: '泉', label: '温泉', desc: '提高基地每秒生命回复', detail: lv => `额外回复 ${lv} HP / 秒`, open: 'openBuildingModal' },
            smithy: { mark: '锻', label: '铁匠铺', desc: '使用战利品材料制作装备', detail: () => '装备制作', open: 'openSmithyModal' },
            shop: { mark: '商', label: '商店', desc: '使用金币购买制作材料', detail: () => '材料补给', open: 'openShopModal' }
        };
        let rows = '', cards = '';
        for (const [key, def] of Object.entries(defs)) {
            const lv = state.base.buildings[key] || 0, cost = this._buildingUpgradeCost(key).amt;
            const unlocked = key !== 'hotSpring' && lv > 0;
            cards += `<button class="facility ${lv ? 'is-built' : ''}" onclick="ui.${lv ? def.open : 'openBuildingModal'}()"><span class="facility-mark">${def.mark}</span><strong>${def.label}</strong><small>${lv ? `Lv.${lv} · ${def.detail(lv)}` : '未建造 · 50 金币'}</small></button>`;
            rows += `<article class="facility-row"><span class="facility-mark">${def.mark}</span><div><h3>${def.label} <small>Lv.${lv}</small></h3><p>${def.desc}</p><small>${unlocked ? '设施已开放' : `${lv ? `当前 ${def.detail(lv)} · 升级` : '建造'}需要 ${cost} 金币`}</small></div><button class="${unlocked ? 'camp-primary' : 'camp-action'}" onclick="ui.${unlocked ? `${def.open}()` : `upgradeBuilding('${key}')`}" ${!unlocked && state.resources.gold < cost ? 'disabled' : ''}>${unlocked ? '进入 →' : lv ? '升级' : '建造'}</button></article>`;
        }
        this._setHtml('base-building-list', cards);
        this._setHtml('building-list', rows);
    },

    upgradeBuilding(key) {
        const costData = this._buildingUpgradeCost(key);
        if (state.resources[costData.res] < costData.amt) { ui.log(`${costData.resName}不足！`); return; }
        state.resources[costData.res] -= costData.amt;
        state.base.buildings[key] = (state.base.buildings[key] || 0) + 1;
        const def = content.buildings[key];
        ui.log(`🏗️ ${def.name} 升至 Lv.${state.base.buildings[key]}！`);
        this.updateBuildingList();
        this.updateBase();
    },

    openSmithyModal() {
        if ((state.base.buildings.smithy || 0) === 0) { ui.log('铁匠铺尚未建造！'); return; }
        this._renderSmithyGrid();
        this.openPanel('smithy-overlay');
    },

    closeSmithyModal() {
        this.closePanel('smithy-overlay');
    },

    // Whether every material for a recipe is currently in stock
    _canCraft(recipe) {
        for (const matId in recipe.materials) {
            if ((state.inventory.materials[matId] || 0) < recipe.materials[matId]) return false;
        }
        return true;
    },

    // Total copies of an item owned (bag + equipped instances)
    _ownedCount(itemId) {
        const bag = state.inventory.items[itemId] || 0;
        const worn = Object.values(state.player.equip).filter(e => e === itemId).length;
        return bag + worn;
    },

    // Smithy: 4-per-row grid of craftable equipment; tap a cell for details/craft
    _renderSmithyGrid() {
        let cells = '';
        for (const itemId in content.recipes) {
            const item     = content.items[itemId];
            const canCraft = this._canCraft(content.recipes[itemId]);
            const owned    = this._ownedCount(itemId);
            cells += `
                <button class="inv-cell has-item ${canCraft ? 'craftable' : 'locked'}" onclick="ui.openRecipeModal('${itemId}')">
                    <span class="cell-icon">${item.icon}</span>
                    <span class="cell-name">${item.name}</span>
                    ${canCraft ? '<span class="cell-corner ok">✓</span>' : ''}
                    ${owned > 0 ? `<span class="cell-qty">×${owned}</span>` : ''}
                </button>`;
        }
        this._setHtml('smithy-recipe-list', `<div class="inv-grid">${cells}</div>`);
    },

    // Detail/craft popup for a recipe (reuses the item modal, sits above the smithy grid)
    openRecipeModal(itemId) {
        const item   = content.items[itemId];
        const recipe = content.recipes[itemId];
        if (!item || !recipe) return;

        const owned = this._ownedCount(itemId);
        document.getElementById('modal-title').innerText =
            `${item.icon} ${item.name}` + (owned > 0 ? `（持有 ×${owned}）` : '');

        document.getElementById('modal-stats').innerText = this._itemStats(itemId);
        document.getElementById('modal-effects').innerHTML = this._renderEffectsHtml(item.effects);

        let reqHtml = '<div class="modal-reqs">所需材料：';
        for (const matId in recipe.materials) {
            const needed = recipe.materials[matId];
            const have   = state.inventory.materials[matId] || 0;
            const m      = content.materials[matId];
            reqHtml += `<span class="${have >= needed ? 'ok' : 'bad'}">${m.icon}${m.name} ${have}/${needed}</span> `;
        }
        reqHtml += '</div>';
        document.getElementById('modal-desc').innerHTML = `<div>${item.desc}</div>${reqHtml}`;

        const canCraft = this._canCraft(recipe);
        document.getElementById('modal-btns').innerHTML =
            `<button class="btn-success" onclick="player.craftItem('${itemId}');ui.openRecipeModal('${itemId}');ui._renderSmithyGrid();" ${canCraft ? '' : 'disabled'}>${canCraft ? '🔨 制作' : '材料不足'}</button>`;

        this.openPanel('modal-overlay');
    },

    openShopModal() {
        if ((state.base.buildings.shop || 0) === 0) { ui.log('商店尚未建造！'); return; }
        this._renderShopGrid();
        this.openPanel('shop-overlay');
    },

    closeShopModal() {
        this.closePanel('shop-overlay');
    },

    // Shop: 4-per-row grid of materials; tap a cell for details/purchase
    _renderShopGrid() {
        let cells = '';
        for (const matId in content.shopPrices) {
            const price     = content.shopPrices[matId];
            const m         = content.materials[matId];
            const canAfford = state.resources.gold >= price;
            cells += `
                <button class="inv-cell has-item is-material ${canAfford ? '' : 'locked'}" onclick="ui.openShopItemModal('${matId}')">
                    <span class="cell-icon">${m.icon}</span>
                    <span class="cell-name">${m.name}</span>
                    <span class="cell-price">💰${price}</span>
                </button>`;
        }
        this._setHtml('shop-list', `<div class="inv-grid">${cells}</div>`);
    },

    // Detail/buy popup for a shop material (reuses the item modal, sits above the shop grid)
    openShopItemModal(matId) {
        const m     = content.materials[matId];
        const price = content.shopPrices[matId];
        if (!m || price == null) return;

        const owned     = state.inventory.materials[matId] || 0;
        const canAfford = state.resources.gold >= price;

        document.getElementById('modal-title').innerText = `${m.icon} ${m.name}`;
        document.getElementById('modal-stats').innerText = `💰 单价 ${price}`;
        document.getElementById('modal-effects').innerHTML = '';
        document.getElementById('modal-desc').innerHTML =
            `<div>合成材料</div><div class="modal-reqs">当前持有 ×${owned} ｜ 金币 ${state.resources.gold}</div>`;
        document.getElementById('modal-btns').innerHTML =
            `<button class="btn-success" onclick="player.buyMaterial('${matId}');ui.openShopItemModal('${matId}');ui._renderShopGrid();ui.updateBase();ui.updateEquip();" ${canAfford ? '' : 'disabled'}>${canAfford ? '🛒 购买' : '金币不足'}</button>`;

        this.openPanel('modal-overlay');
    },

    _renderEffectsHtml(effects) {
        return effects.map(e => {
            const def = EFFECT_REGISTRY[e.type];
            return def ? def.label(e.value) : '';
        }).join('');
    },

    log(msg) {
        const logDiv = document.getElementById('log');
        const d = new Date();
        const t = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
        logDiv.insertAdjacentHTML('beforeend', `<div class="log-entry">[${t}] ${msg}</div>`);
        logDiv.scrollTop = logDiv.scrollHeight;
        const toast = document.getElementById('camp-toast');
        if (toast && state.world.currentTab === 'base') {
            toast.textContent = logDiv.lastElementChild.textContent.replace(/^\[.*?\] /, '');
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => { toast.textContent = ''; }, 2400);
        }
        if (logDiv.childElementCount > 60) logDiv.firstElementChild.remove();
    },

    shake(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
        setTimeout(() => el.classList.remove('shake'), 300);
    },

    openItemModal(itemId) {
        const item = content.items[itemId];
        if (!item) return;

        const enhance = player.getEnhanceLevel(itemId);
        document.getElementById('modal-title').innerText = `${item.icon} ${item.name}${enhance ? ` +${enhance}` : ''}`;

        document.getElementById('modal-stats').innerText = this._itemStats(itemId);

        document.getElementById('modal-effects').innerHTML = this._renderEffectsHtml(item.effects);
        document.getElementById('modal-desc').innerText = item.desc;

        let btnsHtml = '';
        item.slots.forEach(slot => {
            const meta  = content.slotMeta[slot];
            const owned = state.inventory.items[itemId] || 0;
            btnsHtml += `<button onclick="player.equipItem('${slot}','${itemId}');ui.closeModal();ui.updateEquip();" ${owned < 1 ? 'disabled' : ''}>装备→${meta.label}</button>`;
        });
        document.getElementById('modal-btns').innerHTML = btnsHtml;

        this.openPanel('modal-overlay');
    },

    closeModal() {
        this.closePanel('modal-overlay');
    },

    filterInventory(kind) {
        this._inventoryFilter = kind;
        document.querySelectorAll('[data-inv-filter]').forEach(n => n.setAttribute('aria-pressed', String(n.dataset.invFilter === kind)));
        this.updateEquip();
    },
    searchInventory(value) { this._inventorySearch = value.trim().toLocaleLowerCase(); this.updateEquip(); },
    _itemStats(itemId) {
        const item = content.items[itemId], mult = 1 + .1 * player.getEnhanceLevel(itemId);
        return Object.entries({ atk: '攻击', def: '防御', int: '智力', spd: '速度', luck: '幸运' })
            .filter(([key]) => item.stats[key] > 0)
            .map(([key, label]) => `${label} +${['atk', 'def'].includes(key) ? Math.round(item.stats[key] * mult) : item.stats[key]}`).join(' · ') || '无基础属性加成';
    },
    updateEquip() {
        const equip = state.player.equip, cells = [], slotOrder = ['left', 'right', 'armor', 'accessory'];
        const slots = slotOrder.map(slot => {
            const id = equip[slot], item = content.items[id], meta = content.slotMeta[slot];
            if (item) cells.push({ kind: 'equipped', slot, id, item, qty: 1 });
            const enh = item ? player.getEnhanceLevel(id) : 0;
            return `<button class="loadout-slot ${item ? 'filled' : ''}" onclick="${item ? `ui.openEquippedModal('${slot}')` : 'ui.openInventoryModal()'}"><span class="loadout-icon">${item ? item.icon : '+'}</span><span><small>${meta.label}</small><strong>${item ? item.name + (enh ? ` +${enh}` : '') : '未装备'}</strong></span><span class="loadout-arrow">›</span></button>`;
        }).join('');
        this._setHtml('equip-slots', slots);
        for (const [id, qty] of Object.entries(state.inventory.items)) if (qty > 0 && content.items[id]) cells.push({ kind: 'item', id, qty, item: content.items[id] });
        for (const [id, qty] of Object.entries(state.inventory.materials)) if (qty > 0 && content.materials[id]) cells.push({ kind: 'material', id, qty, item: content.materials[id] });
        const filtered = cells.filter(c => (this._inventoryFilter === 'all' || (this._inventoryFilter === 'material' ? c.kind === 'material' : c.kind !== 'material')) && c.item.name.toLocaleLowerCase().includes(this._inventorySearch));
        const html = filtered.map(c => {
            const enh = c.kind !== 'material' ? player.getEnhanceLevel(c.id) : 0;
            const action = c.kind === 'equipped' ? `openEquippedModal('${c.slot}')` : c.kind === 'material' ? `openMaterialModal('${c.id}')` : `openItemModal('${c.id}')`;
            return `<button class="inv-cell has-item ${c.kind === 'equipped' ? 'equipped' : c.kind === 'material' ? 'is-material' : ''}" onclick="ui.${action}"><span class="cell-badge">${c.kind === 'equipped' ? `已装备 · ${content.slotMeta[c.slot].label}` : c.kind === 'material' ? '材料' : '装备'}</span><span class="cell-icon">${c.item.icon}</span><span class="cell-name">${c.item.name}${enh ? ` +${enh}` : ''}</span><span class="cell-qty">×${c.qty}</span></button>`;
        }).join('');
        this._setHtml('inventory-grid', html || '<div class="inventory-empty"><strong>暂无物品</strong><span>试试其他分类或搜索词；探索可获取材料。</span></div>');
        document.getElementById('inv-count').textContent = `${filtered.length} 项`;
    },
    openMaterialModal(id) {
        const m = content.materials[id];
        if (!m) return;
        document.getElementById('modal-title').textContent = `${m.icon} ${m.name}`;
        document.getElementById('modal-stats').textContent = `持有 ×${state.inventory.materials[id] || 0}`;
        document.getElementById('modal-effects').innerHTML = '';
        const recipes = Object.keys(content.recipes).filter(key => content.recipes[key].materials[id]).map(key => content.items[key].name);
        document.getElementById('modal-desc').textContent = recipes.length ? `制作材料，可用于：${recipes.join('、')}。` : '探索获得的制作材料。';
        document.getElementById('modal-btns').innerHTML = '';
        this.openPanel('modal-overlay');
    },

    openEquippedModal(slot) {
        const itemId = state.player.equip[slot];
        if (!itemId) return;
        const item = content.items[itemId];
        const meta = content.slotMeta[slot];
        const enhLvl  = player.getEnhanceLevel(itemId);
        const enhTag  = enhLvl > 0 ? ` +${enhLvl}` : '';

        document.getElementById('modal-title').innerText = `${item.icon} ${item.name}${enhTag}（已装备·${meta.label}）`;
        document.getElementById('modal-stats').innerText = this._itemStats(itemId);

        document.getElementById('modal-effects').innerHTML = this._renderEffectsHtml(item.effects);
        document.getElementById('modal-desc').innerText = item.desc;

        // Enhancement is weapons/shields only (see player.enhanceItem)
        let enhBtn = '';
        if (item.type === 'weapon' || item.type === 'shield') {
            const cost   = player.getEnhanceCost(itemId);
            const maxed  = enhLvl >= player.ENHANCE_MAX;
            const canPay = state.resources.gold >= cost;
            enhBtn = `<button class="btn-gold" onclick="player.enhanceItem('${itemId}');ui.openEquippedModal('${slot}');" ${(!maxed && canPay) ? '' : 'disabled'}>` +
                     (maxed ? '⚒️ 已满级' : `⚒️ 强化 (${cost}💰)`) + `</button>`;
        }
        document.getElementById('modal-btns').innerHTML =
            enhBtn +
            `<button onclick="ui.closeModal();ui.openInventoryModal();">🔄 更换</button>` +
            `<button class="btn-unequip" onclick="player.equipItem('${slot}',null);ui.closeModal();">卸下</button>`;

        this.openPanel('modal-overlay');
    },

    updateBase() {
        const t = state.time, h = state.player, stats = player.getStats(), cost = h.level * 100;
        const period = { day: '白昼', dusk: '黄昏', night: '深夜' }[t.period] || '深夜';
        document.getElementById('time-display').textContent = `第 ${t.days} 天 / ${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')} / ${period}`;
        this._setHtml('resource-display', `<div><span>可用金币</span><strong class="gold-number">${state.resources.gold.toLocaleString()}</strong></div><div><span>持有经验</span><strong>${state.inventory.exp.toLocaleString()}</strong></div><div><span>探索起点</span><strong>${state.progress.checkpointFloor}<small> 层</small></strong></div>`);
        document.getElementById('player-level-info').textContent = `Lv.${h.level}`;
        this._setHtml('player-display-stats', [['攻击', stats.atk], ['防御', stats.def], ['智力', stats.int], ['速度', Number(stats.spd).toFixed(1)], ['暴击', `${Math.round(player.getCritChance() * 100)}%`]].map(([label,value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join(''));
        const btn = document.getElementById('btn-lvl-up');
        btn.disabled = state.inventory.exp < cost; btn.textContent = '角色升级 ↑';
        document.getElementById('base-exp-text').textContent = `升级经验 ${state.inventory.exp} / ${cost}`;
        document.getElementById('base-exp-fill').style.width = `${Math.min(100, state.inventory.exp / cost * 100)}%`;
        document.getElementById('base-player-hp').style.width = `${Math.max(0, Math.min(100, h.currentHp / stats.maxHp * 100))}%`;
        document.getElementById('base-player-hp-txt').textContent = `${Math.floor(h.currentHp)} / ${stats.maxHp}`;
        document.getElementById('base-deploy-floor').textContent = `第 ${state.progress.checkpointFloor} 层`;
        document.querySelectorAll('[data-camp-gold]').forEach(n => { n.textContent = state.resources.gold.toLocaleString(); });
        this.updateBuildingList();
    }
};
