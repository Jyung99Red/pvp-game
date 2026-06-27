// fx.js - 统一管理所有战斗特效触发与战斗log输出

const fx = {

    // ── 核心：触发 CSS class 动画，自动清理 ──
    trigger(el, cls, duration) {
        if (!el) return;
        el.classList.remove(cls);
        void el.offsetWidth; // force reflow
        el.classList.add(cls);
        setTimeout(() => el?.classList.remove(cls), duration);
    },

    // ── 通过 element id 触发 ──
    triggerId(id, cls, duration) {
        this.trigger(document.getElementById(id), cls, duration);
    },

    // ── 玩家手部节点动画（left / right） ──
    playerNode(hand, cls, duration = 300) {
        if (!hand) return;
        this.triggerId(`node-${hand}`, cls, duration);
    },

    // ════════════════════════════════
    //  特效方法
    // ════════════════════════════════

    // 普通斩击（作用于敌人或英雄头像）
    slash(el) { this.trigger(el, 'slashed', 400); },

    // SVG斩击特效（fetch icons/fx/slash.svg 注入，带缓存）
    _slashSVGCache: null,
    xSlash(el) {
        if (!el) return;
        const inject = (svgText) => {
            el.querySelectorAll('.fx-slash-svg').forEach(n => n.remove());
            const wrap = document.createElement('div');
            wrap.innerHTML = svgText;
            const svgEl = wrap.querySelector('svg');
            if (!svgEl) return;
            svgEl.classList.add('fx-slash-svg');
            // 强制重启动画（克隆节点让浏览器重新触发）
            const clone = svgEl.cloneNode(true);
            el.appendChild(clone);
            setTimeout(() => clone.remove(), 500);
        };
        if (this._slashSVGCache) {
            inject(this._slashSVGCache);
        } else {
            fetch('icons/fx/slash.svg', { cache: 'force-cache' })
                .then(r => r.text())
                .then(text => { this._slashSVGCache = text; inject(text); })
                .catch(e => console.warn('[fx] slash.svg load failed', e));
        }
    },

    // 抖动（血条等）
    shake(id) { this.triggerId(id, 'shake', 300); },

    // 敌人武器节点缩小（普通格挡时敌方）
    enemyShrink(el) { this.trigger(el, 'node-shrink', 300); },

    // 玩家节点弹反发光（完美拼刀/完美弹反）
    parryGlow(hand) { this.playerNode(hand, 'node-parry-glow', 300); },

    // 玩家节点格挡缩小（普通格挡）
    guardShrink(hand) { this.playerNode(hand, 'node-guard-shrink', 300); },

    // 举盾前摇：辉光边框逐圈填满
    shieldWindup(hand, durationMs) {
        const el = document.getElementById(`node-${hand}`);
        if (!el) return;
        el.style.setProperty('--shield-windup-time', `${durationMs}ms`);
        el.classList.remove('shield-windup', 'shield-ready', 'shield-cancelled');
        void el.offsetWidth;
        el.classList.add('shield-windup');
    },

    // 蓄力完成，切换到就绪高亮
    shieldReady(hand, holdMs) {
        const el = document.getElementById(`node-${hand}`);
        if (!el) return;
        el.style.setProperty('--shield-hold-time', `${holdMs}ms`);
        el.classList.remove('shield-windup', 'shield-cancelled');
        void el.offsetWidth; // force reflow，确保动画从头播
        el.classList.add('shield-ready');
    },

    // 松手取消：快速淡出
    shieldCancel(hand) {
        const el = document.getElementById(`node-${hand}`);
        if (!el) return;
        el.classList.remove('shield-windup', 'shield-ready');
        el.classList.add('shield-cancelled');
        setTimeout(() => el?.classList.remove('shield-cancelled'), 200);
    },

    // 敌人进入蓄力前摇：设置 CSS 变量并触发 windup-active
    enemyWindupStart(el, windupMs) {
        if (!el) return;
        el.style.setProperty('--windup-time', `${windupMs}ms`);
        el.classList.remove('windup-active');
        void el.offsetWidth;
        el.classList.add('windup-active');
    },

    // 战斗结束/胜利时：清理武器节点 + 双方头像残留动画
    clearBattleSprites() {
        this.clearWeaponNode(document.getElementById('enemy-weapon-node'));
        const enemySprite = document.getElementById('enemy-sprite');
        if (enemySprite) enemySprite.classList.remove('slashed');
    },

    // 清理敌人武器节点所有动画 class 及动态SVG特效
    clearWeaponNode(el) {
        if (!el) return;
        el.classList.remove('warning', 'pre-attack', 'windup-active', 'shake', 'node-shrink');
        el.querySelectorAll('.fx-slash-svg').forEach(n => n.remove());
    },

    // ════════════════════════════════
    //  战斗 Log 输出（统一前缀格式）
    // ════════════════════════════════
    log: {
        encounter(enemyName)         { ui.log(`[遭遇] ${enemyName}`); },

        // 玩家动作
        attack(weaponName, dmg)      { ui.log(`[攻击] ${weaponName} 造成 ${dmg} 伤害`); },
        guard(weaponName)            { ui.log(`[防守] 举起 ${weaponName}`); },
        skill(hp)                    { ui.log(`[技能] 恢复 ${hp} HP`); },
        flee()                       { ui.log(`[撤退] 返回基地`); },
        retreat()                    { ui.log(`[撤离] 见好就收，返回基地`); },

        // 判定结果
        clash(actName, dmg)          { ui.log(`[拼刀] ${actName} → 反击 ${dmg} 伤害`); },
        parry(actName, dmg)          { ui.log(`[弹反] ${actName} → 反弹 ${dmg} 伤害`); },
        block(actName, dmg)          { ui.log(`[格挡] ${actName} → 受到 ${dmg} 伤害`); },
        hit(actName, dmg)            { ui.log(`[受击] ${actName} 命中，受到 ${dmg} 伤害`); },

        // 战斗结算
        death()                      { ui.log(`[阵亡] 英雄倒下...`); },
        victory(enemyName, exp)      { ui.log(`[胜利] 击败 ${enemyName}，获得 ${exp} EXP`); },
        loot(names)                  { ui.log(`[掉落] ${names}`); },
        continueDeep()               { ui.log(`[前进] 继续深入...`); },
        exploreComplete()            { ui.log(`[返程] 探索完成，满载而归`); },
    }
};