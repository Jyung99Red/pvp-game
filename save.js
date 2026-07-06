// save.js - Local save (localStorage). Handles only "load / save / reset",
// no game rules live here.
// Depends on: data.js must load first (uses state / content)
//
// What gets saved, what doesn't:
// - Saved: resources (gold) / inventory (exp+items+materials) / base.buildings /
//   player (level, stats, HP, equip) / progress (checkpointFloor -- permanent
//   dungeon progress, NOT the same as `world` below)
// - Not saved: world (current tab/in-run floor position), battle (mid-fight state),
//   pvpBattle (online match state) -- these are all transient "session-only"
//   state that should always reset to defaults on page reload, rather than
//   trying to restore a fight mid-flight (high risk, low value, and out of
//   scope here).

const save = (() => {
    const KEY = 'idle_rpg_save_v1';
    const AUTOSAVE_INTERVAL_MS = 8000;

    let _timer = null;
    let _resetting = false;   // true during reset; all writes are skipped while this is set (see note below)

    function _snapshot() {
        return {
            v: 1,
            savedAt: Date.now(),
            resources: state.resources,
            inventory: state.inventory,
            base: state.base,
            player: state.player,
            progress: state.progress
        };
    }

    function _doSave() {
        if (_resetting) return false;   // Reset in progress; block any write from putting old data back
        try {
            localStorage.setItem(KEY, JSON.stringify(_snapshot()));
            return true;
        } catch (e) {
            console.warn('[save] write failed', e);
            return false;
        }
    }

    function _doLoad() {
        let raw;
        try {
            raw = localStorage.getItem(KEY);
        } catch (e) {
            console.warn('[save] read failed', e);
            return false;
        }
        if (!raw) return false;

        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            console.warn('[save] save data corrupted, ignoring', e);
            return false;
        }
        if (!data || typeof data !== 'object') return false;

        // Overwrite field by field rather than replacing state wholesale --
        // this preserves world/battle and other fields that aren't saved,
        // keeping the defaults defined in data.js intact.
        if (data.resources) Object.assign(state.resources, data.resources);

        if (data.inventory) {
            if (typeof data.inventory.exp === 'number') state.inventory.exp = data.inventory.exp;
            Object.assign(state.inventory.items, data.inventory.items || {});
            Object.assign(state.inventory.materials, data.inventory.materials || {});
        }

        if (data.base && data.base.buildings) {
            Object.assign(state.base.buildings, data.base.buildings);
        }

        if (data.player) {
            Object.assign(state.player, data.player);
            // baseStats / equip are nested objects, so Object.assign only
            // shallow-copies -- it swaps the reference wholesale, which is
            // fine because player.js always reads state.player.xxx live and
            // never caches an old reference.
        }

        if (data.progress) Object.assign(state.progress, data.progress);

        return true;
    }

    function _clear() {
        try { localStorage.removeItem(KEY); } catch (e) {}
    }

    return {
        // Called once at startup: read the save back into state (if any exists)
        load() {
            const ok = _doLoad();
            if (ok) console.log('[save] loaded local save');
            return ok;
        },

        // Save once manually (other code can call this to save immediately)
        save() {
            return _doSave();
        },

        // Turn on autosave: save on a timer + once before backgrounding/closing the page
        startAutosave() {
            if (_timer) return;
            _timer = setInterval(_doSave, AUTOSAVE_INTERVAL_MS);

            // Mobile browsers' beforeunload isn't always reliable (e.g. the
            // app gets swiped away directly), so visibilitychange is the
            // fallback: save once when backgrounded/locked.
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') _doSave();
            });
            window.addEventListener('beforeunload', _doSave);
        },

        // -- Dev/test only: reset to initial state -----------------------
        // Clears the save and reloads the page so data.js re-runs its
        // initial state definitions from scratch -- more reliable than
        // manually restoring each field (nothing gets missed).
        //
        // Gotcha: location.reload() triggers beforeunload, and our own
        // autosave handler (_doSave) would then write the old in-memory
        // state (as it was right before the clear) straight back to
        // localStorage -- effectively undoing the clear we just did, so the
        // reset silently no-ops. _resetting blocks every write during that
        // window to prevent that.
        resetToInitial() {
            if (!confirm('确定要重置为初始状态吗？当前进度会清空（仅用于测试）')) return;
            _resetting = true;
            _clear();
            location.reload();
        }
    };
})();