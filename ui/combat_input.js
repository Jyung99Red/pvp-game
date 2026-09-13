// Own pointer capture, per-press movement origin and cleanup; combat stays in the engine.
const combatInput = { attach(pads, commands) {
    const pointers = new Map(), removers = [];
    function listen(node, type, fn) { node.addEventListener(type, fn); removers.push(() => node.removeEventListener(type, fn)); }
    function resetVisual(pad) {
        pad.classList.remove('active', 'armed', 'cancel-ready');
        pad.querySelectorAll('[data-skill]').forEach(node => node.classList.remove('selected'));
        pad.querySelector('.pad-knob').style.transform = 'translate(0px, 0px)';
        if (pad.dataset.originAtPress !== undefined) {
            pad.style.removeProperty('--gesture-x'); pad.style.removeProperty('--gesture-y');
        }
    }
    function clear(preserveMove = false) {
        const held = [...pointers.entries()].filter(([, data]) => !preserveMove || data.channel !== 'move');
        for (const [id] of held) pointers.delete(id);
        for (const [id, data] of held) {
            commands.release(data.channel, true);
            if (data.surface.hasPointerCapture(id)) data.surface.releasePointerCapture(id);
        }
        for (const [channel, pad] of Object.entries(pads)) if (!preserveMove || channel !== 'move') resetVisual(pad);
    }
    for (const [channel, pad] of Object.entries(pads)) {
        const originAtPress = pad.dataset.originAtPress !== undefined;
        const surface = pad;
        listen(surface, 'contextmenu', e => e.preventDefault());
        listen(surface, 'pointerdown', e => {
            e.preventDefault();
            if (e.button !== 0 || pointers.size >= 2 || [...pointers.values()].some(g => g.channel === channel)) return;
            const rect = pad.getBoundingClientRect();
            if (!commands.press(channel, originAtPress ? 0 : e.clientX - rect.left - rect.width / 2, originAtPress ? 0 : e.clientY - rect.top - rect.height / 2)) return;
            if (originAtPress) {
                pad.style.setProperty('--gesture-x', `${e.clientX - rect.left}px`);
                pad.style.setProperty('--gesture-y', `${e.clientY - rect.top}px`);
            }
            pointers.set(e.pointerId, { channel, pad, surface, x: e.clientX, y: e.clientY });
            surface.setPointerCapture(e.pointerId);
        });
        function drag(e, g) {
            const rect = pad.getBoundingClientRect();
            commands.drag(channel, e.clientX - g.x, e.clientY - g.y,
                originAtPress ? e.clientX - g.x : e.clientX - rect.left - rect.width / 2,
                originAtPress ? e.clientY - g.y : e.clientY - rect.top - rect.height / 2);
        }
        listen(surface, 'pointermove', e => {
            const g = pointers.get(e.pointerId);
            if (!g || g.channel !== channel) return;
            // Recover if a mouse-up happened outside the window without pointerup.
            if (e.pointerType === 'mouse' && e.buttons === 0) { end(e, true); return; }
            drag(e, g);
        });
        function end(e, cancelled) {
            const g = pointers.get(e.pointerId);
            if (!g || g.channel !== channel) return;
            if (!cancelled) drag(e, g);
            pointers.delete(e.pointerId);
            commands.release(channel, cancelled);
            resetVisual(pad);
            if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
        }
        listen(surface, 'pointerup', e => end(e, false));
        listen(surface, 'pointercancel', e => end(e, true));
        listen(surface, 'lostpointercapture', e => end(e, true));
    }
    listen(window, 'resize', () => { commands.cancel?.(); clear(); });
    return { clear, destroy() { clear(); removers.forEach(remove => remove()); } };
} };
