// Read-only battle view. Presentation effects belong to this instance, never the engine.
const uiSpatialBattle = { create(root, C = spatialData.training, prefix = '') {
    const L = combatGestures, S = spatialCombat;
    let battle, contextLost = false;
    const abort = new AbortController();
    const $ = id => root.querySelector(`[id="${prefix}${id}"]`);
    const canvas = $('arena'), ctx = canvas.getContext('2d');
    const pads = { move: $('move-pad'), action: $('action-pad'), guard: $('guard-pad'), skill: $('skill-pad') };
    const nodes = Object.fromEntries(['player-hp', 'enemy-hp', 'player-meter', 'enemy-meter', 'enemy-state', 'player-state', 'clock', 'notice', 'charge-fill', 'move-label', 'action-label', 'guard-label', 'skill-label', 'battle-log'].map(id => [id, $(id)]));
    const apDots = Array.from({ length: C.apMax }, () => $('ap').appendChild(document.createElement('i')));
    const fullscreen = root.classList?.contains('spatial-fullscreen') || false;
    let width = 360, height = 400, worldTop = 25, worldBottom = 19, worldInset = 6;
    const viewWidth = Math.min(C.width, C.camera?.width || C.width);
    const viewHeight = Math.min(C.height, C.camera?.height || C.height);
    let camera = null;
    // Local presentation only: no camera coordinates enter combat or networking.
    function updateCamera(dt) {
        if (!C.camera) return;
        const p = battle.player, settings = C.camera;
        const clampX = x => S.clamp(x, viewWidth / 2, C.width - viewWidth / 2);
        const clampY = y => S.clamp(y, viewHeight / 2, C.height - viewHeight / 2);
        if (!camera || Math.hypot(p.x - camera.px, p.y - camera.py) > 80) {
            camera = { x: clampX(p.x), y: clampY(p.y), px: p.x, py: p.y, leadX: 0, leadY: 0 };
            return;
        }
        if (!(dt > 0)) return;
        dt = Math.min(dt, .1);
        const moving = battle.running && battle.move?.mode === 'move' && !['attack', 'recover', 'stunned'].includes(p.phase);
        let leadX = moving ? (p.x - camera.px) / dt * settings.leadSeconds : 0;
        let leadY = moving ? (p.y - camera.py) / dt * settings.leadSeconds : 0;
        const factor = Math.min(1, settings.maxLead / Math.max(.001, Math.hypot(leadX, leadY)));
        const leadWeight = 1 - Math.exp(-settings.leadRate * dt), weight = 1 - Math.exp(-settings.followRate * dt);
        camera.leadX += (leadX * factor - camera.leadX) * leadWeight;
        camera.leadY += (leadY * factor - camera.leadY) * leadWeight;
        camera.x = clampX(camera.x + (clampX(p.x + camera.leadX) - camera.x) * weight);
        camera.y = clampY(camera.y + (clampY(p.y + camera.leadY) - camera.y) * weight);
        camera.px = p.x; camera.py = p.y;
    }
    function text(id, value) { if (nodes[id].textContent !== value) nodes[id].textContent = value; }
    function resize() {
        const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (rect.width < 1 || rect.height < 1 || contextLost) return;
        width = rect.width; height = rect.height;
        if (fullscreen) {
            worldTop = Math.max(12, root.querySelector('.vitals').getBoundingClientRect().top - rect.top);
            worldBottom = 12; worldInset = 8;
        }
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (battle) draw();
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    let notice = '左手移动 / 轻击，右手重击 / 防御转向。', effects = [], lastTime = 0, logs = [];
    const hitFlashes = { player: 0, enemy: 0 };
    function consume(events) {
        const dt = Math.max(0, battle.time - lastTime); lastTime = battle.time;
        effects.forEach(e => e.life -= dt); effects = effects.filter(e => e.life > 0);
        for (const side of ['player', 'enemy']) hitFlashes[side] = Math.max(0, hitFlashes[side] - dt);
        for (const e of events) {
            if (e.type === 'hp_changed' && e.hp < e.previous) {
                hitFlashes[e.side] = .28;
                if (e.side === 'enemy' || C.pvp) effects.push({ type: 'impact', x: battle[e.side].x, y: battle[e.side].y,
                    damage: e.previous - e.hp, life: .55 });
            }
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
            if (C.pvp) {
                const who = e.side === 'player' ? '你' : '对手';
                messages.attack_started = `${who}${e.heavy ? '重击' : '轻击'}起手`;
                messages.hit = `${who}${e.crit ? '暴击' : ''}${e.heavy ? '重击' : '轻击'}命中 −${e.damage}`;
                messages.parry = `${who}弹反 · 反击 −${e.damage}`;
                messages.block = `${who}格挡 −${e.damage}`;
                messages.thorns = `${who}荆棘反伤 −${e.damage}`;
                messages.skill_used = `${who}使用${({ heal: '治疗', haste: '疾速', full: '满蓄', parry: '弹反护体' })[e.kind]}`;
            }
            if (messages[e.type]) {
                if (['hit', 'miss', 'parry', 'block', 'thorns', 'stagger', 'enrage', 'skill_used'].includes(e.type)) {
                    logs.unshift(messages[e.type]); logs.length = Math.min(logs.length, 2);
                    notice = '';
                } else notice = messages[e.type];
            }
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
        const stunned = (!enemy || C.pvp) && body.phase === 'stunned';
        const flash = stunned ? .75 : hitFlashes[enemy ? 'enemy' : 'player'] / .28;
        const flashColor = stunned ? [255, 157, 45] : [255, 58, 70];
        const tint = color => {
            if (!flash) return color;
            const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
            return `rgb(${rgb.map((v, i) => Math.round(v + (flashColor[i] - v) * flash)).join(',')})`;
        };
        ctx.save(); ctx.lineWidth = 1; ctx.translate(body.x, body.y);
        ctx.fillStyle = '#050b0e66'; ctx.beginPath(); ctx.ellipse(1, 6, body.radius * 1.25, body.radius * .6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(body.facing);
        if (enemy && !C.pvp) {
            polygon([[-23, -12], [-12, -24], [8, -22], [25, -12], [27, 11], [8, 22], [-13, 23], [-25, 10]], tint('#705747'), tint('#be9975'));
            polygon([[-12, -13], [0, -20], [15, -10], [19, 9], [0, 18], [-13, 9]], tint('#9a7858'), tint('#b6966e'));
            polygon([[13, -13], [34, -20], [24, -3]], '#e1ceb0');
            polygon([[13, 13], [34, 20], [24, 3]], '#e1ceb0');
            circle(20, -7, 2, '#ffb879'); circle(20, 7, 2, '#ffb879');
        } else {
            circle(0, 0, 12, tint(enemy ? '#713f40' : '#254f57'), tint(enemy ? '#f29385' : '#83d9d3'));
            polygon([[9, 0], [-3, -7], [-3, 7]], tint('#baeee2'));
            let angle = 0;
            const reach = 32;
            if (body.phase === 'charging') {
                const a = spatialEngine.heavyShape({ config: enemy ? C.opponentConfig : C, player: body });
                angle = -a.arc / 2;
            } else if (body.phase === 'attack' || body.phase === 'recover') {
                const a = body.attack.shape;
                if (body.phase === 'attack') {
                    const progress = S.clamp(1 - body.timer / Math.max(.001, a.windup), 0, 1);
                    angle = -a.arc / 2 + a.arc * progress;
                    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, reach * .92, -a.arc / 2, angle);
                    ctx.strokeStyle = '#b6fff19a'; ctx.lineWidth = body.attack.heavy ? 7 : 4; ctx.stroke();
                    ctx.restore();
                } else {
                    const remaining = S.clamp(body.timer / Math.max(.001, a.recovery), 0, 1);
                    angle = a.arc / 2 * remaining;
                }
            }
            // Fixed blade geometry; only rotation follows the attack sector, never scale.
            ctx.save(); ctx.rotate(angle);
            polygon([[11, -3], [reach - 9, -3], [reach, 0], [reach - 9, 3], [11, 3]], tint('#dae6dc'), '#81e6d9');
            ctx.strokeStyle = '#ecc185'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(14, -7); ctx.lineTo(14, 7); ctx.stroke();
            ctx.restore();
            polygon([[2, 11], [7, 7], [13, 10], [12, 20], [5, 22], [0, 17]], tint('#477582'), tint('#9ac8df'));
        }
        ctx.restore();
        if (stunned) {
            ctx.save(); ctx.strokeStyle = '#ff9d2d'; ctx.lineWidth = 2.5;
            const pulse = .65 + .35 * Math.sin(battle.time * 28);
            ctx.globalAlpha = pulse;
            circle(body.x, body.y, body.radius + 9, '#ff9d2d24', '#ff9d2d');
            for (let i = 0; i < 3; i++) {
                const x = body.x + (i - 1) * 7;
                ctx.beginPath(); ctx.moveTo(x, body.y - 26); ctx.lineTo(x, body.y - 20); ctx.stroke();
            }
            ctx.restore();
        }
        if ((!enemy || C.pvp) && ['guard_start', 'guard'].includes(body.phase)) {
            ctx.save(); ctx.beginPath(); ctx.arc(body.x, body.y, 27, body.facing - Math.PI / 2, body.facing + Math.PI / 2);
            ctx.lineWidth = body.phase === 'guard' ? 4 : 2;
            ctx.strokeStyle = body.phase === 'guard' && battle.time - body.guardReadyAt <= (enemy ? C.opponentConfig : C).parryWindow ? '#e8fbff' : '#8dbdef'; ctx.stroke();
            ctx.restore();
        }
    }
    function draw() {
        if (contextLost || !battle || canvas.width < 1 || canvas.height < 1) return;
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
        // Camera window controls zoom independently of arena size; input axes stay fixed.
        const availableHeight = Math.max(1, height - worldTop - worldBottom);
        const scale = Math.max(.01, Math.min((width - worldInset * 2) / viewWidth, availableHeight / viewHeight));
        ctx.save(); ctx.translate((width - viewWidth * scale) / 2, worldTop + (fullscreen ? 0 : (availableHeight - viewHeight * scale) / 2)); ctx.scale(scale, scale);
        ctx.beginPath(); ctx.rect(0, 0, viewWidth, viewHeight); ctx.clip();
        if (camera) ctx.translate(viewWidth / 2 - camera.x, viewHeight / 2 - camera.y);
        ctx.fillStyle = '#192a2d'; ctx.fillRect(0, 0, C.width, C.height);
        ctx.strokeStyle = '#294044'; ctx.lineWidth = .6;
        for (let x = 0; x <= C.width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, C.height); ctx.stroke(); }
        for (let y = 0; y <= C.height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(C.width, y); ctx.stroke(); }
        ctx.strokeStyle = '#496265'; ctx.strokeRect(0, 0, C.width, C.height);
        circle(C.width / 2, C.height / 2, 135, null, '#31494a');
        circle(C.width / 2, C.height / 2, 131, null, '#243c3e');
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
        if (C.pvp && e.phase === 'charging') shape(spatialEngine.heavyShape({ config: C.opponentConfig, player: e }), e, e.facing, '#f27365', .65);
        if (C.pvp && e.phase === 'attack') shape(e.attack.shape, e.attack.origin, e.attack.facing, '#f27365', .8);
        if (p.phase === 'charging') shape(spatialEngine.heavyShape(battle), p, p.facing, L.armed(battle.action) ? '#81e6d9' : '#f27365', .65);
        else if (p.phase === 'attack') {
            const progress = 1 - p.timer / (p.attack.heavy ? C.heavy.windup : C.light.windup);
            shape(p.attack.shape, p.attack.origin, p.attack.facing, '#81e6d9', .4 + progress * .5);
            ctx.beginPath(); ctx.arc(p.x, p.y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
            ctx.strokeStyle = '#efc181'; ctx.lineWidth = 3; ctx.stroke();
        }
        effects.filter(fx => fx.type === 'strike').forEach(fx => shape(fx.shape, fx.origin, fx.facing, fx.color, fx.life / .24));
        fighter(e, true); fighter(p, false);
        for (const fx of effects.filter(fx => fx.type === 'impact')) {
            const t = 1 - fx.life / .55;
            ctx.save(); ctx.globalAlpha = Math.min(1, fx.life / .2);
            const age = .55 - fx.life, burstDuration = .18;
            if (age < burstDuration) {
                const burst = age / burstDuration;
                ctx.save(); ctx.globalAlpha = 1 - burst;
                ctx.lineWidth = 2; circle(fx.x, fx.y, 16 + burst * 28, null, '#ffd69b');
                ctx.strokeStyle = '#fff0c3';
                for (let i = 0; i < 8; i++) {
                    const angle = i * Math.PI / 4 + .2, distance = 14 + burst * 30;
                    ctx.beginPath(); ctx.moveTo(fx.x + Math.cos(angle) * distance, fx.y + Math.sin(angle) * distance);
                    ctx.lineTo(fx.x + Math.cos(angle) * (distance + 9 * (1 - burst)), fx.y + Math.sin(angle) * (distance + 9 * (1 - burst))); ctx.stroke();
                }
                ctx.restore();
            }
            ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center';
            ctx.lineWidth = 3; ctx.strokeStyle = '#251c19'; ctx.fillStyle = '#fff1cb';
            ctx.strokeText(`−${fx.damage}`, fx.x, fx.y - 28 - t * 30);
            ctx.fillText(`−${fx.damage}`, fx.x, fx.y - 28 - t * 30); ctx.restore();
        }
        ctx.fillStyle = '#a7bdba'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(C.enemyName || '岩角兽', e.x, e.y - 44);
        if (!C.pvp) for (let i = 0; i < 3; i++) circle(e.x + (i - 1) * 9, e.y - 34, 2.5, e.stagger > i ? '#efc181' : '#3d4d4c');
        ctx.fillStyle = '#a8e1db'; ctx.fillText('你', p.x, p.y + 37);
        ctx.restore();
    }
    function controls() {
        for (const [channel, pad] of Object.entries(pads)) {
            const g = channel === 'action' ? battle.action : channel === 'move' ? battle.move : channel === 'skill' ? battle.skill : battle.guard;
            if (channel === 'move' && !g) pad.hidden = true;
            pad.classList.toggle('no-center-cancel', !battle.controls.cancelAtCenter);
            pad.classList.toggle('active', !!g && g.mode !== 'blocked');
            pad.classList.toggle('armed', channel === 'action' ? L.armed(g) : channel === 'skill' && !!L.selectedSkill(g));
            pad.classList.toggle('cancel-ready', channel === 'action' ? g?.mode === 'charge' && !L.armed(g) : channel === 'skill' && !!g && !L.selectedSkill(g));
            const dx = g ? (channel === 'move' ? g.dx : g.cx) : 0, dy = g ? (channel === 'move' ? g.dy : g.cy) : 0;
            const len = Math.hypot(dx, dy), factor = len > 42 ? 42 / len : 1;
            pad.querySelector('.pad-knob').style.transform = `translate(${dx * factor}px, ${dy * factor}px)`;
        }
        const selected = L.selectedSkill(battle.skill);
        for (const node of pads.skill.querySelectorAll('[data-skill]')) node.classList.toggle('selected', node.dataset.skill === selected);
        const skillNames = { heal: '治疗', haste: '疾速', full: '满蓄', parry: '弹反' };
        text('skill-label', selected ? `松手${skillNames[selected]}` : battle.skill ? (battle.skill.kind ? '取消释放' : '向外拖动') : '技能');
        const g = battle.action;
        text('move-label', battle.move?.mode === 'move' ? (['attack', 'recover', 'stunned'].includes(battle.player.phase) ? '收招后移动' : '移动中') : '移动 / 轻击');
        text('action-label', g?.mode === 'charge' ? (L.armed(g) ? (g.queued ? '已排队 · 重击' : '松手 · 重击') : '中心松手取消') : '重击');
        text('guard-label', battle.guard?.queued ? '收招后防御' : fullscreen ? (battle.guard ? '拖动转向' : '防御') : battle.guard ? '拖动调整朝向' : '防御 / 转向');
    }
    function render(snapshot, events = [], frameDt = 0) {
        battle = snapshot;
        updateCamera(frameDt);
        consume(events);
        draw(); controls();
        const p = battle.player, e = battle.enemy;
        text('battle-log', logs.join('\n'));
        text('player-hp', `${p.hp} / ${p.maxHp}`); text('enemy-hp', `${e.hp} / ${e.maxHp}`);
        nodes['player-meter'].max = p.maxHp; nodes['enemy-meter'].max = e.maxHp;
        nodes['player-meter'].value = p.hp; nodes['enemy-meter'].value = e.hp;
        apDots.forEach((dot, i) => { dot.className = p.ap >= i + 1 ? 'full' : ''; });
        $('ap').setAttribute('aria-label', `行动力 ${p.ap.toFixed(1)} / ${C.apMax}`);
        const phases = { idle: battle.move?.mode === 'move' ? '移动' : '待机', charging: '蓄力中 · 左移右转', attack: `${p.attack && p.attack.heavy ? '重击' : '轻击'}前摇`, recover: battle.queuedCommand ? '收招 · 指令已排队' : '收招', guard_start: '举盾中', guard: '防御中 · 左移右转', stunned: '受击硬直' };
        text('player-state', phases[p.phase]);
        text('enemy-state', e.phase === 'windup' ? `${e.attack.label || (e.attack.kind === 'circle' ? '周身践踏' : '扇形重扫')} · ${e.timer <= e.attack.lock ? '朝向锁定！' : '准备中'}` : e.phase === 'recover' ? '收招空档 · 可以反击' : e.phase === 'stagger' ? '失衡！重击机会' : e.phase === 'active' ? '攻击生效' : '接近中 · 留意距离');
        if (C.pvp) text('enemy-state', `对手 · ${{ idle: '待机 / 移动', charging: '蓄力中', attack: '出招', recover: '收招', guard_start: '举盾中', guard: '防御中', stunned: '硬直' }[e.phase] || e.phase}`);
        const t = Math.floor(battle.elapsed);
        text('clock', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
        nodes['charge-fill'].style.width = `${p.charge / C.fullCharge * 100}%`;
        const chargeHint = !battle.controls.cancelAtCenter ? '松手重击 · 中心取消已关闭' : L.armed(battle.action) ? '松手重击 · 回到红色中心取消' : '中心松手取消 · 向外拖动转向';
        const q = battle.queuedCommand;
        const queuedName = q?.type === 'skill' ? ({ heal: '治疗', haste: '疾速', full: '满蓄', parry: '弹反' }[q.kind]) : q?.type === 'guard' ? '防御' : q?.type === 'heavy' ? '重击' : q?.type === 'light' ? '轻击' : '重击蓄力';
        const selected = L.selectedSkill(battle.skill);
        const skillHint = battle.skill ? (selected ? `松手释放${({ heal: '治疗', haste: '疾速', full: '满蓄', parry: '弹反' })[selected]}` : battle.skill.kind ? '已回到中心 · 松手取消技能' : '向外拖动选择技能 · 上治疗 / 右疾速 / 下满蓄 / 左弹反') : '';
        text('notice', skillHint || (p.phase === 'charging' ? `${Math.round(p.charge / C.fullCharge * 100)}% 蓄力 · ${chargeHint}` : q ? `下一指令：${queuedName} · 收招后执行` : notice));
    }
    window.addEventListener('resize', resize, { signal: abort.signal });
    window.visualViewport?.addEventListener('resize', resize, { signal: abort.signal });
    canvas.addEventListener('contextlost', e => { e.preventDefault(); contextLost = true; }, { signal: abort.signal });
    canvas.addEventListener('contextrestored', () => { contextLost = false; resize(); }, { signal: abort.signal });
    resize();
    return { render, refresh: resize, destroy() { abort.abort(); observer.disconnect(); apDots.forEach(dot => dot.remove()); } };
} };
