// Heads-up display over the 3D view: this fighter's HP and guard bar, the
// foe being fought (its HP, stagger, enrage), small HP bars and a "!" over
// monsters in a fight, how many are left, the running combo with the
// move's name, and floating damage numbers. In a duel: the rival's HP in
// the foe panel and over its head, the countdown, and an arrow at the edge
// of the screen while the rival is in sight but off it. Reads the
// simulation; never writes it.
const hud = (() => {
    const FIGHTING = new Set(['alert', 'chase', 'windup', 'swing', 'recover', 'reel']);
    function attach(root) {
        const $ = sel => root.querySelector(sel);
        const els = {
            hp: $('[data-hud="hp"]'), guard: $('[data-hud="guard"]'), guardBar: $('[data-hud="guard-bar"]'), goal: $('[data-hud="goal"]'),
            target: $('[data-hud="target"]'), targetName: $('[data-hud="target-name"]'), rage: $('[data-hud="rage"]'),
            targetHp: $('[data-hud="target-hp"]'), pipBox: $('[data-hud="pips"]'), pips: [...root.querySelectorAll('[data-hud="pip"]')],
            combo: $('[data-hud="combo"]'), chips: $('[data-hud="chips"]'), move: $('[data-hud="move"]'),
            floats: $('[data-hud="floats"]'), mobs: $('[data-hud="mobs"]'), banner: $('[data-hud="banner"]'), arrow: $('[data-hud="arrow"]')
        };
        let comboKey = '', comboShownAt = -1, floats = [], focus = null, mobs = new Map(), fightAt = null, selfId = 'player';
        const width = (el, share) => { el.style.width = `${(Math.max(0, Math.min(1, share)) * 100).toFixed(1)}%`; };
        const LABEL = { a: 'A', b: 'B', '-': '·' };
        const nameOf = body => body.kind === 'fighter' ? '对手' : body.kind === 'dummy' ? gameConfig.dummy.name : gameConfig.monsters[body.kind].name;
        const topOf = body => body.kind === 'fighter' ? 2.15 : body.kind === 'wolf' ? 1.25 : 1.65;
        // A new world: forget the last one's foes.
        function reset() {
            focus = null; comboKey = ''; fightAt = null;
            for (const m of mobs.values()) m.el.remove();
            mobs = new Map();
            for (const f of floats) f.el.remove();
            floats = [];
            els.banner.hidden = true; els.arrow.hidden = true;
        }
        // The foe the top-right panel shows: the rival in a duel; the
        // training dummy; else the one last traded blows with, while it
        // stands; else the nearest one in a fight.
        function target(sim, p) {
            if (sim.duel) return sim.fighters.find(f => f !== p) || null;
            if (sim.dummy) return sim.dummy;
            const live = sim.monsters.filter(m => m.phase !== 'dead' || m.t < 1);
            const held = live.find(m => m.id === focus);
            if (held) return held;
            let best = null, far = 400;
            for (const m of live) {
                const d = Math.hypot(m.x - p.x, m.y - p.y);
                if (FIGHTING.has(m.phase) && d < far) { far = d; best = m; }
            }
            return best;
        }
        function place(el, view, at) {
            const xy = view?.project(at);
            if (xy) el.style.transform = `translate(${xy.x.toFixed(1)}px, ${xy.y.toFixed(1)}px) translate(-50%, -100%)`;
            return !!xy;
        }
        const over = (body, shown) => (([x, y, z]) => [x, y + topOf(body), z])(space.toBlocks(shown.x, shown.y, shown.h));
        function mobOf(id) {
            let mob = mobs.get(id);
            if (!mob) {
                const el = document.createElement('div');
                el.className = 'mob'; el.hidden = true;
                el.innerHTML = '<span class="mob-alert" hidden>!</span><div class="mob-bar"><i></i></div>';
                els.mobs.appendChild(el);
                mob = { el, alert: el.firstChild, fill: el.querySelector('i') };
                mobs.set(id, mob);
            }
            return mob;
        }
        // The rival off screen but in sight: an arrow on the screen's edge
        // pointing at it.
        function pointAt(view, at) {
            const r = root.getBoundingClientRect(), xy = view?.project(at), margin = 34;
            if (xy && xy.x >= 0 && xy.x <= r.width && xy.y >= 0 && xy.y <= r.height) { els.arrow.hidden = true; return; }
            const cx = r.width / 2, cy = r.height / 2;
            let dx, dy;
            if (xy) { dx = xy.x - cx; dy = xy.y - cy; } else { dx = 0; dy = 1; }
            const k = Math.min((cx - margin) / Math.max(1e-6, Math.abs(dx)), (cy - margin) / Math.max(1e-6, Math.abs(dy)));
            els.arrow.hidden = false;
            els.arrow.style.transform = `translate(${(cx + dx * k).toFixed(1)}px, ${(cy + dy * k).toFixed(1)}px) translate(-50%, -50%) rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
        }
        // duel (optional): { countdown, phase } from the duel session.
        function update(sim, view, now, bodies = null, { self = 'player', duel = null } = {}) {
            selfId = self;
            const p = sim.fighters.find(f => f.id === self) || sim.fighters[0], G = gameConfig.combat.guardBar;
            const shownOf = body => bodies?.get(body.id) || body;
            width(els.hp, p.hp / p.maxHp);
            width(els.guard, p.guard.bar / G.max);
            els.guardBar.classList.toggle('locked', p.guard.locked);
            const total = sim.monsters.length, left = sim.monsters.filter(m => m.phase !== 'dead').length;
            els.goal.hidden = !total;
            if (total) els.goal.textContent = `剩余怪物 ${left} / ${total}`;
            const d = target(sim, p);
            els.target.hidden = !d;
            if (d) {
                els.targetName.textContent = nameOf(d);
                els.rage.hidden = !d.enraged;
                width(els.targetHp, d.hp / d.maxHp);
                els.pipBox.hidden = d.kind === 'fighter';
                const points = d.phase === 'reel' ? gameConfig.combat.stagger.threshold : d.stagger;
                els.pips.forEach((pip, i) => pip.classList.toggle('on', i < Math.floor(points + 1e-9)));
                els.target.classList.toggle('reeling', d.phase === 'reel');
            }
            // Over each monster in a fight or hurt: a small bar; "!" as it notices.
            for (const m of sim.monsters) {
                const mob = mobOf(m.id), shown = shownOf(m);
                const visible = m.phase !== 'dead' && (FIGHTING.has(m.phase) || m.hp < m.maxHp);
                mob.el.hidden = !visible || !place(mob.el, view, over(m, shown));
                if (mob.el.hidden) continue;
                mob.alert.hidden = m.phase !== 'alert';
                mob.el.classList.toggle('enraged', m.enraged);
                width(mob.fill, m.hp / m.maxHp);
            }
            // Over the rival, while it is in sight; an arrow when off screen.
            els.arrow.hidden = true;
            for (const f of sim.fighters) {
                if (f === p) continue;
                const mob = mobOf(f.id), seen = !f.down && (view?.seen(f.id) ?? true), at = over(f, shownOf(f));
                mob.el.hidden = !seen || !place(mob.el, view, at);
                if (!mob.el.hidden) width(mob.fill, f.hp / f.maxHp);
                if (seen) pointAt(view, at);
            }
            // The countdown, then "开始" for a moment.
            if (duel && duel.countdown > 0 && (duel.phase === 'countdown' || duel.phase === 'starting')) {
                els.banner.hidden = false; els.banner.textContent = String(Math.ceil(duel.countdown - 1e-6)); fightAt = null;
            } else if (duel && duel.phase === 'fight') {
                if (fightAt === null) fightAt = now;
                els.banner.hidden = now - fightAt > 0.8;
                els.banner.textContent = '开始';
            } else els.banner.hidden = true;
            // The combo: chips for its inputs, the move's name; fades once it ends.
            const key = p.combo.join(' ') + '|' + (p.act?.move || '');
            if (p.combo.length && key !== comboKey) {
                comboKey = key; comboShownAt = now;
                els.chips.innerHTML = '';
                p.combo.forEach((input, i) => {
                    const chip = document.createElement('span');
                    chip.className = 'chip' + (input === '-' ? ' pause' : '') + (i === p.combo.length - 1 ? ' on' : '');
                    chip.textContent = LABEL[input];
                    els.chips.appendChild(chip);
                });
                els.move.textContent = p.act ? gameConfig.combo.moves[p.act.move].name : '';
            }
            const live = p.act || p.chain;
            els.combo.classList.toggle('show', !!p.combo.length && (live || now - comboShownAt < 0.6));
            if (!p.combo.length) comboKey = '';
            // Damage numbers rise and fade over their target.
            floats = floats.filter(f => {
                const age = now - f.born;
                if (age > 0.8) { f.el.remove(); return false; }
                const at = view?.project([f.at[0], f.at[1] + age * 0.9, f.at[2]]);
                if (at) f.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%)`;
                f.el.style.opacity = String(Math.min(1, (0.8 - age) / 0.3));
                return true;
            });
        }
        function events(list, now) {
            for (const e of list) {
                // Whoever this fighter last traded blows with stays in the panel.
                if (e.type === 'hit' || e.type === 'parry' || e.type === 'block') {
                    const other = e.target === selfId || e.type === 'block' ? e.source : e.target;
                    if (other && other !== 'dummy') focus = other;
                }
                if (!['hit', 'block', 'parry'].includes(e.type) || !e.at) continue;
                const el = document.createElement('div');
                const toSelf = e.type === 'hit' && e.target === selfId;
                el.className = 'float' + (toSelf ? ' hurt' : '') + (e.type === 'parry' ? ' parry' : '') + (e.type === 'block' ? ' block' : '') + (e.heavy ? ' heavy' : '');
                el.textContent = e.type === 'parry' ? `弹反 ${e.damage}` : e.type === 'block' ? `格挡 ${e.damage}` : String(e.damage);
                els.floats.appendChild(el);
                floats.push({ el, at: e.at, born: now });
            }
        }
        return { update, events, reset };
    }
    return { attach };
})();
