// ui_battle.js - 专职负责高频刷新的战斗界面渲染

// 将 updateBattle 方法挂载到全局 ui 对象上
ui.updateBattle = function () {
    if (!state.battle.active) return;
    const b = state.battle;

    // 1. 战斗结束/结算状态切换
    if (b.waitingChoice) {
        document.getElementById('battle-actions').classList.add('hidden');
        document.getElementById('post-battle-actions').classList.remove('hidden');
    } else {
        document.getElementById('battle-actions').classList.remove('hidden');
        document.getElementById('post-battle-actions').classList.add('hidden');
    }

    // 2. 玩家行动按钮状态更新
    const inGCD = Date.now() < b.globalCooldownEnd;
    const leftItem = content.items[state.player.equip.left];
    const rightItem = content.items[state.player.equip.right];

    const btnLeft = document.getElementById('btn-act-left');
    const btnRight = document.getElementById('btn-act-right');

    const leftIconHtml = leftItem ? (leftItem.iconKey ? renderIcon(leftItem.iconKey, 'btn-icon') : leftItem.icon) : '';
    const rightIconHtml = rightItem ? (rightItem.iconKey ? renderIcon(rightItem.iconKey, 'btn-icon') : rightItem.icon) : '';
    btnLeft.innerHTML = leftItem ? `${leftIconHtml}  ${leftItem.name}<br><small>(-1动)</small>` : '左手空';
    btnRight.innerHTML = rightItem ? `${rightIconHtml} ${rightItem.name}<br><small>(-1动)</small>` : '右手空';

    // 武器：GCD + AP + 本手已在 pending 中；盾：GCD + AP + 前摇/持盾中 + consumedByHit未松手
    const shieldBusyLeft  = b.shieldWindupHand === 'left'  || (b.shieldHolding && b.lastShieldHand === 'left')  || b.shieldConsumedByHit;
    const shieldBusyRight = b.shieldWindupHand === 'right' || (b.shieldHolding && b.lastShieldHand === 'right') || b.shieldConsumedByHit;
    const weaponPendingLeft  = leftItem  && leftItem.type  === 'weapon' && b.weaponPendingHand === 'left';
    const weaponPendingRight = rightItem && rightItem.type === 'weapon' && b.weaponPendingHand === 'right';
    const leftDisabled  = !leftItem  || b.actionPoints === 0 || (leftItem.type  === 'shield' ? (inGCD || shieldBusyLeft)  : (inGCD || weaponPendingLeft));
    const rightDisabled = !rightItem || b.actionPoints === 0 || (rightItem.type === 'shield' ? (inGCD || shieldBusyRight) : (inGCD || weaponPendingRight));
    btnLeft.disabled  = leftDisabled;
    btnRight.disabled = rightDisabled;

    const nodeLeft = document.getElementById('node-left');
    const nodeRight = document.getElementById('node-right');
    if (nodeLeft) {
        nodeLeft.innerHTML = leftItem
            ? (leftItem.iconKey ? renderIcon(leftItem.iconKey, 'node-icon') : leftItem.icon)
            : '';
        nodeLeft.classList.toggle('disabled', leftDisabled);
        nodeLeft.classList.toggle('type-shield', leftItem && leftItem.type === 'shield');
        nodeLeft.classList.toggle('type-weapon', leftItem && leftItem.type === 'weapon');
        nodeLeft.classList.toggle('weapon-pending', weaponPendingLeft);
        // 只在既不是前摇也不是持盾时才清除 shield class（避免每帧打断动画）
        const leftShieldActive = b.shieldWindupHand === 'left' || (b.shieldHolding && b.lastShieldHand === 'left');
        if (!leftShieldActive) nodeLeft.classList.remove('shield-ready', 'shield-windup', 'shield-cancelled');
    }
    if (nodeRight) {
        nodeRight.innerHTML = rightItem
            ? (rightItem.iconKey ? renderIcon(rightItem.iconKey, 'node-icon') : rightItem.icon)
            : '';
        nodeRight.classList.toggle('disabled', rightDisabled);
        nodeRight.classList.toggle('type-shield', rightItem && rightItem.type === 'shield');
        nodeRight.classList.toggle('type-weapon', rightItem && rightItem.type === 'weapon');
        nodeRight.classList.toggle('weapon-pending', weaponPendingRight);
        const rightShieldActive = b.shieldWindupHand === 'right' || (b.shieldHolding && b.lastShieldHand === 'right');
        if (!rightShieldActive) nodeRight.classList.remove('shield-ready', 'shield-windup', 'shield-cancelled');
    }
    document.getElementById('btn-skill').disabled = inGCD || b.skillPoints < 3;
    document.getElementById('btn-flee').disabled = b.isStarting;

    // 3. 英雄 Buff 状态显示
    const now = Date.now();
    const buffTexts = b.activeBuffs
        .filter(bf => bf.expiresAt > now)
        .map(bf => bf.type === 'action_speed_boost' ? `⚡ 加速 +${bf.value * 100}%  ${((bf.expiresAt - now) / 1000).toFixed(1)}s` : '');
    const passiveBoost = player.getEquippedEffects('passive_speed_boost');
    if (passiveBoost.length) buffTexts.push(`💍 速度 +${passiveBoost[0].value * 100}%`);
    document.getElementById('player-buff-display').innerText = buffTexts.join('  ');

    // 4. 敌人信息与血条更新
    const eData = content.enemies[b.enemyId];
    document.getElementById('enemy-name').innerText = eData.name;

    let enemyStatusText = '';
    if (b.enemyCurrentAct) {
        const act = eData.acts[b.enemyCurrentAct];
        if (b.enemyPhase === 'windup') {
            enemyStatusText = `🔴 蓄力: ${act.name}`;
        } else if (b.enemyPhase === 'recovery') {
            enemyStatusText = `⏸ 后摇`;
        } else {
            const isAct2 = b.enemyCurrentAct === 'act2';
            enemyStatusText = isAct2 ? `⚠️ ${act.name}` : `⚪ ${act.name}`;
        }
    }
    document.getElementById('enemy-status').innerText = enemyStatusText;

    document.getElementById('enemy-hp').style.width = `${(b.enemyHp / b.enemyMaxHp) * 100}%`;
    document.getElementById('enemy-hp-txt').innerText = `${b.enemyHp}/${b.enemyMaxHp}`;

    // 5. 敌人蓄力条与动画控制
    const actBar = document.getElementById('enemy-action');
    actBar.style.width = b.enemyPhase === 'windup' ? '100%' : `${b.enemyActionProgress * 100}%`;

    const chargeLabel = `→ ${(b.enemyChargeDuration / 1000).toFixed(1)}s`;
    document.getElementById('enemy-action-txt').innerText = chargeLabel;

    const weaponNode = document.getElementById('enemy-weapon-node');

    if (b.waitingChoice || b.enemyHp <= 0) {
        weaponNode.classList.remove('warning', 'pre-attack', 'windup-active');
    } else if (b.enemyPhase === 'windup') {
        if (!weaponNode.classList.contains('warning') && !weaponNode.classList.contains('action')) {
            weaponNode.classList.add('warning');
        }
        const rattleThreshold = 100;
        if (b.enemyWindupTimer <= rattleThreshold && b.enemyWindupTimer > 0) {
            weaponNode.classList.add('pre-attack');
        } else {
            weaponNode.classList.remove('pre-attack');
        }
    } else {
        weaponNode.classList.remove('warning', 'pre-attack');
    }

    // 6. 英雄血条、技能星级
    const s = player.getStats();
    document.getElementById('player-hp').style.width = `${(state.player.currentHp / s.maxHp) * 100}%`;
    document.getElementById('player-hp-txt').innerText = `${state.player.currentHp}/${s.maxHp}`;
    document.getElementById('player-sp').innerText = '⭐'.repeat(b.skillPoints) + '☆'.repeat(3 - b.skillPoints);


    // 7. 英雄行动力条更新
    const speedMult = player.getActionSpeedMultiplier();
    const apBar = document.getElementById('player-action-progress');
    apBar.classList.toggle('penalized', speedMult > 1.01);
    apBar.style.width = `${b.actionPoints === 3 ? 100 : b.actionProgress * 100}%`;

    let apLabel = `行动力: ${b.actionPoints}/3`;
    if (speedMult > 1.01) apLabel += `  ⏱ ×${speedMult.toFixed(2)}`;
    else if (speedMult < 0.99) apLabel += `  ⚡ ×${speedMult.toFixed(2)}`;
    document.getElementById('player-action-txt').innerText = apLabel;
};

// 战斗开始时的 UI 初始化（清残留、刷图标），由 battle.startFight 调用
ui.initEnemy = function (eData, isFirst) {
    const weaponNode = document.getElementById('enemy-weapon-node');
    fx.clearWeaponNode(weaponNode);
    if (weaponNode) {
        void weaponNode.offsetWidth;
        weaponNode.innerHTML = renderIcon('monster-atk', 'node-icon');
    }

    const enemySprite = document.getElementById('enemy-sprite');
    if (enemySprite) {
        enemySprite.classList.remove('slashed');
        enemySprite.innerHTML = eData.iconKey
            ? renderIcon(eData.iconKey, 'sprite-icon')
            : '👹';
    }

    const heroSprite = document.getElementById('player-sprite');
    if (heroSprite) heroSprite.classList.remove('slashed');

    const btnFlee = document.getElementById('btn-flee');
    if (btnFlee) btnFlee.innerHTML = renderIcon('escape', 'btn-icon');

    // 首次战斗入场淡入，非首次直接清除动画
    const battleView = document.getElementById('view-battle');
    if (battleView) {
        battleView.style.animation = 'none';
        if (isFirst) {
            void battleView.offsetWidth;
            battleView.style.animation = 'fadeInDark 1s ease-out forwards';
        }
    }
};