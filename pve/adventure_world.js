// Large-area exploration renderer. It deliberately has no combat rules: it
// only turns a physical enemy/exit overlap into a pveLogic request.
const adventureWorld = (() => {
    let scene = null, canvas = null, ctx = null, abort = null, raf = null, lastAt = 0;
    const keys = new Set();
    const PLAYER_RADIUS = 14, EXIT_RADIUS = 52, PLAYER_SPEED = 185;
    // Arrivals land this far from the return portal -- beyond EXIT_RADIUS so a
    // fresh scene cannot immediately re-trigger the exit and bounce back.
    const ARRIVAL_OFFSET = EXIT_RADIUS + 40;
    // Held-pointer walk stops only inside this radius, so a finger resting on
    // the player does not jitter the actor back and forth.
    const POINTER_DEAD_ZONE = 6;
    // Contact radii, shared by the drawn monster and the fight it enlists into
    // so the sprite does not change size the moment combat starts.
    const MONSTER_RADIUS = 16, BOSS_RADIUS = 25;
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const region = () => content.regions[state.progress.currentRegionId] || null;
    const bossDefeated = id => !!state.progress.defeatedBosses[id];

    // Bearing from a portal away from the map centre. The assumed facing of an
    // unauthored gate, and the only direction whose reverse lands an arrival
    // safely inside the region.
    const _outwardAngle = (def, portal) =>
        Math.atan2(portal.y - def.map.height / 2, portal.x - def.map.width / 2);
    // A gate's facing is the direction it leads (`in`): an authored `angle`
    // wins, otherwise assume it leads out of the region. This single number
    // drives both the drawn arrow and, reversed, where an arrival lands.
    const _portalAngle = (def, exit) =>
        typeof exit.portal.angle === 'number' ? exit.portal.angle : _outwardAngle(def, exit.portal);
    // A point ARRIVAL_OFFSET out from `portal` along `angle`, kept inside the map.
    const _along = (def, portal, angle) => ({
        x: clamp(portal.x + Math.cos(angle) * ARRIVAL_OFFSET, PLAYER_RADIUS, def.map.width - PLAYER_RADIUS),
        y: clamp(portal.y + Math.sin(angle) * ARRIVAL_OFFSET, PLAYER_RADIUS, def.map.height - PLAYER_RADIUS)
    });

    // A return trip comes out on the far side of the gate that leads back and
    // faces into the region: the reverse of that gate's own `in`. Taking the
    // reverse is what keeps an outward-facing gate from spawning arrivals off
    // the edge of the map. A gate authored facing inward would leave the
    // arrival sitting on its own trigger, so fall back to the outward bearing.
    function _spawnPoint(def) {
        const from = state.world.arrivalFrom;
        const exit = from && (def.exits || []).find(item => item.to === from);
        if (!exit) {
            const spawn = def.map.playerSpawn;
            return { x: spawn.x, y: spawn.y, facing: spawn.facing ?? 0 };
        }
        const portal = exit.portal, reverse = _portalAngle(def, exit) + Math.PI;
        const point = _along(def, portal, reverse);
        if (distance(point, portal) < EXIT_RADIUS) {
            const inward = _outwardAngle(def, portal) + Math.PI;
            return { ..._along(def, portal, inward), facing: inward };
        }
        return { ...point, facing: reverse };
    }
    function _makeScene(def) {
        const map = def.map;
        const monsters = (map.monsters || []).filter(item => !item.boss || !bossDefeated(item.enemyId)).map(item => ({
            ...item, home: { x: item.x, y: item.y }, phase: 'idle', alive: true, patrolAt: Math.random() * Math.PI * 2
        }));
        const player = _spawnPoint(def);
        state.world.arrivalFrom = null;   // consumed: only the first build honours it
        return { regionId: def.id, def, map, player, monsters, pointer: null, exitCooldown: .7, notice: '' };
    }
    function _notice(text) {
        if (!scene) return;
        scene.notice = text;
        document.getElementById('adventure-hint').textContent = text || '拖动地图移动。保持距离即可绕过怪物。';
    }
    function _camera() {
        const rect = canvas.getBoundingClientRect();
        return {
            x: clamp(scene.player.x - rect.width / 2, 0, Math.max(0, scene.map.width - rect.width)),
            y: clamp(scene.player.y - rect.height / 2, 0, Math.max(0, scene.map.height - rect.height)),
            width: rect.width, height: rect.height
        };
    }
    // Held in canvas-local pixels, NOT world units. The camera follows the
    // player, so a world-space target goes stale as soon as the player moves
    // and the walk dies at that frozen point; re-deriving it from the current
    // camera each frame is what keeps a held pointer walking continuously.
    function _pointerPoint(event) {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    function _resize() {
        const rect = canvas.getBoundingClientRect(), dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function _attach() {
        abort?.abort(); abort = new AbortController();
        const signal = abort.signal;
        canvas.addEventListener('pointerdown', event => {
            canvas.setPointerCapture?.(event.pointerId); scene.pointer = _pointerPoint(event); event.preventDefault();
        }, { signal });
        canvas.addEventListener('pointermove', event => { if (scene?.pointer) scene.pointer = _pointerPoint(event); }, { signal });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
            canvas.addEventListener(type, () => { if (scene) scene.pointer = null; }, { signal });
        }
        window.addEventListener('keydown', event => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(event.key)) {
                keys.add(event.key); event.preventDefault();
            }
        }, { signal });
        window.addEventListener('keyup', event => keys.delete(event.key), { signal });
        window.addEventListener('resize', _resize, { signal }); _resize();
    }
    function _moveToward(actor, target, speed, dt) {
        const dx = target.x - actor.x, dy = target.y - actor.y, d = Math.hypot(dx, dy);
        if (!d) return;
        const step = Math.min(d, speed * dt); actor.x += dx / d * step; actor.y += dy / d * step;
    }
    function _updatePlayer(dt) {
        let dx = 0, dy = 0;
        if (keys.has('ArrowLeft') || keys.has('a')) dx -= 1;
        if (keys.has('ArrowRight') || keys.has('d')) dx += 1;
        if (keys.has('ArrowUp') || keys.has('w')) dy -= 1;
        if (keys.has('ArrowDown') || keys.has('s')) dy += 1;
        if (dx || dy) {
            const len = Math.hypot(dx, dy); scene.player.x += dx / len * PLAYER_SPEED * dt; scene.player.y += dy / len * PLAYER_SPEED * dt;
            scene.player.facing = Math.atan2(dy, dx);
        } else if (scene.pointer) {
            const cam = _camera();
            const target = { x: cam.x + scene.pointer.x, y: cam.y + scene.pointer.y };
            if (distance(scene.player, target) > POINTER_DEAD_ZONE) {
                // Facing reads off the pre-move heading, so the notch points
                // where the walk is going rather than where it just came from.
                scene.player.facing = Math.atan2(target.y - scene.player.y, target.x - scene.player.x);
                _moveToward(scene.player, target, PLAYER_SPEED, dt);
            }
        }
        scene.player.x = clamp(scene.player.x, PLAYER_RADIUS, scene.map.width - PLAYER_RADIUS);
        scene.player.y = clamp(scene.player.y, PLAYER_RADIUS, scene.map.height - PLAYER_RADIUS);
    }
    function _updateMonsters(dt) {
        // Only ever reached while exploring: _loop stops the whole region for the
        // duration of a fight. Anyone already chasing was sent home at enlist.
        for (const monster of scene.monsters) {
            if (!monster.alive || monster.phase === 'engaged') continue;
            const playerDistance = distance(scene.player, monster), homeDistance = distance(monster, monster.home);
            if (monster.phase === 'idle' && playerDistance <= monster.alertRange) monster.phase = 'chase';
            if (monster.phase === 'chase') {
                if (playerDistance <= monster.encounterRange) {
                    monster.phase = 'engaged';
                    if (pveLogic.startEncounter(monster.enemyId, monster.id)) return;
                    monster.phase = 'idle';
                }
                if (homeDistance > monster.leash && playerDistance > monster.alertRange) monster.phase = 'return';
                else _moveToward(monster, scene.player, monster.speed, dt);
            } else if (monster.phase === 'return') {
                _moveToward(monster, monster.home, monster.speed, dt);
                if (distance(monster, monster.home) < 2) monster.phase = 'idle';
            } else if (monster.patrolRadius) {
                monster.patrolAt += dt * .35;
                const target = { x: monster.home.x + Math.cos(monster.patrolAt) * monster.patrolRadius, y: monster.home.y + Math.sin(monster.patrolAt) * monster.patrolRadius * .55 };
                _moveToward(monster, target, monster.speed * .24, dt);
            }
        }
    }
    function _updateExits(dt) {
        scene.exitCooldown = Math.max(0, scene.exitCooldown - dt);
        if (scene.exitCooldown) return;
        for (const exit of scene.def.exits || []) {
            if (distance(scene.player, exit.portal) > EXIT_RADIUS) continue;
            if (exit.requiresBoss && !bossDefeated(exit.requiresBoss)) {
                scene.exitCooldown = .8; _notice('深渊裂隙被巨龙的力量封锁。'); return;
            }
            pveLogic.travel(exit.to); return;
        }
    }
    function _drawWorld(cam) {
        const lava = scene.regionId === 'c' || scene.regionId === 'd';
        ctx.fillStyle = lava ? '#2a211e' : scene.regionId === 'a' ? '#243027' : '#1f2d28';
        ctx.fillRect(0, 0, cam.width, cam.height);
        ctx.strokeStyle = lava ? '#5d3931' : '#3d5448'; ctx.lineWidth = 1;
        for (let x = -cam.x % 100; x < cam.width; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cam.height); ctx.stroke(); }
        for (let y = -cam.y % 100; y < cam.height; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cam.width, y); ctx.stroke(); }
    }
    function _point(point, cam) { return { x: point.x - cam.x, y: point.y - cam.y }; }
    function _drawLabel(text, x, y, color) { ctx.fillStyle = color; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(text, x, y); }
    function _draw(cam) {
        if (!ctx || !scene) return;
        _drawWorld(cam);
        for (const exit of scene.def.exits || []) {
            const p = _point(exit.portal, cam), blocked = exit.requiresBoss && !bossDefeated(exit.requiresBoss);
            const angle = _portalAngle(scene.def, exit);
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle + Math.PI / 4); ctx.fillStyle = blocked ? '#70413d' : '#c59b58'; ctx.fillRect(-16, -16, 32, 32); ctx.restore();
            // The diamond is symmetric, so the facing needs a mark of its own:
            // a chevron at the gate's mouth pointing the way it leads.
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle);
            ctx.beginPath(); ctx.moveTo(28, 0); ctx.lineTo(16, -7); ctx.lineTo(16, 7); ctx.closePath();
            ctx.fillStyle = blocked ? '#8f5751' : '#ecd29d'; ctx.fill(); ctx.restore();
            _drawLabel(blocked ? '封锁的裂隙' : exit.label, p.x, p.y - 26, blocked ? '#d39a91' : '#ecd29d');
        }
        for (const monster of scene.monsters) {
            if (!monster.alive) continue;
            const p = _point(monster, cam), enemy = content.enemies[monster.enemyId], chasing = monster.phase === 'chase';
            if (chasing) { ctx.beginPath(); ctx.arc(p.x, p.y, monster.alertRange, 0, Math.PI * 2); ctx.strokeStyle = '#b5694b55'; ctx.stroke(); }
            ctx.beginPath(); ctx.arc(p.x, p.y, monster.boss ? BOSS_RADIUS : MONSTER_RADIUS, 0, Math.PI * 2); ctx.fillStyle = monster.boss ? '#b35340' : chasing ? '#d08050' : '#9b6a4c'; ctx.fill();
            _drawLabel(monster.boss ? `首领 · ${enemy.name}` : enemy.name, p.x, p.y - (monster.boss ? 34 : 25), chasing ? '#ffd2b4' : '#e9b58a');
        }
        const player = _point(scene.player, cam); ctx.beginPath(); ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2); ctx.fillStyle = '#82c3d7'; ctx.fill(); ctx.strokeStyle = '#e4fbff'; ctx.stroke();
        // Facing wedge: a notch from the centre out to the rim, so heading reads at a glance.
        const facing = scene.player.facing || 0;
        ctx.beginPath();
        ctx.moveTo(player.x + Math.cos(facing) * PLAYER_RADIUS, player.y + Math.sin(facing) * PLAYER_RADIUS);
        ctx.lineTo(player.x + Math.cos(facing + 2.4) * PLAYER_RADIUS * .5, player.y + Math.sin(facing + 2.4) * PLAYER_RADIUS * .5);
        ctx.lineTo(player.x + Math.cos(facing - 2.4) * PLAYER_RADIUS * .5, player.y + Math.sin(facing - 2.4) * PLAYER_RADIUS * .5);
        ctx.closePath(); ctx.fillStyle = '#e4fbff'; ctx.fill();
        _drawLabel('你', player.x, player.y - 23, '#dffaff');
    }
    function _loop(at) {
        raf = null;
        if (!scene || state.world.currentTab !== 'adventure' || state.pveBattle?.active) return;
        const dt = Math.min(.05, Math.max(0, (at - lastAt) / 1000)); lastAt = at;
        _updatePlayer(dt); _updateMonsters(dt); _updateExits(dt); _draw(_camera());
        if (scene && state.world.currentTab === 'adventure' && !state.pveBattle?.active) raf = requestAnimationFrame(_loop);
    }
    return {
        activate() {
            const def = region(); if (!def || !document.getElementById('adventure-world')) return;
            canvas = document.getElementById('adventure-world'); ctx = canvas.getContext('2d');
            if (!scene || scene.regionId !== def.id) scene = _makeScene(def);
            _attach(); cancelAnimationFrame(raf); lastAt = performance.now(); raf = requestAnimationFrame(_loop);
        },
        deactivate() { if (raf != null) cancelAnimationFrame(raf); raf = null; abort?.abort(); abort = null; keys.clear(); if (scene) scene.pointer = null; },
        // A region session survives deactivate(), so this reports whether one
        // exists -- not which tab is showing. A fight keeps the scene alive so
        // the world can be handed back when it ends.
        isActive() { return !!scene; },
        // Read-only view of the live scene, for the adapter and for tests.
        scene() { return scene; },
        // Region-space enlist: build the fight at the monster's live position so
        // combat starts exactly where the two bodies already stand, and hand back
        // the leash data the disengage rule needs. Returns null when there is no
        // region scene, which is what keeps the dev/test path on its arena.
        enlist(enemyId, mapEntityId) {
            const monster = scene?.monsters.find(item => item.id === mapEntityId);
            const def = region();
            if (!monster || !def) return null;
            const C = pveProfiles.enemy(def, enemyId, content.enemies[enemyId],
                { radius: monster.boss ? BOSS_RADIUS : MONSTER_RADIUS, speed: monster.speed });
            C.player.x = scene.player.x; C.player.y = scene.player.y; C.player.facing = scene.player.facing || 0;
            C.enemy.x = monster.x; C.enemy.y = monster.y;
            C.enemy.facing = Math.atan2(scene.player.y - monster.y, scene.player.x - monster.x);
            // Send any other chaser home rather than letting it hover at
            // encounterRange, which would fire the instant this fight ends.
            for (const other of scene.monsters) if (other.phase === 'chase') other.phase = 'return';
            return { config: C, home: { ...monster.home }, leash: monster.leash, alertRange: monster.alertRange };
        },
        // Hand the region back after a fight. On victory the monster is already
        // gone via completeEncounter; on a disengage it walks home from wherever
        // the fight actually left it rather than teleporting.
        endCombat(mapEntityId, { disengaged = false, player = null, enemy = null } = {}) {
            if (!scene) return null;
            if (player) {
                scene.player.x = clamp(player.x, PLAYER_RADIUS, scene.map.width - PLAYER_RADIUS);
                scene.player.y = clamp(player.y, PLAYER_RADIUS, scene.map.height - PLAYER_RADIUS);
                scene.player.facing = player.facing;
            }
            const monster = scene.monsters.find(item => item.id === mapEntityId);
            if (monster && disengaged) {
                if (enemy) { monster.x = enemy.x; monster.y = enemy.y; }
                monster.phase = 'return';
            }
            return monster || null;
        },
        completeEncounter(entityId) { const monster = scene?.monsters.find(item => item.id === entityId); if (monster) monster.alive = false; },
        returnFromCombat(entityId, won) {
            const monster = scene?.monsters.find(item => item.id === entityId);
            if (monster && !won) { monster.phase = 'return'; monster.x = monster.home.x; monster.y = monster.home.y; }
        }
    };
})();
