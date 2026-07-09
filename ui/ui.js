window.devCheat = function() {
    player._applyLevelStats(); 
    state.resources.gold += 50;
    ui.log(`🛠️ 测试作弊生效：直升 Lv.${state.player.level}，金币+50`);
    ui.updateBase();
};

const GRID_COLS = 4;
const GRID_ROWS = 5;
const GRID_TOTAL = GRID_COLS * GRID_ROWS;

const ui = {
    init() {
        save.load();   // Read the local save back into state first, then render the UI

        // Build building list
        this.updateBuildingList();

        // (PVE battle buttons are inline-wired in partials/pve-battle.html,
        //  same pattern as the PVP view — no init-time bindings needed)

		// Only act when the click lands on the backdrop itself, not the box inside.
        // Layered close: the item modal sits above the inventory (higher z-index),
        // so clicking its backdrop closes only the item modal and leaves the
        // inventory behind it open; clicking the inventory backdrop closes both.
        const closeModalsOnBG = (e) => {
            if (e.target.id === 'modal-overlay') {
                this.closeModal();
            } else if (e.target.id === 'inventory-overlay') {
                this.closeModal();
                this.closeInventoryModal();
            } else if (e.target.id === 'smithy-overlay') {
                this.closeSmithyModal();
            } else if (e.target.id === 'shop-overlay') {
                this.closeShopModal();
            } else if (e.target.classList.contains('modal-overlay-shared')) {
                this.closeBuildingModal();
            }
        };

        // Close modals on overlay click
        document.getElementById('modal-overlay').addEventListener('click', closeModalsOnBG);
        document.getElementById('smithy-overlay').addEventListener('click', closeModalsOnBG);
        document.getElementById('shop-overlay').addEventListener('click', closeModalsOnBG);
        document.getElementById('building-overlay').addEventListener('click', closeModalsOnBG);
        document.getElementById('inventory-overlay').addEventListener('click', closeModalsOnBG);

        this.updateBase();
        this.updateEquip();
        this.switchTab('base');
        tick.start();
        save.startAutosave();
        this.log("系统已加载。");
    },
	
	openInventoryModal() {
        this.updateEquip(); // Refresh latest inventory data before opening
        document.getElementById('inventory-overlay').classList.add('open');
    },
    closeInventoryModal() {
        document.getElementById('inventory-overlay').classList.remove('open');
    },
    
    openBuildingModal() { 
        this.updateBuildingList(); 
        document.getElementById('building-overlay').classList.add('open'); 
    },
    closeBuildingModal() { document.getElementById('building-overlay').classList.remove('open'); },

    // Enter the dungeon: always resumes from the saved checkpoint floor
    // (see state.progress.checkpointFloor / pve_logic.js's enterDungeon)
    enterDungeon() {
        if (state.world.status !== 'base') return;
        pveLogic.enterDungeon();
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
        const buildingDefs = {
            hotSpring:  { icon: '♨️', label: '温泉', desc: '提供HP秒回', gate: false },
            smithy:     { icon: '🔨', label: '铁匠铺', desc: '解锁装备制作', gate: true, openFn: 'openSmithyModal' },
            shop:       { icon: '🛒', label: '商店', desc: '解锁用金币购买素材', gate: true, openFn: 'openShopModal' }
        };
        let html = '';
        for (const key in buildingDefs) {
            const def  = buildingDefs[key];
            const lv   = state.base.buildings[key] || 0;
            const costData = this._buildingUpgradeCost(key);
            const canAfford = state.resources[costData.res] >= costData.amt;
            const isUnlocked = def.gate && lv > 0;

            html += `<div class="building-card">
                <div class="building-info">
                    <div class="building-name">${def.icon} ${def.label} <span style="color:#888;font-size:11px;font-weight:normal;">Lv.${lv}</span></div>
                    <div class="building-lv">${def.desc}</div>
                    ${!def.gate || lv === 0 ? `<div class="building-cost">升级: ${costData.amt} ${costData.icon}</div>` : ''}
                </div>
                ${isUnlocked
                    ? `<button onclick="ui.${def.openFn}()" class="btn-gold">进入</button>`
                    : `<button onclick="ui.upgradeBuilding('${key}')" ${canAfford ? '' : 'disabled'} class="btn-info">升级</button>`
                }
            </div>`;
        }
        document.getElementById('building-list').innerHTML = html;
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
        document.getElementById('smithy-overlay').classList.add('open');
    },

    closeSmithyModal() {
        document.getElementById('smithy-overlay').classList.remove('open');
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
                <div class="inv-cell has-item ${canCraft ? 'craftable' : 'locked'}" onclick="ui.openRecipeModal('${itemId}')">
                    <span class="cell-icon">${item.icon}</span>
                    <span class="cell-name">${item.name}</span>
                    ${canCraft ? '<span class="cell-corner ok">✓</span>' : ''}
                    ${owned > 0 ? `<span class="cell-qty">×${owned}</span>` : ''}
                </div>`;
        }
        document.getElementById('smithy-recipe-list').innerHTML = `<div class="inv-grid">${cells}</div>`;
    },

    // Detail/craft popup for a recipe (reuses the item modal, sits above the smithy grid)
    openRecipeModal(itemId) {
        const item   = content.items[itemId];
        const recipe = content.recipes[itemId];
        if (!item || !recipe) return;

        const owned = this._ownedCount(itemId);
        document.getElementById('modal-title').innerText =
            `${item.icon} ${item.name}` + (owned > 0 ? `（持有 ×${owned}）` : '');

        const statsArr = [];
        if (item.stats.atk > 0) statsArr.push(`⚔️ +${item.stats.atk}`);
        if (item.stats.def > 0) statsArr.push(`🛡️ +${item.stats.def}`);
        if (item.stats.int > 0) statsArr.push(`🧠 +${item.stats.int}`);
        if (item.stats.spd > 0) statsArr.push(`⚡ +${item.stats.spd}`);
        document.getElementById('modal-stats').innerText = statsArr.length ? statsArr.join('  ') : '无属性加成';
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

        document.getElementById('modal-overlay').classList.add('open');
    },

    openShopModal() {
        if ((state.base.buildings.shop || 0) === 0) { ui.log('商店尚未建造！'); return; }
        this._renderShopGrid();
        document.getElementById('shop-overlay').classList.add('open');
    },

    closeShopModal() {
        document.getElementById('shop-overlay').classList.remove('open');
    },

    // Shop: 4-per-row grid of materials; tap a cell for details/purchase
    _renderShopGrid() {
        let cells = '';
        for (const matId in content.shopPrices) {
            const price     = content.shopPrices[matId];
            const m         = content.materials[matId];
            const canAfford = state.resources.gold >= price;
            cells += `
                <div class="inv-cell has-item is-material ${canAfford ? '' : 'locked'}" onclick="ui.openShopItemModal('${matId}')">
                    <span class="cell-icon">${m.icon}</span>
                    <span class="cell-name">${m.name}</span>
                    <span class="cell-price">💰${price}</span>
                </div>`;
        }
        document.getElementById('shop-list').innerHTML = `<div class="inv-grid">${cells}</div>`;
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
            `<button class="btn-success" onclick="player.buyMaterial('${matId}');ui.openShopItemModal('${matId}');ui._renderShopGrid();ui.updateBase();" ${canAfford ? '' : 'disabled'}>${canAfford ? '🛒 购买' : '金币不足'}</button>`;

        document.getElementById('modal-overlay').classList.add('open');
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

        document.getElementById('modal-title').innerText = `${item.icon} ${item.name}`;

        const statsArr = [];
        if (item.stats.atk > 0) statsArr.push(`⚔️ +${item.stats.atk}`);
        if (item.stats.def > 0) statsArr.push(`🛡️ +${item.stats.def}`);
		if (item.stats.int > 0) statsArr.push(`🧠 +${item.stats.int}`);
        document.getElementById('modal-stats').innerText = statsArr.length ? statsArr.join('  ') : '无属性加成';

        document.getElementById('modal-effects').innerHTML = this._renderEffectsHtml(item.effects);
        document.getElementById('modal-desc').innerText = item.desc;

        let btnsHtml = '';
        item.slots.forEach(slot => {
            const meta  = content.slotMeta[slot];
            const owned = state.inventory.items[itemId] || 0;
            btnsHtml += `<button onclick="player.equipItem('${slot}','${itemId}');ui.closeModal();ui.updateEquip();" ${owned < 1 ? 'disabled' : ''}>装备→${meta.label}</button>`;
        });
        document.getElementById('modal-btns').innerHTML = btnsHtml;

        document.getElementById('modal-overlay').classList.add('open');
    },

    closeModal() {
        document.getElementById('modal-overlay').classList.remove('open');
    },

    updateEquip() {
        const equip  = state.player.equip;
        const inv    = state.inventory.items;
        const slotOrder = ['left', 'right', 'armor', 'accessory'];

        let slotHtml = '';
        slotOrder.forEach(slot => {
            const id   = equip[slot];
            const item = id ? content.items[id] : null;
            const meta = content.slotMeta[slot];
            // Empty slot → tap opens the backpack so you can pick something to wear
            slotHtml += `
                <div class="equip-slot-card ${item ? 'filled' : ''}" onclick="${item ? `ui.openEquippedModal('${slot}')` : `ui.openInventoryModal()`}">
                    <span class="slot-label">${meta.label}</span>
                    <span class="slot-icon">${item ? item.icon : '○'}</span>
                    <span class="slot-name">${item ? item.name + (player.getEnhanceLevel(id) > 0 ? `+${player.getEnhanceLevel(id)}` : '') : meta.hint}</span>
                    ${item ? `<button class="unequip-btn" onclick="event.stopPropagation();player.equipItem('${slot}',null);">✕</button>` : ''}
                </div>
            `;
        });
        document.getElementById('equip-slots').innerHTML = slotHtml;

        // Backpack cells: currently-equipped items first (badged "已装备", tap to
        // manage), then unequipped item stacks, then materials. Equipped items
        // are shown for reference/quick-swap and don't count toward the bag total.
        const equippedCells = [];
        slotOrder.forEach(slot => {
            if (equip[slot]) equippedCells.push({ kind: 'equipped', slot, id: equip[slot] });
        });
        const bagCells = [];
        for (const id in inv) {
            if ((inv[id] || 0) > 0) bagCells.push({ kind: 'item', id, qty: inv[id] });
        }
        for (const id in content.materials) {
            const qty = state.inventory.materials[id] || 0;
            if (qty > 0) bagCells.push({ kind: 'material', id, qty });
        }

        const rendered  = [...equippedCells, ...bagCells];
        // Always show at least GRID_TOTAL slots; grow in whole rows when fuller
        const padTarget = Math.max(GRID_TOTAL, Math.ceil(rendered.length / GRID_COLS) * GRID_COLS);
        let gridHtml = '';
        for (let i = 0; i < padTarget; i++) {
            const c = rendered[i];
            if (!c) { gridHtml += `<div class="inv-cell"></div>`; continue; }
            if (c.kind === 'equipped') {
                const item = content.items[c.id];
                const enh  = player.getEnhanceLevel(c.id);
                gridHtml += `
                    <div class="inv-cell has-item equipped" onclick="ui.openEquippedModal('${c.slot}')">
                        <span class="cell-badge">已装备</span>
                        <span class="cell-icon">${item.icon}</span>
                        <span class="cell-name">${item.name}${enh > 0 ? `+${enh}` : ''}</span>
                    </div>`;
            } else if (c.kind === 'item') {
                const item = content.items[c.id];
                gridHtml += `
                    <div class="inv-cell has-item" onclick="ui.openItemModal('${c.id}')">
                        <span class="cell-icon">${item.icon}</span>
                        <span class="cell-name">${item.name}</span>
                        ${c.qty > 1 ? `<span class="cell-qty">×${c.qty}</span>` : ''}
                    </div>`;
            } else {
                const m = content.materials[c.id];
                gridHtml += `
                    <div class="inv-cell has-item is-material">
                        <span class="cell-icon">${m.icon}</span>
                        <span class="cell-name">${m.name}</span>
                        <span class="cell-qty">×${c.qty}</span>
                    </div>`;
            }
        }
        document.getElementById('inventory-grid').innerHTML = gridHtml;
        document.getElementById('inv-count').innerText = `${bagCells.length}/${GRID_TOTAL}`;
    },

    openEquippedModal(slot) {
        const itemId = state.player.equip[slot];
        if (!itemId) return;
        const item = content.items[itemId];
        const meta = content.slotMeta[slot];
        const enhLvl  = player.getEnhanceLevel(itemId);
        const enhTag  = enhLvl > 0 ? ` +${enhLvl}` : '';
        const enhMult = 1 + 0.1 * enhLvl;

        document.getElementById('modal-title').innerText = `${item.icon} ${item.name}${enhTag}（已装备·${meta.label}）`;
        const statsArr = [];
        if (item.stats.atk > 0) statsArr.push(`⚔️ +${Math.round(item.stats.atk * enhMult)}`);
        if (item.stats.def > 0) statsArr.push(`🛡️ +${Math.round(item.stats.def * enhMult)}`);
        if (item.stats.int > 0) statsArr.push(`🧠 +${item.stats.int}`);
        document.getElementById('modal-stats').innerText = statsArr.length ? statsArr.join('  ') : '无属性加成';

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

        document.getElementById('modal-overlay').classList.add('open');
    },

    updateBase() {
        const t    = state.time;
        const pStr = t.period === 'day' ? '☀️白昼' : (t.period === 'dusk' ? '🌆黄昏' : '🌙深夜');
        document.getElementById('time-display').innerText =
            `📅 第${t.days}天 | ${t.hours.toString().padStart(2,'0')}:${t.minutes.toString().padStart(2,'0')} | ${pStr}`;

        const r   = state.resources;
        const mats = state.inventory.materials;
        let matLine = '';
        for (const id in content.materials) {
            const qty = mats[id] || 0;
            if (qty > 0) { const m = content.materials[id]; matLine += `${m.icon}×${qty} `; }
        }

        document.getElementById('resource-display').innerHTML =
            `💰 ${r.gold} &nbsp; 🧪 EXP: ${state.inventory.exp} &nbsp; 🏰 进度: 第${state.progress.checkpointFloor}层` +
            (matLine ? `<br><small style="color:#999;">素材: ${matLine}</small>` : '');

        const h = state.player;
        const s = player.getStats();
        const cost = h.level * 100;
        const canLvUp = state.inventory.exp >= cost;
        
        // 1. Render the level and exp next to the title bar
        const levelInfoEl = document.getElementById('player-level-info');
        if (levelInfoEl) {
            levelInfoEl.innerHTML = `<b style="color:#eee;">Lv.${h.level}</b> (${state.inventory.exp}/${cost})`;
        }

        // 2. Render the atk/def/spd stats below
        const statsEl = document.getElementById('player-display-stats');
        if (statsEl) {
            statsEl.innerHTML = `⚔️ ${s.atk} &nbsp; 🛡️ ${s.def} &nbsp; 🧠 ${s.int} &nbsp; ⚡ ${Number(s.spd).toFixed(1)} &nbsp; 💥 ${Math.round(player.getCritChance() * 100)}%`;
        }

        const btnLvl = document.getElementById('btn-lvl-up');
        if (btnLvl) {
            btnLvl.disabled = !canLvUp;
            btnLvl.innerText = canLvUp ? '⬆️ 升级' : 'EXP不足';
        }

        document.getElementById('base-player-hp').style.width = `${(h.currentHp / s.maxHp) * 100}%`;
        document.getElementById('base-player-hp-txt').innerText = `${Math.floor(h.currentHp)}/${s.maxHp}`;

        if (document.getElementById('building-list')) this.updateBuildingList();
    }
};