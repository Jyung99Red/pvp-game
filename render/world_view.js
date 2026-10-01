// three.js view of the simulation. It only draws: positions come from the
// sim and every character box's matrix comes from core/rig.js, so what is
// drawn is exactly what hit tests will use (3d-migration-concept.md 8).
const worldView = (() => {
    const UP = [0, 1, 0];

    function create(canvas, sim) {
        const T = THREE, C = gameConfig, P = palette;
        const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        const small = Math.min(window.innerWidth, window.innerHeight) < 700;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, C.graphics.pixelRatioMax));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = T.PCFShadowMap;

        const scene = new T.Scene(), sky = new T.Color(P.sky);
        scene.background = sky;
        scene.fog = new T.Fog(sky, C.camera.distance + 8, C.camera.distance + 26);
        const camera = new T.PerspectiveCamera(C.camera.fov, 1, 0.1, 120);

        scene.add(new T.HemisphereLight(P.skyLight, P.groundLight, 1.9));
        const sun = new T.DirectionalLight(P.sun, 2.7), extent = C.graphics.shadowExtent;
        const mapSize = small ? C.graphics.shadowMapSmall : C.graphics.shadowMapLarge;
        sun.castShadow = true;
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
        function placeSun(x, y, z) {
            focus.set(x, y, z);
            const u = Math.round(focus.dot(lightRight) / texel) * texel, v = Math.round(focus.dot(lightUp) / texel) * texel, w = focus.dot(lightDir);
            sun.target.position.copy(lightRight).multiplyScalar(u).addScaledVector(lightUp, v).addScaledVector(lightDir, w);
            sun.position.copy(sun.target.position).addScaledVector(lightDir, 25);
        }

        const tx = renderTextures.create(T), rnd = renderTextures.rng(7);
        const lambert = (color, map) => new T.MeshLambertMaterial({ color: map ? '#ffffff' : color, map: map || null });
        // Box whose faces carry 16 texels per block, like Minecraft.
        function boxGeo(w, h, d) {
            const g = new T.BoxGeometry(w, h, d), uv = g.attributes.uv;
            const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
            for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
            return g;
        }

        // ---- terrain ----
        const unitBox = boxGeo(1, 1, 1), dummy = new T.Object3D(), tint = new T.Color();
        function blocks(material, cells, { cast = true, receive = true, vary = 0.07 } = {}) {
            if (!cells.length) return null;
            const mesh = new T.InstancedMesh(unitBox, material, cells.length);
            cells.forEach(([x, y, z], i) => {
                dummy.position.set(x, y, z); dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
                const k = 1 - vary + rnd() * vary * 1.6;
                mesh.setColorAt(i, tint.setRGB(k, k, k));
            });
            mesh.castShadow = cast; mesh.receiveShadow = receive;
            scene.add(mesh);
            return mesh;
        }
        const t = sim.terrain, K = terrainKit.KIND;
        const grass = [], path = [], stone = [], moss = [], bark = [], leaves = [];
        for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) {
            const kind = terrainKit.kindAt(t, c, r), x = c + 0.5, z = r + 0.5;
            // Paths are flush with the grass: the ground query says 0 everywhere.
            (kind === K.path ? path : grass).push([x, -0.5, z]);
            if (kind === K.stone) for (let y = 0; y < terrainKit.levelAt(t, c, r); y++) (rnd() < 0.3 ? moss : stone).push([x, y + 0.5, z]);
            if (kind === K.tree) {
                const h = terrainKit.levelAt(t, c, r);
                for (let y = 0; y < h; y++) bark.push([x, y + 0.5, z]);
                for (let y = h - 2; y <= h + 1; y++) {
                    const rad = y >= h ? 1 : 2;
                    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
                        if (dx === 0 && dz === 0 && y < h) continue;
                        if (Math.abs(dx) === rad && Math.abs(dz) === rad && (rad === 2 || y === h + 1 || rnd() < 0.5)) continue;
                        if (y === h + 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
                        leaves.push([x + dx, y + 0.5, z + dz]);
                    }
                }
            }
        }
        const grassSide = lambert(null, tx.grassSide);
        blocks([grassSide, grassSide, lambert(null, tx.grassTop), lambert(null, tx.dirt), grassSide, grassSide], grass, { cast: false, vary: 0.06 });
        blocks(lambert(null, tx.path), path, { cast: false, vary: 0.05 });
        blocks(lambert(null, tx.stone), stone);
        blocks(lambert(null, tx.mossy), moss);
        blocks(lambert(null, tx.bark), bark);
        blocks(lambert(null, tx.leaves), leaves, { vary: 0.12 });
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
        // Flowers and tufts on open grass: tiny boxes, never textured.
        {
            const items = [], spawn = t.spawn;
            for (let i = 0; i < t.width * t.height * 0.18; i++) {
                const x = rnd() * t.width, z = rnd() * t.height, c = Math.floor(x), r = Math.floor(z);
                if (terrainKit.kindAt(t, c, r) !== K.grass || Math.hypot(c - spawn.col, r - spawn.row) < 2) continue;
                if (rnd() < 0.55) {
                    for (let k = 0; k < 3; k++) items.push({ p: [x + (k - 1) * 0.09, 0.12 + k % 2 * 0.04, z + (rnd() - 0.5) * 0.1], s: [0.05, 0.24 + k % 2 * 0.08, 0.05], c: P.stem });
                } else {
                    items.push({ p: [x, 0.15, z], s: [0.05, 0.3, 0.05], c: P.stem });
                    items.push({ p: [x, 0.34, z], s: [0.15, 0.13, 0.15], c: [P.flowerRed, P.flowerYellow, P.flowerWhite, P.flowerViolet][rnd() * 4 | 0] });
                }
            }
            const mesh = new T.InstancedMesh(unitBox, new T.MeshLambertMaterial(), items.length);
            items.forEach((it, i) => {
                dummy.position.set(...it.p); dummy.scale.set(...it.s); dummy.rotation.y = rnd() * Math.PI * 2; dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, tint.set(it.c));
            });
            dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
            mesh.castShadow = true;
            scene.add(mesh);
        }

        // ---- characters ----
        // One mesh per box; its matrix is copied from the rig every frame.
        const bodyMaterials = new Map();
        const bodyMaterial = name => {
            if (!bodyMaterials.has(name)) {
                if (!P[name]) throw new Error(`Unknown palette colour ${name}`);
                bodyMaterials.set(name, new T.MeshLambertMaterial({ color: P[name], map: tx.grain }));
            }
            return bodyMaterials.get(name);
        };
        function rigMeshes(rig) {
            return rig.parts.map(part => {
                const mesh = new T.Mesh(boxGeo(...part.size), bodyMaterial(part.color));
                mesh.matrixAutoUpdate = false; mesh.castShadow = true; mesh.receiveShadow = true;
                scene.add(mesh);
                return mesh;
            });
        }
        const p0 = sim.player;
        const playerRig = rigKit.build(playerModel, { scale: C.models.playerScale, equipment: equipmentModels.forLoadout(p0.loadout) });
        const playerMeshes = rigMeshes(playerRig);
        let lastFacing = p0.facing, lean = 0, clock = 0;

        function placeCamera(x, y, z) {
            const cam = C.camera, fit = Math.max(1, 1.05 / camera.aspect), d = cam.distance * fit, cp = Math.cos(cam.pitch);
            const tx0 = x, ty0 = y + cam.lookHeight, tz0 = z;
            camera.position.set(tx0 + Math.sin(cam.yaw) * cp * d, ty0 + Math.sin(cam.pitch) * d, tz0 + Math.cos(cam.yaw) * cp * d);
            camera.lookAt(tx0, ty0, tz0);
        }
        // `body` is the player as shown: by default the simulation's own,
        // or a blend between two steps (ui/app.js).
        function render(sim, frameSeconds, body = sim.player) {
            const p = body, dt = Math.max(1e-3, frameSeconds);
            clock += frameSeconds;
            const omega = space.wrapAngle(p.facing - lastFacing) / dt;
            lastFacing = p.facing;
            const leanTarget = Math.max(-0.12, Math.min(0.12, 0.015 * omega)) * p.moveBlend;
            lean += (leanTarget - lean) * Math.min(1, frameSeconds * 10);
            const pose = playerAnim.present(playerAnim.pose(playerRig, p), p, { time: clock, lean });
            const at = space.toBlocks(p.x, p.y, p.h), solved = rigKit.solve(playerRig, pose, at, space.yawOf(p.facing));
            playerMeshes.forEach((mesh, i) => { mesh.matrix.fromArray(solved.parts[i]); mesh.matrixWorldNeedsUpdate = true; });
            placeCamera(at[0], at[1], at[2]);
            placeSun(at[0], at[1], at[2]);
            renderer.render(scene, camera);
        }
        function resize(width, height) {
            if (!width || !height) return;
            renderer.setSize(width, height, false);
            camera.aspect = width / height; camera.updateProjectionMatrix();
        }
        return { render, resize, info: () => renderer.info.render, renderer, scene, camera, playerRig };
    }
    return { create };
})();
