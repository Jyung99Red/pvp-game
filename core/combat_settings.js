// Operation preferences are shared by training and PVE, separate from progression saves.
const combatSettings = (() => {
    const defaults = { cancelAtCenter: true, autoFace: false };
    const key = 'pvp-game-combat-controls-v1';
    function read() {
        const values = { ...defaults };
        try {
            const saved = JSON.parse(localStorage.getItem(key));
            for (const name of Object.keys(values)) if (typeof saved?.[name] === 'boolean') values[name] = saved[name];
        } catch (_) { /* Storage may be unavailable; defaults remain usable. */ }
        return values;
    }
    function attach(root, getBattle, onChange) {
        const values = read(), abort = new AbortController();
        for (const node of root.querySelectorAll('[data-combat-setting]')) {
            const name = node.dataset.combatSetting;
            node.checked = values[name];
            node.addEventListener('change', () => {
                values[name] = node.checked;
                const battle = getBattle();
                if (onChange) onChange({ ...values });
                else if (battle) { spatialEngine.cancelInputs(battle); Object.assign(battle.controls, values); }
                try { localStorage.setItem(key, JSON.stringify(values)); } catch (_) { /* Session preferences still apply. */ }
            }, { signal: abort.signal });
        }
        return { apply(battle) { Object.assign(battle.controls, values); }, destroy() { abort.abort(); } };
    }
    return { attach };
})();
