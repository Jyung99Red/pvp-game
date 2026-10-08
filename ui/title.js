// The title screen (design.md 3.6; user, 2026-10-08): the page opens on
// it, over the base dimmed and standing still. 继续冒险 when there is a
// save; 新的冒险 (开始冒险 without one: a save is erased only once asked);
// the duel room; this phone's settings, unfolded beside the keys
// (ui/settings_view.js). No 退出: a page cannot close itself, and a phone
// leaves a game by its own gesture; the menu's 回到主界面 comes back here.
const titleScreen = (() => {
    // hooks: saved() a save exists; act(name) for continue, new and duel.
    function attach(root, hooks) {
        const el = root.querySelector('[data-title]');
        const keys = Object.fromEntries([...el.querySelectorAll('[data-title-act]')].map(b => [b.dataset.titleAct, b]));
        const box = el.querySelector('[data-title-settings]'), settingsPage = settingsView.attach(box, { prefix: 'title-setting' });
        let open = false, unfolded = false;
        function render() {
            const saved = hooks.saved();
            keys.continue.hidden = !saved;
            keys.new.textContent = saved ? '新的冒险' : '开始冒险';
            keys.new.classList.toggle('primary', !saved);
            box.hidden = !unfolded;
            keys.settings.setAttribute('aria-expanded', String(unfolded));
            if (unfolded) settingsPage.render();
        }
        // Shown again while open, it is only brought up to date.
        function show() {
            const was = open;
            open = true; el.hidden = false;
            root.classList.add('at-title');
            if (!was) unfolded = false;
            render();
            if (!was) (hooks.saved() ? keys.continue : keys.new).focus({ preventScroll: true });
        }
        function close() {
            if (!open) return;
            open = false; el.hidden = true;
            root.classList.remove('at-title');
            settingsPage.stop();
        }
        el.addEventListener('click', e => {
            const key = e.target.closest('[data-title-act]');
            if (!key) return;
            if (key.dataset.titleAct === 'settings') { unfolded = !unfolded; render(); }
            else hooks.act(key.dataset.titleAct);
        });
        return { open: show, close, isOpen: () => open };
    }
    return { attach };
})();
