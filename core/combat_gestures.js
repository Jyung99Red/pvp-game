// Pure gesture recognition. No combat state, DOM or wall clock.
const combatGestures = (() => {
    const config = Object.freeze({ deadZone: 12, holdSeconds: .24, cancelRadius: 18 });
    function begin(time, cx = 0, cy = 0) { return { mode: 'pending', start: time, dx: 0, dy: 0, cx, cy }; }
    function hold(g, time) {
        if (g && g.mode === 'pending' && time - g.start >= config.holdSeconds) {
            g.mode = 'charge';
            return { type: 'charge', start: g.start };
        }
        return null;
    }
    function drag(g, dx, dy, cx = dx, cy = dy) {
        g.dx = dx; g.dy = dy; g.cx = cx; g.cy = cy;
        if (g.mode === 'pending' && Math.hypot(dx, dy) > config.deadZone) g.mode = 'move';
    }
    function armed(g) {
        return !!g && g.mode === 'charge' && Math.hypot(g.cx ?? g.dx, g.cy ?? g.dy) > config.cancelRadius;
    }
    function release(g, cancelled) {
        if (cancelled) return { type: 'cancel_charge' };
        if (g.mode === 'pending') return { type: 'light' };
        if (g.mode === 'charge') return { type: armed(g) ? 'heavy' : 'cancel_charge' };
        return null;
    }
    return { config, begin, hold, drag, armed, release };
})();
