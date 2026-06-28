// save.js - 本地存档（localStorage）。只负责"读 / 写 / 重置"，不含任何游戏规则。
// 依赖: data.js 必须先加载（用到 state / content）
//
// 存什么、不存什么：
// - 存：resources（金币/石材） / inventory（经验+物品+材料） / base.buildings / player（等级、属性、HP、装备）
// - 不存：world（当前tab/探索进度）、battle（战斗中间状态）、pvpBattle（联机对战状态）
//   ——这些都是"会话内"的瞬时状态，重新打开页面时应该总是回到默认值，
//   而不是尝试还原一场战斗中途的状态（风险高、价值低，也不是这次要做的事）。

const save = (() => {
    const KEY = 'idle_rpg_save_v1';
    const AUTOSAVE_INTERVAL_MS = 8000;

    let _timer = null;

    function _snapshot() {
        return {
            v: 1,
            savedAt: Date.now(),
            resources: state.resources,
            inventory: state.inventory,
            base: state.base,
            player: state.player
        };
    }

    function _doSave() {
        try {
            localStorage.setItem(KEY, JSON.stringify(_snapshot()));
            return true;
        } catch (e) {
            console.warn('[save] 写入失败', e);
            return false;
        }
    }

    function _doLoad() {
        let raw;
        try {
            raw = localStorage.getItem(KEY);
        } catch (e) {
            console.warn('[save] 读取失败', e);
            return false;
        }
        if (!raw) return false;

        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            console.warn('[save] 存档损坏，已忽略', e);
            return false;
        }
        if (!data || typeof data !== 'object') return false;

        // 逐项覆盖，而不是整体替换 state —— 保留 world/battle 等没有被存档的字段，
        // 维持 data.js 里定义的默认初始值不变。
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
            // baseStats / equip 是嵌套对象，Object.assign 在这里是浅拷贝、
            // 直接整体换掉引用——没问题，因为 player.js 每次都是现读 state.player.xxx，
            // 没有缓存旧引用。
        }
        return true;
    }

    function _clear() {
        try { localStorage.removeItem(KEY); } catch (e) {}
    }

    return {
        // 启动时调用一次：把存档读回 state（如果有的话）
        load() {
            const ok = _doLoad();
            if (ok) console.log('[save] 已读取本地存档');
            return ok;
        },

        // 手动存一次（其他地方想立刻保存也可以直接调）
        save() {
            return _doSave();
        },

        // 开启自动存档：定时存 + 切到后台/关闭页面前存一次
        startAutosave() {
            if (_timer) return;
            _timer = setInterval(_doSave, AUTOSAVE_INTERVAL_MS);

            // 移动端浏览器 beforeunload 不一定可靠（直接划掉App场景），
            // 用 visibilitychange 兜底，切后台/锁屏时就存一次。
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') _doSave();
            });
            window.addEventListener('beforeunload', _doSave);
        },

        // ── 开发测试用：重置到初始状态 ──────────────────────────────
        // 直接清空存档 + 刷新页面，让 data.js 重新跑一遍最初的 state 定义，
        // 比手动逐项还原更可靠（不会漏掉某个字段忘记重置）。
        resetToInitial() {
            if (!confirm('确定要重置为初始状态吗？当前进度会清空（仅用于测试）')) return;
            _clear();
            location.reload();
        }
    };
})();