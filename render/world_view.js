// three.js view of the simulation. It only draws: positions come from the
// sim and every character box's matrix comes from core/rig.js, so what is
// drawn is exactly what hit tests use (design.md 2.5). The
// renderer and camera live as long as the page; the scene is built per
// world (`load`), so switching maps or restarting needs no reload.
const worldView = (() => {
    const UP = [0, 1, 0];
    // Lighting by day and in a dark region: sky (hemisphere) and sun
    // intensity, fog start and end past the camera distance (blocks), and
    // the torch's intensity. A torch lights `reach` blocks round it.
    const LIGHT = { day: { sky: 1.9, sun: 2.7, fog: [8, 26], torch: 3 }, dark: { sky: 0.05, sun: 0.03, fog: [1, 9], torch: 9 } };
    const TORCH = { reach: 7, decay: 1.2 };
    // How soft the edge of the sun's shadows is, blocks: the reach of the
    // shadow filter, the same on a small shadow map as on a large one
    // (user, 2026-10-04: soft, like the shade of sight).
    const SUN_SOFT = 0.1;
    // In a dark region a little daylight comes in by each portal: a soft
    // light `inside` blocks in from it, so the dark does not shut at the
    // doorway (user, 2026-10-03).
    const DOORWAY = { intensity: 4, reach: 6, decay: 1.4, inside: 1, height: 1.6 };
    // Is the point (blocks) inside a block of the terrain (or off the map)?
    function inBlock(t, [x, y, z]) {
        const c = Math.floor(x), r = Math.floor(z);
        return !terrainKit.inside(t, c, r) || (terrainKit.solidAt(t, c, r) && y < terrainKit.levelAt(t, c, r));
    }
    // The last point going from `from` to `to` that is not inside a block.
    function clearOf(t, from, to, steps = 12) {
        let last = from;
        for (let k = 1; k <= steps; k++) {
            const at = from.map((v, i) => v + (to[i] - v) * k / steps);
            if (inBlock(t, at)) break;
            last = at;
        }
        return last;
    }

    // opts.selfId: the fighter this phone plays (the camera follows it; in a
    // duel the other one is drawn as the rival).
    function create(canvas, sim, opts = {}) {
        const T = THREE, C = gameConfig;
        const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        const small = Math.min(window.innerWidth, window.innerHeight) < 700;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, C.graphics.pixelRatioMax));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = T.PCFShadowMap;
        const camera = new T.PerspectiveCamera(C.camera.fov, 1, 0.1, 120);
        const mapSize = small ? C.graphics.shadowMapSmall : C.graphics.shadowMapLarge;
        let world = null;
        // The menu's settings (ui/settings.js): the camera's distance
        // multiplier, and sun shadows (off in the power saver).
        const tune = { zoom: 1, shadows: true };

        function load(next, { selfId = 'player' } = {}) {
            if (world) world.dispose();
            world = build(T, renderer, next, camera, mapSize, selfId, tune);
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
        // zoom: camera distance multiplier; saver: fewer pixels, no shadows.
        function settings({ zoom, saver }) {
            tune.zoom = zoom; tune.shadows = !saver;
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, saver ? C.graphics.saverPixelRatio : C.graphics.pixelRatioMax));
            world.retune();
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
    function build(T, renderer, sim, camera, mapSize, selfId, tune) {
        const C = gameConfig, P = palette, U = C.world.unitsPerBlock;
        // A dark region (design.md 2.5) has no daylight to speak of:
        // dim sky light, no sun shadows, black fog close in; a torch is the
        // light there.
        const dark = !!C.maps[sim.region]?.dark, L = dark ? LIGHT.dark : LIGHT.day;
        const scene = new T.Scene(), sky = new T.Color(dark ? P.darkSky : P.sky);
        scene.background = sky;
        scene.fog = new T.Fog(sky, C.camera.distance + L.fog[0], C.camera.distance + L.fog[1]);
        // Fog and shadows follow the menu's settings.
        function retune() {
            const d = C.camera.distance * tune.zoom;
            scene.fog.near = d + L.fog[0]; scene.fog.far = d + L.fog[1];
            sun.castShadow = !dark && tune.shadows;
        }

        scene.add(new T.HemisphereLight(P.skyLight, P.groundLight, L.sky));
        const sun = new T.DirectionalLight(P.sun, L.sun), extent = C.graphics.shadowExtent;
        sun.castShadow = !dark && tune.shadows;
        // The torch's light: always there (lights coming and going would
        // rebuild every shader), at zero while no torch burns.
        const torchLight = new T.PointLight(P.flame, 0, TORCH.reach, TORCH.decay);
        scene.add(torchLight);
        if (dark) for (const e of sim.entities) {
            if (e.type !== 'portal') continue;
            const glow = new T.PointLight(P.skyLight, DOORWAY.intensity, DOORWAY.reach, DOORWAY.decay), [x, , z] = space.toBlocks(e.x + Math.cos(e.facing) * DOORWAY.inside * U, e.y + Math.sin(e.facing) * DOORWAY.inside * U);
            glow.position.set(x, DOORWAY.height, z);
            scene.add(glow);
        }
        sun.shadow.mapSize.set(mapSize, mapSize);
        Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 60 });
        sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
        scene.add(sun, sun.target);
        // Shadow box follows the player, snapped to whole shadow texels in
        // the light's frame so edges do not shimmer while walking.
        const lightDir = new T.Vector3(7, 14, -5).normalize();
        const lightRight = new T.Vector3().crossVectors(new T.Vector3(...UP), lightDir).normalize();
        const lightUp = new T.Vector3().crossVectors(lightDir, lightRight);
        const texel = 2 * extent / mapSize, focus = new T.Vector3();
        sun.shadow.radius = Math.max(1, SUN_SOFT / texel);
        function placeSun(x, y, z) {
            focus.set(x, y, z);
            const u = Math.round(focus.dot(lightRight) / texel) * texel, v = Math.round(focus.dot(lightUp) / texel) * texel, w = focus.dot(lightDir);
            sun.target.position.copy(lightRight).multiplyScalar(u).addScaledVector(lightUp, v).addScaledVector(lightDir, w);
            sun.position.copy(sun.target.position).addScaledVector(lightDir, 25);
        }

        const tx = renderTextures.create(T);
        const lambert = (color, map) => new T.MeshLambertMaterial({ color: map ? '#ffffff' : color, map: map || null });
        // Box whose faces carry 16 texels per block, like Minecraft.
        function boxGeo(w, h, d) {
            const g = new T.BoxGeometry(w, h, d), uv = g.attributes.uv;
            const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
            for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
            return g;
        }

        // ---- terrain: chunk meshes (render/terrain_mesh.js) ----
        const t = sim.terrain;
        const ground = terrainMesh.create(T, scene, sim, tx);
        // Grass beyond the map edge, so the world does not end in sky. It
        // lies just under the block tops, which cover it inside the map.
        {
            const span = 240, top = tx.grassTop.clone();
            top.repeat.set(span, span); top.needsUpdate = true;
            const skirt = new T.Mesh(new T.PlaneGeometry(span, span), lambert(null, top));
            skirt.rotation.x = -Math.PI / 2; skirt.position.set(t.width / 2, -0.01, t.height / 2);
            skirt.receiveShadow = true;
            scene.add(skirt);
        }

        // ---- characters ----
        // Each character is one skinned mesh: every box is welded into one
        // geometry and bound to a bone of its own, whose world matrix is the
        // box's matrix from the rig. So a character is one draw call (and
        // one for its shadow) however many boxes it has. Boxes `apart` keep
        // a mesh of their own: the player's blade, to glow while charging.
        // Each character has its own materials, so a hit flashes only the
        // one struck. With ?boxes in the address, hit boxes are outlined:
        // body boxes in cyan, weapon boxes (grown by combat.weaponPad) red.
        const showBoxes = /[?&]boxes(=|&|$)/.test(window.location.search);
        const pad = C.combat.weaponPad / U, colour = new T.Color();
        // `look` swaps palette colours by name (playerModel.looks).
        function character(rig, apart = () => false, look = {}) {
            const material = new T.MeshLambertMaterial({ map: tx.grain, vertexColors: true });
            const pos = [], nor = [], uv = [], col = [], skin = [], weight = [], index = [], bones = [], boned = [], loose = [], lines = [];
            rig.parts.forEach((part, i) => {
                const name = look[part.color] || part.color;
                if (!P[name]) throw new Error(`Unknown palette colour ${name}`);
                const g = boxGeo(...part.size);
                if (apart(part)) {
                    const mesh = new T.Mesh(g, new T.MeshLambertMaterial({ color: P[name], map: tx.grain }));
                    mesh.matrixAutoUpdate = false; mesh.castShadow = true; mesh.receiveShadow = true;
                    scene.add(mesh); loose.push({ i, mesh });
                } else {
                    const base = pos.length / 3, bone = bones.length;
                    bones.push(new T.Bone()); boned.push(i);
                    colour.set(P[name]);
                    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
                    for (let k = 0; k < g.attributes.position.count; k++) { col.push(colour.r, colour.g, colour.b); skin.push(bone, 0, 0, 0); weight.push(1, 0, 0, 0); }
                    for (const k of g.index.array) index.push(base + k);
                    g.dispose();
                }
                if (showBoxes && (part.kind === 'body' || part.kind === 'weapon')) {
                    const line = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(...part.size)), new T.LineBasicMaterial({ color: part.kind === 'weapon' ? '#ff5d4f' : '#5ccfc4', depthTest: false, transparent: true }));
                    line.matrixAutoUpdate = false; line.renderOrder = 10;
                    scene.add(line);
                    lines.push({ i, line, grow: part.kind === 'weapon' ? part.size.map(v => (v + 2 * pad) / v) : null });
                }
            });
            const geometry = new T.BufferGeometry();
            geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
            geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
            geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
            geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
            geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(skin, 4));
            geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weight, 4));
            geometry.setIndex(index);
            const mesh = new T.SkinnedMesh(geometry, material);
            mesh.bind(new T.Skeleton(bones), new T.Matrix4());
            // Bounds would have to follow the bones; a handful of characters
            // is cheaper drawn than culled.
            mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
            scene.add(mesh);
            const grown = new T.Matrix4();
            // A shield's white double, shown only while a parry flashes it
            // (render/effects.js): one box round all the shield's boxes, which
            // hang on one bone.
            const shieldParts = rig.parts.map((part, i) => ({ part, i })).filter(({ part }) => C.items[part.owner]?.offhand === 'shield');
            let blinker = null;
            if (shieldParts.length) {
                const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
                for (const { part } of shieldParts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], part.at[k] - part.size[k] / 2); hi[k] = Math.max(hi[k], part.at[k] + part.size[k] / 2); }
                const box = new T.Mesh(new T.BoxGeometry(...hi.map((v, k) => v - lo[k] + 0.02)), new T.MeshBasicMaterial({ color: '#ffffff' }));
                box.matrixAutoUpdate = false; box.visible = false;
                scene.add(box);
                blinker = { box, bone: shieldParts[0].part.bone, at: new T.Matrix4().makeTranslation(...hi.map((v, k) => (v + lo[k]) / 2)), on: false };
            }
            // Flames on a torch: shown only while it burns, glowing.
            const flames = loose.filter(l => rig.parts[l.i].tag === 'flame').map(l => l.mesh);
            for (const f of flames) { f.material.emissive.set(P[rig.parts[loose.find(l => l.mesh === f).i].color]); f.castShadow = false; }
            let lit = false;
            return {
                mesh, blade: loose.find(l => rig.parts[l.i].kind === 'weapon')?.mesh.material || null, flames,
                materials: [material, ...loose.filter(l => rig.parts[l.i].tag !== 'flame').map(l => l.mesh.material)],
                light(on) { lit = on; for (const f of flames) f.visible = on && mesh.visible; },
                // Show the shield white (or not); false when there is no shield.
                flash(on) {
                    if (!blinker) return false;
                    blinker.on = on; blinker.box.visible = on && mesh.visible;
                    return true;
                },
                place(solved) {
                    boned.forEach((part, b) => bones[b].matrixWorld.fromArray(solved.parts[part]));
                    for (const { i, mesh: m } of loose) { m.matrix.fromArray(solved.parts[i]); m.matrixWorldNeedsUpdate = true; }
                    if (blinker) { blinker.box.matrix.fromArray(solved.bones[blinker.bone]).multiply(blinker.at); blinker.box.matrixWorldNeedsUpdate = true; }
                    for (const { i, line, grow } of lines) {
                        line.matrix.fromArray(solved.parts[i]);
                        if (grow) line.matrix.multiply(grown.makeScale(...grow));
                        line.matrixWorldNeedsUpdate = true;
                    }
                },
                show(visible) {
                    mesh.visible = visible;
                    for (const l of loose) l.mesh.visible = visible && (lit || rig.parts[l.i].tag !== 'flame');
                    for (const l of lines) l.line.visible = visible;
                    if (blinker) blinker.box.visible = visible && blinker.on;
                }
            };
        }
        // Every fighter, on its own skeleton (its gear): this phone's own as
        // modelled, any other as the rival; armor may swap the tunic's
        // colours. The blade and torch flames are meshes of their own (the
        // blade glows while charging).
        const rigOf = id => sim.rigs.fighters[id], playerRig = rigOf(selfId) || rigOf(sim.fighters[0].id);
        const fighters = new Map(sim.fighters.map(f => [f.id, {
            rig: rigOf(f.id),
            view: character(rigOf(f.id), part => part.kind === 'weapon' || part.tag === 'flame', { ...equipmentModels.lookOf(f.loadout), ...(f.id === selfId ? {} : playerModel.looks.rival) }),
            lastFacing: f.facing, lean: 0
        }]));
        const dummyView = sim.dummy ? character(sim.rigs.dummy) : null;
        const monsters = new Map(sim.monsters.map(m => [m.id, { body: m, view: character(sim.rigs.monsters[m.kind], () => false, monsterKit.look(m.kind)), warning: null }]));
        // Characters this far (blocks) from the camera's focus cannot be on
        // screen: they are neither posed nor drawn.
        const FAR = 18;

        // ---- props: portal openings, chests, loot on the ground ----
        const portals = sim.entities.filter(e => e.type === 'portal').map(e => {
            const plane = new T.Mesh(new T.PlaneGeometry(0.98, terrainKit.PORTAL_HEIGHT - 0.04), new T.MeshBasicMaterial({ transparent: true, opacity: 0.6, side: T.DoubleSide, depthWrite: false }));
            const [x, , z] = space.toBlocks(e.x, e.y);
            plane.position.set(x, terrainKit.PORTAL_HEIGHT / 2, z);
            if (e.side === 'east' || e.side === 'west') plane.rotation.y = Math.PI / 2;
            scene.add(plane);
            return { body: e, plane };
        });
        const chestRig = rigKit.build(propModels.chest), chests = new Map();
        for (const e of sim.entities) if (e.type === 'chest') chests.set(e.id, character(chestRig));
        const unitBox = new T.BoxGeometry(1, 1, 1), DROPS = 64, drops = new T.InstancedMesh(unitBox, new T.MeshLambertMaterial({ map: tx.grain }), DROPS);
        drops.castShadow = true; drops.frustumCulled = false; drops.count = 0;
        scene.add(drops);
        // Flames on burning thickets: a few bright cubes per block, licking.
        const FIRES = 48, fires = new T.InstancedMesh(unitBox, new T.MeshBasicMaterial(), FIRES);
        fires.frustumCulled = false; fires.count = 0;
        scene.add(fires);
        const place = new T.Object3D(), tint = new T.Color();
        function props(current, me) {
            for (const { body, plane } of portals) {
                const locked = body.requires && !current.progress?.bosses?.[body.requires];
                plane.material.color.set(P[propModels.portal[locked ? 'locked' : 'open']]);
                plane.material.opacity = locked ? 0.42 : 0.55 + 0.12 * Math.sin(clock * 2.4);
            }
            for (const e of current.entities) {
                if (e.type !== 'chest') continue;
                const view = chests.get(e.id);
                if (!view) continue;
                const k = e.open ? Math.min(1, e.t / 0.45) : 0, lid = rigKit.scale(propModels.chest.open, 1 - (1 - k) * (1 - k));
                view.place(rigKit.solve(chestRig, lid, space.toBlocks(e.x, e.y, e.h), space.yawOf(e.facing)));
            }
            let n = 0;
            for (const e of current.entities) {
                if (e.type !== 'drop' || n >= DROPS) continue;
                const look = propModels.drops[e.item] || propModels.drops.gold, [x, y, z] = space.toBlocks(e.x, e.y, e.h);
                if (Math.hypot(x - me[0], z - me[2]) > FAR) continue;
                const bob = e.h === 0 ? 0.04 + 0.04 * Math.sin(clock * 3 + e.facing * 5) : 0;
                place.position.set(x, y + look.size[1] / 2 + bob, z);
                place.rotation.set(0, e.facing + clock * 1.6, 0);
                place.scale.set(...look.size);
                place.updateMatrix();
                drops.setMatrixAt(n, place.matrix); drops.setColorAt(n, tint.set(P[look.color]));
                n++;
            }
            drops.count = n;
            drops.instanceMatrix.needsUpdate = true;
            if (drops.instanceColor) drops.instanceColor.needsUpdate = true;
            let f = 0;
            for (const e of current.entities) {
                if (e.type !== 'brush' || e.burning < 0) continue;
                const [x, , z] = space.toBlocks(e.x, e.y), life = 1 - e.burning / C.props.burnSeconds;
                for (let k = 0; k < 4 && f < FIRES; k++, f++) {
                    const a = k * 1.7 + e.col * 0.9 + e.row * 1.3, lick = 0.5 + 0.5 * Math.sin(clock * (9 + k) + a);
                    const size = (0.28 + 0.22 * lick) * Math.max(0.3, life);
                    place.position.set(x + Math.cos(a) * 0.25, terrainKit.BRUSH_HEIGHT * Math.max(0.2, life) + size / 2 - 0.1 + lick * 0.2, z + Math.sin(a) * 0.25);
                    place.rotation.set(0, a + clock, 0); place.scale.setScalar(size); place.updateMatrix();
                    fires.setMatrixAt(f, place.matrix); fires.setColorAt(f, tint.set(k % 2 ? P.flame : P.flameTip));
                }
            }
            fires.count = f;
            fires.instanceMatrix.needsUpdate = true;
            if (fires.instanceColor) fires.instanceColor.needsUpdate = true;
        }
        // ---- range warnings: the swept outline of a monster's move on the
        // ground (core/monster.js reach), fading in through its windup ----
        const warnShapes = new Map();
        function warnGeometry(kind, move) {
            const key = `${kind}:${move}`;
            if (!warnShapes.has(key)) {
                const hull = monsterKit.reach(kind, move).hull, g = new T.BufferGeometry(), pts = [];
                for (let i = 1; i < hull.length - 1; i++) for (const p of [hull[0], hull[i + 1], hull[i]]) pts.push(p[0], 0, p[1]);
                g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
                warnShapes.set(key, g);
            }
            return warnShapes.get(key);
        }
        const warnMaterial = () => new T.MeshBasicMaterial({ color: '#ff2a1a', transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        // (A monster out of sight shows no warning either.)
        function warn(entry, m, visible) {
            const S = C.monsters[m.kind], mv = S.moves[m.move], active = visible && (m.phase === 'windup' || m.phase === 'swing');
            if (!active) { if (entry.warning) entry.warning.visible = false; return; }
            if (!entry.warning) { entry.warning = new T.Mesh(warnGeometry(m.kind, m.move), warnMaterial()); entry.warning.renderOrder = 1; scene.add(entry.warning); }
            const w = entry.warning;
            w.geometry = warnGeometry(m.kind, m.move); w.visible = true;
            // It follows the turning windup, then stays where the swing began.
            if (m.phase === 'windup') {
                const [x, , z] = space.toBlocks(m.x, m.y, m.h);
                w.position.set(x, 0.012, z); w.rotation.y = space.yawOf(m.facing);
                w.material.opacity = 0.14 + 0.3 * Math.min(1, m.t / mv.windup);
            } else w.material.opacity = 0.44 * (1 - Math.min(1, m.t / mv.swing));
        }

        // ---- sight: ground this fighter cannot see is shaded, out to
        // `SHADE_FAR` blocks; walls at least eye high cast it, and so does
        // everything outside the front arc it sees (player.sightAngle).
        // The same in the adventure and in a duel (user, 2026-10-04). The
        // edge of sight comes exact from the terrain (terrainKit.sightFan:
        // rays past every wall corner), so it slides evenly as the fighter
        // walks; an even spread of rays stepped along left the edge jumping
        // from one ray to the next. Sight is worked out as far as
        // `SIGHT_FAR` blocks, which is past the screen's edge.
        //
        // The shade's edge is soft (user, 2026-10-04; drawing only, what is
        // seen is decided as before): the fan is drawn from straight above
        // into a small texture, `MASK` texels across the `2 * SIGHT_FAR`
        // blocks round the fighter, blurred along and then across, and
        // that texture is the opacity of one dark sheet over the ground. ----
        const SHADE_FAR = 30, SIGHT_FAR = 20, SHADE_Y = 0.02, MASK = 256, BLUR = 1.1;
        const shade = (() => {
            const geo = new T.BufferGeometry();
            let pos = null;
            // The fan, white on black, seen from above with north up.
            const fanMesh = new T.Mesh(geo, new T.MeshBasicMaterial({ color: '#ffffff', side: T.DoubleSide, fog: false }));
            fanMesh.frustumCulled = false;
            const above = new T.Scene(), eye = new T.OrthographicCamera(-SIGHT_FAR, SIGHT_FAR, SIGHT_FAR, -SIGHT_FAR, 0, 10);
            above.background = new T.Color('#000000'); above.add(fanMesh);
            eye.up.set(0, 0, -1); eye.position.set(0, 5, 0); eye.lookAt(0, 0, 0);
            const target = samples => new T.WebGLRenderTarget(MASK, MASK, { depthBuffer: false, samples });
            const drawnMask = target(4), blurred = [target(0), target(0)];
            // A nine-texel bell curve in five taps; `along` is one texel's step.
            const blur = new T.ShaderMaterial({
                uniforms: { map: { value: null }, along: { value: new T.Vector2() } }, depthTest: false, depthWrite: false,
                vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
                fragmentShader: `uniform sampler2D map; uniform vec2 along; varying vec2 vUv;
void main() {
    float a = texture2D(map, vUv).g * 0.227027
        + (texture2D(map, vUv + along * 1.384615).g + texture2D(map, vUv - along * 1.384615).g) * 0.316216
        + (texture2D(map, vUv + along * 3.230769).g + texture2D(map, vUv - along * 3.230769).g) * 0.070270;
    gl_FragColor = vec4(a, a, a, 1.0);
}`
            });
            const pass = new T.Scene(), flat = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), full = new T.Mesh(new T.PlaneGeometry(2, 2), blur);
            full.frustumCulled = false; pass.add(full);
            function soften() {
                const steps = [[drawnMask, eye, above, null], [blurred[0], flat, pass, [BLUR / MASK, 0, drawnMask]], [blurred[1], flat, pass, [0, BLUR / MASK, blurred[0]]]];
                for (const [to, cam, what, from] of steps) {
                    if (from) { blur.uniforms.along.value.set(from[0], from[1]); blur.uniforms.map.value = from[2].texture; }
                    renderer.setRenderTarget(to); renderer.render(what, cam);
                }
                renderer.setRenderTarget(null);
            }
            // The dark sheet: as far as SHADE_FAR; past the texture it takes
            // the texture's edge, which is past sight and so all shade. Drawn
            // over the ground it lies on, whatever the depth buffer's precision.
            const mask = blurred[1].texture, k = SHADE_FAR / SIGHT_FAR;
            mask.repeat.set(k, k); mask.offset.set(0.5 - k / 2, 0.5 - k / 2);
            const mesh = new T.Mesh(new T.PlaneGeometry(2 * SHADE_FAR, 2 * SHADE_FAR), new T.MeshBasicMaterial({ color: '#05070d', alphaMap: mask, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
            mesh.rotation.x = -Math.PI / 2; mesh.frustumCulled = false; mesh.renderOrder = 1;
            scene.add(mesh);
            const fan = { n: 0, angle: new Float64Array(0), reach: new Float64Array(0) };
            let lastX = NaN, lastZ = NaN, lastFacing = NaN, lastRev = -1;
            function dispose() {
                geo.dispose(); fanMesh.material.dispose(); blur.dispose(); full.geometry.dispose();
                for (const target of [drawnMask, ...blurred]) target.dispose();
            }
            // Recast only when the fighter has moved or turned (or the terrain changed).
            function update(x, z, facing) {
                if (x === lastX && z === lastZ && facing === lastFacing && lastRev === t.rev) return;
                lastX = x; lastZ = z; lastFacing = facing; lastRev = t.rev;
                terrainKit.sightFan(t, x * U, z * U, SIGHT_FAR * U, { facing, half: C.player.sightAngle, out: fan });
                const n = fan.n;
                if (!pos || pos.length < fan.angle.length * 18) {
                    geo.dispose();
                    pos = new Float32Array(fan.angle.length * 18);
                    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
                }
                // Between each ray and the next: from where sight ends out to the far edge.
                for (let i = 0, o = 0; i < n; i++) {
                    const j = (i + 1) % n, c0 = Math.cos(fan.angle[i]), s0 = Math.sin(fan.angle[i]), c1 = Math.cos(fan.angle[j]), s1 = Math.sin(fan.angle[j]);
                    const d0 = fan.reach[i] / U, d1 = fan.reach[j] / U;
                    const nx0 = x + c0 * d0, nz0 = z + s0 * d0, fx0 = x + c0 * SHADE_FAR, fz0 = z + s0 * SHADE_FAR;
                    const nx1 = x + c1 * d1, nz1 = z + s1 * d1, fx1 = x + c1 * SHADE_FAR, fz1 = z + s1 * SHADE_FAR;
                    pos[o++] = nx0; pos[o++] = SHADE_Y; pos[o++] = nz0; pos[o++] = fx0; pos[o++] = SHADE_Y; pos[o++] = fz0; pos[o++] = fx1; pos[o++] = SHADE_Y; pos[o++] = fz1;
                    pos[o++] = nx0; pos[o++] = SHADE_Y; pos[o++] = nz0; pos[o++] = fx1; pos[o++] = SHADE_Y; pos[o++] = fz1; pos[o++] = nx1; pos[o++] = SHADE_Y; pos[o++] = nz1;
                }
                geo.setDrawRange(0, n * 6);
                geo.attributes.position.needsUpdate = true;
                eye.position.set(x, 5, z); mesh.position.set(x, SHADE_Y, z);
                soften();
            }
            return { update, dispose };
        })();

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
            // The torch light sits on this fighter's flame, flickering a
            // little -- short of any block the flame pokes into, or the light
            // would be shut inside it and the wall's near side go dark.
            const bearer = drawn.find(d => d.id === selfId && d.body.lit);
            if (bearer) {
                const flame = bearer.rig.parts.findIndex(part => part.tag === 'flame'), m = bearer.solved.parts[flame];
                const body = space.toBlocks(bearer.shown.x, bearer.shown.y, bearer.shown.h + U);
                torchLight.position.set(...clearOf(current.terrain, body, [m[12], m[13] + 0.15, m[14]]));
                torchLight.intensity = L.torch * (1 + 0.08 * Math.sin(clock * 13) + 0.05 * Math.sin(clock * 23.7));
            } else torchLight.intensity = 0;
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
                warn(entry, m, visible);
            }
            props(current, focus);
            ground.update();
            effects.onEvents(events, selfId);
            effects.update(frameSeconds, current, { selfId, fighters: drawn, foes });
            const at = space.toBlocks(me.x, me.y, me.h);
            shade.update(at[0], at[2], me.facing);
            placeCamera(at[0], at[1], at[2]);
            placeSun(at[0], at[1], at[2]);
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
            for (const g of warnShapes.values()) once(g, () => g.dispose());
            for (const texture of Object.values(tx)) if (texture?.isTexture) once(texture, () => texture.dispose());
            ground.dispose(); shade.dispose();
            // The shadow map is the light's own render target.
            sun.dispose();
        }
        retune();
        return { scene, render, dispose, retune, playerRig, seen, ground };
    }
    return { create };
})();
