// Pure gesture recognition. No combat state, DOM or wall clock.
const combatGestures = (() => {
    const config = Object.freeze({ deadZone: 12, holdSeconds: .24, releaseDistance: 32 });
    function begin(time) { return { mode: 'pending', start: time, dx: 0, dy: 0 }; }
    function hold(g, time) {
        if (g && g.mode === 'pending' && time - g.start >= config.holdSeconds) {
            g.mode = 'charge';
            return { type: 'charge', start: g.start };
        }
        return null;
    }
    function drag(g, dx, dy) {
        g.dx = dx; g.dy = dy;
        if (['pending', 'move_pending'].includes(g.mode) && Math.hypot(dx, dy) > config.deadZone) g.mode = 'move';
    }
    function armed(g) {
        return !!g && g.mode === 'charge' && g.dy <= -config.releaseDistance && Math.abs(g.dx) <= -g.dy;
    }
    function release(g, cancelled) {
        if (cancelled) return { type: 'cancel_charge' };
        if (g.mode === 'pending') return { type: 'light' };
        if (g.mode === 'charge') return { type: armed(g) ? 'heavy' : 'cancel_charge' };
        return null;
    }
    return { config, begin, hold, drag, armed, release };
})();
