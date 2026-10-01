// Pure maths of the touch layer, kept out of the DOM so Node can test it:
// where each button sits for a screen size, and what a stick offset means.
const controlsKit = (() => {
    // Stick offset in CSS px (screen axes) to a move vector of length 0..1:
    // nothing inside the dead zone, then full speed `ramp` px further out.
    function stickVector(dx, dy, input = gameConfig.input) {
        const len = Math.hypot(dx, dy);
        if (len <= input.deadZone) return { x: 0, y: 0, mag: 0 };
        const mag = Math.min(1, (len - input.deadZone) / input.ramp);
        return { x: dx / len * mag, y: dy / len * mag, mag };
    }
    // Held movement keys to a move vector (screen axes), unit length.
    function keyVector(held, keys = gameConfig.input.keys) {
        const on = name => keys[name].some(code => held.has(code));
        const x = (on('right') ? 1 : 0) - (on('left') ? 1 : 0), y = (on('down') ? 1 : 0) - (on('up') ? 1 : 0);
        const len = Math.hypot(x, y);
        return len ? { x: x / len, y: y / len, mag: 1 } : { x: 0, y: 0, mag: 0 };
    }
    // Button centres and sizes in viewport px for a screen of `width` x
    // `height` with safe-area `insets` { top, right, bottom, left }.
    function layout(width, height, insets = {}, L = gameConfig.controlsLayout) {
        const inset = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
        const buttons = {};
        for (const [id, b] of Object.entries(L.buttons)) {
            const x = b.side === 'right' ? width - inset.right - b.x : inset.left + b.x;
            buttons[id] = { x, y: height - inset.bottom - b.y, size: b.size, r: b.size / 2 };
        }
        return {
            buttons,
            stickRest: { x: inset.left + L.stick.restX, y: height - inset.bottom - L.stick.restY },
            stickZone: { x0: 0, x1: width * L.stick.zone }
        };
    }
    // Problems with a layout: overlaps closer than minGap, buttons off the
    // safe screen. Empty when fine; tests run it over common phones.
    function check(width, height, insets = {}, L = gameConfig.controlsLayout) {
        const inset = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
        const { buttons } = layout(width, height, inset, L), list = Object.entries(buttons), problems = [];
        for (const [id, b] of list) {
            if (b.x - b.r < inset.left || b.x + b.r > width - inset.right || b.y - b.r < inset.top || b.y + b.r > height - inset.bottom) problems.push(`${id} leaves the safe area`);
        }
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const [ia, a] = list[i], [ib, b] = list[j];
            if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + L.minGap - 1e-9) problems.push(`${ia} and ${ib} closer than ${L.minGap}px`);
        }
        return problems;
    }
    return { stickVector, keyVector, layout, check };
})();
