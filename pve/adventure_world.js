// Large-area exploration simulation plus its world layer. It deliberately owns
// no DOM of its own -- no canvas, no listeners, no rAF -- so a single region
// session can be stepped by the page adapter and drawn into the shared battle
// view's canvas, which is what lets walking and fighting be one continuous view
// instead of two. It also owns no combat rules: it only turns a physical enemy
// or exit overlap into a `pveLogic` request.
//
// The player body is a spatial actor (`scene.field.player`), stepped with
// `spatialEngine.advanceActor`. Walking therefore uses exactly the movement,
// gear motion multipliers and gesture rules a fight does -- the move pad is the
// only movement control in either mode.
const adventureWorld = (() => {
    let scene = null;
    // Arrivals land this far from the return portal -- beyond EXIT_RADIUS so a
    // fresh scene cannot immediately re-trigger the exit and bounce back.
    const PLAYER_RADIUS = 14, EXIT_RADIUS = 52;
    const ARRIVAL_OFFSET = EXIT_RADIUS + 40;
    // Contact radii, shared by the drawn monster and the fight it enlists into
    // so the sprite does not change size the moment combat starts.
    const MONSTER_RADIUS = 16, BOSS_RADIUS = 25;
    const STEP = .01, MAX_CATCH_UP = .1;
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
    // The walking preset and its actor. Rebuilt rather than reused whenever a
    // fight ends: the engine that walked into the fight may be parked mid-charge
    // or mid-stun, and carrying that into the resumed walk would show up as a
    // phantom action with no input behind it.
    function _field(def, at) {
        const field = spatialEngine.create(pveProfiles.region(def));
        const spawn = at || _spawnPoint(def);
        field.player.x = spawn.x; field.player.y = spawn.y; field.player.facing = spawn.facing || 0;
        spatialEngine.start(field);
        return field;
    }
    function _makeScene(def) {
        const map = def.map;
        const monsters = (map.monsters || []).filter(item => !item.boss || !bossDefeated(item.enemyId)).map(item => ({
            ...item, home: { x: item.x, y: item.y }, phase: 'idle', alive: true, patrolAt: Math.random() * Math.PI * 2,
            respawnAt: 0
        }));
        // Buildings. `radius` is the reach at which one becomes the interact
        // target; authoring it per structure is allowed but rarely wanted.
        const structures = (map.structures || []).map(item => ({ ...item, radius: item.radius ?? gameConfig.adventure.structureRange }));
        // Resolved before the field exists: `_spawnPoint` consumes the arrival
        // hint, and the hint has to be read before anything clears it.
        const spawn = _spawnPoint(def);
        const field = _field(def, spawn);
        const boss = def.boss;
        state.world.arrivalFrom = null;   // consumed: only the first build honours it
        return {
            regionId: def.id, def, map, field, player: field.player, monsters, structures,
            notice: '', noticeUntil: 0, exitCooldown: .7, accumulator: 0,
            // Region clock in seconds, driven by `stepWorld`. Monsters respawn
            // against it; it restarts whenever the scene is rebuilt.
            clock: 0,
            // The structure the walker is standing in reach of, or null. Read by
            // the adapter (pad label) and by `pveLogic.interact`.
            interaction: null,
            // Written into the hint line by the adapter, which owns the DOM. A
            // region with buildings says so once, which is how the interact key
            // gets taught without a tutorial.
            hint: [
                structures.length ? '走近建筑后，点击中央键与之交互。' : '',
                boss && bossDefeated(boss.enemyId)
                    ? '首领已被击败，不会重生。其余怪物会重新出现（离开区域或等待一段时间）。'
                    : '拖动移动键行走。保持距离即可绕过怪物；接触后才会进入战斗。'
            ].filter(Boolean).join(' ')
        };
    }
    // A notice outranks the region's resting hint line. With a duration it also
    // expires, which is what keeps a one-off line ("a fight just ended", "that
    // gate is sealed") from becoming the region's permanent description.
    function _notice(text, seconds = 0) {
        if (!scene) return;
        scene.notice = text;
        scene.noticeUntil = seconds > 0 ? scene.clock + seconds : Infinity;
    }
    function _moveToward(actor, target, speed, dt) {
        const dx = target.x - actor.x, dy = target.y - actor.y, d = Math.hypot(dx, dy);
        if (!d) return;
        const step = Math.min(d, speed * dt); actor.x += dx / d * step; actor.y += dy / d * step;
    }
    function _updateMonsters(dt) {
        // The region keeps living during a fight -- patrols continue and the world
        // stays put under the duel -- so this runs in both modes. The one thing it
        // must not do is start a SECOND engagement: the enlisted monster is owned
        // by the fight engine (it is `engaged`, and skipped below), and every other
        // monster is barred from picking a target until that fight resolves. The
        // guard was written in phase 3, found unreachable because the whole loop
        // was stopped, and is genuinely load-bearing now.
        const fighting = !!state.pveBattle?.active;
        for (const monster of scene.monsters) {
            if (!monster.alive || monster.phase === 'engaged') continue;
            const playerDistance = distance(scene.player, monster), homeDistance = distance(monster, monster.home);
            if (monster.phase === 'idle' && !fighting && playerDistance <= monster.alertRange) monster.phase = 'chase';
            if (monster.phase === 'chase') {
                if (!fighting && playerDistance <= monster.encounterRange) {
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
    // A fallen region monster comes back where it was posted, `monsterRespawnSeconds`
    // after it fell. Bosses never do -- their defeat is permanent progression,
    // held in `progress.defeatedBosses`, and a boss is filtered out of a scene
    // entirely once defeated.
    function _updateRespawns() {
        const now = scene.clock;
        for (const monster of scene.monsters) {
            if (monster.alive || monster.boss || !monster.respawnAt || now < monster.respawnAt) continue;
            // Never drop one on top of the player: that would be an instant
            // encounter with no time to react. Try again a moment later.
            if (distance(scene.player, monster.home) < scene.player.radius + MONSTER_RADIUS + 8) {
                monster.respawnAt = now + 1; continue;
            }
            monster.x = monster.home.x; monster.y = monster.home.y;
            monster.phase = 'idle'; monster.alive = true; monster.respawnAt = 0;
        }
    }
    // The nearest structure in reach becomes the interact target. The release
    // radius is deliberately larger than the acquire one, so a prompt does not
    // flicker on and off while the player stands on the boundary. Scanned for
    // the whole scene rather than per substep -- this is a prompt, not physics.
    // During a fight there is no interaction at all: the move pad is a weapon.
    function _updateStructures() {
        if (state.pveBattle?.active) { scene.interaction = null; return; }
        const release = Math.max(gameConfig.adventure.structureRelease, gameConfig.adventure.structureRange);
        const held = scene.interaction && scene.structures.find(item => item.id === scene.interaction.id);
        let best = null, nearest = Infinity;
        for (const structure of scene.structures) {
            const gap = distance(scene.player, structure);
            if (gap > (structure === held ? Math.max(release, structure.radius) : structure.radius)) continue;
            if (gap < nearest) { best = structure; nearest = gap; }
        }
        scene.interaction = best ? { id: best.id, kind: best.kind, label: best.label } : null;
    }
    function _updateExits(dt) {
        scene.exitCooldown = Math.max(0, scene.exitCooldown - dt);
        if (scene.exitCooldown) return;
        for (const exit of scene.def.exits || []) {
            if (distance(scene.player, exit.portal) > EXIT_RADIUS) continue;
            if (exit.requiresBoss && !bossDefeated(exit.requiresBoss)) {
                scene.exitCooldown = .8; _notice('深渊裂隙被巨龙的力量封锁。', 4); return;
            }
            pveLogic.travel(exit.to); return;
        }
    }

    // ── World layer ───────────────────────────────────────────────────────────
    // Handed to the shared view as `options.layer`, so the region is drawn inside
    // the same transform, clip and camera the fighters are. Everything below is
    // in ABSOLUTE world coordinates -- the view has already applied the camera.
    function _drawGround(ctx, camera, viewWidth, viewHeight) {
        const left = camera ? camera.x - viewWidth / 2 : 0, top = camera ? camera.y - viewHeight / 2 : 0;
        const lava = scene.regionId === 'c' || scene.regionId === 'd';
        ctx.fillStyle = lava ? '#2a211e' : scene.regionId === 'a' ? '#243027' : '#1f2d28';
        ctx.fillRect(left, top, viewWidth, viewHeight);
        ctx.strokeStyle = lava ? '#5d3931' : '#3d5448'; ctx.lineWidth = 1;
        for (let x = Math.floor(left / 100) * 100; x < left + viewWidth; x += 100) {
            ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + viewHeight); ctx.stroke();
        }
        for (let y = Math.floor(top / 100) * 100; y < top + viewHeight; y += 100) {
            ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + viewWidth, y); ctx.stroke();
        }
    }
    function _drawLabel(ctx, text, x, y, color) {
        ctx.fillStyle = color; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(text, x, y);
    }
    function _drawWorldLayer(ctx, offer = {}) {
        if (!scene) return;
        const { camera = null, viewWidth = 0, viewHeight = 0 } = offer;
        _drawGround(ctx, camera, viewWidth, viewHeight);
        for (const exit of scene.def.exits || []) {
            const blocked = exit.requiresBoss && !bossDefeated(exit.requiresBoss);
            const angle = _portalAngle(scene.def, exit);
            ctx.save(); ctx.translate(exit.portal.x, exit.portal.y); ctx.rotate(angle + Math.PI / 4);
            ctx.fillStyle = blocked ? '#70413d' : '#c59b58'; ctx.fillRect(-16, -16, 32, 32); ctx.restore();
            // The diamond is symmetric, so the facing needs a mark of its own:
            // a chevron at the gate's mouth pointing the way it leads.
            ctx.save(); ctx.translate(exit.portal.x, exit.portal.y); ctx.rotate(angle);
            ctx.beginPath(); ctx.moveTo(28, 0); ctx.lineTo(16, -7); ctx.lineTo(16, 7); ctx.closePath();
            ctx.fillStyle = blocked ? '#8f5751' : '#ecd29d'; ctx.fill(); ctx.restore();
            _drawLabel(ctx, blocked ? '封锁的裂隙' : exit.label, exit.portal.x, exit.portal.y - 26, blocked ? '#d39a91' : '#ecd29d');
        }
        for (const monster of scene.monsters) {
            // `engaged` means the fight engine owns this body now: it is drawn by
            // the shared view's own fighter, and drawing the region's marker too
            // would show the monster twice, a circle behind the sprite.
            if (!monster.alive || monster.phase === 'engaged') continue;
            const enemy = content.enemies[monster.enemyId], chasing = monster.phase === 'chase';
            if (chasing) {
                ctx.beginPath(); ctx.arc(monster.x, monster.y, monster.alertRange, 0, Math.PI * 2);
                ctx.strokeStyle = '#b5694b55'; ctx.stroke();
            }
            ctx.beginPath(); ctx.arc(monster.x, monster.y, monster.boss ? BOSS_RADIUS : MONSTER_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = monster.boss ? '#b35340' : chasing ? '#d08050' : '#9b6a4c'; ctx.fill();
            _drawLabel(ctx, monster.boss ? `首领 · ${enemy.name}` : enemy.name, monster.x, monster.y - (monster.boss ? 34 : 25), chasing ? '#ffd2b4' : '#e9b58a');
        }
        // Buildings are drawn AFTER the gates on purpose: a gate chevron is
        // located in tests by the first point drawn 28px out from the portal, so
        // nothing else may put a point near a portal first. Every structure is
        // kept well clear of the gates in the region data, and the whole marker
        // stays rectangular -- a 12px arc is how the tests find the player body.
        for (const structure of scene.structures) {
            const active = scene.interaction?.id === structure.id;
            ctx.fillStyle = active ? '#7d6338' : '#46554e';
            ctx.fillRect(structure.x - 22, structure.y - 18, 44, 36);
            if (active) {   // the reach ring, drawn under the outline
                ctx.strokeStyle = '#efc18155'; ctx.lineWidth = 6;
                ctx.beginPath(); ctx.rect(structure.x - 27, structure.y - 23, 54, 46); ctx.stroke();
            }
            ctx.strokeStyle = active ? '#efc181' : '#7f948b'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.rect(structure.x - 22, structure.y - 18, 44, 36); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(structure.x - 26, structure.y - 18);
            ctx.lineTo(structure.x, structure.y - 34);
            ctx.lineTo(structure.x + 26, structure.y - 18);
            ctx.stroke();
            _drawLabel(ctx, structure.label, structure.x, structure.y + 32, active ? '#ffe6b8' : '#cfd8d2');
        }
        // The player body itself is drawn by the shared view, from the same solo
        // snapshot the fight renders -- that is what makes the two continuous.
    }

    return {
        // Build the region session. Re-entering the same region keeps the scene;
        // travelling (or arriving with an `arrivalFrom` hint) rebuilds it.
        enter(def = region()) {
            if (!def) return false;
            if (!scene || scene.regionId !== def.id) scene = _makeScene(def);
            else spatialEngine.start(scene.field);
            return true;
        },
        // Resume a walk that `pauseField` (a fight, or the pause overlay) stopped.
        startField() { if (scene) spatialEngine.start(scene.field); },
        leave() { if (scene) spatialEngine.pause(scene.field); },
        // A region session survives leaving the tab, so this reports whether one
        // exists -- not which tab is showing. A fight keeps the scene alive so the
        // world can be handed back when it ends.
        isActive() { return !!scene; },
        // Read-only view of the live scene, for the adapter and for tests.
        scene() { return scene; },
        // Put a line in the region's hint log. `seconds` > 0 makes it expire;
        // omitted, it stays until the scene is rebuilt.
        notice(text, seconds = 0) { _notice(text, seconds); },
        // The world drawer the shared view calls instead of its default arena.
        worldLayer(ctx, offer) { _drawWorldLayer(ctx, offer); },
        // One fixed-step pass of the region. The engine clamps a single actor step
        // to 50ms and the frame clock can hand us more than that after a stall, so
        // this accumulates exactly like the fight loop does.
        //
        // Called in BOTH modes: the world stays alive under a fight, so patrols
        // keep moving and the region keeps its clock. Only the walking half is
        // mode-specific -- the field engine is paused for the duration of a fight,
        // so `advanceActor` no-ops, and exits are skipped because it is the
        // walking body that triggers them and that body is not moving.
        stepWorld(seconds) {
            if (!scene || !Number.isFinite(seconds)) return;
            const current = scene, fighting = !!state.pveBattle?.active;
            const elapsed = Math.max(0, Math.min(seconds, MAX_CATCH_UP));
            current.accumulator += elapsed;
            current.clock += elapsed;
            while (current.accumulator >= STEP - 1e-9) {
                current.accumulator = Math.max(0, current.accumulator - STEP);
                spatialEngine.advanceActor(current.field, STEP);
                _updateMonsters(STEP);
                if (!fighting) _updateExits(STEP);
                // Travelling swaps the scene out from under us mid-step; the next
                // frame belongs to the new region, not this loop.
                if (scene !== current) return;
            }
            // Once per frame, not per 10ms substep: respawns, the interact prompt
            // and the notice expiry are frame-grain concerns.
            if (current.noticeUntil && current.clock >= current.noticeUntil) { current.notice = ''; current.noticeUntil = 0; }
            _updateRespawns();
            _updateStructures();
        },
        pauseField() { if (scene) spatialEngine.pause(scene.field); },
        // Hand the walk back after a fight, on a clean engine at wherever the fight
        // actually left the player.
        resumeField() {
            if (!scene) return;
            const at = { x: scene.player.x, y: scene.player.y, facing: scene.player.facing || 0 };
            const field = _field(scene.def, at);
            scene.field = field; scene.player = field.player; scene.accumulator = 0;
        },
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
        // The base's training post: the same formal fight a region monster
        // gives, against a dummy set down a few steps in front of the player.
        // The `training` flag is what makes the fight reward-free and deathless
        // (pveLogic) and shows the combo tree (the shared view).
        enlistTraining(enemyId) {
            const def = region();
            if (!scene || !def || !content.enemies[enemyId]) return null;
            const C = pveProfiles.enemy(def, enemyId, content.enemies[enemyId], { radius: MONSTER_RADIUS });
            const p = scene.player, facing = p.facing || 0, gap = 90;
            C.training = true;
            Object.assign(C.player, { x: p.x, y: p.y, facing, hp: C.player.maxHp });
            C.enemy.x = clamp(p.x + Math.cos(facing) * gap, MONSTER_RADIUS, def.map.width - MONSTER_RADIUS);
            C.enemy.y = clamp(p.y + Math.sin(facing) * gap, MONSTER_RADIUS, def.map.height - MONSTER_RADIUS);
            C.enemy.facing = Math.atan2(p.y - C.enemy.y, p.x - C.enemy.x);
            return { config: C, home: null, leash: 0, alertRange: 0 };
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
        completeEncounter(entityId) {
            const monster = scene?.monsters.find(item => item.id === entityId);
            if (!monster) return;
            monster.alive = false;
            // The region clock is what the respawn is measured against, so a
            // monster killed just before the player leaves still comes back at
            // the right moment if the scene survives the trip.
            monster.respawnAt = scene.clock + Math.max(0, gameConfig.adventure.monsterRespawnSeconds);
        },
        // Hand the region back after a fight that did NOT disengage (victory or
        // flee). `player` is where the fight left the walker: the region's own
        // body has been standing still for the whole fight, so without it the
        // walk would resume at the spot the encounter started from.
        returnFromCombat(entityId, won, player = null) {
            if (!scene) return;
            if (player) {
                scene.player.x = clamp(player.x, PLAYER_RADIUS, scene.map.width - PLAYER_RADIUS);
                scene.player.y = clamp(player.y, PLAYER_RADIUS, scene.map.height - PLAYER_RADIUS);
                scene.player.facing = player.facing;
            }
            const monster = scene.monsters.find(item => item.id === entityId);
            if (monster && !won) { monster.phase = 'return'; monster.x = monster.home.x; monster.y = monster.home.y; }
        }
    };
})();
