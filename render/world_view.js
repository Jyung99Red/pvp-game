// three.js view of the simulation. It only draws: positions come from the
// sim and every character box's matrix comes from core/rig.js, so what is
// drawn is exactly what hit tests use (design.md 2.5). The
// renderer and camera live as long as the page; the scene is built per
// world (`load`), so switching maps or restarting needs no reload.
// A world is put together from parts of its own: the shaders
// (render/view_shaders.js), the light (render/view_light.js), the
// characters (render/view_bodies.js), the props (render/view_props.js),
// the shade of sight (render/view_sight.js); the terrain is
// render/terrain_mesh.js and the drawn-only effects render/effects.js.
const worldView = (() => {
    // The picture's tunable numbers are game_config.js `graphics` (what
    // each is for is written there); here, the ghost and the mist.
    const { ghost: GHOST, mist: MIST } = gameConfig.graphics;
    // The largest sun shadow map, texels a side.
    const SUN_LARGEST = 4096;

    // opts.selfId: the fighter this phone plays (the camera follows it; in a
    // duel the other one is drawn as the rival).
    function create(canvas, sim, opts = {}) {
        const T = THREE, C = gameConfig;
        const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        const small = Math.min(window.innerWidth, window.innerHeight) < 700;
        // Bright ground eases towards white instead of being cut off at
        // it; colours below that are left as they are.
        renderer.toneMapping = T.NeutralToneMapping;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = T.PCFShadowMap;
        const camera = new T.PerspectiveCamera(C.camera.fov, 1, 0.1, 120);
        let world = null;
        // The menu's settings (ui/settings.js): the camera's distance
        // multiplier, and the picture quality's (graphics.quality): sun
        // shadows and the size of the sun's and the torch's shadow maps
        // (texels a side; a large screen's sun map twice a phone's, at most
        // SUN_LARGEST), how many moving lights, and what the shaders are
        // built with (`built`: torch shadow samples, the probes' light
        // and block light, which need a new world when they change).
        // hourShift: hours the time of day is drawn ahead, from ?hour=21
        // in the address (it starts at that hour and goes on; for testing,
        // never saved).
        const tune = { zoom: 1, sunMap: 0, torchMap: 0, built: null, hourShift: 0 };
        // `level`: a quality's name (graphics.quality) or its values.
        // Returns whether the shaders must be built anew.
        function quality(level) {
            const q = typeof level === 'string' ? C.graphics.quality[level] : level;
            tune.sunMap = small ? q.sunShadow : Math.min(SUN_LARGEST, 2 * q.sunShadow);
            tune.torchMap = q.torchShadow;
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
            const built = { torchTaps: q.torchTaps, bounce: q.bounce };
            if (tune.built && Object.keys(built).every(k => built[k] === tune.built[k])) return false;
            tune.built = built;
            viewShaders.patchShaders(T, built);
            return true;
        }
        quality('high');
        const asked = new URLSearchParams(window.location.search).get('hour');
        if (asked !== null && Number.isFinite(Number(asked))) tune.hourShift = Number(asked) - dayKit.hourOf(sim);

        // The world now and whose it is, to build again when the shaders change.
        let shown = null;
        function load(next, { selfId = 'player' } = {}) {
            if (world) world.dispose();
            shown = { sim: next, selfId };
            world = build(T, renderer, next, camera, selfId, tune);
        }
        load(sim, opts);
        // `bodies`: fighters and monsters as shown, by id -- a blend between
        // two steps (ui/app.js); anyone missing is drawn as simulated.
        // `events` are the simulation events since the last frame.
        function render(current, frameSeconds, { bodies = null, events = [] } = {}) {
            world.render(current, frameSeconds, bodies, events);
            renderer.render(world.scene, camera);
        }
        function resize(width, height) {
            if (!width || !height) return;
            renderer.setSize(width, height, false);
            camera.aspect = width / height; camera.updateProjectionMatrix();
        }
        // zoom: camera distance multiplier; quality: a quality's name
        // ('saver', 'high', 'ultra') or its values (the menu's own). A
        // change the shaders are built with builds the world again (its
        // materials go, and their programs with them).
        function settings({ zoom, quality: level }) {
            tune.zoom = zoom;
            if (quality(level)) load(shown.sim, { selfId: shown.selfId });
            else world.retune();
        }
        // A point in blocks to CSS pixels on the canvas, or null behind the camera.
        const projected = new T.Vector3();
        function project(point) {
            projected.set(point[0], point[1], point[2]).project(camera);
            if (projected.z > 1) return null;
            const r = renderer.domElement.getBoundingClientRect();
            return { x: (projected.x + 1) / 2 * r.width, y: (1 - projected.y) / 2 * r.height };
        }
        return {
            load, render, resize, project, settings, renderer, camera,
            info: () => renderer.info.render,
            // The hour a world is drawn at (the HUD's clock shows the same).
            hour: current => dayKit.hourOf(current, tune.hourShift),
            get scene() { return world.scene; },
            get playerRig() { return world.playerRig; },
            // The terrain's chunk meshes and the camera cut (render/terrain_mesh.js).
            get ground() { return world.ground; },
            // Was body `id` (a fighter, a monster, the dummy) drawn last
            // frame? What the player's fighter does not see is not.
            seen: id => world.seen.has(id)
        };
    }

    // ---- one world: scene, terrain, characters, effects ----
    function build(T, renderer, sim, camera, selfId, tune) {
        const C = gameConfig;
        // A dark region (design.md 2.5) has no daylight to speak of:
        // dim sky light, no sun shadows, black fog close in; a torch is the
        // light there. Anywhere else the light is the hour's
        // (render/view_light.js).
        const dark = !!C.maps[sim.region]?.dark;
        // Characters this far (blocks) from the camera's focus cannot be on
        // screen: they are neither posed nor drawn.
        const FAR = 18;
        const scene = new T.Scene(), tx = renderTextures.create(T);
        // ---- terrain: chunk meshes (render/terrain_mesh.js) ----
        const t = sim.terrain;
        const ground = terrainMesh.create(T, scene, sim, tx, { probes: tune.built.bounce });
        // What the world's parts (render/view_*.js) share: each is made
        // from this alone (and the props from the characters' maker too,
        // for the chests).
        const stage = { T, renderer, camera, scene, sim, selfId, tune, dark, tx, ground, far: FAR };
        const light = viewLight.create(stage), { sky, mists } = light;
        const lambert = (color, map) => new T.MeshLambertMaterial({ color: map ? '#ffffff' : color, map: map || null });

        // The map's own floor goes on beyond the map edge (grass, or a
        // cave's gravel), so the world does not end in sky: four sheets
        // round the map, a tile to a block. Not under the map itself,
        // where the terrain draws its own ground and a pond lies lower
        // than it (user, 2026-10-04).
        // Where the map's own edge is the drop beyond a cliff, no ground
        // goes on beyond it either: each side's sheet is laid only along
        // the stretches of that side that are not the drop (a corner
        // going by the corner cell). Under a map with a cliff lie a few
        // sheets of mist, the sky's colour, one under another: what is
        // seen past the edge fades into them the deeper it lies.
        {
            const span = 120, top = tx.ground(terrainMesh.floorOf(t)), w = t.width, h = t.height, y = -0.01;
            const pos = [], uv = [], idx = [];
            const sheet = (x0, z0, x1, z1) => {
                const base = pos.length / 3;
                pos.push(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0);
                uv.push(x0, -z1, x1, -z1, x1, -z0, x0, -z0);
                idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            };
            const dropAt = (c, r) => terrainKit.kindAt(t, c, r) === terrainKit.KIND.drop;
            // Stretches of cells 0..n-1 that are ground (`ground(i)`), as [from, to]; with `ends`, the first and the last go on `span` past the map.
            const stretches = (n, ground, ends, lay) => {
                for (let i = 0, from = -1; i <= n; i++) {
                    const on = i < n && ground(i);
                    if (on && from < 0) from = i;
                    if (!on && from >= 0) { lay(ends && from === 0 ? -span : from, ends && i === n ? n + span : i); from = -1; }
                }
            };
            stretches(w, c => !dropAt(c, 0), true, (x0, x1) => sheet(x0, -span, x1, 0));
            stretches(w, c => !dropAt(c, h - 1), true, (x0, x1) => sheet(x0, h, x1, h + span));
            stretches(h, r => !dropAt(0, r), false, (z0, z1) => sheet(-span, z0, 0, z1));
            stretches(h, r => !dropAt(w - 1, r), false, (z0, z1) => sheet(w, z0, w + span, z1));
            let cliffs = false;
            for (let r = 0; r < h && !cliffs; r++) for (let c = 0; c < w; c++) if (dropAt(c, r)) { cliffs = true; break; }
            if (cliffs) for (let k = 1; k <= MIST.layers; k++) {
                const mist = new T.Mesh(new T.PlaneGeometry(w + 2 * span, h + 2 * span), terrainMesh.shadeUnseen(new T.MeshBasicMaterial({ color: sky, transparent: true, opacity: MIST.opacity, depthWrite: false, fog: false }), ground.sight));
                mists.push(mist.material);
                mist.rotation.x = -Math.PI / 2; mist.position.set(w / 2, -k * MIST.step, h / 2);
                // The lowest first.
                mist.renderOrder = -k;
                scene.add(mist);
            }
            const sheets = new T.BufferGeometry();
            sheets.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
            sheets.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
            sheets.setIndex(idx); sheets.computeVertexNormals();
            // (The ground out there and the mist take the shade of sight as the terrain does.)
            const skirt = new T.Mesh(sheets, terrainMesh.shadeUnseen(lambert(null, top), ground.sight, shader => terrainMesh.fadeLight(T, shader, ground.fade)));
            skirt.receiveShadow = true;
            scene.add(skirt);
        }

        // ---- characters (render/view_bodies.js) ----
        const cast = viewBodies.create(stage);
        // Every fighter, on its own skeleton (its gear): this phone's own as
        // modelled, any other as the rival; armor may swap the tunic's
        // colours. The blade and torch flames are meshes of their own (the
        // blade glows while charging).
        // (This phone's own fighter fades as the terrain does, not as the
        // other bodies: in the dark it is still to be found.)
        const rigOf = id => sim.rigs.fighters[id], playerRig = rigOf(selfId) || rigOf(sim.fighters[0].id);
        const fighters = new Map(sim.fighters.map(f => {
            const ghost = { value: 0 }, own = f.id === selfId;
            return [f.id, {
                rig: rigOf(f.id), ghost,
                view: cast.character(rigOf(f.id), part => part.kind === 'weapon' || part.tag === 'flame', { ...equipmentModels.lookOf(f.loadout), ...(own ? {} : playerModel.looks.rival) }, { ghost, fade: own ? ground.fade : cast.fade }),
                lastFacing: f.facing, lean: 0
            }];
        }));
        fighters.get(selfId)?.view.shunTorch();
        const dummyView = sim.dummy ? cast.character(sim.rigs.dummy) : null;
        const monsters = new Map(sim.monsters.map(m => [m.id, { body: m, view: cast.character(sim.rigs.monsters[m.kind], () => false, monsterKit.look(m.kind)), warning: null }]));
        // ---- props (render/view_props.js), the shade of sight
        // (render/view_sight.js), the effects (render/effects.js) ----
        const props = viewProps.create(stage, cast);
        const sight = viewSight.create(stage);
        const effects = renderEffects.create(T, scene, renderTextures.rng(11));
        let clock = 0;
        const seen = new Set();

        // Do blocks hide the fighter standing at `at` from the camera? The
        // lines from the camera to a few points of the body ([across, up],
        // blocks; inside the body's width, so a wall the fighter leans on
        // sideways is not in the way) are tried against the terrain.
        const BODY = [[0, 0.3], [0, 1], [0, 1.7], [-0.22, 0.6], [0.22, 0.6], [-0.22, 1.4], [0.22, 1.4]];
        // How fast the cut opens and shuts, per second.
        const CUT_RATE = 10;
        const eyeAt = [0, 0, 0], bodyAt = [0, 0, 0], across = new T.Vector3();
        let cutSet = false;
        function hidden(at) {
            camera.position.toArray(eyeAt);
            across.set(1, 0, 0).applyQuaternion(camera.quaternion);
            return BODY.some(([side, up]) => {
                bodyAt[0] = at[0] + across.x * side; bodyAt[1] = at[1] + up; bodyAt[2] = at[2] + across.z * side;
                return ground.hides(eyeAt, bodyAt);
            });
        }
        function placeCamera(x, y, z) {
            const cam = C.camera, fit = Math.max(1, 1.05 / camera.aspect), d = cam.distance * tune.zoom * fit, cp = Math.cos(cam.pitch);
            const [jx, jy] = effects.jitter(), tx0 = x + jx, ty0 = y + cam.lookHeight + jy, tz0 = z;
            camera.position.set(tx0 + Math.sin(cam.yaw) * cp * d, ty0 + Math.sin(cam.pitch) * d, tz0 + Math.cos(cam.yaw) * cp * d);
            camera.lookAt(tx0, ty0, tz0);
        }
        function render(current, frameSeconds, bodies, events) {
            const dt = Math.max(1e-3, frameSeconds);
            clock += frameSeconds;
            const shownOf = body => bodies?.get(body.id) || body;
            const me = shownOf(current.fighters.find(f => f.id === selfId) || current.fighters[0]);
            // What this fighter does not see is not drawn: a rival, a
            // monster or the dummy behind its back or behind a wall.
            const inSight = body => combatKit.sees(current.terrain, me, body);
            seen.clear();
            const drawn = [];
            for (const f of current.fighters) {
                const entry = fighters.get(f.id);
                if (!entry) continue;
                const p = shownOf(f);
                const visible = f.id === selfId || inSight(p);
                entry.view.show(visible);
                if (!visible) continue;
                seen.add(f.id);
                entry.ghost.value = fighterKit.hidden(f) ? GHOST : 0;
                const omega = space.wrapAngle(p.facing - entry.lastFacing) / dt;
                entry.lastFacing = p.facing;
                const leanTarget = Math.max(-0.12, Math.min(0.12, 0.015 * omega)) * p.moveBlend;
                entry.lean += (leanTarget - entry.lean) * Math.min(1, frameSeconds * 10);
                const pose = playerAnim.present(playerAnim.pose(entry.rig, p), p, { time: clock, lean: entry.lean });
                const solved = rigKit.solve(entry.rig, pose, space.toBlocks(p.x, p.y, p.h), space.yawOf(p.facing));
                entry.view.place(solved);
                entry.view.light(!!f.lit);
                drawn.push({ id: f.id, body: f, shown: p, rig: entry.rig, solved, blade: entry.view.blade, materials: entry.view.materials, flash: entry.view.flash });
            }
            // The hour's light (render/view_light.js); colours fade as its
            // look has them, the terrain's and other bodies'.
            light.frame(current, { me, drawn, shownOf, clock, frameSeconds, lamps: props.lamps });
            ground.fade.value = light.now.fade[0]; cast.fade.value = light.now.fade[1];
            const foes = [];
            if (dummyView && current.dummy) {
                const visible = inSight(current.dummy);
                dummyView.show(visible);
                if (visible) { seen.add(current.dummy.id); dummyView.place(dummyKit.solve(current)); foes.push({ body: current.dummy, view: dummyView, top: 1.95 }); }
            }
            const focus = space.toBlocks(me.x, me.y, me.h);
            for (const m of current.monsters) {
                const entry = monsters.get(m.id);
                if (!entry) continue;
                const shown = shownOf(m), rig = current.rigs.monsters[m.kind], root = space.toBlocks(shown.x, shown.y, shown.h);
                // A fallen monster lies a while, then sinks into the ground.
                const sink = m.phase === 'dead' ? Math.max(0, m.t - C.monsters.corpseSeconds) * 0.5 : 0;
                const near = Math.hypot(root[0] - focus[0], root[2] - focus[2]) < FAR, visible = sink < 1.2 && near && inSight(shown);
                entry.view.show(visible);
                if (visible) {
                    seen.add(m.id);
                    root[1] -= sink;
                    entry.view.place(rigKit.solve(rig, monsterKit.pose(rig, shown), root, space.yawOf(shown.facing)));
                    foes.push({ body: m, view: entry.view, top: monsterKit.height(m.kind) + 0.25, shown });
                }
                props.warn(entry, m, visible);
            }
            props.update(current, focus, clock);
            ground.update();
            effects.onEvents(events, selfId);
            effects.update(frameSeconds, current, { selfId, fighters: drawn, foes });
            const at = space.toBlocks(me.x, me.y, me.h);
            sight.update(at[0], at[2], me.facing);
            placeCamera(at[0], at[1], at[2]);
            light.placeSun(at[0], at[1], at[2]);
            // Cut the blocks between the camera and this fighter's chest,
            // while some do hide the fighter; the hole eases open and shut.
            ground.cut.center.value.set(at[0], at[1] + 1, at[2]);
            ground.cut.eye.value.copy(camera.position);
            // (A world's first frame shows it as it is, with no easing.)
            const open = hidden(at) ? 1 : 0;
            ground.cut.open.value = cutSet ? ground.cut.open.value + (open - ground.cut.open.value) * Math.min(1, frameSeconds * CUT_RATE) : open;
            cutSet = true;
        }
        function dispose() {
            const seen = new Set();
            const once = (thing, fn) => { if (thing && !seen.has(thing)) { seen.add(thing); fn(thing); } };
            scene.traverse(o => {
                once(o.geometry, g => g.dispose());
                for (const m of [].concat(o.material || [])) once(m, () => { once(m.map, map => map.dispose()); m.dispose(); });
                if (o.isSkinnedMesh) o.skeleton.dispose();
            });
            props.dispose(once);
            for (const texture of Object.values(tx)) if (texture?.isTexture) once(texture, () => texture.dispose());
            ground.dispose();
            sight.dispose();
            light.dispose();
            cast.dispose();
        }
        light.retune();
        return { scene, render, dispose, retune: light.retune, playerRig, seen, ground };
    }
    return { create };
})();
