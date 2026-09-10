// Pointer capture and listener lifecycle only; commands are validated by the engine.
const combatInput = { attach(pads, commands) {
    const pointers = new Map(), removers = [];
    function listen(node, type, fn) { node.addEventListener(type, fn); removers.push(() => node.removeEventListener(type, fn)); }
    function clear() {
        const held = [...pointers.entries()]; pointers.clear();
        for (const [id, data] of held) {
            if (data.pad.hasPointerCapture(id)) data.pad.releasePointerCapture(id);
        }
    }
    for (const [channel, pad] of Object.entries(pads)) {
        listen(pad, 'contextmenu', e => e.preventDefault());
        listen(pad, 'pointerdown', e => {
            e.preventDefault();
            if (e.button !== 0 || [...pointers.values()].some(g => g.channel === channel)) return;
            if (!commands.press(channel)) return;
            pointers.set(e.pointerId, { channel, pad, x: e.clientX, y: e.clientY });
            pad.setPointerCapture(e.pointerId);
        });
        listen(pad, 'pointermove', e => {
            const g = pointers.get(e.pointerId);
            if (!g) return;
            commands.drag(channel, e.clientX - g.x, e.clientY - g.y);
        });
        function end(e, cancelled) {
            const g = pointers.get(e.pointerId);
            if (!g) return;
            if (!cancelled) commands.drag(channel, e.clientX - g.x, e.clientY - g.y);
            pointers.delete(e.pointerId);
            commands.release(channel, cancelled);
            if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId);
        }
        listen(pad, 'pointerup', e => end(e, false));
        listen(pad, 'pointercancel', e => end(e, true));
        listen(pad, 'lostpointercapture', e => end(e, true));
    }
    return { clear, destroy() { clear(); removers.forEach(remove => remove()); } };
} };
