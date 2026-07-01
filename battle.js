// ============================================================
// Enemy action flow:
//   CHARGING  → progress 0→1 over chargeDuration
//   WINDUP    → holds full bar before firing (windupMs per act)
//   Execute attack → roll next act → back to CHARGING
// ============================================================

const battle = {
    lastTime: 0,
    rAF: null,

    startFight(enemyKey) {
        this._clearShieldWindup(); // Clear any leftover guard timer from the previous fight to avoid cross-battle triggers

        const eData = content.enemies[enemyKey];
        const firstAct = Math.random() < 0.5 ? 'act1' : 'act2';
        const isFirst = state.world.currentFightIndex === 0;

        state.battle = {
            active: true, waitingChoice: false, isStarting: isFirst, enemyId: enemyKey,
            enemyHp: eData.hp, enemyMaxHp: eData.hp,

            // Charging phase
            enemyPhase: 'charging',
            enemyActionProgress: 0,
            enemyWindupTimer: 0, enemyRecoveryTimer: 0, 
            enemyCurrentAct: firstAct,
            enemyChargeDuration: eData.baseMsCharge,

            actionPoints: 3, actionProgress: 0, skillPoints: 0,
            lastWeaponActTime: 0, lastShieldActTime: 0,
            globalCooldownEnd: 0,
            weaponPendingHand: null,
            shieldHolding: false, shieldConsumedByHit: false,
            activeBuffs: []
        };
        state.world.status = 'fighting';

        ui.initEnemy(eData, isFirst);
        ui.switchTab('battle');
        fx.log.encounter(eData.name);

        if (isFirst) {
            setTimeout(() => {
                if (!state.battle.active) return;
                state.battle.isStarting = false;
                this.lastTime = performance.now(); // Reset the clock to avoid a huge dt after unfreezing
            }, 1000);
        }

        this.lastTime = performance.now();
        this.loop(this.lastTime);
    },

    loop(currentTime) {
        if (!state.battle.active || state.battle.waitingChoice) return;
        const dt = currentTime - this.lastTime;
        this.lastTime = currentTime;

        // Don't advance the battle timeline while in the entry buffer phase
        if (!state.battle.isStarting) {
            this.updateData(dt);
        }

        ui.updateBattle();
        if (state.battle.active && !state.battle.waitingChoice) {
            this.rAF = requestAnimationFrame(t => this.loop(t));
        }
    },

    _chargeDuration(actKey) {
		const eData = content.enemies[state.battle.enemyId];
		return eData.baseMsCharge;
	},

    updateData(dt) {
        const b = state.battle;
        const now = Date.now();

        // Expire buffs
        b.activeBuffs = b.activeBuffs.filter(bf => bf.expiresAt > now);

        // player AP recovery
        if (b.actionPoints < 3) {
            const speedMult = player.getActionSpeedMultiplier();
            b.actionProgress += dt / (2000 * speedMult);
            if (b.actionProgress >= 1) {
                b.actionPoints++;
                b.actionProgress = b.actionPoints < 3 ? b.actionProgress - 1 : 0;
            }
        } else {
            b.actionProgress = 0;
        }
		if (b.enemyPhase === 'recovery') {
			b.enemyRecoveryTimer -= dt;
			if (b.enemyRecoveryTimer <= 0) {
				b.enemyPhase = 'charging';
			}
			return; // No other updates while in recovery
		}



        // Enemy phase state machine
        if (b.enemyPhase === 'charging') {
            b.enemyActionProgress += dt / b.enemyChargeDuration;
            if (b.enemyActionProgress >= 1) {
                b.enemyActionProgress = 1;
                const eData = content.enemies[b.enemyId];
                const act = eData.acts[b.enemyCurrentAct];
                const windupMs = act.windupMs || 0;

                if (windupMs > 0) {
                    // Transition to windup phase
                    b.enemyPhase = 'windup';
                    b.enemyWindupTimer = windupMs;
                    fx.enemyWindupStart(document.getElementById('enemy-weapon-node'), windupMs);
                } else {
                    this._fireAttack();
                }
            }
        } else if (b.enemyPhase === 'windup') {
            b.enemyWindupTimer -= dt;
            if (b.enemyWindupTimer <= 0) {
                this._fireAttack();
            }
        }
    },

    _fireAttack() {
        const b = state.battle;
        const actFired = b.enemyCurrentAct;
        const nextAct = Math.random() < 0.5 ? 'act1' : 'act2';

        // Clear the enemy weapon's charge effect
        const weaponNode = document.getElementById('enemy-weapon-node');
        fx.clearWeaponNode(weaponNode);
        if (weaponNode) void weaponNode.offsetWidth;

        // Hero sprite hit animation (the moment the attack lands)
        fx.slash(document.getElementById('player-sprite'));

        this.enemyExecuteAttack(actFired);

        if (!b.active) return; // fight ended inside executeAttack

        // Set up next cycle
        const recoveryMs = (content.enemies[b.enemyId].acts[actFired]?.recoveryMs) || 0;
		b.enemyCurrentAct = nextAct;
		b.enemyChargeDuration = this._chargeDuration(nextAct);
		b.enemyPhase = 'recovery';
		b.enemyRecoveryTimer = recoveryMs;
		b.enemyActionProgress = 0;
		b.enemyWindupTimer = 0;
    },

    canAct() { return state.battle.active && !state.battle.isStarting && Date.now() >= state.battle.globalCooldownEnd; },
    setGCD() { state.battle.globalCooldownEnd = Date.now() + 300; },

    applyBuff(buff) {
        state.battle.activeBuffs = state.battle.activeBuffs.filter(b => b.type !== buff.type);
        state.battle.activeBuffs.push(buff);
    },

    playerAction(hand) {
        const b = state.battle;
        const itemId = state.player.equip[hand];
        if (!itemId) return;
        const item = content.items[itemId];

        if (item.type === 'shield') {
            // Blocked during GCD (post-guard cooldown)
            if (Date.now() < b.globalCooldownEnd) return;
            // This press was already consumed by a block; must wait for a true release before re-raising the shield
            if (b.shieldConsumedByHit) return;
            // Already winding up or holding the shield; block re-press
            if (b.shieldHolding || b.shieldWindupHand === hand) return;
            if (b.actionPoints < 1) return;
            this.shieldBegin(hand, item);
            return;
        }

        // Weapon: record intent on press, only fire on release (prevents an accidental second attack from a long press)
        if (!this.canAct() || b.actionPoints < 1) return;
        b.weaponPendingHand = hand;
        fx.playerNode(hand, 'node-weapon-pending', 600);
    },

    weaponRelease(hand) {
        const b = state.battle;
        // Shield release is handled by shieldRelease
        const itemId = state.player.equip[hand];
        if (!itemId) return;
        const item = content.items[itemId];
        if (item.type === 'shield') { this.shieldRelease(hand); return; }

        // Not this hand's pending action; ignore
        if (b.weaponPendingHand !== hand) return;
        b.weaponPendingHand = null;

        // Re-check on release: cancel if GCD is active or AP is insufficient
        if (!this.canAct() || b.actionPoints < 1) return;

        b.actionPoints--;
        this.setGCD();
        b.lastWeaponActTime = Date.now();
        b.lastWeaponHand = hand;
        const dmg = Math.max(1, player.getStats().atk - content.enemies[b.enemyId].def);
        this.damageEnemy(dmg);
        if (b.skillPoints < 3) b.skillPoints++;
        fx.log.attack(item.name, dmg);
        fx.slash(document.getElementById('enemy-sprite'));
    },

    playerSkill() {
        if (!this.canAct() || state.battle.skillPoints < 3) return;
        this.setGCD();
        state.battle.skillPoints -= 3;
        const healAmt = Math.floor(player.getStats().maxHp * 0.3);
        player.heal(healAmt);
        fx.log.skill(healAmt);
    },

    playerFlee() {
        if (!state.battle.active || state.battle.isStarting) return;
        fx.log.flee();
        this.endFight(true);
    },

    enemyExecuteAttack(actKey) {
        const b = state.battle;
        const eData = content.enemies[b.enemyId];
        const act = eData.acts[actKey];
        const now = Date.now();

        // Enemy's raw damage before any mitigation
        const baseDmg = Math.floor(eData.atk * act.dmgMult);

        const timeSinceWeapon = now - b.lastWeaponActTime;

        // Block check: the shield must currently be held (shieldHolding)
        const isShieldActive = !!(b.shieldHolding && b.lastShieldHand && b.lastShieldActTime > 0);
        const timeSinceShieldReady = isShieldActive ? (now - b.lastShieldActTime) : Infinity;

        const windowMult = player.getJudgmentMultiplier();
        const clashWindow = 100 * windowMult;
        const parryWindow = 200 * windowMult;

        const isWeaponClash   = timeSinceWeapon <= clashWindow;
        const isShieldPerfect = isShieldActive && timeSinceShieldReady <= parryWindow;
        const isShieldGuard   = isShieldActive && !isShieldPerfect;

        // Grab the nodes that need animating
        const weaponNode = document.getElementById('enemy-weapon-node');
        const heroSprite = document.getElementById('player-sprite');

        if (isWeaponClash) {
            // --- Perfect clash ---
            fx.xSlash(weaponNode);
            fx.parryGlow(b.lastWeaponHand);

            const clashDmg = Math.max(1, player.getStats().atk - eData.def) * 2;
            this.damageEnemy(clashDmg);
            if (b.actionPoints < 3) b.actionProgress = Math.min(1, b.actionProgress + 0.2);
            fx.log.clash(act.name, clashDmg);

        } else if (isShieldPerfect) {
            // --- Perfect parry ---
            fx.shake('enemy-weapon-node');
            fx.parryGlow(b.lastShieldHand);
            this._cancelShieldHold(b.lastShieldHand);
            b.shieldConsumedByHit = true;
            this.setGCD();

            const reflectDmg = Math.floor(eData.atk * 0.5);
            this.damageEnemy(reflectDmg);
            if (b.skillPoints < 3) b.skillPoints++;
            fx.log.parry(act.name, reflectDmg);

        } else if (isShieldGuard) {
            // --- Normal block ---
            fx.enemyShrink(weaponNode);
            fx.guardShrink(b.lastShieldHand);
            this._cancelShieldHold(b.lastShieldHand);
            b.shieldConsumedByHit = true;
            this.setGCD();

            const guardMult = player.getGuardDamageMultiplier();
            const def = player.getStats().def;
            const afterDefDmg = Math.max(1, Math.floor((baseDmg * baseDmg) / (baseDmg + def * 0.5)));
            const actual = Math.max(1, Math.floor(afterDefDmg * 0.4 * guardMult));
            state.player.currentHp = Math.max(0, state.player.currentHp - actual);

            fx.shake('player-hp-wrap');
            fx.log.block(act.name, actual);

        } else {
            // --- Full hit ---
            fx.slash(heroSprite);
            const actual = player.takeDamage(baseDmg);
            fx.shake('player-hp-wrap');
            fx.log.hit(act.name, actual);
        }

        // --- Death check ---
        if (state.player.currentHp <= 0) {
            fx.log.death();
            this.endFight(false);
        }
    },

    rollDrops(enemyId) {
        const eData = content.enemies[enemyId];
        const dropped = [];
        if (eData.drops) {
            eData.drops.forEach(drop => {
                if (Math.random() <= drop.chance) {
                    const amt = drop.amount[0] + Math.floor(Math.random() * (drop.amount[1] - drop.amount[0] + 1));
                    state.inventory.materials[drop.id] = (state.inventory.materials[drop.id] || 0) + amt;
                    dropped.push({ id: drop.id, amt });
                }
            });
        }

        if (dropped.length) {
            const names = dropped.map(d => `${content.materials[d.id].name}×${d.amt}`).join('  ');
            fx.log.loot(names);
        }
    },

    damageEnemy(amt) {
        state.battle.enemyHp = Math.max(0, state.battle.enemyHp - amt);
        ui.shake('enemy-hp-wrap');
        if (state.battle.enemyHp <= 0 && !state.battle.waitingChoice) {
            const eData = content.enemies[state.battle.enemyId];
            state.inventory.exp += eData.exp;
            this.rollDrops(state.battle.enemyId);
            fx.log.victory(eData.name, eData.exp);
            this.winCurrentFight();
        }
    },

    winCurrentFight() {
        state.battle.waitingChoice = true;
        cancelAnimationFrame(this.rAF);

        // Clean up leftover animations immediately on kill
        fx.clearBattleSprites();

        ui.updateBattle();
    },

    continueNext() {
        const area = content.areas[state.world.currentArea];
        state.world.currentFightIndex++;
        if (state.world.currentFightIndex < area.encounters.length) {
            fx.log.continueDeep();
            this.startFight(area.encounters[state.world.currentFightIndex]);
        } else {
            fx.log.exploreComplete();
            this.endFight(true);
        }
    },

    safeRetreat() {
        fx.log.retreat();
        this.endFight(true);
    },

    endFight(win) {
        state.battle.active = false;
        state.battle.waitingChoice = false;
        cancelAnimationFrame(this.rAF);
        if (state.player.currentHp <= 0) {
            state.player.currentHp = Math.max(1, Math.floor(player.getStats().maxHp * 0.1));
        }
        state.world.status = 'base';

        // --- Fully clear leftover animation classes ---
        fx.clearBattleSprites();

        // Clear guard state
        this._clearShieldWindup();

        ui.switchTab('base');
        ui.updateBase();
    },

    // -- Guard windup: starts on press, takes effect after SHIELD_WINDUP_MS; must keep holding to trigger a block, release cancels --
    SHIELD_WINDUP_MS: 500,
    SHIELD_HOLD_MS: 3000,
    _shieldTimer: null,
    _shieldHoldTimer: null,

    shieldBegin(hand, item) {
        const b = state.battle;
        this._clearShieldWindup();

        b.shieldWindupHand = hand;
        b.shieldWindupStart = Date.now();
        b.shieldHolding = false;
        b.lastShieldActTime = 0;

        fx.log.guard(item.name);
        fx.shieldWindup(hand, this.SHIELD_WINDUP_MS);

        this._shieldTimer = setTimeout(() => {
            if (!b.active || b.shieldWindupHand !== hand) return;
            // Windup complete: consume 1 AP, enter guard-ready
            b.actionPoints = Math.max(0, b.actionPoints - 1);
            b.lastShieldActTime = Date.now();
            b.lastShieldHand = hand;
            b.shieldWindupHand = null;
            b.shieldWindupStart = 0;
            b.shieldHolding = true;
            this._shieldTimer = null;
            fx.shieldReady(hand, this.SHIELD_HOLD_MS);

            // Max hold auto-timeout, synced with the CSS countdown
            this._shieldHoldTimer = setTimeout(() => {
                this._cancelShieldHold(hand);
            }, this.SHIELD_HOLD_MS);
        }, this.SHIELD_WINDUP_MS);
    },

    shieldRelease(hand) {
        const b = state.battle;
        // Reset the consumedByHit flag on release regardless of state
        b.shieldConsumedByHit = false;

        if (b.shieldWindupHand === hand) {
            // Released during windup: cancel, no GCD, no AP spent
            this._clearShieldWindup();
            fx.shieldCancel(hand);
            return;
        }
        if (b.shieldHolding && b.lastShieldHand === hand) {
            // Released after ready: revoke the guard window, no GCD
            this._cancelShieldHold(hand);
        }
    },

    _cancelShieldHold(hand) {
        const b = state.battle;
        b.shieldHolding = false;
        b.lastShieldActTime = 0;
        if (this._shieldHoldTimer) {
            clearTimeout(this._shieldHoldTimer);
            this._shieldHoldTimer = null;
        }
        fx.shieldCancel(hand);
    },

    _clearShieldWindup() {
        if (this._shieldTimer) {
            clearTimeout(this._shieldTimer);
            this._shieldTimer = null;
        }
        if (this._shieldHoldTimer) {
            clearTimeout(this._shieldHoldTimer);
            this._shieldHoldTimer = null;
        }
        const b = state.battle;
        if (b) {
            b.shieldWindupHand = null;
            b.shieldWindupStart = 0;
            b.shieldHolding = false;
            b.weaponPendingHand = null;
        }
    },
};