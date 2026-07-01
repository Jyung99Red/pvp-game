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

    // Speed multiplier: >1 = slower (penalty), <1 = faster (boost)
    // Sources: iron sword passive penalty + swift ring passive boost + temp activeBuffs
    getActionSpeedMultiplier() {
        let mult = 1.0;
        
        // 1. Base speed conversion: 10 spd = baseline 1.0x, 20 spd halves the time (0.5x)
        const spd = this.getStats().spd || 10;
        mult *= (10 / spd);

        // 2. Negative status effects (e.g. iron sword slow)
        this.getEquippedEffects('action_speed_penalty').forEach(e => { mult *= (1 + e.value); });
        // 3. Accessory passives (e.g. swift ring)
        this.getEquippedEffects('passive_speed_boost').forEach(e => { mult *= (1 - e.value); });
        // 4. Temporary buffs
        const now = Date.now();
        state.battle.activeBuffs.forEach(b => {
            if (b.type === 'action_speed_boost' && b.expiresAt > now) mult *= (1 - b.value);
        });
        
        return mult;
    },

    getGuardDamageMultiplier() {
        let mult = 1.0;
        this.getEquippedEffects('guard_damage_reduce').forEach(e => { mult *= (1 - e.value); });
        return mult;
    },

    getStats() {
        const stats = { ...state.player.baseStats };
        Object.values(state.player.equip).forEach(id => {
            if (!id) return;
            const item = content.items[id];
            if (item) { 
                stats.atk += (item.stats.atk || 0); 
                stats.def += (item.stats.def || 0); 
                // Also applies if gear ever carries an spd stat
                if (item.stats.spd) stats.spd += item.stats.spd;
				if (item.stats.int) stats.int += item.stats.int;
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