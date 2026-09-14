const tick = {
    timer: null,
    start() {
        this.timer = setInterval(() => this.loop(), 1000);
    },
    loop() {
		state.time.tick++;
		
        // 1. Advance time (1 tick = 10 minutes)
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

        // 2. Base production
        for (let bKey in state.base.buildings) {
            let lvl = state.base.buildings[bKey];
            if (lvl > 0) {
                let produce = content.buildings[bKey].baseProduce;
                for (let res in produce) {
                    state.resources[res] += produce[res] * lvl;
                }
            }
        }
		
		const spatialOwnsHp = state.pveBattle?.spatial && state.pveBattle.active && !state.pveBattle.waitingChoice;
        const allowRegen = !spatialOwnsHp && !(state.pveBattle?.spatial && state.world.status === 'fighting' && document.hidden);
        // 3. Passive recovery shares its cadence with the formal PVE loop.
        const recovery = gameConfig.progression.recovery;
        if (allowRegen && state.time.tick % recovery.passiveEveryTicks === 0 && state.player.currentHp > 0 && state.player.currentHp < player.getStats().maxHp) {
            player.heal(recovery.passiveHp);
        }

        // --- 4. Hot spring healing check ---
        const hotSpringLv = state.base.buildings.hotSpring || 0;
        if (allowRegen && hotSpringLv > 0 && state.player.currentHp > 0 && state.player.currentHp < player.getStats().maxHp) {
            let healAmt = 0;
            if (state.world.status === 'base') {
                healAmt = hotSpringLv;
            } else if (state.world.status === 'fighting') {
                healAmt = hotSpringLv - recovery.hotSpringCombatPenalty;
            }
            if (healAmt > 0) {
                player.heal(healAmt);
            }
        }
        
        ui.updateBase();
    }
        
};
