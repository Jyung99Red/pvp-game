// The menu (design.md 3.6): Esc or the key top left opens it over the
// running game, which goes on (user, 2026-10-02: like Minecraft's
// inventory; the pause is a button of its own). Three columns: the main
// character in what is worn, turned by dragging (render/figure_view.js);
// HP and stats over the four gear slots (a column) and the bag beside
// them, the picked item below (one bag: the base's storage opens this
// too), gear changed in the base only (design.md 7.2); and the side:
// pause, the duel room, this phone's settings (folded away), a new
// adventure. The close key has the corner to itself. Gear changes go
// through core/inventory.js on the world's progress and take effect when
// the menu closes (`closed`).
const menuScreen = (() => {
    const K = inventoryKit, { SLOT_NAMES, STAT_NAMES } = itemScreens;
    // Radians the figure turns per CSS pixel dragged.
    const TURN = 0.012;
    // The custom picture quality's sliders (ui/settings.js), one per value
    // of graphics.choices: the label, and how a value reads. The pixel
    // ratio reads as what is drawn: never more than the phone's own, and
    // the picture's size in device pixels.
    const SLIDERS = {
        pixelRatio: ['像素比', v => {
            const own = window.devicePixelRatio || 1, used = Math.min(v, own);
            return `×${+used.toFixed(2)}${v > own ? '（手机上限）' : ''} ${Math.round(window.innerWidth * used)}×${Math.round(window.innerHeight * used)}`;
        }],
        sunShadow: ['太阳影子', v => String(v)],
        torchShadow: ['火把影子', v => String(v)],
        torchTaps: ['火把柔边', v => `${v} 点`],
        bounce: ['反弹光', v => v ? '开' : '关']
    };
    const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    // hooks: progress() the world's progress; player() the fighter shown
    // (HP); canChange() gear may be changed now;
    // changed('gear'); act(name) for the side's buttons (pause, duel,
    // reset); closed({ gearChanged }).
    function attach(root, hooks) {
        const el = root.querySelector('[data-menu-screen]'), $ = sel => el.querySelector(sel);
        const figureBox = $('[data-menu-figure]'), slotsEl = $('[data-menu-slots]'), bagEl = $('[data-menu-bag]'), detailEl = $('[data-menu-detail]');
        const hpFill = $('[data-menu-hp]'), hpText = $('[data-menu-hp-text]'), statsEl = $('[data-menu-stats]');
        const settingsEl = $('[data-menu-settings]');
        const acts = Object.fromEntries([...el.querySelectorAll('[data-menu-act]')].map(b => [b.dataset.menuAct, b]));
        const I = gameConfig.items;
        let open = false, picked = null, message = '', gearChanged = false, raf = 0, drag = null, fig = null, shownHp = '', folded = true;

        const owned = id => K.count(hooks.progress(), id);
        const statLine = stats => K.STATS.filter(k => stats?.[k]).map(k => `${STAT_NAMES[k]} +${stats[k]}`).join('，');
        const slotLine = item => SLOT_NAMES[item.slot] + (item.weapon ? ` · ${gameConfig.combo.weapons[item.weapon].name}` : '');
        // Carried and not worn: gear by slot, then supplies, then materials.
        function bagItems() {
            const p = hooks.progress(), worn = new Set(Object.values(p.loadout).filter(Boolean));
            const rank = id => I[id].kind === 'gear' ? K.SLOTS.indexOf(I[id].slot) : I[id].kind === 'supply' ? K.SLOTS.length : K.SLOTS.length + 1;
            return Object.keys(I).filter(id => I[id].kind !== 'gold' && owned(id) > 0 && !worn.has(id)).sort((a, b) => rank(a) - rank(b));
        }
        const cell = (id, extra = '') => {
            const n = owned(id), count = I[id].kind !== 'gear' && n > 0 ? `<b class="cell-count">${n}</b>` : '';
            return `<button type="button" class="cell${id === picked ? ' on' : ''}${extra}" data-item="${id}" aria-label="${esc(I[id].name)}">${itemScreens.iconHtml(id)}${count}</button>`;
        };

        // The picked item: what it is, and putting it on or taking it off.
        function detail() {
            if (!picked || (!owned(picked) && !Object.values(hooks.progress().loadout).includes(picked))) {
                picked = null;
                return `<p class="detail-hint">点一下装备栏或背包里的东西看详情。</p><p class="detail-note">${esc(message)}</p>`;
            }
            const p = hooks.progress(), item = I[picked], lines = [item.desc];
            let compare = '', actions = [];
            if (item.slot) {
                const slot = item.slot, worn = p.loadout[slot] === picked, lock = hooks.canChange() ? '' : '只能在曙光村里换装备';
                lines.unshift(`${slotLine(item)}${item.stats ? ' · ' + statLine(item.stats) : ''}${item.kind === 'supply' ? ` · 有 ${owned(picked)}` : ''}`);
                const now = K.statsOf(p.loadout), next = K.statsOf({ ...p.loadout, [slot]: worn ? null : picked });
                if (!(worn && slot === 'main')) compare = K.STATS.map(k => [STAT_NAMES[k], now[k], next[k]]).filter(([, a, b]) => a !== b)
                    .map(([k, a, b]) => `<span>${k} ${a}→<b class="${b > a ? 'up' : 'down'}">${b}</b></span>`).join('');
                actions = worn
                    ? (slot === 'main' ? [] : [{ id: 'unequip', label: '卸下', why: lock }])
                    : [{ id: 'equip', label: p.loadout[slot] ? '换上' : '装上', why: lock, primary: true }];
            } else lines.unshift(`有 ${owned(picked)} 个${item.sell ? ` · 商店收每个 ${item.sell} 金币` : ''}`);
            const why = actions.find(a => a.why)?.why || '';
            return `<div class="detail-top"><h3>${itemScreens.iconHtml(picked)}${esc(item.name)}</h3>
                ${compare ? `<span class="detail-compare">${compare}</span>` : ''}
                <div class="detail-actions">${actions.map(a => `<button type="button" data-act="${a.id}" class="${a.primary ? 'primary' : ''}" ${a.why ? 'disabled' : ''}>${esc(a.label)}</button>`).join('')}</div></div>
                <p class="detail-note">${esc(message || why)}</p>
                ${lines.map(l => `<p>${esc(l)}</p>`).join('')}`;
        }
        function render() {
            const p = hooks.progress(), stats = K.statsOf(p.loadout);
            statsEl.innerHTML = ['atk', 'def', 'maxHp'].map(k => `<div><dt>${k === 'maxHp' ? '生命上限' : STAT_NAMES[k]}</dt><dd>${stats[k]}</dd></div>`).join('')
                + `<div class="menu-gold"><dt aria-label="金币">${itemScreens.iconHtml('gold')}</dt><dd>${p.inventory.gold}</dd></div>`;
            slotsEl.innerHTML = K.SLOTS.map(slot => {
                const id = p.loadout[slot];
                return `<div class="slot">${id ? cell(id) : '<span class="cell empty" aria-label="空">空</span>'}<span class="slot-name">${SLOT_NAMES[slot]}</span></div>`;
            }).join('');
            const items = bagItems();
            bagEl.innerHTML = items.length ? items.map(id => cell(id)).join('') : '<p class="bag-empty">背包里没有别的东西</p>';
            detailEl.innerHTML = detail();
            settingsEl.hidden = folded;
            acts.settings.setAttribute('aria-expanded', String(!folded));
            settingsEl.innerHTML = Object.entries(gameSettings.CHOICES).map(([key, c]) => {
                const now = c.options.find(([v]) => v === gameSettings.get(key))?.[1] ?? '';
                const button = `<button type="button" class="setting" data-setting="${key}" aria-label="${c.label}：${now}，点一下换">${c.label}<b>${now}</b></button>`;
                return key === 'quality' && gameSettings.get('quality') === 'custom' ? button + sliders() : button;
            }).join('');
            if (fig) fig.show(p.loadout);
            life(true);
        }
        // The custom quality's sliders, under the quality's key.
        function sliders() {
            const custom = gameSettings.get('custom'), choices = gameConfig.graphics.choices;
            return `<div class="sliders">${Object.entries(SLIDERS).map(([key, [label, read]]) => {
                const options = choices[key], at = Math.max(0, options.indexOf(custom[key]));
                return `<label class="slider"><span>${label}<b data-custom-shown="${key}">${esc(read(options[at]))}</b></span>`
                    + `<input type="range" min="0" max="${options.length - 1}" step="1" value="${at}" data-custom="${key}" aria-label="${label}"></label>`;
            }).join('')}</div>`;
        }
        // A slider moved: its value reads at once; let go, it is kept and drawn.
        const slid = e => {
            const input = e.target.closest?.('[data-custom]');
            if (!input) return null;
            const key = input.dataset.custom, value = gameConfig.graphics.choices[key][Number(input.value)];
            el.querySelector(`[data-custom-shown="${key}"]`).textContent = SLIDERS[key][1](value);
            return { key, value };
        };
        el.addEventListener('input', slid);
        el.addEventListener('change', e => { const s = slid(e); if (s) gameSettings.setCustom(s.key, s.value); });
        // HP goes on changing under the open menu.
        function life(force = false) {
            const f = hooks.player(), text = `${Math.ceil(f.hp)} / ${f.maxHp}`;
            if (!force && text === shownHp) return;
            shownHp = text;
            hpFill.style.width = `${(Math.max(0, Math.min(1, f.hp / f.maxHp)) * 100).toFixed(1)}%`;
            hpText.textContent = text;
        }
        function tick(now) {
            if (!open) return;
            if (fig) {
                const r = figureBox.getBoundingClientRect();
                fig.size(r.width, r.height);
                fig.frame(now / 1000);
            }
            life();
            raf = requestAnimationFrame(tick);
        }

        function show() {
            if (open) return;
            open = true; picked = null; message = ''; gearChanged = false;
            el.hidden = false;
            fig = figureView.figure();
            if (fig && fig.canvas.parentNode !== figureBox) figureBox.prepend(fig.canvas);
            figureBox.classList.toggle('none', !fig);
            render();
            raf = requestAnimationFrame(tick);
            acts.close.focus({ preventScroll: true });
        }
        function close() {
            if (!open) return;
            open = false; el.hidden = true; drag = null;
            cancelAnimationFrame(raf);
            hooks.closed({ gearChanged });
        }

        el.addEventListener('click', e => {
            const item = e.target.closest('[data-item]')?.dataset.item;
            if (item) { picked = item; message = ''; render(); return; }
            const a = e.target.closest('[data-act]');
            if (a && !a.disabled && picked) {
                const slot = I[picked].slot, equip = a.dataset.act === 'equip';
                const why = K.equip(hooks.progress(), slot, equip ? picked : null);
                if (!why) { gearChanged = true; hooks.changed('gear'); }
                message = why || (equip ? `换上了${I[picked].name}` : `卸下了${I[picked].name}`);
                render();
                return;
            }
            // A setting's key moves it on to its next choice.
            const s = e.target.closest('[data-setting]');
            if (s) {
                const key = s.dataset.setting, options = gameSettings.CHOICES[key].options, at = options.findIndex(([v]) => v === gameSettings.get(key));
                gameSettings.set(key, options[(at + 1) % options.length][0]);
                render();
                return;
            }
            const act = e.target.closest('[data-menu-act]');
            if (!act || act.disabled) return;
            if (act.dataset.menuAct === 'close') close();
            else if (act.dataset.menuAct === 'settings') { folded = !folded; render(); }
            else hooks.act(act.dataset.menuAct);
        });
        // Dragging the figure turns it.
        figureBox.addEventListener('pointerdown', e => { drag = { id: e.pointerId, x: e.clientX }; figureBox.setPointerCapture?.(e.pointerId); });
        figureBox.addEventListener('pointermove', e => {
            if (!drag || e.pointerId !== drag.id || !fig) return;
            fig.turn((e.clientX - drag.x) * TURN);
            drag.x = e.clientX;
        });
        const release = e => { if (drag && e.pointerId === drag.id) drag = null; };
        figureBox.addEventListener('pointerup', release);
        figureBox.addEventListener('pointercancel', release);
        return { open: show, close, isOpen: () => open, render, get picked() { return picked; } };
    }
    return { attach };
})();
