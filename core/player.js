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
    // wins — used for absolute values such as the shield parry window (not
    // multiplicative buffs, so folding them like _applyEffectPass doesn't apply).
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
    getWeapon() {
        const slotOrder = ['left', 'right'];
        for (const slot of slotOrder) {
            const item = content.items[state.player.equip[slot]];
            if (item?.type === 'weapon') return item;
        }
        return null;
    },
    // Baseline plus the equipped weapon's own chargeOffsetMs. Weapon
    // enhancement only scales atk/def, so it never moves this threshold.
    getChargeThresholdMs() {
        return combatRules.weaponChargeThresholdMs(this.getWeapon()?.chargeOffsetMs);
    },
    getParryWindowBaseMs() { return this.getFirstEquippedEffectValue('parry_window_ms', combatRules.parryWindowMs); },

    getInsight() { return this.getStats().insight ?? gameConfig.progression.insight.baseline; },
    getFocus() { return this.getStats().focus ?? gameConfig.resources.focusBaseline; },
    getParryWindowMultiplier() {
        const rule = gameConfig.progression.insight;
        return Math.max(rule.minMultiplier, 1 + (this.getInsight() - rule.baseline) * rule.windowPerPoint);
    },

    // Luck contribution plus flat crit_chance item effects.
    getCritChance() {
        let c = (this.getStats().luck || 0) * gameConfig.progression.critChancePerLuck;
        this.getEquippedEffects('crit_chance').forEach(e => { c += e.value; });
        return c;
    },

    getGuardThorns() {
        let t = 0;
        this.getEquippedEffects('guard_thorns').forEach(e => { t += e.value; });
        return t;
    },

    getApMax() {
        let m = combatRules.apMax;
        this.getEquippedEffects('ap_max_bonus').forEach(e => { m += e.value; });
        return m;
    },

    getGuardDamageMultiplier() {
        return this._applyEffectPass(1.0, 'guard_damage_reduce');
    },
    getSpatialMotion() {
        return {
            move: this._applyEffectPass(1, 'spatial_move_speed'),
            turn: this._applyEffectPass(1, 'spatial_turn_speed'),
            chargeMove: this._applyEffectPass(1, 'charge_move_speed'),
            chargeTurn: this._applyEffectPass(1, 'charge_turn_speed')
        };
    },

    getStats() {
        const stats = { ...state.player.baseStats };
        Object.values(state.player.equip).forEach(id => {
            if (!id) return;
            const item = content.items[id];
            if (item) {
                const enhMult = 1 + gameConfig.progression.enhancement.statBonusPerLevel * this.getEnhanceLevel(id);
                Object.keys(STAT_REGISTRY).forEach(statKey => {
                    let add = item.stats[statKey];
                    if (!add) return;
                    // Enhancement applies to atk/def only --
                    // utility stats (focus/insight) stay at their designed values
                    if (statKey === 'atk' || statKey === 'def') add = Math.round(add * enhMult);
                    stats[statKey] = (stats[statKey] || 0) + add;
                });
            }
        });
        return stats;
    },

    // Enhancement applies to weapons/shields using the configured level bonus.

    ENHANCE_MAX: gameConfig.progression.enhancement.maxLevel,

    getEnhanceLevel(itemId) {
        return state.inventory.enhance[itemId] || 0;
    },

    getEnhanceCost(itemId) {
        return gameConfig.progression.enhancement.goldPerLevel * (this.getEnhanceLevel(itemId) + 1);
    },

    enhanceItem(itemId) {
        const item = content.items[itemId];
        if (!item || (item.type !== 'weapon' && item.type !== 'shield')) return;
        const lvl = this.getEnhanceLevel(itemId);
        if (lvl >= this.ENHANCE_MAX) { ui.log('已达到强化上限！'); return; }
        const cost = this.getEnhanceCost(itemId);
        if (state.resources.gold < cost) { ui.log('金币不足！'); return; }
        state.resources.gold -= cost;
        state.inventory.enhance[itemId] = lvl + 1;
        ui.log(`⚒️ 强化成功！${item.icon}${item.name} +${lvl + 1}`);
        ui.updateBase();
        ui.updateEquip();
    },
	

    heal(amount) {
        const max = this.getStats().maxHp;
        state.player.currentHp = Math.min(max, state.player.currentHp + amount);
    },
	
	getJudgmentMultiplier() {
	    // Compatibility alias used by saved/networked combat profiles.
        return this.getParryWindowMultiplier();
    },

    _applyLevelStats() {
        state.player.level++;
        for (const [stat, gain] of Object.entries(gameConfig.progression.levelStats)) {
            state.player.baseStats[stat] += gain;
        }
        
        // Full heal on level up
        state.player.currentHp = this.getStats().maxHp;
    },

    // Standard level-up flow (check exp -> deduct exp -> apply stats -> refresh UI)
    levelUp() {
        const cost = state.player.level * gameConfig.progression.levelExpPerLevel;
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
    },

    buyMaterial(matId) {
        const price = content.shopPrices[matId];
        if (!price) return;
        if (state.resources.gold < price) { ui.log('金币不足！'); return; }
        state.resources.gold -= price;
        state.inventory.materials[matId] = (state.inventory.materials[matId] || 0) + 1;
        const m = content.materials[matId];
        ui.log(`🛒 购买成功！获得 ${m.icon}${m.name}`);
    }
};
