const player = {

    // Collect all effects of a given type from currently equipped items
    getEquippedEffects(type) {
        const result = [];
        Object.values(state.player.equip).forEach(id => {
            if (!id) return;
            const item = content.items[id];
            if (item) item.effects.forEach(e => { if (e.type === type) result.push(e); });
        });
        return result;
    },

    // Folds all equipped effects of `type` into `mult` via the effect registry.
    _applyEffectPass(mult, type) {
        const def = EFFECT_REGISTRY[type];
        if (!def) return mult;
        this.getEquippedEffects(type).forEach(e => { mult = def.apply(mult, e.value); });
        return mult;
    },

    // First equipped item (in slot order) that carries an effect of `type`
    // wins — used for per-item combat-timing values (not multiplicative
    // buffs, so folding them together like _applyEffectPass doesn't apply).
    getFirstEquippedEffectValue(type, fallback) {
        const slotOrder = ['left', 'right', 'armor', 'accessory'];
        for (const slot of slotOrder) {
            const id = state.player.equip[slot];
            if (!id) continue;
            const item = content.items[id];
            if (!item) continue;
            const e = item.effects.find(e => e.type === type);
            if (e) return e.value;
        }
        return fallback;
    },
    getChargeThresholdMs() { return this.getFirstEquippedEffectValue('charge_threshold_ms', pvpConfig.earlyReleaseMs); },
    getParryWindowBaseMs() { return this.getFirstEquippedEffectValue('parry_window_ms', pvpConfig.parryWindowMs); },

    getGuardDamageMultiplier() {
        return this._applyEffectPass(1.0, 'guard_damage_reduce');
    },

    getStats() {
        const stats = { ...state.player.baseStats };
        Object.values(state.player.equip).forEach(id => {
            if (!id) return;
            const item = content.items[id];
            if (item) {
                Object.keys(STAT_REGISTRY).forEach(statKey => {
                    const add = item.stats[statKey];
                    if (add) stats[statKey] = (stats[statKey] || 0) + add;
                });
            }
        });
        return stats;
    },
	

    takeDamage(amount) {
        const def = this.getStats().def;
        // Dynamic armor-ratio damage formula
        const actual = Math.max(1, Math.floor((amount * amount) / (amount + def * 0.5)));
        
        state.player.currentHp = Math.max(0, state.player.currentHp - actual);
        return actual;
    },

    heal(amount) {
        const max = this.getStats().maxHp;
        state.player.currentHp = Math.min(max, state.player.currentHp + amount);
    },
	
	getJudgmentMultiplier() {
        const intValue = this.getStats().int || 10;
        return Math.max(0.5, 1 + (intValue - 10) * 0.03); 
    },

    _applyLevelStats() {
        state.player.level++;
        state.player.baseStats.maxHp += 20;
        state.player.baseStats.atk += 3;
		state.player.baseStats.def += 2;
        state.player.baseStats.spd += 0.2; 
        state.player.baseStats.int += 1;
        
        // Full heal on level up
        state.player.currentHp = this.getStats().maxHp;
    },

    // Standard level-up flow (check exp -> deduct exp -> apply stats -> refresh UI)
    levelUp() {
        const cost = state.player.level * 100;
        if (state.inventory.exp >= cost) {
            state.inventory.exp -= cost;
            
            this._applyLevelStats(); // Invoke the core level-up routine
            
            ui.log(`↑ 角色升级至 Lv.${state.player.level}！`);
            ui.updateBase();
        } else {
            ui.log("经验不足以升级！");
        }
    },

    equipItem(slot, itemId) {
        if (state.world.status === 'fighting') { ui.log("战斗中无法更换装备！"); return; }
        const equip = state.player.equip;
        const inv   = state.inventory.items;

        if (itemId) {
            const item = content.items[itemId];
            if (!item) { ui.log("未知物品！"); return; }
            if (!item.slots.includes(slot)) {
                ui.log(`${item.icon}${item.name} 无法装备到【${content.slotMeta[slot].label}】槽！`);
                return;
            }
            if (!(inv[itemId] >= 1)) {
                ui.log(`背包中没有 ${item.icon}${item.name}！`);
                return;
            }
            const oldId = equip[slot];
            if (oldId) inv[oldId] = (inv[oldId] || 0) + 1;
            inv[itemId]--;
            if (inv[itemId] <= 0) delete inv[itemId];

            equip[slot] = itemId;
            ui.log(`装备: [${content.slotMeta[slot].label}] ← ${item.icon}${item.name}`);
        } else {
            const oldId = equip[slot];
            if (oldId) {
                inv[oldId] = (inv[oldId] || 0) + 1;
                equip[slot] = null;
                ui.log(`卸下: [${content.slotMeta[slot].label}] → 已放回背包`);
            }
        }
        ui.updateBase();
        ui.updateEquip();
    },

    craftItem(itemId) {
        const recipe = content.recipes[itemId];
        if (!recipe) return;
        for (const matId in recipe.materials) {
            const needed = recipe.materials[matId];
            const owned  = state.inventory.materials[matId] || 0;
            if (owned < needed) {
                const m = content.materials[matId];
                ui.log(`材料不足：${m.icon}${m.name} 需要 ×${needed}，当前 ×${owned}`);
                return;
            }
        }
        for (const matId in recipe.materials) {
            state.inventory.materials[matId] -= recipe.materials[matId];
        }
        const item = content.items[itemId];
        state.inventory.items[itemId] = (state.inventory.items[itemId] || 0) + 1;
        ui.log(`🔨 制作成功！获得 ${item.icon}${item.name}`);
        ui.updateEquip();
        ui.updateBase();
    }
};