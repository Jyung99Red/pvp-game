// three.js view of the simulation. It only draws: positions come from the
// sim and every character box's matrix comes from core/rig.js, so what is
// drawn is exactly what hit tests use (design.md 2.5). The
// renderer and camera live as long as the page; the scene is built per
// world (`load`), so switching maps or restarting needs no reload.
const worldView = (() => {
    const UP = [0, 1, 0];
    // Lighting by look: the sky's (hemisphere) and the sun's (or the
    // moon's) intensity, their colours (palette names: the sky's light,
    // the light off the ground, the sun, and the fog far off), fog start
    // and end past the camera distance (blocks), the torch's intensity, and
    // how dark the sun's shadows are (1 full). By day the sun is warm and
    // the sky's light cool, so what lies in shadow turns a little blue
    // (user, 2026-10-04). The looks follow the time of day (core/daytime.js,
    // day.looks); `dawn` is sunrise and sunset, the base's old morning light
    // (user, 2026-10-06). At night the moon's light is enough to see by out
    // of doors (user). A dark region stays `dark` whatever the hour: its
    // sky's light is enough to make out the walls and the way, and no more
    // (user, 2026-10-06: nobody gets lost there without a torch; it was
    // 0.05, all black, then 0.4). `bodies`: what the sky's light, and what
    // the ground gives back of it, does on every body but this phone's own
    // fighter: [the share of it they take, how far their colours go to
    // grey in it]. In the dark a goblin's green stood out of the gloom, a
    // grey wolf did not (user, 2026-10-06): there colours fade, as they do
    // to the eye; a torch's light brings them back.
    const LIGHT = {
        day: { sky: 1.9, sun: 2.7, colors: ['skyCool', 'groundLight', 'sunWarm', 'sky'], fog: [8, 26], torch: 3, shadow: 1, bodies: [1, 0] },
        dawn: { sky: 1.7, sun: 2.9, colors: ['skyDawn', 'groundDawn', 'sunDawn', 'skyDawnBack'], fog: [8, 26], torch: 3, shadow: 1, bodies: [1, 0] },
        grey: { sky: 2.2, sun: 2.0, colors: ['skyGrey', 'groundGrey', 'sunGrey', 'skyGreyBack'], fog: [8, 26], torch: 3, shadow: 1, bodies: [1, 0] },
        night: { sky: 1.1, sun: 0.9, colors: ['skyNight', 'groundNight', 'moon', 'skyNightBack'], fog: [6, 22], torch: 6, shadow: 0.7, bodies: [1, 0] },
        dark: { sky: 0.3, sun: 0.03, colors: ['skyLight', 'groundLight', 'sun', 'darkSky'], fog: [1, 9], torch: 9, shadow: 1, bodies: [1, 0.8] }
    };
    // A region whose day looks other than `day`: grey among the rocks.
    const LOOK = { valley: 'grey' };
    // The sun's direction moves on in steps of this many hours (its shadow
    // map is snapped to whole texels, and a light turning every frame
    // would make the shadows' edges crawl).
    const SUN_STEP = 0.05;
    // A torch lights `reach` blocks round it. Its shadows (graphics.
    // quality's torchShadow) are the torch's own, cast by blocks and bodies
    // alike; `bias` keeps a face from shadowing itself. Their edge is soft
    // (user, 2026-10-06): blurred over `soft` radians as seen from the
    // light, in the quality's torchTaps samples.
    // Its light is not on the flame, which a swing pokes into a monster's
    // body, the shadows then turning all about (user, 2026-10-06), but
    // near its bearer: `follow` of the way from a point `height` blocks up
    // the bearer's middle to the flame, so the hand's movement still shows
    // a little, eased at `ease` a second; and, as for walls, short of
    // anyone else's body (`clear` blocks wider than it) on the way out.
    const TORCH = { reach: 7, decay: 1.2, bias: -0.004, normalBias: 0.02, soft: 0.03, follow: 0.35, height: 1.45, ease: 14, clear: 0.12 };
    // A burning thicket's light: the flames' colour, flickering.
    const FIRE = { intensity: 4, reach: 5, decay: 1.4, height: 0.8 };
    // How soft the edge of the sun's shadows is, blocks: the reach of the
    // shadow filter, the same on a small shadow map as on a large one
    // (user, 2026-10-04: soft, like the shade of sight).
    const SUN_SOFT = 0.1;
    // The engine's soft shadows take five samples in a disc that noise
    // turns from pixel to pixel; on a large shadow map (SUN_WIDE texels
    // or more) that disc is many texels wide and the five show as grain.
    // There, SUN_TAPS samples of the same disc are taken instead (a small
    // map keeps the engine's five: its disc is narrow, and phones are
    // spared the cost). The map's size is the light's own, so the choice
    // follows a change of picture quality with no new shader. The
    // engine's shader is patched before any material is compiled; a
    // three.js whose shader reads otherwise is left as it is.
    const SUN_TAPS = 12, SUN_WIDE = 2048, SUN_LARGEST = 4096;
    function smoothShadows(T) {
        const chunk = T.ShaderChunk.shadowmap_pars_fragment, from = chunk.indexOf('shadow = ('), end = ') * 0.2;', to = chunk.indexOf(end, from);
        if (from < 0 || to < 0 || !chunk.slice(from, to).includes('vogelDiskSample( 4, 5, phi )') || !chunk.includes('vec2 shadowMapSize')) return;
        T.ShaderChunk.shadowmap_pars_fragment = `${chunk.slice(0, from)}shadow = 0.0;
int taps = shadowMapSize.x >= ${SUN_WIDE}.0 ? ${SUN_TAPS} : 5;
for ( int k = 0; k < ${SUN_TAPS}; k ++ ) {
    if ( k >= taps ) break;
    shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( k, taps, phi ) * radius, shadowCoord.z ) );
}
shadow /= float( taps );${chunk.slice(to + end.length)}`;
    }
    // The engine's point light shadows take five samples; `taps` samples
    // of the same disc are taken instead, or a soft edge shows as grain.
    // Patched before any material is compiled; a three.js whose shader
    // reads otherwise is left as it is.
    function softTorchShadows(T, taps) {
        const chunk = T.ShaderChunk.shadowmap_pars_fragment, start = 'vec2 sample0 = vogelDiskSample( 0, 5, phi );', end = ') * 0.2;';
        const from = chunk.indexOf(start), to = chunk.indexOf(end, from);
        if (from < 0 || to < 0 || !chunk.slice(from, to).includes('bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize')) return;
        T.ShaderChunk.shadowmap_pars_fragment = `${chunk.slice(0, from)}shadow = 0.0;
for ( int k = 0; k < ${taps}; k ++ ) {
    vec2 s = vogelDiskSample( k, ${taps}, phi );
    shadow += texture( shadowMap, vec4( bd3D + ( tangent * s.x + bitangent * s.y ) * texelSize, dp ) );
}
shadow /= ${taps}.0;${chunk.slice(to + end.length)}`;
    }
    // The light probes (render/terrain_light.js) worked out at each corner
    // of a face instead of at each of its pixels: the engine reads seven
    // texels of their 3D texture a pixel, and what they give back changes
    // slowly (a probe every two blocks), so a face's corners (a block
    // apart) hold it well enough, for far less (graphics.quality's
    // `bounce`). The engine's own reading goes into the vertex
    // shader of every lit material and hands its result on. The engine
    // tells only the fragment shader whether there are probes, so the
    // vertex shader always reads them (with none, an empty texture, and
    // the fragment shader does not take it). A three.js whose shaders
    // read otherwise keeps reading per pixel.
    function probesByVertex(T) {
        const S = T.ShaderChunk, read = S.lightprobes_pars_fragment, light = S.lights_fragment_begin, guard = '#ifdef USE_LIGHT_PROBES_GRID';
        const from = light.indexOf(guard), to = light.indexOf('#endif', from);
        if (from < 0 || to < 0 || !read.trim().startsWith(guard) || !read.trim().endsWith('#endif') || !read.includes('vec3 getLightProbeGridIrradiance(') || !S.shadowmap_vertex.includes('vec4 shadowWorldPosition;')) return;
        const unguarded = read.trim().slice(guard.length, -'#endif'.length);
        S.lights_fragment_begin = `${light.slice(0, from)}#ifdef USE_LIGHT_PROBES_GRID
		irradiance += vProbeIrradiance;
	${light.slice(to)}`;
        S.lightprobes_pars_fragment = `${read}
#ifdef USE_LIGHT_PROBES_GRID
varying vec3 vProbeIrradiance;
#endif`;
        S.shadowmap_pars_vertex = `${S.shadowmap_pars_vertex}
${unguarded}
varying vec3 vProbeIrradiance;`;
        S.shadowmap_vertex = `${S.shadowmap_vertex}
{
	vec4 probeAt = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		probeAt = batchingMatrix * probeAt;
	#endif
	#ifdef USE_INSTANCING
		probeAt = instanceMatrix * probeAt;
	#endif
	#ifdef HAS_NORMAL
		vProbeIrradiance = getLightProbeGridIrradiance( ( modelMatrix * probeAt ).xyz, transformNormalByInverseViewMatrix( transformedNormal, viewMatrix ) );
	#else
		vProbeIrradiance = getLightProbeGridIrradiance( ( modelMatrix * probeAt ).xyz, vec3( 0.0, 1.0, 0.0 ) );
	#endif
}`;
    }
    // The engine's shaders as they came, patched afresh for the quality's
    // shader-deep settings (torch shadow samples, probes by vertex): every
    // material compiled from then on reads them.
    const CHUNKS = ['shadowmap_pars_fragment', 'lights_fragment_begin', 'lightprobes_pars_fragment', 'shadowmap_pars_vertex', 'shadowmap_vertex'];
    let pristine = null;
    function patchShaders(T, { torchTaps, bounce }) {
        pristine ??= Object.fromEntries(CHUNKS.map(k => [k, T.ShaderChunk[k]]));
        Object.assign(T.ShaderChunk, pristine);
        smoothShadows(T);
        softTorchShadows(T, torchTaps);
        if (bounce) probesByVertex(T);
    }
    // What every character's material reads each frame, both uniforms
    // ({ value }), so the shader is one and the same for them all:
    // `ghost`: a fighter a ring of stealth hides (fighterKit.hidden; user,
    // 2026-10-06) is drawn thinned out, GHOST of its pixels left out in the
    // pattern of the camera's cut (render/terrain_mesh.js). Nothing is
    // blended, so nothing needs sorting and its shadow stays.
    // `sky` (a vector: LIGHT's `bodies`): the share it takes of the sky's
    // light and of the ground's bounce, and how far its colours go to grey
    // in that light; the lights that shine on it -- the sun, a torch, a
    // fire -- it takes whole and in colour.
    // Drawn only: the body is hit as ever.
    const GHOST = 0.4;
    function embodied(material, ghost, sky) {
        material.onBeforeCompile = shader => {
            shader.uniforms.ghost = ghost; shader.uniforms.bodySky = sky;
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
uniform float ghost; uniform vec2 bodySky;
float ghostDither(vec2 p) {
    const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
    ivec2 i = ivec2(mod(p, 4.0));
    return (m[i.x + i.y * 4] + 0.5) / 16.0;
}`)
                .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (ghost > ghostDither(gl_FragCoord.xy)) discard;`)
                .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722))), bodySky.y) * bodySky.x;`);
        };
        return material;
    }
    // Block light (render/terrain_light.js; user, 2026-10-06): how many
    // cells a torch's, a burning thicket's and a doorway's light spreads
    // round corners, how bright a doorway's is against a torch's, and how
    // bright it is at its source for each unit of a torch's intensity
    // now (`power`). It is worked out again only when a source has moved
    // a cell or changed. `power` was 0.16: that filled the shadow of a
    // monster three cells from the torch (user, 2026-10-06).
    const GLOW = { torch: 8, fire: 6, doorway: 7, door: 0.5, power: 0.05 };
    // How much of the light the ground and the walls are lit by they give
    // back onto what is near (light probes; user, 2026-10-06).
    const BOUNCE = 0.7;
    // How bright the sky a pond gives back is (the sky's own colour, paler
    // low down), for each unit of the sky's light.
    const WATER_SKY = 0.5;
    // In a dark region a little daylight comes in by each portal: a soft
    // light `inside` blocks in from it, so the dark does not shut at the
    // doorway (user, 2026-10-03). At night it is the moon's, `night` as
    // bright.
    const DOORWAY = { intensity: 4, reach: 6, decay: 1.4, inside: 1, height: 1.6, night: 0.4 };
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
            patchShaders(T, built);
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

    // The mist under a map with a cliff: sheets of the sky's colour, `step`
    // blocks one under another.
    const MIST = { layers: 4, step: 0.9, opacity: 0.42 };
    // ---- one world: scene, terrain, characters, effects ----
    function build(T, renderer, sim, camera, selfId, tune) {
        const C = gameConfig, P = palette, U = C.world.unitsPerBlock;
        // A dark region (design.md 2.5) has no daylight to speak of:
        // dim sky light, no sun shadows, black fog close in; a torch is the
        // light there. Anywhere else the light is the hour's (`daylight`).
        const dark = !!C.maps[sim.region]?.dark, dayLook = LOOK[sim.region] || 'day';
        const lookOf = name => LIGHT[dark ? 'dark' : name === 'day' ? dayLook : name];
        // The light now, a blend of two looks: intensities, the four
        // colours, fog, the torch, the shadows' darkness; `outside`, how
        // much of it is day (0 at night), for the light at a cave's doors.
        const now = { sky: 0, sun: 0, fog: [0, 0], torch: 0, shadow: 1, bodies: [1, 0], outside: 1, colors: [0, 1, 2, 3].map(() => new T.Color()) };
        const other = new T.Color();
        function blend(hour) {
            const l = dayKit.look(hour), a = lookOf(l.from), b = lookOf(l.to), u = l.mix, mix = (p, q) => p + (q - p) * u;
            for (const k of ['sky', 'sun', 'torch', 'shadow']) now[k] = mix(a[k], b[k]);
            for (const k of ['fog', 'bodies']) { now[k][0] = mix(a[k][0], b[k][0]); now[k][1] = mix(a[k][1], b[k][1]); }
            now.colors.forEach((c, i) => c.set(P[a.colors[i]]).lerp(other.set(P[b.colors[i]]), u));
            now.outside = mix(l.from === 'night' ? 0 : 1, l.to === 'night' ? 0 : 1);
        }
        blend(dayKit.hourOf(sim, tune.hourShift));
        const scene = new T.Scene(), sky = now.colors[3].clone();
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
        // what is seen past the map.
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
        const ground = terrainMesh.create(T, scene, sim, tx, { probes: tune.built.bounce });
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
            const skirt = new T.Mesh(sheets, terrainMesh.shadeUnseen(lambert(null, top), ground.sight));
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
        // What casts no shadow in point lights: writes nothing.
        const shunned = new T.MeshDistanceMaterial({ depthWrite: false, colorWrite: false });
        const pad = C.combat.weaponPad / U, colour = new T.Color();
        // `look` swaps palette colours by name (playerModel.looks). `ghost`
        // and `sky` are what its materials read (`embodied`): none of it
        // left out, and the sky's light as the look has it on bodies,
        // unless told.
        const solid = { value: 0 }, whole = { value: new T.Vector2(1, 0) }, dimmed = { value: new T.Vector2(1, 0) };
        function character(rig, apart = () => false, look = {}, { ghost = solid, sky = dimmed } = {}) {
            const thin = made => embodied(made, ghost, sky);
            const material = thin(new T.MeshLambertMaterial({ map: tx.grain, vertexColors: true }));
            const pos = [], nor = [], uv = [], col = [], skin = [], weight = [], index = [], bones = [], boned = [], loose = [], lines = [];
            rig.parts.forEach((part, i) => {
                const name = look[part.color] || part.color;
                if (!P[name]) throw new Error(`Unknown palette colour ${name}`);
                const g = boxGeo(...part.size);
                if (apart(part)) {
                    const mesh = new T.Mesh(g, thin(new T.MeshLambertMaterial({ color: P[name], map: tx.grain })));
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
                // Cast no shadow in a torch's light (its bearer's own body
                // would shade all in front of it); the sun's still.
                shunTorch() { for (const m of [mesh, ...loose.map(l => l.mesh)]) m.customDistanceMaterial = shunned; },
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
        // (This phone's own fighter takes the sky's light whole and in
        // colour: in the dark it is still to be found.)
        const rigOf = id => sim.rigs.fighters[id], playerRig = rigOf(selfId) || rigOf(sim.fighters[0].id);
        const fighters = new Map(sim.fighters.map(f => {
            const ghost = { value: 0 }, own = f.id === selfId;
            return [f.id, {
                rig: rigOf(f.id), ghost,
                view: character(rigOf(f.id), part => part.kind === 'weapon' || part.tag === 'flame', { ...equipmentModels.lookOf(f.loadout), ...(own ? {} : playerModel.looks.rival) }, { ghost, sky: own ? whole : dimmed }),
                lastFacing: f.facing, lean: 0
            }];
        }));
        fighters.get(selfId)?.view.shunTorch();
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

        // ---- ground masks: a fan of rays (terrainKit.sightFan) drawn from
        // straight above into a small texture, north up, and blurred along
        // and then across: white where the rays do not reach, soft at the
        // edge. `size` texels across the `2 * half` blocks round its middle.
        // The shade of sight is drawn with one. ----
        const BLUR = 1.1;
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
        const masks = [];
        function fanMask(size, half) {
            const geo = new T.BufferGeometry(), out = half * 1.5;
            let pos = null;
            const fanMesh = new T.Mesh(geo, new T.MeshBasicMaterial({ color: '#ffffff', side: T.DoubleSide, fog: false }));
            fanMesh.frustumCulled = false;
            const above = new T.Scene(), eye = new T.OrthographicCamera(-half, half, half, -half, 0, 10);
            above.background = new T.Color('#000000'); above.add(fanMesh);
            eye.up.set(0, 0, -1); eye.position.set(0, 5, 0); eye.lookAt(0, 0, 0);
            const target = samples => new T.WebGLRenderTarget(size, size, { depthBuffer: false, samples });
            const drawnMask = target(4), blurred = [target(0), target(0)];
            const steps = [[drawnMask, eye, above, null], [blurred[0], flat, pass, [BLUR / size, 0, drawnMask]], [blurred[1], flat, pass, [0, BLUR / size, blurred[0]]]];
            // The fan round (x, z), blocks: between each ray and the next,
            // from where it ends out past the texture's edge.
            function draw(x, z, fan) {
                const n = fan.n;
                if (!pos || pos.length < fan.angle.length * 18) {
                    geo.dispose();
                    pos = new Float32Array(fan.angle.length * 18);
                    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
                }
                for (let i = 0, o = 0; i < n; i++) {
                    const j = (i + 1) % n, c0 = Math.cos(fan.angle[i]), s0 = Math.sin(fan.angle[i]), c1 = Math.cos(fan.angle[j]), s1 = Math.sin(fan.angle[j]);
                    const d0 = fan.reach[i] / U, d1 = fan.reach[j] / U;
                    const nx0 = x + c0 * d0, nz0 = z + s0 * d0, fx0 = x + c0 * out, fz0 = z + s0 * out;
                    const nx1 = x + c1 * d1, nz1 = z + s1 * d1, fx1 = x + c1 * out, fz1 = z + s1 * out;
                    pos[o++] = nx0; pos[o++] = 0; pos[o++] = nz0; pos[o++] = fx0; pos[o++] = 0; pos[o++] = fz0; pos[o++] = fx1; pos[o++] = 0; pos[o++] = fz1;
                    pos[o++] = nx0; pos[o++] = 0; pos[o++] = nz0; pos[o++] = fx1; pos[o++] = 0; pos[o++] = fz1; pos[o++] = nx1; pos[o++] = 0; pos[o++] = nz1;
                }
                geo.setDrawRange(0, n * 6);
                geo.attributes.position.needsUpdate = true;
                eye.position.set(x, 5, z);
                for (const [to, cam, what, from] of steps) {
                    if (from) { blur.uniforms.along.value.set(from[0], from[1]); blur.uniforms.map.value = from[2].texture; }
                    renderer.setRenderTarget(to); renderer.render(what, cam);
                }
                renderer.setRenderTarget(null);
            }
            const mask = { texture: blurred[1].texture, half, out, draw, dispose() { geo.dispose(); fanMesh.material.dispose(); for (const one of [drawnMask, ...blurred]) one.dispose(); } };
            masks.push(mask);
            return mask;
        }

        // ---- sight: what this fighter cannot see is shaded; walls at least
        // eye high cast the shade, and so does everything outside the front
        // arc it sees (player.sightAngle) but for a small ring round it
        // (player.sightNear; user, 2026-10-04). The same in the adventure
        // and in a duel (user, 2026-10-04). The edge of sight comes exact
        // from the terrain (terrainKit.sightFan: rays past every wall
        // corner), so it slides evenly as the fighter walks; an even spread
        // of rays stepped along left the edge jumping from one ray to the
        // next. Sight is worked out as far as `SIGHT_FAR` blocks, which is
        // past the screen's edge; past the mask the shade takes the mask's
        // edge, which is past sight and so all shade.
        //
        // The shade's edge is soft (user, 2026-10-04; drawing only, what is
        // seen is decided as before): its mask is how far the terrain's
        // material goes towards `SHADE.color` (render/terrain_mesh.js),
        // `opacity` of the way at most. It is in the material, not a dark
        // sheet over the ground, so that what stands on the ground --
        // blocks, plants, stones -- goes dark with it (user, 2026-10-05). ----
        const SIGHT_FAR = 20, MASK = 256, SHADE = { color: [5, 7, 13], opacity: 0.48 };
        const shade = (() => {
            const mask = fanMask(MASK, SIGHT_FAR), fan = { n: 0, angle: new Float64Array(0), reach: new Float64Array(0) };
            ground.sight.mask.value = mask.texture; ground.sight.at.value.set(0, 0, mask.half);
            ground.sight.tone.value.set(...SHADE.color.map(v => v / 255), SHADE.opacity);
            let lastX = NaN, lastZ = NaN, lastFacing = NaN, lastRev = -1;
            // Recast only when the fighter has moved or turned (or the terrain changed).
            function update(x, z, facing) {
                if (x === lastX && z === lastZ && facing === lastFacing && lastRev === t.rev) return;
                lastX = x; lastZ = z; lastFacing = facing; lastRev = t.rev;
                terrainKit.sightFan(t, x * U, z * U, SIGHT_FAR * U, { facing, half: C.player.sightAngle, near: C.player.sightNear, out: fan });
                ground.sight.at.value.set(x, z, mask.half);
                mask.draw(x, z, fan);
            }
            return { update };
        })();

        // Each torch's light's way out from its bearer towards the flame, eased (TORCH).
        const torchOffsets = new Map();
        const bounceLight = [0, 0, 0];
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
            // The hour's light.
            const hour = dayKit.hourOf(current, tune.hourShift);
            daylight(hour);
            dimmed.value.set(now.bodies[0], now.bodies[1]);
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
            const door = DOORWAY.night + (1 - DOORWAY.night) * now.outside;
            for (const at of doorways) {
                const color = other.set(P.moon).lerp(glowColour.set(P.skyLight), now.outside).getHex();
                glowing.push({ at, color, intensity: DOORWAY.intensity * door, reach: DOORWAY.reach, decay: DOORWAY.decay });
                glows.push({ at, reach: GLOW.doorway, rgb: rgbOf(color, GLOW.door * door) });
            }
            kindle(glowing, me);
            ground.glow(glows, now.torch * GLOW.power);
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
            ground.dispose();
            for (const mask of masks) mask.dispose();
            blur.dispose(); full.geometry.dispose();
            // The shadow map is the light's own render target.
            sun.dispose(); torchLight.dispose();
            for (const light of pool) light.dispose();
            shunned.dispose();
        }
        retune();
        return { scene, render, dispose, retune, playerRig, seen, ground };
    }
    return { create };
})();
