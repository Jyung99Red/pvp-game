// This phone's settings, picked on the menu's side (design.md 3.6): sound,
// the frame-rate line, picture quality and how far the camera stands. Kept
// in localStorage apart from the save (the sound in ui/sfx.js's own key);
// none of it touches the rules. `apply` hands every value to whoever draws
// it, now and on each change.
const gameSettings = (() => {
    const KEY = 'blocky-rpg-settings';
    // Each setting: its label and its choices ([value, label]), the first the default.
    const CHOICES = Object.freeze({
        sound: { label: '音效', options: [[true, '开'], [false, '关']] },
        perf: { label: '帧率', options: [[true, '显示'], [false, '隐藏']] },
        quality: { label: '画质', options: [['high', '清晰'], ['ultra', '极高'], ['saver', '省电']] },
        camera: { label: '镜头', options: [['near', '近'], ['mid', '中'], ['far', '远']] }
    });
    const DEFAULTS = Object.freeze({ sound: true, perf: true, quality: 'high', camera: 'mid' });
    const allowed = (key, value) => CHOICES[key]?.options.some(([v]) => v === value);
    let values = { ...DEFAULTS }, listener = null;
    try {
        const kept = JSON.parse(localStorage.getItem(KEY) || '{}');
        for (const key of Object.keys(DEFAULTS)) if (allowed(key, kept?.[key])) values[key] = kept[key];
    } catch (_) { /* Storage unavailable or unreadable: the defaults. */ }
    values.sound = sfx.isEnabled();
    function set(key, value) {
        if (!allowed(key, value)) return;
        values[key] = value;
        if (key === 'sound') sfx.setEnabled(value);
        try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (_) { /* Not kept. */ }
        listener?.({ ...values });
    }
    // `fn(values)` now and after every change.
    function apply(fn) { listener = fn; fn({ ...values }); }
    return { CHOICES, get: key => values[key], set, apply };
})();
