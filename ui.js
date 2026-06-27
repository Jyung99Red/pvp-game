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
        // Build area list
        let areaHtml = '';
        for (let key in content.areas) {
            areaHtml += `<button onclick="ui.startExplore('${key}')">探索 [${content.areas[key].name}]</button>`;
        }
        document.getElementById('area-list').innerHTML = areaHtml;

        // Build building list
        this.updateBuildingList();

        // 绑定战斗按钮事件
        document.getElementById('btn-act-left').onclick    = () => battle.playerAction('left');
        document.getElementById('btn-act-right').onclick   = () => battle.playerAction('right');
        document.getElementById('btn-skill').onclick       = () => battle.playerSkill();
        document.getElementById('btn-flee').onclick        = () => battle.playerFlee();
        document.getElementById('btn-continue').onclick    = () => battle.continueNext();
        document.getElementById('btn-retreat-safe').onclick = () => battle.safeRetreat();
		
		const closeModalsOnBG = (e) => {
            if (e.target.classList.contains('modal-overlay-shared') || 
                e.target.id === 'modal-overlay' || 
                e.target.id === 'smithy-overlay' ||
                e.target.id === 'inventory-overlay') { 
                this.closeModal();
                this.closeSmithyModal();
                this.closeAreaModal();
                this.closeBuildingModal();
                this.closeInventoryModal(); 
            }
        };

        // Close modals on overlay click
        document.getElementById('modal-overlay').addEventListener('click', closeModalsOnBG);
        document.getElementById('smithy-overlay').addEventListener('click', closeModalsOnBG);
        document.getElementById('area-overlay').addEventListener('click', closeModalsOnBG);
        document.getElementById('building-overlay').addEventListener('click', closeModalsOnBG);
        document.getElementById('inventory-overlay').addEventListener('click', closeModalsOnBG);

        this.updateBase();
        this.updateEquip();
        this.switchTab('base');
        tick.start();
        this.log("系统已加载。");
    },
	
	openAreaModal() { document.getElementById('area-overlay').classList.add('open'); },
    closeAreaModal() { document.getElementById('area-overlay').classList.remove('open'); },
	
	openInventoryModal() {
        this.updateEquip(); // 打开前刷新最新背包数据
        
        const overlay = document.getElementById('inventory-overlay');
        const box = document.getElementById('inventory-box');
        const anchorPanel = document.getElementById('player-equip-panel');
        
        // 动态计算锚点面板的底部位置
        if (anchorPanel) {
            const rect = anchorPanel.getBoundingClientRect();
            // 让背包盒子的顶部外边距 = 面板的底部坐标 + 8px的间隙
            box.style.marginTop = `${rect.bottom + 8}px`;
        }
        
        overlay.classList.add('open');
    },
    closeInventoryModal() {
        document.getElementById('inventory-overlay').classList.remove('open');
    },
    
    openBuildingModal() { 
        this.updateBuildingList(); 
        document.getElementById('building-overlay').classList.add('open'); 
    },
    closeBuildingModal() { document.getElementById('building-overlay').classList.remove('open'); },

    // 唯一的 startExplore，包含了关闭弹窗的逻辑
    startExplore(areaKey) {
        if (state.world.status !== 'base') return;
        this.closeAreaModal(); // 开始战斗前关闭弹窗
        state.world.currentArea = areaKey;
        state.world.currentFightIndex = 0;
        battle.startFight(content.areas[areaKey].encounters[0]);
    },

    switchTab(tabId) {
        if (state.battle.active && tabId !== 'battle') { ui.log("正在战斗中！"); return; }

        // PVP 对战中或正在建立连接时，禁止切到其他主tab，避免误触导致连接异常中断
        // pvp-battle 本身不是 nav-btn，只能通过代码跳转，所以这里拦截的是"离开"动作
        if (state.pvpBattle && state.pvpBattle.active && tabId !== 'pvp-battle') {
            ui.log("PVP 对战中，无法切换界面！");
            return;
        }
        if (pvpNet.role && !(state.pvpBattle && state.pvpBattle.active) && tabId !== 'pvp-room' && tabId !== 'pvp-battle') {
            // 已经发起/加入房间、还没正式开打（在等待对方连接的中间状态）
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
        if (tabId === 'battle' && !state.battle.active) {
            document.getElementById('enemy-name').innerText = "当前无战斗";
            document.getElementById('battle-actions').classList.add('hidden');
            document.getElementById('post-battle-actions').classList.add('hidden');
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
        if (key === 'hotSpring') {
            if (lv === 0) return { res: 'gold', amt: 50, icon: '💰', resName: '金币' };
            return { res: 'stone', amt: 50 * Math.pow(lv + 1, 2), icon: '🪨', resName: '石材' };
        }
        return { res: 'gold', amt: 50 * Math.pow(lv + 1, 2), icon: '💰', resName: '金币' };
    },

    updateBuildingList() {
        const buildingDefs = {
            goldMine:   { icon: '⛏️', label: '金矿', desc: '每秒产出金币' },
            stoneMine:  { icon: '🪨', label: '采石场', desc: '每秒产出石材' },
            hotSpring:  { icon: '♨️', label: '温泉', desc: '提供HP秒回' },
            smithy:     { icon: '🔨', label: '铁匠铺', desc: '解锁装备制作' }
        };
        let html = '';
        for (const key in buildingDefs) {
            const def  = buildingDefs[key];
            const lv   = state.base.buildings[key] || 0;
            const costData = this._buildingUpgradeCost(key);
            const canAfford = state.resources[costData.res] >= costData.amt;
            const isSmithyBuilt = key === 'smithy' && lv > 0;

            html += `<div class="building-card">
                <div class="building-info">
                    <div class="building-name">${def.icon} ${def.label} <span style="color:#888;font-size:11px;font-weight:normal;">Lv.${lv}</span></div>
                    <div class="building-lv">${def.desc}</div>
                    ${key !== 'smithy' || lv === 0 ? `<div class="building-cost">升级: ${costData.amt} ${costData.icon}</div>` : ''}
                </div>
                ${isSmithyBuilt
                    ? `<button onclick="ui.openSmithyModal()" style="background:#7b4e00;">进入</button>`
                    : `<button onclick="ui.upgradeBuilding('${key}')" ${canAfford ? '' : 'disabled'} style="background:${canAfford ? '#2a5a8f' : '#333'};">升级</button>`
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
        this._renderSmithyRecipes();
        document.getElementById('smithy-overlay').classList.add('open');
    },

    closeSmithyModal() {
        document.getElementById('smithy-overlay').classList.remove('open');
    },

    _renderSmithyRecipes() {
        const equip = state.player.equip;
        const inv   = state.inventory.items;
        let html = '';
        for (const itemId in content.recipes) {
            const recipe  = content.recipes[itemId];
            const item    = content.items[itemId];
            const already = inv[itemId] || 0;
            const equippedCount = Object.values(equip).filter(e => e === itemId).length;

            let reqHtml  = '';
            let canCraft = true;
            for (const matId in recipe.materials) {
                const needed = recipe.materials[matId];
                const owned  = state.inventory.materials[matId] || 0;
                if (owned < needed) canCraft = false;
                const m = content.materials[matId];
                reqHtml += `<span class="${owned >= needed ? 'ok' : 'bad'}">${m.icon}${m.name} ${owned}/${needed}</span>  `;
            }

            html += `<div class="recipe-card">
                <div class="recipe-name">${item.icon} ${item.name} ${(already + equippedCount) > 0 ? `<span style="color:#888;font-size:11px;">（持有 ×${already + equippedCount}）</span>` : ''}</div>
                <div class="recipe-reqs">${reqHtml}</div>
                <button onclick="player.craftItem('${itemId}');ui._renderSmithyRecipes();" ${canCraft ? '' : 'disabled'} style="background:${canCraft ? '#2a6' : '#333'}">
                    ${canCraft ? '🔨 制作' : '材料不足'}
                </button>
            </div>`;
        }
        document.getElementById('smithy-recipe-list').innerHTML = html;
    },

    _renderEffectsHtml(effects) {
        return effects.map(e => {
            if (e.type === 'action_speed_penalty')
                return `<span class="effect-tag effect-penalty">⏱ 行动慢 ${e.value*100}%</span>`;
            if (e.type === 'guard_damage_reduce')
                return `<span class="effect-tag effect-buff">🛡 格挡减伤 ${e.value*100}%</span>`;
            if (e.type === 'passive_speed_boost')
                return `<span class="effect-tag effect-passive">⚡ 速度 +${e.value*100}%（永久）</span>`;
            return '';
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
            slotHtml += `
                <div class="equip-slot-card ${item ? 'filled' : ''}" onclick="${item ? `ui.openEquippedModal('${slot}')` : ''}">
                    <span class="slot-label">${meta.label}</span>
                    <span class="slot-icon">${item ? item.icon : '○'}</span>
                    <span class="slot-name">${item ? item.name : meta.hint}</span>
                    ${item ? `<button class="unequip-btn" onclick="event.stopPropagation();player.equipItem('${slot}',null);">✕</button>` : ''}
                </div>
            `;
        });
        document.getElementById('equip-slots').innerHTML = slotHtml;

        const cells = [];
        for (const id in inv) {
            if ((inv[id] || 0) > 0) cells.push({ kind: 'item', id, qty: inv[id] });
        }
        for (const id in content.materials) {
            const qty = state.inventory.materials[id] || 0;
            if (qty > 0) cells.push({ kind: 'material', id, qty });
        }

        let gridHtml = '';
        for (let i = 0; i < GRID_TOTAL; i++) {
            if (i < cells.length) {
                const c = cells[i];
                if (c.kind === 'item') {
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
            } else {
                gridHtml += `<div class="inv-cell"></div>`;
            }
        }
        document.getElementById('inventory-grid').innerHTML = gridHtml;
        document.getElementById('inv-count').innerText = `${cells.length}/${GRID_TOTAL}`;
    },

    openEquippedModal(slot) {
        const itemId = state.player.equip[slot];
        if (!itemId) return;
        const item = content.items[itemId];
        const meta = content.slotMeta[slot];

        document.getElementById('modal-title').innerText = `${item.icon} ${item.name}（已装备·${meta.label}）`;
        const statsArr = [];
        if (item.stats.atk > 0) statsArr.push(`⚔️ +${item.stats.atk}`);
        if (item.stats.def > 0) statsArr.push(`🛡️ +${item.stats.def}`);
        document.getElementById('modal-stats').innerText = statsArr.length ? statsArr.join('  ') : '无属性加成';

        document.getElementById('modal-effects').innerHTML = this._renderEffectsHtml(item.effects);
        document.getElementById('modal-desc').innerText = item.desc;
        document.getElementById('modal-btns').innerHTML =
            `<button onclick="player.equipItem('${slot}',null);ui.closeModal();" style="background:#553;">卸下装备</button>`;

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
            `💰 ${r.gold} &nbsp; 🪨 ${r.stone} &nbsp; 🧪 EXP: ${state.inventory.exp}` +
            (matLine ? `<br><small style="color:#999;">素材: ${matLine}</small>` : '');

        const h = state.player;
        const s = player.getStats();
        const cost = h.level * 100;
        const canLvUp = state.inventory.exp >= cost;
        
        // 1. 单独渲染标题栏旁边的 等级与经验值
        const levelInfoEl = document.getElementById('player-level-info');
        if (levelInfoEl) {
            levelInfoEl.innerHTML = `<b style="color:#eee;">Lv.${h.level}</b> (${state.inventory.exp}/${cost})`;
        }

        // 2. 单独渲染下面的 攻击/防御/速度 属性
        const statsEl = document.getElementById('player-display-stats');
        if (statsEl) {
            statsEl.innerHTML = `⚔️ ${s.atk} &nbsp; 🛡️ ${s.def} &nbsp; 🧠 ${s.int} &nbsp; ⚡ ${Number(s.spd).toFixed(1)}`;
        }

        const btnLvl = document.getElementById('btn-lvl-up');
        if (btnLvl) {
            btnLvl.disabled = !canLvUp;
            btnLvl.innerText = canLvUp ? '⬆️ 升级' : 'EXP不足';
            btnLvl.style.background = canLvUp ? '#2a9d8f' : '#333';
        }

        document.getElementById('base-player-hp').style.width = `${(h.currentHp / s.maxHp) * 100}%`;
        document.getElementById('base-player-hp-txt').innerText = `${Math.floor(h.currentHp)}/${s.maxHp}`;

        if (document.getElementById('building-list')) this.updateBuildingList();
    }
};