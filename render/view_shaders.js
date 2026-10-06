// The world view's changes to three.js shader text (render/world_view.js):
// the sun's and the torch's soft shadows with more samples, the light
// probes read at a face's corners, and what every character's material
// reads (the ghost of a hidden fighter, the fade of colours). Drawing only.
const viewShaders = (() => {
    // The engine's soft shadows take five samples in a disc that noise
    // turns from pixel to pixel; on a large shadow map (SUN_WIDE texels
    // or more) that disc is many texels wide and the five show as grain.
    // There, SUN_TAPS samples of the same disc are taken instead (a small
    // map keeps the engine's five: its disc is narrow, and phones are
    // spared the cost). The map's size is the light's own, so the choice
    // follows a change of picture quality with no new shader. The
    // engine's shader is patched before any material is compiled; a
    // three.js whose shader reads otherwise is left as it is.
    const SUN_TAPS = 12, SUN_WIDE = 2048;
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
    // 2026-10-06) is drawn thinned out, graphics.ghost of its pixels left out in the
    // pattern of the camera's cut (render/terrain_mesh.js). Nothing is
    // blended, so nothing needs sorting and its shadow stays.
    // `fade`: how far its colours go to grey in the natural light (the look's
    // `fade`; render/terrain_mesh.js `fadeLight`).
    // Drawn only: the body is hit as ever.
    function embodied(T, material, ghost, fade) {
        material.onBeforeCompile = shader => {
            shader.uniforms.ghost = ghost;
            terrainMesh.fadeLight(T, shader, fade);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
uniform float ghost;
float ghostDither(vec2 p) {
    const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
    ivec2 i = ivec2(mod(p, 4.0));
    return (m[i.x + i.y * 4] + 0.5) / 16.0;
}`)
                .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (ghost > ghostDither(gl_FragCoord.xy)) discard;`);
        };
        return material;
    }
    return { patchShaders, embodied };
})();
