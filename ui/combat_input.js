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
            if (e.button !== 0 || pointers.size >= 2 || [...pointers.values()].some(g => g.channel === channel)) return;
            const rect = pad.getBoundingClientRect();
            if (!commands.press(channel, e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2)) return;
            pointers.set(e.pointerId, { channel, pad, x: e.clientX, y: e.clientY });
            pad.setPointerCapture(e.pointerId);
        });
        listen(pad, 'pointermove', e => {
            const g = pointers.get(e.pointerId);
            if (!g) return;
            const rect = pad.getBoundingClientRect();
            commands.drag(channel, e.clientX - g.x, e.clientY - g.y, e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2);
        });
        function end(e, cancelled) {
            const g = pointers.get(e.pointerId);
            if (!g) return;
            if (!cancelled) {
                const rect = pad.getBoundingClientRect();
                commands.drag(channel, e.clientX - g.x, e.clientY - g.y, e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2);
            }
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
