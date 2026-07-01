// icons.js - SVG icon lookup table and render helpers
// symbol id mirrors the icons/ folder structure:
//   icons/weapons/weapon-atk.svg → id = "weapons/weapon-atk"
//   icons/fx/slash.svg           → id = "fx/slash"

// -- Icon lookup table --
// key = the name used in code, value = the SVG symbol id
const ICONS = {
    // [ Data - entities & gear ]
    'weapon-atk': 'data/weapon-atk',      // Offensive weapon
    'shield-def': 'data/shield-def',      // Defensive shield
    'goblin': 'data/goblin',              // Goblin sprite

    // [ UI - interface & interaction ]
    'escape': 'ui/escape',                // Retreat/flee button
    'monster-atk': 'ui/monster-atk',      // Enemy attack-warning node icon

    // [ FX - battle effects ]
    'fx-slash': 'fx/slash',               // Slash effect
};


// -- Render helpers --

/**
 * Build an inline SVG <use> tag (for embedding in HTML)
 * @param {string} key     - a key from ICONS
 * @param {string} cls     - extra CSS class (optional)
 * @returns {string}       - HTML string
 */
function renderIcon(key, cls = '') {
    const id = ICONS[key];
    if (!id) return '';
    const clsAttr = cls ? ` class="game-icon ${cls}"` : ' class="game-icon"';
    return `<svg${clsAttr} aria-hidden="true"><use href="#${id}"/></svg>`;
}

/**
 * Mount an icon onto an existing DOM element
 * @param {HTMLElement} el  - target element
 * @param {string} key      - a key from ICONS
 * @param {string} cls      - extra CSS class (optional)
 */
function setIcon(el, key, cls = '') {
    if (!el) return;
    el.innerHTML = renderIcon(key, cls);
}

// -- Dev-mode SVG sprite loader --
// In a bundled build (game_build.html), symbols are already inlined -> skip.
// In dev mode (index.html + local server), fetch each SVG file and inject it automatically.
function _loadSVGSprite() {
    // Take the first id from ICONS and check whether its symbol already exists (bundled mode)
    const firstId = Object.values(ICONS)[0];
    if (!firstId || document.querySelector(`symbol[id="${firstId}"]`)) return;

    // Collect all the SVGs that need fetching from ICONS (deduped)
    const seen = new Set();
    const sources = [];
    for (const id of Object.values(ICONS)) {
        if (!seen.has(id)) {
            seen.add(id);
            sources.push({ id, src: `icons/${id}.svg` });
        }
    }

    // Create a hidden sprite container and insert it at the very start of body
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
