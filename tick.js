const tick = {
    timer: null,
    start() {
        this.timer = setInterval(() => this.loop(), 1000);
    },
    loop() {
		state.time.tick++;
		
        // 1. 推进时间 (每tick = 10分钟)
        state.time.minutes += 10;
        if (state.time.minutes >= 60) {
            state.time.minutes -= 60;
            state.time.hours++;
        }
        if (state.time.hours >= 24) {
            state.time.hours -= 24;
            state.time.days++;
        }
        
        let h = state.time.hours;
        if (h >= 6 && h < 18) state.time.period = 'day';
        else if (h >= 18 && h < 22) state.time.period = 'dusk';
        else state.time.period = 'night';

        // 2. 基地产出
        for (let bKey in state.base.buildings) {
            let lvl = state.base.buildings[bKey];
            if (lvl > 0) {
                let produce = content.buildings[bKey].baseProduce;
                for (let res in produce) {
                    state.resources[res] += produce[res] * lvl;
                }
            }
        }
		
		// --- 3. 玩家基础生理回复 (每 2 tick 也就是 2 秒回复 1 HP) ---
        if (state.time.tick % 2 === 0 && state.player.currentHp > 0 && state.player.currentHp < player.getStats().maxHp) {
            player.heal(1);
        }

        // --- 4. 温泉回复判定 ---
        const hotSpringLv = state.base.buildings.hotSpring || 0;
        if (hotSpringLv > 0 && state.player.currentHp > 0 && state.player.currentHp < player.getStats().maxHp) {
            let healAmt = 0;
            if (state.world.status === 'base') {
                healAmt = hotSpringLv;
            } else if (state.world.status === 'fighting') {
                healAmt = hotSpringLv - 1;
            }
            if (healAmt > 0) {
                player.heal(healAmt);
            }
        }
        
        ui.updateBase();
    }
        
};