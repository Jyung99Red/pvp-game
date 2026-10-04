// A PVP duel between two phones over one ordered, reliable message channel
// (design.md 8), carried over from the 2D version (tag v1-2d,
// pvp/pvp_logic.js) onto the new simulation. The host runs the fight and
// decides every hit; the guest sends its controls and draws the host's
// snapshots, predicting in between (both fighters move on, nothing is
// judged) and replaying its own unconfirmed controls on top of each
// snapshot. No DOM and no network here: `send` and `now` come from the
// caller, so Node tests can play both ends.
//
// Each side picks its weapon before connecting (one of pvp.weapons; the
// rest of the gear is the starter's) and names it in its hello.
//
// Messages: hello { protocol, rules, weapon } both ways on connect; host start
// { battle }; guest ready; host snap { serial, ack, countdown, state,
// events } every pvp.snapshotSeconds; guest input { seq, cmd }; either way
// beat (nothing else to say), surrender, rematch, abort (the match is off),
// leave (the room is closed). Everything after hello names its battle.
const duelKit = (() => {
    const PROTOCOL = 4;
    const P = () => gameConfig.pvp;
    const STEP = simLoop.STEP;
    // The guest's own events it already showed when it predicted them; the
    // host's copies of these are skipped.
    const PREDICTED = new Set(['attack', 'swing', 'charge', 'charge_dropped', 'guard_raise', 'guard_lower', 'guard_locked', 'pause_ready']);

    // Everything both phones must agree on, as one short fingerprint: the
    // rules, the arena, and the models (their poses decide hits). A
    // different version of the game gives a different fingerprint.
    function hash(text) {
        let a = 0x811c9dc5, b = 0x01000193;
        for (let i = 0; i < text.length; i++) {
            const c = text.charCodeAt(i);
            a = Math.imul(a ^ c, 0x01000193) >>> 0;
            b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
        }
        return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
    }
    let fingerprint = null;
    function rules() {
        if (!fingerprint) {
            const { input, controlsLayout, graphics, camera, ...shared } = gameConfig;
            fingerprint = hash(JSON.stringify([PROTOCOL, shared, playerModel, playerPoses, playerMoves, P().weapons.map(main => equipmentModels.forLoadout(loadoutFor(main)))]));
        }
        return fingerprint;
    }
    // The fair gear for a duel: the starter's, with the main hand picked.
    const weaponOk = main => typeof main === 'string' && P().weapons.includes(main);
    function loadoutFor(main) {
        if (!weaponOk(main)) throw new Error(`Not a duel weapon: ${main}`);
        return { ...inventoryKit.starter(), main };
    }
    const arena = mains => worldSim.create({ map: gameConfig.maps.arena, duel: true, loadouts: mains.map(loadoutFor) });
    const newBattle = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    // ---- a snapshot from the other phone is checked before it is used ----
    const num = v => typeof v === 'number' && Number.isFinite(v);
    const within = (v, lo, hi) => num(v) && v >= lo - 1e-6 && v <= hi + 1e-6;
    const bool = v => typeof v === 'boolean';
    const count = v => Number.isSafeInteger(v) && v >= 0;
    const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const moveId = v => typeof v === 'string' && Object.hasOwn(gameConfig.combo.moves, v);
    function validFighter(f, ref, t) {
        // Only moves of the fighter's own weapon type.
        const type = inventoryKit.weaponOf(ref.loadout), ownMove = v => moveId(v) && gameConfig.combo.moves[v].weapon === type;
        if (!obj(f) || f.id !== ref.id || f.side !== ref.side || f.kind !== 'fighter') return false;
        if (!within(f.x, 0, t.width * t.unit) || !within(f.y, 0, t.height * t.unit) || !num(f.h) || !num(f.facing)) return false;
        if (f.radius !== ref.radius || f.maxHp !== ref.maxHp || f.atk !== ref.atk || f.def !== ref.def || f.endless !== ref.endless) return false;
        if (!within(f.hp, 0, f.maxHp) || !bool(f.down) || !obj(f.loadout) || f.loadout.main !== ref.loadout.main || f.loadout.offhand !== ref.loadout.offhand) return false;
        if (!['speed', 'gait', 'moveBlend', 'runBlend', 'moveTime', 'downT', 'guardBlend'].every(k => num(f[k])) || !within(f.pace, 0, 1) || !within(f.stun, 0, 10) || !within(f.freeze, 0, 10)) return false;
        const i = f.input;
        if (!obj(i) || !obj(i.move) || !num(i.move.x) || !num(i.move.y) || Math.hypot(i.move.x, i.move.y) > 1 + 1e-6 || !obj(i.buttons)) return false;
        if (Object.keys(i.buttons).length !== worldSim.BUTTONS.length || !worldSim.BUTTONS.every(b => obj(i.buttons[b]) && bool(i.buttons[b].held) && count(i.buttons[b].presses))) return false;
        if (!obj(f.stats) || !Object.keys(ref.stats).every(k => count(f.stats[k]))) return false;
        const g = f.guard;
        if (!obj(g) || !['down', 'raising', 'up'].includes(g.state) || !num(g.t) || !num(g.readyAt) || !within(g.bar, 0, gameConfig.combat.guardBar.max) || !bool(g.locked) || !bool(g.queued)) return false;
        if (f.push !== null && !(obj(f.push) && num(f.push.x) && num(f.push.y) && num(f.push.t))) return false;
        const k = f.press;
        if (k !== null && !(obj(k) && num(k.at) && bool(k.held) && (k.upAt === null || num(k.upAt)) && [null, 'a', 'b'].includes(k.as) && bool(k.free))) return false;
        if (f.buffer !== null && !(obj(f.buffer) && ['a', 'b'].includes(f.buffer.input) && num(f.buffer.at) && num(f.buffer.age))) return false;
        if (!Array.isArray(f.combo) || f.combo.length > 32 || !f.combo.every(c => ['a', 'b', '-'].includes(c))) return false;
        // Nothing in the arena to interact with; a weapon and the shield only.
        if (f.focus !== null || f.using !== null || f.handOut !== 0 || f.handFor !== 0 || f.drink !== null || f.lit !== false) return false;
        if (f.chain !== null && !(obj(f.chain) && ownMove(f.chain.move) && num(f.chain.at) && bool(f.chain.cued))) return false;
        const a = f.act;
        if (a === null) return true;
        return obj(a) && ownMove(a.move) && ['windup', 'charge', 'swing', 'recover'].includes(a.phase) && within(a.t, 0, 60) && within(a.lead, 0, 1) && num(a.facing) &&
            num(a.pressAt) && within(a.share, 0, 1) && num(a.stepTotal) && Array.isArray(a.hit) && a.hit.length <= 8 && a.hit.every(h => typeof h === 'string') &&
            (a.from === null || (obj(a.from) && ownMove(a.from.move) && num(a.from.t)));
    }
    function validSnapshot(sim, s) {
        if (!obj(s) || !num(s.time) || s.time < 0 || !count(s.tick) || s.map !== sim.map || s.region !== sim.region || s.duel !== true || !count(s.seed) || !count(s.serial)) return false;
        if (!Array.isArray(s.entities) || s.entities.length || !Array.isArray(s.fighters) || s.fighters.length !== sim.fighters.length) return false;
        if (!s.fighters.every((f, i) => validFighter(f, sim.fighters[i], sim.terrain))) return false;
        const r = s.result;
        return r === null || (obj(r) && [...worldSim.DUEL_IDS, null].includes(r.winner) && num(r.at) && (r.conceded === undefined || worldSim.DUEL_IDS.includes(r.conceded)));
    }

    // One end of a duel. role: 'host' | 'guest'. send(message): to the other
    // phone. now(): seconds. weapon: this side's main hand (pvp.weapons).
    // `on` (all optional): start(sim) a new match;
    // result(outcome) 'win' | 'lose' | 'draw'; rematch() the other side asks
    // for another; end(reason) 'incompatible' | 'timeout' | 'lost' (the
    // channel closed) | 'aborted' | 'left' | 'closed' (this phone left): the
    // duel is over for good.
    // phase: hello -> starting -> countdown -> fight -> over (-> starting
    // again on a rematch) | ended.
    function create({ role, send, now, on = {}, weapon = P().weapons[0] }) {
        if (role !== 'host' && role !== 'guest') throw new Error(`Unknown duel role ${role}`);
        loadoutFor(weapon);
        const host = role === 'host', self = host ? 0 : 1, other = 1 - self;
        let phase = 'hello', battle = null, sim = null, countdown = 0, peerOk = false, endReason = null, peerWeapon = null;
        let lastHeard = now(), lastSent = -Infinity, wantRematch = false, peerRematch = false;
        // host
        let receivedSeq = 0, eventId = 0, history = [], lastSnap = -Infinity, serial = 0;
        // guest
        let inputSeq = 0, pending = [], applied = -1, seenEvent = 0, latency = 0.03, snapAt = 0, snapCountdown = 0;
        // drawing: positions before the last live step, and snapshot
        // corrections still being eased out (guest)
        let before = new Map(), offsets = new Map();
        const outbox = [];
        // Live steps. Once the fight is decided the world plays on a moment
        // for the falls to show, with nothing judged any more.
        const loop = simLoop.create(dt => {
            remember();
            worldSim.step(sim, dt, { judge: host && phase === 'fight' });
            take(worldSim.drain(sim));
        });
        const ids = () => sim.fighters.map(f => f.id);
        function remember() { before = new Map(sim.fighters.map(f => [f.id, { x: f.x, y: f.y, h: f.h, facing: f.facing, gait: f.gait, moveBlend: f.moveBlend, runBlend: f.runBlend }])); }

        function post(message) {
            lastSent = now();
            send(battle && !['hello'].includes(message.t) ? { battle, ...message } : message);
        }
        // Events as they happen: the host numbers them for the guest; the
        // guest keeps only its own predicted ones (the host sends the rest).
        function take(events) {
            for (const e of events) {
                if (host) {
                    const numbered = { ...e, id: ++eventId };
                    history.push(numbered);
                    outbox.push(numbered);
                } else if (e.side === ids()[self] && PREDICTED.has(e.type)) outbox.push(e);
            }
            if (history.length > P().historyEvents) history.splice(0, history.length - P().historyEvents);
        }
        function end(reason, tell = null) {
            if (phase === 'ended') return;
            if (tell) post({ t: tell });
            phase = 'ended'; endReason = reason;
            on.end?.(reason);
        }

        // ---- starting a match ----
        function begin(id) {
            const mains = [weapon, peerWeapon];
            battle = id; sim = arena(host ? mains : mains.reverse()); phase = 'starting';
            wantRematch = peerRematch = false; countdown = P().countdown;
            receivedSeq = eventId = serial = 0; history = []; lastSnap = -Infinity;
            inputSeq = 0; pending = []; applied = -1; seenEvent = 0; snapCountdown = countdown; snapAt = now();
            loop.reset(); outbox.length = 0; offsets = new Map(); remember();
            on.start?.(sim);
        }
        function hostStart() {
            begin(newBattle());
            post({ t: 'start' });
        }

        // ---- the guest takes a snapshot ----
        function applySnapshot(msg) {
            if (!Number.isSafeInteger(msg.serial) || msg.serial <= applied || !Number.isSafeInteger(msg.ack) || msg.ack < 0 || msg.ack > inputSeq ||
                !within(msg.countdown, 0, P().countdown) || !Array.isArray(msg.events) || !validSnapshot(sim, msg.state)) return;
            applied = msg.serial;
            const at = now();
            const acked = pending.filter(p => p.seq <= msg.ack);
            if (acked.length) {
                const sample = Math.min(P().latencySeconds, Math.max(0, (at - acked.at(-1).at) / 2));
                latency += (sample - latency) * 0.1;
            }
            pending = pending.filter(p => p.seq > msg.ack);
            const was = sim.fighters.map(f => ({ id: f.id, x: f.x, y: f.y, facing: f.facing }));
            worldSim.restore(sim, msg.state);
            snapCountdown = msg.countdown; snapAt = at;
            // The snapshot is about one way's latency old: predict on to now,
            // replaying this phone's own controls the host has not had yet.
            if (!sim.result && msg.countdown <= 0) {
                const from = at - Math.min(latency, P().replaySeconds), n = Math.max(0, Math.round((at - from) / STEP));
                let k = 0;
                for (let i = 0; i <= n; i++) {
                    while (k < pending.length && pending[k].at <= from + i * STEP + 1e-9) worldSim.command(sim, pending[k++].cmd, self);
                    if (i < n) worldSim.step(sim, STEP, { judge: false });
                }
                while (k < pending.length) worldSim.command(sim, pending[k++].cmd, self);
            }
            worldSim.drain(sim);
            loop.reset();
            // Draw from where things were, easing the jump out.
            remember();
            sim.fighters.forEach((f, i) => {
                const o = offsets.get(f.id) || { x: 0, y: 0, facing: 0 }, w = was[i];
                o.x += w.x - f.x; o.y += w.y - f.y; o.facing = space.wrapAngle(o.facing + w.facing - f.facing);
                offsets.set(f.id, Math.hypot(o.x, o.y) > 90 || sim.result ? { x: 0, y: 0, facing: 0 } : o);
            });
            for (const e of msg.events) {
                if (!obj(e) || !count(e.id) || e.id <= seenEvent) continue;
                seenEvent = e.id;
                if (!(e.side === ids()[self] && PREDICTED.has(e.type))) outbox.push(e);
            }
            settled();
        }
        // The fight is decided: once, on both ends.
        function settled() {
            if (sim?.result && phase !== 'over' && phase !== 'ended') {
                phase = 'over';
                on.result?.(worldSim.outcome(sim, ids()[self]));
            }
        }
        function snapshot() {
            lastSnap = now();
            post({ t: 'snap', serial: ++serial, ack: receivedSeq, countdown, state: worldSim.snapshot(sim), events: history });
        }

        // ---- messages from the other phone ----
        function receive(msg) {
            if (phase === 'ended' || !obj(msg) || typeof msg.t !== 'string') return;
            lastHeard = now();
            if (msg.t === 'hello') {
                if (msg.protocol !== PROTOCOL || msg.rules !== rules() || !weaponOk(msg.weapon)) { end('incompatible'); return; }
                peerOk = true; peerWeapon = msg.weapon;
                if (host && phase === 'hello') hostStart();
                return;
            }
            if (!peerOk) return;
            if (msg.t === 'leave') { end('left'); return; }
            if (msg.t === 'start') {
                if (host || typeof msg.battle !== 'string' || msg.battle === battle) return;
                if (phase !== 'hello' && !(phase === 'over' && wantRematch)) return;
                begin(msg.battle);
                post({ t: 'ready' });
                return;
            }
            if (msg.battle !== battle) return;
            if (msg.t === 'abort') { end('aborted'); return; }
            if (host) {
                if (msg.t === 'ready' && phase === 'starting') { phase = 'countdown'; snapshot(); }
                else if (msg.t === 'input' && msg.seq === receivedSeq + 1 && (phase === 'countdown' || phase === 'fight')) {
                    receivedSeq = msg.seq;
                    worldSim.command(sim, msg.cmd, other);
                    take(worldSim.drain(sim));
                } else if (msg.t === 'surrender' && phase === 'fight') { worldSim.concede(sim, ids()[other]); take(worldSim.drain(sim)); }
                if (count(msg.ack) && msg.ack <= eventId) history = history.filter(e => e.id > msg.ack);
            } else if (msg.t === 'snap' && sim) applySnapshot(msg);
            if (msg.t === 'rematch' && phase === 'over') {
                peerRematch = true; on.rematch?.();
                if (host && wantRematch) hostStart();
            }
        }

        // ---- this phone's own controls ----
        // Presses wait for the fight; the stick is always taken, so a stick
        // already held at the start walks at once.
        function command(cmd) {
            if (!sim || phase === 'ended' || phase === 'over' || phase === 'hello' || phase === 'starting') return false;
            if (cmd?.type !== 'move' && phase !== 'fight') return false;
            if (!worldSim.command(sim, cmd, self)) return false;
            take(worldSim.drain(sim));
            if (!host) {
                if (pending.length >= 256) { end('aborted', 'abort'); return false; }
                pending.push({ seq: ++inputSeq, cmd, at: now() });
                post({ t: 'input', seq: inputSeq, cmd, ack: seenEvent });
            }
            return true;
        }

        // ---- the frame: time passes ----
        function frame(seconds) {
            if (phase === 'ended') return outbox.splice(0);
            const t = now();
            if (t - lastHeard > P().timeoutSeconds) { end('timeout'); return outbox.splice(0); }
            if (host) {
                if (phase === 'countdown') {
                    countdown = Math.max(0, countdown - seconds);
                    if (countdown === 0) { phase = 'fight'; loop.reset(); remember(); }
                } else if (phase === 'fight' || phase === 'over') loop.advance(seconds);
                settled();
                if (phase === 'over' && serial && lastSnap !== Infinity) { snapshot(); lastSnap = Infinity; }
                else if ((phase === 'countdown' || phase === 'fight') && t - lastSnap >= P().snapshotSeconds - 1e-9) snapshot();
            } else if (sim && (phase === 'starting' || phase === 'countdown' || phase === 'fight')) {
                countdown = Math.max(0, snapCountdown - (t - snapAt));
                if (applied >= 0) phase = snapCountdown > 0 && countdown > 0 ? 'countdown' : 'fight';
                if (phase === 'fight' && snapCountdown <= 0) loop.advance(seconds);
            } else if (sim && phase === 'over') loop.advance(seconds);
            const ease = Math.exp(-seconds * 18);
            for (const o of offsets.values()) { o.x *= ease; o.y *= ease; o.facing *= ease; }
            if (t - lastSent >= P().heartbeatSeconds) post({ t: 'beat', ack: seenEvent });
            return outbox.splice(0);
        }

        return {
            role, self, weapon,
            get peerWeapon() { return peerWeapon; },
            get phase() { return phase; }, get sim() { return sim; }, get battle() { return battle; },
            get countdown() { return countdown; }, get endReason() { return endReason; },
            get selfId() { return sim ? sim.fighters[self].id : worldSim.DUEL_IDS[self]; },
            get rematchAsked() { return peerRematch; }, get rematchSent() { return wantRematch; },
            // The channel is open: introduce this phone.
            open() { lastHeard = now(); post({ t: 'hello', protocol: PROTOCOL, rules: rules(), weapon }); },
            receive, command, frame,
            // Drawing helpers: interpolation between the last two live steps
            // and the guest's eased snapshot corrections.
            alpha: () => loop.alpha(),
            before: id => before.get(id) || null,
            offset: id => offsets.get(id) || { x: 0, y: 0, facing: 0 },
            surrender() {
                if (phase !== 'fight') return false;
                if (host) { worldSim.concede(sim, ids()[self]); take(worldSim.drain(sim)); }
                else post({ t: 'surrender' });
                return true;
            },
            rematch() {
                if (phase !== 'over' || wantRematch) return false;
                wantRematch = true;
                post({ t: 'rematch' });
                if (host && peerRematch) hostStart();
                return true;
            },
            // The match is off (this page went to the background, say).
            abort() { if (battle) end('aborted', 'abort'); else end('closed', 'leave'); },
            // Leaving the room for good.
            leave() { end('closed', 'leave'); },
            // The channel itself is gone.
            lost() { end('lost'); }
        };
    }
    return { PROTOCOL, PREDICTED, rules, loadoutFor, validSnapshot, create };
})();
