// icons.js - SVG图标映射表与渲染helper
// symbol id 对应 icons/ 文件夹结构：
//   icons/weapons/weapon-atk.svg → id = "weapons/weapon-atk"
//   icons/fx/slash.svg           → id = "fx/slash"

// ── 图标映射表 ──
// key = 代码里用的名称，value = SVG symbol id
const ICONS = {
    // 【 Data 类 - 实体与装备 】
    'weapon-atk': 'data/weapon-atk',      // 攻击型武器
    'shield-def': 'data/shield-def',      // 防守型盾牌
    'goblin': 'data/goblin',              // 哥布林头像

    // 【 UI 类 - 界面与交互 】
    'escape': 'ui/escape',                // 撤离/逃跑按钮
    'monster-atk': 'ui/monster-atk',      // 敌方攻击预警节点图标

    // 【 FX 类 - 战斗特效 】
    'fx-slash': 'fx/slash',               // 斩击特效
};


// ── 渲染helper ──

/**
 * 生成内联 SVG <use> 标签（用于嵌入HTML）
 * @param {string} key     - ICONS 里的 key
 * @param {string} cls     - 额外的 CSS class（可选）
 * @returns {string}       - HTML字符串
 */
function renderIcon(key, cls = '') {
    const id = ICONS[key];
    if (!id) return '';
    const clsAttr = cls ? ` class="game-icon ${cls}"` : ' class="game-icon"';
    return `<svg${clsAttr} aria-hidden="true"><use href="#${id}"/></svg>`;
}

/**
 * 把图标挂载到现有DOM元素上
 * @param {HTMLElement} el  - 目标元素
 * @param {string} key      - ICONS 里的 key
 * @param {string} cls      - 额外 CSS class（可选）
 */
function setIcon(el, key, cls = '') {
    if (!el) return;
    el.innerHTML = renderIcon(key, cls);
}

// ── Dev-mode SVG sprite loader ──
// 在打包版（game_build.html）里，symbol 已内联 → 直接跳过。
// 在开发模式（index.html + 本地服务器）里，自动 fetch 各 SVG 文件并注入。
function _loadSVGSprite() {
    // 取 ICONS 里第一个 id，检查 symbol 是否已存在（打包模式）
    const firstId = Object.values(ICONS)[0];
    if (!firstId || document.querySelector(`symbol[id="${firstId}"]`)) return;

    // 从 ICONS 里收集所有需要 fetch 的 SVG（去重）
    const seen = new Set();
    const sources = [];
    for (const id of Object.values(ICONS)) {
        if (!seen.has(id)) {
            seen.add(id);
            sources.push({ id, src: `icons/${id}.svg` });
        }
    }

    // 创建隐藏 sprite 容器，插到 body 最前面
    const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sprite.setAttribute('style', 'display:none');
    sprite.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(sprite, document.body.firstChild);

    const parser = new DOMParser();
    sources.forEach(({ id, src }) => {
        fetch(src, { cache: 'no-store' })
            .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
            .then(text => {
                const doc = parser.parseFromString(text, 'image/svg+xml');
                const svgEl = doc.querySelector('svg');
                const vb = svgEl?.getAttribute('viewBox') || '0 0 512 512';
                const sym = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
                sym.setAttribute('id', id);
                sym.setAttribute('viewBox', vb);
                [...svgEl.childNodes].forEach(n => sym.appendChild(document.importNode(n, true)));
                sprite.appendChild(sym);
            })
            .catch(e => console.warn(`[icons] load failed: ${src}`, e));
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _loadSVGSprite);
} else {
    _loadSVGSprite();
}
