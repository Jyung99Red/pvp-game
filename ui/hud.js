// Heads-up display over the 3D view: the player's HP and guard bar, the
// training dummy's HP and stagger, the running combo with the move's name,
// and floating damage numbers. Reads the simulation; never writes it.
const hud = (() => {
    function attach(root) {
        const $ = sel => root.querySelector(sel);
        const els = {
            hp: $('[data-hud="hp"]'), guard: $('[data-hud="guard"]'), guardBar: $('[data-hud="guard-bar"]'),
            target: $('[data-hud="target"]'), targetHp: $('[data-hud="target-hp"]'), pips: [...root.querySelectorAll('[data-hud="pip"]')],
            combo: $('[data-hud="combo"]'), chips: $('[data-hud="chips"]'), move: $('[data-hud="move"]'), floats: $('[data-hud="floats"]')
        };
        let comboKey = '', comboShownAt = -1, floats = [];
        root.querySelector('.target-name').textContent = gameConfig.dummy.name;
        const width = (el, share) => { el.style.width = `${(Math.max(0, Math.min(1, share)) * 100).toFixed(1)}%`; };
        const LABEL = { a: 'A', b: 'B', '-': '·' };
        function update(sim, view, now) {
            const p = sim.player, G = gameConfig.combat.guardBar;
            width(els.hp, p.hp / p.maxHp);
            width(els.guard, p.guard.bar / G.max);
            els.guardBar.classList.toggle('locked', p.guard.locked);
            const d = sim.dummy;
            els.target.hidden = !d;
            if (d) {
                width(els.targetHp, d.hp / d.maxHp);
                const points = d.phase === 'reel' ? gameConfig.combat.stagger.threshold : d.stagger;
                els.pips.forEach((pip, i) => pip.classList.toggle('on', i < Math.floor(points + 1e-9)));
                els.target.classList.toggle('reeling', d.phase === 'reel');
            }
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
                if (!['hit', 'block', 'parry'].includes(e.type) || !e.at) continue;
                const el = document.createElement('div');
                const toPlayer = e.type === 'hit' && e.side === 'dummy';
                el.className = 'float' + (toPlayer ? ' hurt' : '') + (e.type === 'parry' ? ' parry' : '') + (e.type === 'block' ? ' block' : '') + (e.heavy ? ' heavy' : '');
                el.textContent = e.type === 'parry' ? `弹反 ${e.damage}` : e.type === 'block' ? `格挡 ${e.damage}` : String(e.damage);
                els.floats.appendChild(el);
                floats.push({ el, at: e.at, born: now });
            }
        }
        return { update, events };
    }
    return { attach };
})();
