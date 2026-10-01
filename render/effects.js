// Drawn-only feedback (combat-combo-concept.md, 打击感 step 1): blade
// trail, block debris, hit flash, a small camera shake, stagger stars, the
// charge glow and the pause-line cue. Reads simulation events and solved
// rigs; never writes the simulation. Kept low-key on purpose.
const renderEffects = (() => {
    const TRAIL_N = 40, TRAIL_AGE = 0.11, MAXP = 120;

    function create(T, scene, rnd) {
        const unit = new T.BoxGeometry(1, 1, 1), dummy = new T.Object3D(), col = new T.Color();
        // ---- debris: small cubes that pop, fall and bounce ----
        const parts = new T.InstancedMesh(unit, new T.MeshBasicMaterial(), MAXP);
        parts.frustumCulled = false; scene.add(parts);
        const pool = Array.from({ length: MAXP }, () => ({ life: 0 }));
        dummy.scale.setScalar(0); dummy.updateMatrix();
        for (let i = 0; i < MAXP; i++) { parts.setMatrixAt(i, dummy.matrix); parts.setColorAt(i, col.set('#ffffff')); }
        dummy.scale.setScalar(1);
        function burst(at, n, colors, lo, hi, size) {
            for (let k = 0; k < n; k++) {
                const i = pool.findIndex(q => q.life <= 0);
                if (i < 0) break;
                const th = rnd() * Math.PI * 2, up = 0.3 + rnd() * 0.9, v = lo + rnd() * (hi - lo);
                Object.assign(pool[i], { life: 0.45 + rnd() * 0.3, x: at[0], y: at[1], z: at[2], vx: Math.cos(th) * v, vy: up * v, vz: Math.sin(th) * v, s: size * (0.7 + rnd() * 0.6), spin: rnd() * 6 });
                parts.setColorAt(i, col.set(colors[rnd() * colors.length | 0]));
            }
            parts.instanceColor.needsUpdate = true;
        }
        function tickParts(dt) {
            pool.forEach((p, i) => {
                if (p.life <= 0) return;
                p.life -= dt; p.vy -= 9.8 * dt;
                p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
                if (p.y < p.s / 2) { p.y = p.s / 2; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
                p.spin += dt * 8;
                dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.spin, p.spin * 0.7, 0);
                dummy.scale.setScalar(p.life > 0 ? p.s * Math.min(1, p.life / 0.3) : 0); dummy.updateMatrix();
                parts.setMatrixAt(i, dummy.matrix);
            });
            dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
            parts.instanceMatrix.needsUpdate = true;
        }

        // ---- blade trail: a ribbon through recent blade positions ----
        const trailGeo = new T.BufferGeometry();
        trailGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(TRAIL_N * 6), 3));
        trailGeo.setAttribute('color', new T.BufferAttribute(new Float32Array(TRAIL_N * 8), 4));
        const index = [];
        for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        trailGeo.setIndex(index);
        const trail = new T.Mesh(trailGeo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, side: T.DoubleSide, depthWrite: false }));
        trail.frustumCulled = false; scene.add(trail);
        const samples = [];
        let clock = 0;
        function sampleBlade(rig, solved, heavy) {
            const i = rig.parts.findIndex(p => p.kind === 'weapon'), half = rig.parts[i].size[2] / 2, m = solved.parts[i];
            samples.push({ b: math3d.transformPoint(m, [0, 0, -half]), t: math3d.transformPoint(m, [0, 0, half]), at: clock, heavy });
            if (samples.length > TRAIL_N) samples.shift();
        }
        function drawTrail() {
            while (samples.length && clock - samples[0].at > TRAIL_AGE) samples.shift();
            const pos = trailGeo.attributes.position.array, c = trailGeo.attributes.color.array;
            samples.forEach((s, i) => {
                pos.set([...s.b, ...s.t], i * 6);
                const a = 0.6 * (1 - (clock - s.at) / TRAIL_AGE), rgb = s.heavy ? [1, 0.82, 0.45] : [1, 1, 1];
                c.set([...rgb, a * 0.1, ...rgb, a], i * 8);
            });
            trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
            trailGeo.setDrawRange(0, Math.max(0, samples.length - 1) * 6);
        }

        // ---- stagger stars ----
        const stars = new T.Group();
        for (let i = 0; i < 4; i++) {
            const s = new T.Mesh(new T.BoxGeometry(0.09, 0.09, 0.09), new T.MeshBasicMaterial({ color: '#ffd84a' }));
            s.position.set(Math.cos(i / 4 * Math.PI * 2) * 0.32, 0, Math.sin(i / 4 * Math.PI * 2) * 0.32);
            stars.add(s);
        }
        stars.visible = false; scene.add(stars);

        // ---- flashes, shake and glow, driven by events ----
        const flash = { player: 0, dummy: 0 };
        let shake = 0, cue = 0;
        function onEvents(events) {
            for (const e of events) {
                if (e.type === 'hit' && e.side === 'player') {
                    flash.dummy = 0.12;
                    if (e.heavy) { burst(e.at, 12, ['#ffffff', '#ffd27a', '#f2b544'], 2, 3.8, 0.08); shake = Math.max(shake, 0.12); }
                    else burst(e.at, 7, ['#ffffff', '#f4f1e6', '#d9dee3'], 1.5, 2.8, 0.06);
                } else if (e.type === 'hit' && e.side === 'dummy') {
                    flash.player = 0.12; burst(e.at, 6, ['#ffffff', '#e8b4a0'], 1.4, 2.4, 0.06);
                } else if (e.type === 'block') burst(e.at, 5, ['#d9dee3', '#9aa2aa'], 1.2, 2.2, 0.05);
                else if (e.type === 'parry') { burst(e.at, 12, ['#fff3b0', '#ffd84a', '#ffffff'], 2, 3.6, 0.07); flash.dummy = 0.12; shake = Math.max(shake, 0.1); }
                else if (e.type === 'pause_ready') cue = 0.14;
            }
        }
        const white = new T.Color('#ffffff'), red = new T.Color('#ff8a7a'), gold = new T.Color('#f2b544');
        // Per frame. `view` gives the materials of each rig and the solved rigs.
        function update(dt, sim, view) {
            clock += dt;
            tickParts(dt);
            const p = sim.player, a = p.act;
            if (a?.phase === 'swing') sampleBlade(view.playerRig, view.playerSolved, gameConfig.combo.moves[a.move].knockback > 0);
            drawTrail();
            for (const side of ['player', 'dummy']) flash[side] = Math.max(0, flash[side] - dt);
            const kP = flash.player / 0.12, kD = flash.dummy / 0.12;
            for (const m of view.materials.player) m.emissive.copy(red).multiplyScalar(0.7 * kP);
            for (const m of view.materials.dummy) m.emissive.copy(white).multiplyScalar(0.8 * kD);
            // The blade glows gold while charging, flashes white on the pause line.
            cue = Math.max(0, cue - dt);
            const charge = a?.phase === 'charge' ? Math.min(1, fighterKit.chargeOf(sim, a) / gameConfig.combat.charge.full) : 0;
            if (view.blade) {
                if (cue > 0) view.blade.emissive.copy(white).multiplyScalar(0.9);
                else view.blade.emissive.copy(gold).multiplyScalar(0.9 * charge);
            }
            const d = sim.dummy;
            stars.visible = !!d && d.phase === 'reel';
            if (stars.visible) {
                const [x, , z] = space.toBlocks(d.x, d.y, d.h);
                stars.position.set(x, 1.95, z); stars.rotation.y = clock * 5;
            }
            shake = Math.max(0, shake - dt);
        }
        // Camera jitter for this frame, in blocks.
        const jitter = () => shake > 0 ? [(rnd() - 0.5) * shake * 0.4, (rnd() - 0.5) * shake * 0.4] : [0, 0];
        return { onEvents, update, jitter };
    }
    return { create };
})();
