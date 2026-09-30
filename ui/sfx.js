// Procedural combat sounds (Web Audio, no asset files). Presentation only:
// the simulation never waits on or reads anything here. Mobile browsers keep
// audio locked until the first touch, so the context is created and resumed
// on the first pointer press anywhere on the page.
const sfx = (() => {
    const key = 'pvp-game-sfx-v1';
    let ctx = null, master = null, noise = null, enabled = true;
    try { enabled = localStorage.getItem(key) !== 'off'; } catch (_) { /* Storage may be unavailable. */ }
    function unlock() {
        if (!enabled) return;
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        if (!ctx) {
            ctx = new Audio();
            master = ctx.createGain(); master.gain.value = .55; master.connect(ctx.destination);
            // One shared second of white noise feeds every noisy sound.
            noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = noise.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
    }
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    function envelope(gain, at, peak, length) {
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(peak, at + .006);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    }
    function tone(type, from, to, length, peak, delay = 0) {
        const at = ctx.currentTime + delay, osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(from, at);
        osc.frequency.exponentialRampToValueAtTime(to, at + length);
        envelope(gain, at, peak, length);
        osc.connect(gain).connect(master); osc.start(at); osc.stop(at + length + .02);
    }
    function hiss(from, to, length, peak, q = 1.2) {
        const at = ctx.currentTime, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        source.buffer = noise; filter.type = 'bandpass'; filter.Q.value = q;
        filter.frequency.setValueAtTime(from, at); filter.frequency.exponentialRampToValueAtTime(to, at + length);
        envelope(gain, at, peak, length);
        source.connect(filter).connect(gain).connect(master); source.start(at); source.stop(at + length + .02);
    }
    const sounds = {
        swing: heavy => heavy ? hiss(900, 260, .16, .09, .9) : hiss(1800, 650, .09, .06),
        hit: () => { tone('sine', 150, 55, .1, .22); hiss(2600, 1200, .04, .07, .7); },
        hurt: () => { tone('triangle', 120, 45, .14, .2); hiss(900, 400, .06, .06, .8); },
        block: () => { tone('triangle', 520, 470, .12, .07); tone('square', 1040, 900, .06, .025); },
        parry: () => { tone('sine', 1320, 1300, .26, .08); tone('sine', 1980, 1960, .18, .035, .01); },
        guardBroken: () => tone('sawtooth', 320, 110, .26, .05),
        cue: () => tone('sine', 880, 900, .08, .04)
    };
    // Engine events already carry who they belong to (`side`).
    function play(e) {
        if (!enabled || !ctx || ctx.state !== 'running') return;
        const own = e.side !== 'enemy';
        if (e.type === 'swing_started') sounds.swing(e.heavy);
        else if (e.type === 'hit') (own ? sounds.hit : sounds.hurt)();
        else if (e.type === 'block') sounds.block();
        else if (e.type === 'parry') sounds.parry();
        else if (e.type === 'guard_broken' && own) sounds.guardBroken();
        else if (e.type === 'pause_ready' && own) sounds.cue();
    }
    // Safe to call once per view: a toggle is only ever bound once.
    function attach(root) {
        for (const node of root.querySelectorAll?.('[data-sfx-toggle]') || []) {
            node.checked = enabled;
            if (node.dataset.sfxBound) continue;
            node.dataset.sfxBound = '1';
            node.addEventListener('change', () => {
                enabled = node.checked;
                try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch (_) { /* Session value still applies. */ }
                if (enabled) unlock();
            });
        }
    }
    return { play, attach, isEnabled: () => enabled };
})();
