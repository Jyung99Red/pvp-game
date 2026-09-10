// Read-only battle view. Presentation effects belong to this instance, never the engine.
const uiSpatialBattle = { create(root, C = spatialData.training, prefix = '') {
    const L = combatGestures, S = spatialCombat;
    let battle;
    const $ = id => root.querySelector(`[id="${prefix}${id}"]`);
    const canvas = $('arena'), ctx = canvas.getContext('2d');
    const pads = { action: $('action-pad'), guard: $('guard-pad') };
    const nodes = Object.fromEntries(['player-hp', 'enemy-hp', 'player-meter', 'enemy-meter', 'enemy-state', 'player-state', 'clock', 'notice', 'charge-fill', 'action-label', 'guard-label'].map(id => [id, $(id)]));
    const apDots = Array.from({ length: C.apMax }, () => $('ap').appendChild(document.createElement('i')));
    const fullscreen = root.classList?.contains('spatial-fullscreen') || false;
    let width = 360, height = 400, worldTop = 25, worldBottom = 19, worldInset = 6;
    function text(id, value) { if (nodes[id].textContent !== value) nodes[id].textContent = value; }
    function resize() {
        const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = rect.width; height = rect.height;
        if (fullscreen) {
            const landscape = width >= 600 && height <= 480;
            worldTop = landscape ? 26 : root.querySelector('.vitals').getBoundingClientRect().bottom - rect.top + 25;
            worldBottom = height - (pads.action.getBoundingClientRect().top - rect.top) + (landscape ? 12 : 36);
            worldInset = landscape ? 202 : 12;
        }
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (battle) draw();
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    let notice = '轻点出刀，拖动走位；长按蓄力，上划松手出招。', effects = [], lastTime = 0;
    function consume(events) {
        const dt = Math.max(0, battle.time - lastTime); lastTime = battle.time;
        effects.forEach(e => e.life -= dt); effects = effects.filter(e => e.life > 0);
        for (const e of events) {
            if (e.type === 'strike') effects.push({ ...e, color: e.side === 'player' ? '#81e6d9' : '#f27365', life: .24 });
            const messages = {
                ap_insufficient: '行动力不足，走位等待恢复',
                attack_started: e.heavy ? '重击起手 · 范围亮起时命中' : '轻击起手',
                charge_cancelled: '已取消蓄力 · 未消耗行动力',
                stagger: '失衡！抓住空档打重击',
                hit: e.side === 'player' ? `${e.crit ? '暴击！' : ''}${e.heavy ? '重击' : '轻击'}命中 −${e.damage}${e.heavy ? ' · 失衡 +2' : ''}` : `受击 −${e.damage}${e.rear ? ' · 留意防御朝向' : ''}`,
                miss: e.side === 'player' ? '挥空 · 再靠近一点，留意朝向' : '走位避开！现在可以反击',
                parry: `精准防御！反击 −${e.damage} · 失衡 +1`,
                thorns: `荆棘反伤 −${e.damage}`, enrage: '狂暴！攻击更猛烈，注意起手', combo: '连段！准备接下一招',
                block: `格挡 −${e.damage} · 消耗 1 行动力`
            };
            if (messages[e.type]) notice = messages[e.type];
        }
    }
    function circle(x, y, r, fill, stroke) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    function shape(shape, origin, facing, color, opacity = 1) {
        ctx.save(); ctx.globalAlpha = opacity;
        ctx.beginPath();
        if (shape.kind === 'circle') ctx.arc(origin.x, origin.y, shape.range, 0, Math.PI * 2);
        else {
            ctx.moveTo(origin.x, origin.y);
            ctx.arc(origin.x, origin.y, shape.range, facing - shape.arc / 2, facing + shape.arc / 2);
            ctx.closePath();
        }
        ctx.fillStyle = color + '28'; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
    }
    function polygon(points, fill, stroke) {
        ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    function fighter(body, enemy) {
        ctx.save(); ctx.translate(body.x, body.y);
        ctx.fillStyle = '#050b0e66'; ctx.beginPath(); ctx.ellipse(1, 6, body.radius * 1.25, body.radius * .6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(body.facing);
        if (enemy) {
            polygon([[-23, -12], [-12, -24], [8, -22], [25, -12], [27, 11], [8, 22], [-13, 23], [-25, 10]], '#705747', '#be9975');
            polygon([[-12, -13], [0, -20], [15, -10], [19, 9], [0, 18], [-13, 9]], '#9a7858', '#b6966e');
            polygon([[13, -13], [34, -20], [24, -3]], '#e1ceb0');
            polygon([[13, 13], [34, 20], [24, 3]], '#e1ceb0');
            circle(20, -7, 2, '#ffb879'); circle(20, 7, 2, '#ffb879');
        } else {
            circle(0, 0, 12, '#254f57', '#83d9d3');
            polygon([[9, 0], [-3, -7], [-3, 7]], '#baeee2');
            polygon([[9, -11], [29, -10], [32, -8], [29, -6], [9, -7]], '#dae6dc', '#81e6d9');
            ctx.strokeStyle = '#ecc185'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(11, -15); ctx.lineTo(11, -3); ctx.stroke();
            polygon([[2, 11], [7, 7], [13, 10], [12, 20], [5, 22], [0, 17]], '#477582', '#9ac8df');
        }
        ctx.restore();
        if (!enemy && ['guard_start', 'guard'].includes(body.phase)) {
            ctx.beginPath(); ctx.arc(body.x, body.y, 27, body.facing - Math.PI / 2, body.facing + Math.PI / 2);
            ctx.lineWidth = body.phase === 'guard' ? 4 : 2;
            ctx.strokeStyle = body.phase === 'guard' && battle.time - body.guardReadyAt <= C.parryWindow ? '#e8fbff' : '#8dbdef'; ctx.stroke();
        }
    }
    function draw() {
        const p = battle.player, e = battle.enemy;
        ctx.clearRect(0, 0, width, height);
        if (fullscreen) {
            const ground = ctx.createRadialGradient(width / 2, height * .42, 20, width / 2, height * .42, Math.max(width, height) * .7);
            ground.addColorStop(0, '#284148'); ground.addColorStop(1, '#0b171d');
            ctx.fillStyle = ground; ctx.fillRect(0, 0, width, height);
            ctx.strokeStyle = '#87b4ad09'; ctx.lineWidth = 1;
            for (let x = width / 2 % 48; x < width; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
            for (let y = 0; y < height; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
        }
        // Uniform scaling keeps the entire fixed world visible and preserves reach.
        const availableHeight = Math.max(1, height - worldTop - worldBottom);
        const scale = Math.max(.01, Math.min((width - worldInset * 2) / C.width, availableHeight / C.height));
        ctx.save(); ctx.translate((width - C.width * scale) / 2, worldTop + (availableHeight - C.height * scale) / 2); ctx.scale(scale, scale);
        ctx.fillStyle = '#192a2d'; ctx.fillRect(0, 0, C.width, C.height);
        ctx.strokeStyle = '#294044'; ctx.lineWidth = .6;
        for (let x = 0; x <= C.width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, C.height); ctx.stroke(); }
        for (let y = 0; y <= C.height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(C.width, y); ctx.stroke(); }
        ctx.strokeStyle = '#496265'; ctx.strokeRect(0, 0, C.width, C.height);
        circle(180, 200, 135, null, '#31494a');
        circle(180, 200, 131, null, '#243c3e');
        // Clip telegraphs at the arena boundary; actors are clamped by logic.
        ctx.beginPath(); ctx.rect(0, 0, C.width, C.height); ctx.clip();
        if (e.phase === 'windup') {
            const locked = e.timer <= e.attack.lock;
            shape(e.attack, e, e.facing, locked ? '#f27365' : '#efc181');
            const progress = 1 - e.timer / e.attack.windup;
            ctx.beginPath(); ctx.arc(e.x, e.y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
            ctx.strokeStyle = locked ? '#f27365' : '#efc181'; ctx.lineWidth = 3; ctx.stroke();
        }
        if (['recover', 'stagger'].includes(e.phase)) circle(e.x, e.y, 33, '#81e6d914', '#81e6d9');
        if (p.phase === 'charging') shape(C.heavy, p, p.facing, '#81e6d9', .55);
        else if (p.phase === 'attack') {
            const progress = 1 - p.timer / (p.attack.heavy ? C.heavy.windup : C.light.windup);
            shape(p.attack.shape, p.attack.origin, p.attack.facing, '#81e6d9', .4 + progress * .5);
            ctx.beginPath(); ctx.arc(p.x, p.y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
            ctx.strokeStyle = '#efc181'; ctx.lineWidth = 3; ctx.stroke();
        }
        effects.forEach(fx => shape(fx.shape, fx.origin, fx.facing, fx.color, fx.life / .24));
        fighter(e, true); fighter(p, false);
        ctx.fillStyle = '#a7bdba'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(C.enemyName || '岩角兽', e.x, e.y - 44);
        for (let i = 0; i < 3; i++) circle(e.x + (i - 1) * 9, e.y - 34, 2.5, e.stagger > i ? '#efc181' : '#3d4d4c');
        ctx.fillStyle = '#a8e1db'; ctx.fillText('你', p.x, p.y + 37);
        ctx.restore();
    }
    function controls() {
        for (const [channel, pad] of Object.entries(pads)) {
            const g = channel === 'action' ? battle.action : battle.guard;
            pad.classList.toggle('active', !!g && g.mode !== 'blocked');
            pad.classList.toggle('armed', channel === 'action' && L.armed(g));
            const dx = g ? g.dx : 0, dy = g ? g.dy : 0;
            const len = Math.hypot(dx, dy), factor = len > 42 ? 42 / len : 1;
            pad.querySelector('.pad-knob').style.transform = `translate(${dx * factor}px, ${dy * factor}px)`;
        }
        const g = battle.action;
        text('action-label', g && g.mode === 'charge' ? (L.armed(g) ? '松手 · 重击' : '原地松手 · 取消') : g && g.mode === 'move' ? (battle.player.phase === 'idle' ? '移动中 · 松手停' : '收招后移动') : '移动 / 攻击');
        text('guard-label', fullscreen ? (battle.guard ? '拖动转向' : '防御') : battle.guard ? '拖动调整朝向' : '防御 / 转向');
    }
    function render(snapshot, events = []) {
        battle = snapshot;
        consume(events);
        draw(); controls();
        const p = battle.player, e = battle.enemy;
        text('player-hp', `${p.hp} / ${p.maxHp}`); text('enemy-hp', `${e.hp} / ${e.maxHp}`);
        nodes['player-meter'].max = p.maxHp; nodes['enemy-meter'].max = e.maxHp;
        nodes['player-meter'].value = p.hp; nodes['enemy-meter'].value = e.hp;
        apDots.forEach((dot, i) => { dot.className = p.ap >= i + 1 ? 'full' : ''; });
        $('ap').setAttribute('aria-label', `行动力 ${p.ap.toFixed(1)} / ${C.apMax}`);
        const phases = { idle: battle.action && battle.action.mode === 'move' ? '移动' : '待机', charging: '蓄力中 · 原地', attack: `${p.attack && p.attack.heavy ? '重击' : '轻击'}前摇`, recover: '收招', guard_start: '举盾中', guard: '防御中 · 原地', stunned: '受击硬直' };
        text('player-state', phases[p.phase]);
        text('enemy-state', e.phase === 'windup' ? `${e.attack.label || (e.attack.kind === 'circle' ? '周身践踏' : '扇形重扫')} · ${e.timer <= e.attack.lock ? '朝向锁定！' : '准备中'}` : e.phase === 'recover' ? '收招空档 · 可以反击' : e.phase === 'stagger' ? '失衡！重击机会' : e.phase === 'active' ? '攻击生效' : '接近中 · 留意距离');
        const t = Math.floor(battle.elapsed);
        text('clock', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
        nodes['charge-fill'].style.width = `${p.charge / C.fullCharge * 100}%`;
        const chargeHint = L.armed(battle.action) ? '已准备出招 · 松手重击；滑回起点可取消' : '向上划出再松手攻击 · 原地松手取消';
        text('notice', p.phase === 'charging' ? `${Math.round(p.charge / C.fullCharge * 100)}% 蓄力 · ${chargeHint}` : notice);
    }
    resize();
    return { render, destroy() { observer.disconnect(); apDots.forEach(dot => dot.remove()); } };
} };
