// The world's light and the time of day (render/world_view.js): the sky's
// light, the sun (or the moon) where the hour puts it and its shadows, the
// torch's light and its shadows, the moving lights (a torch that stands in
// the map is one), the light at a cave's doors; each frame, the hour's
// light on everything, what the ground gives back, the ponds' sky, where
// the torch's light goes and what gives block light. Drawing only.
const viewLight = (() => {
    const UP = [0, 1, 0];
    // The picture's tunable numbers are game_config.js `graphics` (what
    // each is for is written there): the looks' light, a region's own day
    // look, the sun's steps and soft edge, the torch, a fire, a torch that
    // stands in the map, a doorway, block light, bounce, the ponds' sky.
    const {
        looks: LIGHT, dayLook: LOOK, sunStep: SUN_STEP, sunSoft: SUN_SOFT, torch: TORCH, fire: FIRE, lamp: LAMP, doorway: DOORWAY,
        glow: GLOW, bounce: BOUNCE, waterSky: WATER_SKY
    } = gameConfig.graphics;
    // Is the point (blocks) inside a block of the terrain (or off the map)?
    function inBlock(t, [x, y, z]) {
        const c = Math.floor(x), r = Math.floor(z);
        return !terrainKit.inside(t, c, r) || (terrainKit.solidAt(t, c, r) && y < terrainKit.levelAt(t, c, r));
    }
    // Is the point inside one of `bodies` ([x, z, radius, top], blocks: upright cylinders)?
    const inBody = (bodies, [x, y, z]) => bodies.some(([bx, bz, r, top]) => y < top && (x - bx) ** 2 + (z - bz) ** 2 < r * r);
    // The last point going from `from` to `to` that is not inside a block
    // (or one of `bodies`).
    function clearOf(t, from, to, bodies = [], steps = 12) {
        let last = from;
        for (let k = 1; k <= steps; k++) {
            const at = from.map((v, i) => v + (to[i] - v) * k / steps);
            if (inBlock(t, at) || inBody(bodies, at)) break;
            last = at;
        }
        return last;
    }

    // `stage`: what the world's parts share (render/world_view.js `build`).
    function create({ T, scene, sim, selfId, tune, dark, ground }) {
        const C = gameConfig, P = palette, U = C.world.unitsPerBlock;
        // A dark region's light is the `dark` look at every hour.
        const dayLook = LOOK[sim.region] || 'day';
        const lookOf = name => LIGHT[dark ? 'dark' : name === 'day' ? dayLook : name];
        // The light now, a blend of two looks: intensities, the four
        // colours, fog, the torch, the shadows' darkness; `outside`, how
        // much of it is day (0 at night), for the light at a cave's doors.
        const now = { sky: 0, sun: 0, fog: [0, 0], torch: 0, shadow: 1, fade: [0, 0], outside: 1, colors: [0, 1, 2, 3].map(() => new T.Color()) };
        const other = new T.Color();
        function blend(hour) {
            const l = dayKit.look(hour), a = lookOf(l.from), b = lookOf(l.to), u = l.mix, mix = (p, q) => p + (q - p) * u;
            for (const k of ['sky', 'sun', 'torch', 'shadow']) now[k] = mix(a[k], b[k]);
            for (const k of ['fog', 'fade']) { now[k][0] = mix(a[k][0], b[k][0]); now[k][1] = mix(a[k][1], b[k][1]); }
            now.colors.forEach((c, i) => c.set(P[a.colors[i]]).lerp(other.set(P[b.colors[i]]), u));
            now.outside = mix(l.from === 'night' ? 0 : 1, l.to === 'night' ? 0 : 1);
        }
        blend(dayKit.hourOf(sim, tune.hourShift));
        const sky = now.colors[3].clone();
        scene.background = sky;
        scene.fog = new T.Fog(sky, C.camera.distance + now.fog[0], C.camera.distance + now.fog[1]);
        // The shadows' maps follow the menu's settings. The torch's keep
        // its light from passing walls (user, 2026-10-06). A shadow map of
        // a new size is made anew on the next frame.
        function retune() {
            sun.castShadow = !dark;
            const resize = (shadow, size) => {
                if (shadow.mapSize.x === size) return false;
                shadow.mapSize.set(size, size);
                if (shadow.map) { shadow.map.dispose(); shadow.map = null; }
                return true;
            };
            if (resize(sun.shadow, tune.sunMap)) {
                texel = 2 * extent / tune.sunMap;
                sun.shadow.radius = Math.max(1, SUN_SOFT / texel);
            }
            if (resize(torchLight.shadow, tune.torchMap)) torchLight.shadow.radius = TORCH.soft * tune.torchMap;
        }

        const hemisphere = new T.HemisphereLight(now.colors[0], now.colors[1], now.sky);
        scene.add(hemisphere);
        const sun = new T.DirectionalLight(now.colors[2], now.sun), extent = C.graphics.shadowExtent;
        // The torch's light: always there (lights coming and going would
        // rebuild every shader), at zero while no torch burns, its shadow
        // map then not redrawn. Then the moving lights without shadows
        // (graphics.lights): each frame they go to the nearest of what
        // gives light -- a burning thicket, a doorway's glow, someone
        // else's torch -- and the rest of them are at zero.
        // (Its shadow map's size and softness: `retune`.)
        const torchLight = new T.PointLight(P.flame, 0, TORCH.reach, TORCH.decay);
        torchLight.castShadow = true;
        Object.assign(torchLight.shadow.camera, { near: 0.05, far: TORCH.reach });
        torchLight.shadow.bias = TORCH.bias; torchLight.shadow.normalBias = TORCH.normalBias;
        scene.add(torchLight);
        const pool = Array.from({ length: C.graphics.lights }, () => {
            const light = new T.PointLight('#ffffff', 0, 1, 1);
            scene.add(light);
            return light;
        });
        const glowColour = new T.Color();
        // The nearest of `glowing` ({ at: [x, y, z], color, intensity,
        // reach, decay }, blocks) to `me` get the moving lights.
        function kindle(glowing, me) {
            const [x, , z] = space.toBlocks(me.x, me.y, me.h), far = g => (g.at[0] - x) ** 2 + (g.at[2] - z) ** 2;
            glowing.sort((a, b) => far(a) - far(b));
            pool.forEach((light, i) => {
                const g = glowing[i];
                if (!g) { light.intensity = 0; return; }
                light.position.set(...g.at); light.color.set(g.color);
                light.intensity = g.intensity; light.distance = g.reach; light.decay = g.decay;
            });
        }
        const doorways = dark ? sim.entities.filter(e => e.type === 'portal').map(e => space.toBlocks(e.x + Math.cos(e.facing) * DOORWAY.inside * U, e.y + Math.sin(e.facing) * DOORWAY.inside * U, 0)).map(([x, , z]) => [x, DOORWAY.height, z]) : [];
        Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 60 });
        sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
        scene.add(sun, sun.target);
        // The sun (or the moon) goes where the hour puts it (dayKit.sky);
        // its shadow box follows the player, snapped to whole shadow texels
        // in the light's frame so edges do not shimmer while walking.
        const lightDir = new T.Vector3(), lightRight = new T.Vector3(), lightUp = new T.Vector3(), upward = new T.Vector3(...UP);
        let aimedAt = NaN;
        function aim(hour) {
            const stepped = Math.round(hour / SUN_STEP) * SUN_STEP;
            if (stepped === aimedAt) return;
            aimedAt = stepped;
            lightDir.set(...dayKit.sky(stepped).dir);
            lightRight.crossVectors(upward, lightDir).normalize();
            lightUp.crossVectors(lightDir, lightRight);
        }
        // One texel of the sun's shadow map, blocks (`retune`).
        let texel = 1;
        const focus = new T.Vector3();
        function placeSun(x, y, z) {
            focus.set(x, y, z);
            const u = Math.round(focus.dot(lightRight) / texel) * texel, v = Math.round(focus.dot(lightUp) / texel) * texel, w = focus.dot(lightDir);
            sun.target.position.copy(lightRight).multiplyScalar(u).addScaledVector(lightUp, v).addScaledVector(lightDir, w);
            sun.position.copy(sun.target.position).addScaledVector(lightDir, 25);
        }
        // The hour's light on everything: the sky's, the sun's or the moon's
        // (fading in after it rises and out before it sets), the fog and
        // what is seen past the map (`mists`: the materials of the mist
        // under a map with a cliff, render/world_view.js).
        const mists = [];
        function daylight(hour) {
            blend(hour);
            aim(hour);
            hemisphere.color.copy(now.colors[0]); hemisphere.groundColor.copy(now.colors[1]); hemisphere.intensity = now.sky;
            sun.color.copy(now.colors[2]); sun.intensity = now.sun * (dark ? 1 : dayKit.sky(hour).fade);
            sun.shadow.intensity = now.shadow;
            sky.copy(now.colors[3]); scene.fog.color.copy(sky);
            for (const m of mists) m.color.copy(sky);
            const d = C.camera.distance * tune.zoom;
            scene.fog.near = d + now.fog[0]; scene.fog.far = d + now.fog[1];
        }

        // Each torch's light's way out from its bearer towards the flame, eased (TORCH).
        const torchOffsets = new Map();
        const bounceLight = [0, 0, 0];
        // Each frame: the hour's light, what the ground gives back, the
        // ponds' sky, the torch's light and the moving lights, block light.
        // `drawn`: the fighters drawn this frame (render/world_view.js);
        // `shownOf`: a body as shown; `lamps`: where the torches that stand
        // in the map have their light (render/lamp_view.js `lights`).
        function frame(current, { me, drawn, shownOf, clock, frameSeconds, lamps = [] }) {
            // The hour's light.
            const hour = dayKit.hourOf(current, tune.hourShift);
            daylight(hour);
            // The ground and the walls give back the hour's light, their
            // colour (render/terrain_light.js, the probes): the sky's and
            // the sun's (or the moon's) as it falls on open ground.
            const up = Math.max(0, lightDir.y);
            bounceLight[0] = (hemisphere.color.r * hemisphere.intensity + sun.color.r * sun.intensity * up) * BOUNCE;
            bounceLight[1] = (hemisphere.color.g * hemisphere.intensity + sun.color.g * sun.intensity * up) * BOUNCE;
            bounceLight[2] = (hemisphere.color.b * hemisphere.intensity + sun.color.b * sun.intensity * up) * BOUNCE;
            ground.bounce(bounceLight);
            // The ponds give back the sky as the hour lights it, and ripple.
            ground.water.time.value = clock;
            ground.water.sky.value.copy(now.colors[3]).multiplyScalar(now.sky * WATER_SKY);
            ground.water.horizon.value.copy(now.colors[3]).lerp(now.colors[0], 0.5).multiplyScalar(now.sky * WATER_SKY);
            // The torch light: near this fighter, a little towards its
            // flame (TORCH), flickering a little -- short of any block or
            // body the flame pokes into, or the light would be shut inside
            // it (a wall's near side would go dark, a monster's shadow turn
            // all about). Anyone else's burning torch is one of the moving
            // lights.
            const flicker = k => 1 + 0.08 * Math.sin(clock * 13 + k) + 0.05 * Math.sin(clock * 23.7 + 2 * k);
            const standing = [];
            const stand = (b, top) => { const [x, , z] = space.toBlocks(b.x, b.y); standing.push([x, z, b.radius / U + TORCH.clear, top]); };
            for (const d of drawn) stand(d.shown, 1.9);
            if (current.dummy) stand(current.dummy, 1.95);
            for (const m of current.monsters) if (m.phase !== 'dead') stand(shownOf(m), monsterKit.height(m.kind));
            const flameOf = d => {
                const flame = d.rig.parts.findIndex(part => part.tag === 'flame'), m = d.solved.parts[flame];
                const base = space.toBlocks(d.shown.x, d.shown.y, d.shown.h);
                base[1] += TORCH.height;
                const want = [m[12] - base[0], m[13] + 0.15 - base[1], m[14] - base[2]].map(v => v * TORCH.follow);
                let off = torchOffsets.get(d.id);
                if (!off) torchOffsets.set(d.id, off = want);
                else for (let i = 0; i < 3; i++) off[i] += (want[i] - off[i]) * Math.min(1, frameSeconds * TORCH.ease);
                const others = standing.filter((_, i) => i >= drawn.length || drawn[i] !== d);
                return clearOf(current.terrain, base, base.map((v, i) => v + off[i]), others);
            };
            const bearer = drawn.find(d => d.id === selfId && d.body.lit);
            if (bearer) {
                torchLight.position.set(...flameOf(bearer));
                torchLight.intensity = now.torch * flicker(0);
            } else torchLight.intensity = 0;
            // (Drawn at least once: a shadow map never drawn is no texture, and nothing lit would draw.)
            torchLight.shadow.autoUpdate = !!bearer || !torchLight.shadow.map;
            const glowing = [];
            // Block light from the same sources, in steps of a tenth.
            const glows = [], tenth = v => Math.round(v * 10) / 10, rgbOf = (color, k) => glowColour.set(color).toArray().map(v => tenth(v * k));
            if (bearer) glows.push({ at: torchLight.position.toArray(), reach: GLOW.torch, rgb: rgbOf(P.flame, 1) });
            for (const d of drawn) if (d.id !== selfId && d.body.lit) {
                const at = flameOf(d);
                glowing.push({ at, color: P.flame, intensity: now.torch * flicker(d.solved.parts.length), reach: TORCH.reach, decay: TORCH.decay });
                glows.push({ at, reach: GLOW.torch, rgb: rgbOf(P.flame, 1) });
            }
            for (const e of current.entities) {
                if (e.type !== 'brush' || e.burning < 0) continue;
                const [x, , z] = space.toBlocks(e.x, e.y), life = Math.max(0, 1 - e.burning / C.props.burnSeconds);
                glowing.push({ at: [x, FIRE.height, z], color: P.flame, intensity: FIRE.intensity * Math.sqrt(life) * flicker(e.col * 3 + e.row), reach: FIRE.reach, decay: FIRE.decay });
                glows.push({ at: [x, FIRE.height, z], reach: GLOW.fire, rgb: rgbOf(P.flame, Math.sqrt(life)) });
            }
            for (const l of lamps) {
                glowing.push({ at: l.at, color: P.flame, intensity: now.torch * LAMP.light * flicker(l.seed), reach: LAMP.reach, decay: LAMP.decay });
                glows.push({ at: l.at, reach: LAMP.glow, rgb: rgbOf(P.flame, LAMP.light) });
            }
            const door = DOORWAY.night + (1 - DOORWAY.night) * now.outside;
            for (const at of doorways) {
                const color = other.set(P.moon).lerp(glowColour.set(P.skyLight), now.outside).getHex();
                glowing.push({ at, color, intensity: DOORWAY.intensity * door, reach: DOORWAY.reach, decay: DOORWAY.decay });
                glows.push({ at, reach: GLOW.doorway, rgb: rgbOf(color, GLOW.door * door) });
            }
            kindle(glowing, me);
            ground.glow(glows, now.torch * GLOW.power);
        }
        // (The shadow maps are the lights' own render targets.)
        function dispose() {
            sun.dispose(); torchLight.dispose();
            for (const light of pool) light.dispose();
        }
        return { now, sky, mists, retune, frame, placeSun, dispose };
    }
    return { create };
})();
