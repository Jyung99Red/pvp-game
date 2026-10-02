// Every tunable number of the game, and nothing else. Units: world units
// (40 to a block) for positions, distances and speeds; seconds for time;
// radians for angles; CSS pixels for anything on the touch layer.
// docs/tasks/parameters.md mirrors this file.
const gameConfig = (() => {
    const freeze = value => {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    };
    return freeze({
        // 1. Scale. A block is 40 world units; the simulation keeps world
        // units so distances read the same as in the 2D version.
        world: { unitsPerBlock: 40 },

        // 2. The main character on foot.
        // speed: walking, world units/second at full stick. turnRate:
        // radians/second while turning towards the stick. radius: wall
        // collision. startSeconds: from a standstill to full walking speed.
        // turnSlow: walking straight away from the facing is this share
        // slower (easing with the angle) until the body has turned.
        // Running: after `runAfter` seconds of unbroken walking
        // with the stick pushed at least `runStick` of the way, speed eases up
        // to speed * runMultiplier over runRampSeconds, and back down the same
        // way once the walk is broken (stick eased off or released, a wall).
        player: { speed: 140, turnRate: 8, radius: 12, runAfter: 2, runMultiplier: 1.8, runRampSeconds: 0.3, runStick: 0.9, startSeconds: 0.12, turnSlow: 0.5 },

        // 3. Animation. blendSeconds: idle <-> walk cross-fade.
        animation: { blendSeconds: 0.1 },

        // 4. Sizes that will decide hits (design.md 4.3). The
        // body boxes themselves are model data in models/; these scale it.
        // playerScale multiplies the whole character. Blade lengths are on
        // the weapons (`items`, blocks).
        models: { playerScale: 1 },

        // 4b. Fighting rules shared by every fight (training, PVE, PVP).
        // fighters.base: the main character's stats before equipment (no
        // levels: equipment is the only growth, design.md 7.1); each
        // item worn adds its own (`items`). The starter gear makes 360 HP,
        // 30 ATK, 8 DEF; a duel is always fought in it.
        // hitStun: a hit that is not guarded freezes the one struck's
        // controls this long. weaponPad: weapon boxes grow by this much on
        // every side for hit tests only (design.md 4.3).
        // Damage = max(1, round(raw * (1 - DEF / (DEF + defenseConstant)))).
        // A blocked hit does blockMultiplier of that; a perfect parry hits
        // back for atk * parryAtkRatio. Impact: on contact both fighters'
        // clocks stop for `hitstop`; then the one struck is pushed
        // `knockback` units over knockbackSeconds. Player moves carry their
        // own knockback in the combo table; these are for hits on the
        // player, blocks and parries. Stagger: points from moves (and
        // `parry`) fill to `threshold`, then the target reels `duration`.
        combat: {
            fighters: { base: { maxHp: 340, atk: 22, def: 4 } },
            hitStun: 0.35, weaponPad: 8,
            damage: { defenseConstant: 17.5, blockMultiplier: 0.4, parryAtkRatio: 0.5 },
            impact: { hitstop: { hit: 0.06, block: 0.04, parry: 0.08 }, knockback: { hit: 10, block: 5, parry: 8 }, knockbackSeconds: 0.12 },
            stagger: { threshold: 3, duration: 1.5, parry: 1 },
            // The opening B: held past its windup it charges. Charge time
            // counts from the press; damage grows from `threshold` to `full`
            // seconds. While charging the body walks and turns slower.
            charge: { threshold: 0.3, full: 2.3, moveMultiplier: 0.6, turnMultiplier: 0.65 },
            // The shield: `startup` from press to up; a hit within
            // parryWindow of the shield coming up is a perfect parry. Only
            // hits from within frontAngle of facing are blocked.
            guard: { startup: 0.16, parryWindow: 0.18, moveMultiplier: 0.3, turnMultiplier: 0.5, frontAngle: Math.PI / 2 },
            // Guard bar (points). Raising costs raiseCost, holding drains
            // holdDrain a second, a blocked hit costs
            // raw / maxHp * blockCostScale * max (a parry parryCostRatio of
            // that). Down, it refills in refillSeconds; emptied, the shield
            // stays locked until it is back to unlockRatio.
            guardBar: { max: 100, raiseCost: 10, holdDrain: 10, blockCostScale: 6, parryCostRatio: 0.5, refillSeconds: 3, unlockRatio: 0.4 },
            // A potion in the offhand (design.md 3.4): a drink takes
            // `seconds`, walking and turning slowed meanwhile, and heals
            // `heal` of max HP at the end; a blow that gets through spills
            // it (the potion is kept). Pressed in a move or a stun, it waits
            // for that to be over.
            potion: { seconds: 0.8, heal: 0.3, moveMultiplier: 0.3, turnMultiplier: 0.5 }
        },

        // 4c. Player moves (design.md 4.1, 4.2). Every weapon belongs to a
        // weapon type (`items.*.weapon`), and the type has its own move tree:
        // `weapons.<type>.root` is what A and B start out of a combo, and
        // `standard` the distance (centre to centre, world units) every move
        // of the type must land at (tests). `moves` holds the moves of every
        // type, each naming its `weapon`; ids are unique across types.
        // Each move: windup -> swing -> recovery, seconds. Only the swing
        // hits. `derive`, counted from the swing's end, is when a buffered
        // input that `next` derives cuts the recovery short; a finisher has
        // none, and an input with no entry starts over from the root once
        // the recovery is over. `next` maps the next input -- A, B, or A
        // after a pause -- to the move it derives. ratio: damage per ATK;
        // stagger: stagger points (whole numbers, user 2026-10-02);
        // knockback: world units the target is pushed; step: how far the
        // body moves along its facing during the swing (negative: back). A
        // `charge` move grows ratio by chargeRatio and step by chargeStep
        // with its charge. Shapes and reach come from the key poses
        // (models/player_moves.js).
        // pauseAfterRecovery: the pause line after a recovery ends;
        // windowAfterRecovery: the chain resets this long after;
        // bufferSeconds: an input pressed ahead that has not run within this
        // long is dropped. recoveryTurnMultiplier: in a recovery the stick
        // only turns the body, at this share of player.turnRate.
        combo: {
            pauseAfterRecovery: 0.2, windowAfterRecovery: 0.7, bufferSeconds: 0.5, recoveryTurnMultiplier: 0.5,
            weapons: {
                // Heavy and far-reaching: everything a beat slower than the dagger.
                sword: { name: '剑', root: { a: 'slash', b: 'charged' }, standard: 60 },
                // Quick and close: chains up to six moves; B inside a combo flicks and goes on.
                dagger: { name: '短刃', root: { a: 'cut', b: 'lunge' }, standard: 48 }
            },
            moves: {
                slash: { weapon: 'sword', name: '横扫', windup: 0.13, swing: 0.10, recovery: 0.36, derive: 0.15, ratio: 0.36, stagger: 0, knockback: 0, step: 3, next: { a: 'backslash', b: 'rising' } },
                backslash: { weapon: 'sword', name: '回扫', windup: 0.13, swing: 0.10, recovery: 0.44, derive: 0.17, ratio: 0.38, stagger: 0, knockback: 0, step: 3, next: { a: 'spin', b: 'cleave', pause: 'thrust' } },
                spin: { weapon: 'sword', name: '回旋斩', windup: 0.20, swing: 0.22, recovery: 0.72, ratio: 0.66, stagger: 0, knockback: 0, step: 0 },
                thrust: { weapon: 'sword', name: '连刺', windup: 0.15, swing: 0.08, recovery: 0.66, ratio: 0.72, stagger: 0, knockback: 0, step: 14 },
                rising: { weapon: 'sword', name: '上挑', windup: 0.36, swing: 0.12, recovery: 0.72, ratio: 0.84, stagger: 2, knockback: 16, step: 4 },
                cleave: { weapon: 'sword', name: '下劈', windup: 0.36, swing: 0.10, recovery: 0.78, ratio: 0.96, stagger: 2, knockback: 16, step: 7 },
                charged: { weapon: 'sword', name: '蓄力斩', windup: 0.54, swing: 0.14, recovery: 0.72, derive: 0.30, ratio: 0.36, chargeRatio: 0.96, stagger: 2, knockback: 20, step: 4, chargeStep: 13, charge: true, next: { a: 'follow' } },
                follow: { weapon: 'sword', name: '追斩', windup: 0.13, swing: 0.10, recovery: 0.54, ratio: 0.48, stagger: 0, knockback: 0, step: 3 },
                cut: { weapon: 'dagger', name: '斜切', windup: 0.10, swing: 0.08, recovery: 0.30, derive: 0.12, ratio: 0.26, stagger: 0, knockback: 0, step: 4, next: { a: 'recut', b: 'flick' } },
                recut: { weapon: 'dagger', name: '反切', windup: 0.10, swing: 0.08, recovery: 0.32, derive: 0.12, ratio: 0.26, stagger: 0, knockback: 0, step: 4, next: { a: 'stab', b: 'flick', pause: 'retreat' } },
                stab: { weapon: 'dagger', name: '直刺', windup: 0.10, swing: 0.06, recovery: 0.34, derive: 0.13, ratio: 0.30, stagger: 0, knockback: 0, step: 10, next: { a: 'whirl', b: 'flick' } },
                whirl: { weapon: 'dagger', name: '旋刃', windup: 0.14, swing: 0.16, recovery: 0.40, derive: 0.16, ratio: 0.36, stagger: 0, knockback: 0, step: 2, next: { a: 'drop' } },
                drop: { weapon: 'dagger', name: '落刃', windup: 0.22, swing: 0.10, recovery: 0.60, ratio: 0.70, stagger: 1, knockback: 14, step: 8 },
                flick: { weapon: 'dagger', name: '挑刃', windup: 0.16, swing: 0.08, recovery: 0.36, derive: 0.14, ratio: 0.42, stagger: 1, knockback: 10, step: 4, next: { a: 'whirl' } },
                lunge: { weapon: 'dagger', name: '突刺', windup: 0.18, swing: 0.10, recovery: 0.45, derive: 0.16, ratio: 0.48, stagger: 1, knockback: 10, step: 30, next: { a: 'recut' } },
                retreat: { weapon: 'dagger', name: '退步斩', windup: 0.08, swing: 0.08, recovery: 0.40, ratio: 0.40, stagger: 0, knockback: 0, step: -26 }
            }
        },

        // 4d. Training dummy: anchored where the map puts it, never walks,
        // turns or gets pushed. It attacks its moves in turn, `delay` apart,
        // while the player is within engageRange. radius: body collision.
        // clubLength: blocks. flinchSeconds: how long a hit jolts it back.
        // Move times are seconds, ratio is per ATK.
        dummy: {
            name: '训练木桩', maxHp: 600, atk: 24, def: 1, radius: 14, engageRange: 120, firstDelay: 0.8, delay: 0.45, clubLength: 0.9, flinchSeconds: 0.22,
            moves: [
                { id: 'swipe', name: '快斩', windup: 1.3, swing: 0.16, recovery: 0.95, ratio: 0.6 },
                { id: 'smash', name: '重击', windup: 1.6, swing: 0.16, recovery: 1.15, ratio: 1.0 }
            ]
        },

        // 4e. Monsters (design.md 5), on the old minimal AI (tag
        // v1-2d): patrol from waypoint to waypoint patrolRadius round home
        // at patrolSpeed, resting patrolRest at each; notice the player
        // within alertRange and stand alert for alertSeconds; chase at
        // `speed`, turning at turnRate; attack the moves in turn, `delay`
        // apart (firstDelay before the first). A move starts once the
        // player is within its reach, which comes from its key poses
        // (core/monster.js), never from here; the chase stops at standOff
        // of that reach. During a windup the body keeps turning to the
        // player at trackTurn until `lock` seconds before the swing. Past
        // `leash` from home with the player out of alertRange it walks back
        // home. At enrage.threshold of its HP it enrages for good: damage
        // times enrage.atk, its whole clock times enrage.tempo. HP is the
        // old value times the old hpScale 3, and so is ATK, to keep the old
        // danger (the 2D version). Moves: seconds; ratio per
        // ATK; step: world units lunged during the swing; ram: the body
        // itself is the weapon (the wolf's leap). corpseSeconds: a fallen
        // monster lies this long, then sinks away. loot: the table rolled
        // when it falls (`loot` below). stagger: points that make it reel
        // (else combat.stagger.threshold; bosses take 10, user 2026-10-02).
        // A monster that gets home after giving up a chase is whole again.
        // Bosses (design.md 5): `model` is the skeleton they are
        // built on, `scale` how much bigger, `look` their colours
        // (models/); a boss down stays down and opens what waits on it.
        monsters: {
            corpseSeconds: 2.5,
            goblin: {
                name: '哥布林', loot: 'goblin', maxHp: 105, atk: 36, def: 3, radius: 12, speed: 54, turnRate: 3, trackTurn: 1.6,
                patrolRadius: 60, patrolSpeed: 16, patrolRest: 1.4, alertRange: 150, alertSeconds: 0.5, leash: 260, standOff: 0.85,
                firstDelay: 0.3, delay: 0.45, flinchSeconds: 0.22, enrage: { threshold: 0.3, atk: 1.3, tempo: 1.2 },
                moves: [
                    { id: 'flail', name: '乱挥', windup: 1.3, lock: 0.4, swing: 0.16, recovery: 0.85, ratio: 0.6, step: 8 },
                    { id: 'pounce', name: '猛扑', windup: 1.6, lock: 0.5, swing: 0.2, recovery: 1.15, ratio: 0.9, step: 36 }
                ]
            },
            wolf: {
                name: '野狼', loot: 'wolf', maxHp: 90, atk: 54, def: 2, radius: 16, speed: 78, turnRate: 3, trackTurn: 1.6,
                patrolRadius: 80, patrolSpeed: 22, patrolRest: 1.0, alertRange: 180, alertSeconds: 0.4, leash: 300, standOff: 0.85,
                firstDelay: 0.3, delay: 0.45, flinchSeconds: 0.22, enrage: { threshold: 0.3, atk: 1.3, tempo: 1.2 },
                moves: [
                    { id: 'bite', name: '撕咬', windup: 1.05, lock: 0.3, swing: 0.14, recovery: 0.75, ratio: 0.6, step: 14 },
                    { id: 'leap', name: '扑击', windup: 1.15, lock: 0.35, swing: 0.54, recovery: 1.35, ratio: 0.9, step: 150, ram: true }
                ]
            },
            goblinChief: {
                name: '哥布林头目', model: 'goblin', scale: 1.45, look: 'chief', boss: true, loot: 'goblinChief', stagger: 10,
                maxHp: 450, atk: 48, def: 5, radius: 18, speed: 50, turnRate: 2.6, trackTurn: 1.4,
                patrolRadius: 0, patrolSpeed: 16, patrolRest: 2, alertRange: 190, alertSeconds: 0.7, leash: 360, standOff: 0.85,
                firstDelay: 0.5, delay: 0.6, flinchSeconds: 0.18, enrage: { threshold: 0.5, atk: 1.25, tempo: 1.2 },
                moves: [
                    { id: 'flail', name: '横扫', windup: 1.2, lock: 0.35, swing: 0.2, recovery: 0.9, ratio: 0.6, step: 10 },
                    { id: 'slam', name: '震地', windup: 1.7, lock: 0.5, swing: 0.18, recovery: 1.3, ratio: 1.0, step: 6 },
                    { id: 'pounce', name: '猛扑', windup: 1.5, lock: 0.45, swing: 0.24, recovery: 1.2, ratio: 0.85, step: 60 }
                ]
            },
            wolfKing: {
                name: '狼王', model: 'wolf', scale: 1.4, look: 'king', boss: true, loot: 'wolfKing', stagger: 10,
                maxHp: 420, atk: 60, def: 4, radius: 22, speed: 88, turnRate: 3, trackTurn: 1.8,
                patrolRadius: 0, patrolSpeed: 22, patrolRest: 2, alertRange: 210, alertSeconds: 0.6, leash: 380, standOff: 0.85,
                firstDelay: 0.4, delay: 0.5, flinchSeconds: 0.18, enrage: { threshold: 0.5, atk: 1.25, tempo: 1.25 },
                moves: [
                    { id: 'bite', name: '撕咬', windup: 0.95, lock: 0.3, swing: 0.14, recovery: 0.7, ratio: 0.6, step: 18 },
                    { id: 'bite', name: '撕咬', windup: 0.8, lock: 0.25, swing: 0.14, recovery: 0.8, ratio: 0.6, step: 18 },
                    { id: 'leap', name: '扑击', windup: 1.1, lock: 0.35, swing: 0.6, recovery: 1.4, ratio: 0.9, step: 190, ram: true }
                ]
            }
        },

        // 4f. Items and loot (design.md 6.4, 7). items: everything that
        // can be carried, with its name, icon and line for the screens.
        // kind: gold | material | gear | supply. Gear goes in a `slot`
        // (main, offhand, armor, accessory) and adds its `stats`; a weapon's
        // `blade` (blocks) decides its reach; an offhand item's `offhand` is
        // what the offhand key does with it (shield, torch, potion). `max`:
        // how many can be owned. `price`: what the shop sells it for;
        // `sell`: what it pays for one. `recipe`: what the smithy wants for
        // it (gold and materials). Gear is never lost; potions are used up.
        items: {
            gold: { kind: 'gold', name: '金币', icon: '🪙', desc: '打怪和开宝箱得来，在商店和铁匠铺花。' },
            goblin_ear: { kind: 'material', name: '哥布林耳', icon: '👂', sell: 4, desc: '哥布林掉的。铁匠铺打造要用，商店也收。' },
            wolf_pelt: { kind: 'material', name: '狼皮', icon: '🐺', sell: 6, desc: '野狼掉的。铁匠铺打造要用，商店也收。' },
            chief_tusk: { kind: 'material', name: '头目獠牙', icon: '🦷', sell: 30, desc: '哥布林头目的獠牙。能打成护符。' },
            king_fang: { kind: 'material', name: '狼王之牙', icon: '🦴', sell: 40, desc: '狼王的牙。能打成项链。' },
            iron_ore: { kind: 'material', name: '铁矿石', icon: '🪨', sell: 3, desc: '原野和山谷的铁矿石块里采来的。铁匠铺打造铁器要用。' },
            crystal: { kind: 'material', name: '晶石', icon: '💎', sell: 10, desc: '幽暗洞穴里采来的晶石。能镶在饰品上。' },
            herb: { kind: 'material', name: '草药', icon: '🌿', sell: 2, desc: '野外的草药丛采来的。能编进护符，商店也收。' },
            potion: { kind: 'supply', slot: 'offhand', offhand: 'potion', name: '药水', icon: '🧪', price: 15, max: 5, desc: '放在副手。按副手键喝一口，回复三成生命；挨打会洒掉这一口（药水还在）。' },
            torch: { kind: 'gear', slot: 'offhand', offhand: 'torch', name: '火把', icon: '🔥', price: 30, max: 1, desc: '放在副手。按副手键点燃或熄灭，照亮暗处，能烧掉枯木丛。不能挡，也不能拿来打。' },
            wooden_sword: { kind: 'gear', slot: 'main', weapon: 'sword', name: '木剑', icon: '🗡️', stats: { atk: 8 }, blade: 0.92, max: 1, desc: '开局带着的剑。' },
            assassin_dagger: { kind: 'gear', slot: 'main', weapon: 'dagger', name: '刺客短刃', icon: '🔪', stats: { atk: 11 }, blade: 0.6, max: 1, recipe: { gold: 40, materials: { wolf_pelt: 2, iron_ore: 2 } }, desc: '短刃。比剑短，要贴得更近；出招快，连段最长六段，起手 B 是往前冲的突刺。' },
            iron_sword: { kind: 'gear', slot: 'main', weapon: 'sword', name: '铁剑', icon: '⚔️', stats: { atk: 16 }, blade: 1.0, max: 1, recipe: { gold: 80, materials: { iron_ore: 5, goblin_ear: 2 } }, desc: '比木剑长一点，也重得多。' },
            wooden_shield: { kind: 'gear', slot: 'offhand', offhand: 'shield', name: '木盾', icon: '🛡️', stats: { def: 2 }, max: 1, desc: '开局带着的盾。按住副手键举盾。' },
            iron_shield: { kind: 'gear', slot: 'offhand', offhand: 'shield', name: '铁盾', icon: '🔰', stats: { def: 6 }, max: 1, recipe: { gold: 80, materials: { iron_ore: 4, wolf_pelt: 2 } }, desc: '更结实的盾。' },
            cloth_armor: { kind: 'gear', slot: 'armor', name: '布甲', icon: '👕', stats: { def: 2, maxHp: 20 }, max: 1, desc: '开局穿着的衣服。' },
            iron_armor: { kind: 'gear', slot: 'armor', name: '铁甲', icon: '🥋', stats: { def: 7, maxHp: 40 }, max: 1, recipe: { gold: 100, materials: { iron_ore: 6, wolf_pelt: 3 } }, desc: '加了肩甲和胸甲。' },
            chief_charm: { kind: 'gear', slot: 'accessory', name: '头目护符', icon: '📿', stats: { maxHp: 50 }, max: 1, recipe: { gold: 60, materials: { chief_tusk: 1, herb: 3 } }, desc: '用头目的獠牙打的护符。' },
            fang_necklace: { kind: 'gear', slot: 'accessory', name: '狼牙项链', icon: '🦷', stats: { atk: 4 }, max: 1, recipe: { gold: 60, materials: { king_fang: 1, crystal: 2 } }, desc: '用狼王的牙和晶石穿的项链。' }
        },
        // What a new game starts with, worn (a duel is fought in this too).
        gear: { starter: { main: 'wooden_sword', offhand: 'wooden_shield', armor: 'cloth_armor', accessory: null } },
        loot: {
            goblin: [{ item: 'gold', chance: 1, amount: [2, 5] }, { item: 'goblin_ear', chance: 0.85, amount: [1, 2] }],
            wolf: [{ item: 'gold', chance: 1, amount: [2, 4] }, { item: 'wolf_pelt', chance: 0.9, amount: [1, 2] }],
            goblinChief: [{ item: 'gold', chance: 1, amount: [20, 30] }, { item: 'chief_tusk', chance: 1, amount: [1, 1] }],
            wolfKing: [{ item: 'gold', chance: 1, amount: [25, 35] }, { item: 'king_fang', chance: 1, amount: [1, 1] }],
            chiefChest: [{ item: 'gold', chance: 1, amount: [40, 60] }, { item: 'goblin_ear', chance: 1, amount: [2, 4] }, { item: 'wolf_pelt', chance: 1, amount: [1, 2] }],
            kingChest: [{ item: 'gold', chance: 1, amount: [60, 90] }, { item: 'wolf_pelt', chance: 1, amount: [3, 5] }],
            caveChest: [{ item: 'gold', chance: 1, amount: [50, 80] }, { item: 'crystal', chance: 1, amount: [2, 3] }, { item: 'wolf_pelt', chance: 1, amount: [2, 3] }],
            ironOre: [{ item: 'iron_ore', chance: 1, amount: [1, 2] }],
            crystal: [{ item: 'crystal', chance: 1, amount: [1, 1] }],
            herb: [{ item: 'herb', chance: 1, amount: [1, 2] }]
        },
        // Loot on the ground (world units, seconds). It pops out at
        // popSpeed[0..1] and up to popHeight over popSeconds, lies still,
        // and once restSeconds old flies to a fighter within pickupRange at
        // pullSpeed (lifting to pullHeight), picked up within
        // collectDistance. radius: wall collision while it pops.
        drops: { radius: 4, popSeconds: 0.45, popHeight: 24, popSpeed: [30, 80], restSeconds: 0.5, pickupRange: 64, pullSpeed: 280, pullHeight: 14, collectDistance: 10 },

        // 4g. The interact key (design.md 3.5). A target
        // is picked within `reach` of the fighter (world units), scored by
        // distance plus facingWeight per radian off the facing; the target
        // already picked keeps it out to `release` and scores holdBonus
        // better. chestHold: seconds the key is held to open a chest.
        interact: { reach: 56, release: 72, facingWeight: 18, holdBonus: 10, chestHold: 0.6 },
        // Props: chestRadius (a chest is solid); arriveDistance, how far
        // in front of the portal back someone arriving stands. A thicket
        // set alight sets its neighbours alight after burnSpread seconds
        // and is gone after burnSeconds.
        props: { chestRadius: 14, arriveDistance: 64, burnSpread: 0.35, burnSeconds: 1.4 },
        // Resources (design.md 6.5): held `hold` seconds with the interact
        // key, each throws out its loot table and is gone until it grows
        // back: once regrowSeconds of play have passed, the next visit to
        // its region finds it again.
        gather: {
            regrowSeconds: 300,
            ore: { name: '铁矿', verb: '采矿', hold: 1.0, loot: 'ironOre' },
            crystal: { name: '晶石', verb: '采矿', hold: 1.2, loot: 'crystal' },
            herb: { name: '草药', verb: '采集', hold: 0.4, loot: 'herb' }
        },
        // Buildings of the base: name, the interact key's verb, and what it
        // does -- `rest` refills HP, `open` opens the building's panel.
        buildings: {
            hotSpring: { name: '温泉', verb: '泡温泉', action: 'rest' },
            smithy: { name: '铁匠铺', verb: '进入', action: 'open' },
            shop: { name: '商店', verb: '进入', action: 'open' },
            storage: { name: '仓库', verb: '进入', action: 'open' }
        },

        // 5. Fixed oblique camera (design.md 1). yaw 0 keeps
        // screen-up on -z; pitch is the angle down from the horizon;
        // distance and lookHeight are blocks; fov is vertical, in degrees.
        camera: { yaw: 0, pitch: 0.96, distance: 10.5, fov: 34, lookHeight: 0.8 },

        // 6. Rendering cost. Shadow map size by screen class (short side
        // under 700 CSS px is small); shadowExtent is the half-width in
        // blocks of the shadowed area around the player.
        graphics: { pixelRatioMax: 2, shadowMapSmall: 1024, shadowMapLarge: 2048, shadowExtent: 12 },

        // 7. Touch and keyboard. deadZone and ramp: stick offset (CSS px)
        // below which nothing moves, and beyond which speed reaches full
        // over `ramp` more pixels. stickRadius: knob travel. maxTouches:
        // two thumbs (design.md 3.2).
        input: {
            deadZone: 12, ramp: 32, stickRadius: 52, maxTouches: 2,
            keys: {
                up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
                left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
                a: ['KeyJ'], b: ['KeyK'], offhand: ['KeyL'], interact: ['KeyE']
            }
        },

        // 8. Button layout (design.md 3.2). Each button's
        // centre is `x` from its `side` edge and `y` from the bottom edge,
        // both inside the safe area; `size` is the diameter. The stick
        // appears wherever the bottom-left zone (zoneWidth x zoneHeight from
        // the safe area's corner, out to the screen edges) is pressed, and
        // rests faintly at (restX, restY) from the bottom-left.
        controlsLayout: {
            minGap: 10,
            buttons: {
                a: { side: 'right', x: 78, y: 72, size: 84 },
                b: { side: 'right', x: 70, y: 162, size: 72 },
                offhand: { side: 'right', x: 176, y: 56, size: 72 },
                interact: { side: 'left', x: 64, y: 196, size: 56 }
            },
            stick: { zoneWidth: 250, zoneHeight: 190, restX: 120, restY: 96 }
        },

        // 9. Maps (design.md 6.3: the base, two regions, the training
        // ground and the PVP arena). One character per block: `.` grass,
        // `:` path, `=` cobble, `;` gravel, `1`-`9` stone wall of that many
        // blocks, `T` tree, `H` a building's wall (3 high), `#` a portal's
        // pillar (3 high), `P` a portal's opening, `B` a dry thicket (2
        // high), `O` iron ore and `X` crystal (1-high boulders), `h` a herb
        // (walked through), `C` a chest, `@` grass
        // where the player starts when not arriving through a portal (a
        // duel: the host on the first, the guest on the second, in reading
        // order), `D` the training dummy (facing `dummyFacing`, radians),
        // and monster homes: `g` goblin, `w` wolf, `G` the goblin chief, `K`
        // the wolf king; `B` a dry thicket (2 high, burnt away by a lit
        // torch). Rows run north (screen top) to south.
        // Next to the rows: `buildings` ({ kind, at: [col, row, width,
        // depth] over its H blocks, door: side, south by default}),
        // `portals` ({ at: [col, row] of its P, to: map, facing: the side
        // that leads into this map, requires: a boss to be down first }),
        // `chests` ({ at, loot, requires }). Someone arriving stands in front
        // of the portal that leads back. `training`: nobody falls there (an
        // emptied HP bar refills); elsewhere the player can fall. `safe`: no
        // monsters. `duel`: the map is for PVP only. `dark`: no daylight,
        // only a torch lights it (drawn). `floor`: the letter of the ground
        // the markers lie on (grass by default).
        maps: {
            // The base (design.md 6.3): no monsters. Four buildings, the
            // north gate to the field, the west gate to the training ground,
            // and the east gate straight to the valley once the goblin chief
            // is down.
            base: {
                name: '曙光据点', safe: true,
                rows: [
                    '.....TT........T.....T...T........',
                    '...TTT...............T.....T...T..',
                    'T................................T',
                    '...333333333333#P#3333333333333..T',
                    '.T.3............:.............3...',
                    '...3..HHHH......:....HHHH.....3...',
                    '.T.3..HHHH......:....HHHH.....3..T',
                    'T..3..HHHH......:....HHHH.....3..T',
                    'T..3....================......#...',
                    '...3....================::::::P...',
                    '...3....================......#...',
                    '...#....================HHHH..3...',
                    '...P::::================HHHH..3...',
                    '...#....================HHHH..3...',
                    'T..3....================......3..T',
                    '...3........:.................3...',
                    '...3..HHHH..:...@.............3.TT',
                    '...3..HHHH..:.................3...',
                    '...3..HHHH..:.................3...',
                    '...3.....::::.................3...',
                    '.T.3222222222222222222222222223...',
                    '..................................',
                    '..................................',
                    '..................................'
                ],
                buildings: [
                    { kind: 'hotSpring', at: [6, 5, 4, 3] }, { kind: 'smithy', at: [21, 5, 4, 3] },
                    { kind: 'shop', at: [24, 11, 4, 3] }, { kind: 'storage', at: [6, 16, 4, 3] }
                ],
                portals: [
                    { at: [16, 3], to: 'field', facing: 'south' },
                    { at: [3, 12], to: 'clearing', facing: 'east' },
                    { at: [30, 9], to: 'valley', facing: 'west', requires: 'goblinChief' }
                ]
            },
            // The first region: goblins and wolves; the goblin chief keeps the
            // walled north-east corner, the gate to the valley and a chest.
            field: {
                name: '晨雾原野',
                rows: [
                    '......T....T....T....T.T.TT................TTT..T...',
                    '.....T.T..T...TTT.T.......T...T.T..........T..TT....',
                    '....................................................',
                    'T..3323332333233323332333233323332333233#P#332333.T.',
                    '.T.3.......................T......3.....:.......3...',
                    '...3.T.................w.......T..3.....:.....C.3.T.',
                    'T..2..T...........22..............3.....:.......2...',
                    '...3...............1O.............3.....:.......3...',
                    '...3....11........................3......G......3...',
                    '.T.3.......................h.g....3.............3...',
                    '...2..........g...................3.............2...',
                    'T..3..............................3.............3...',
                    '...3..h...................1.......3.............3...',
                    '...3..............................3.............3...',
                    '...2..............................33333..33333332...',
                    '...3.T.........1.......................::.......3...',
                    'T..3.................h.................::.......3...',
                    '...3..................g................::......T3...',
                    '...2..1O.......................2.......::...2...2...',
                    '...3...........................2.......::.......3...',
                    '...3...................................::.......3...',
                    'T..3.........g...1.....................::w......3...',
                    '...2........................g..........::.......2..T',
                    '...3...................................::.......3...',
                    '...3.............................h.....::.......3...',
                    'TT.3......:::::::::::::::::::::::::::::::.......3...',
                    '...2......:::::::::::::::::::::::::::::::.......2..T',
                    '...3......::................................w...3.TT',
                    '.T.3......::..h.....................1...........3.TT',
                    '...3......::.@........11O...1...................3...',
                    '...2......::.................................1..2.T.',
                    '...3......::....................................3.T.',
                    '.T.321222#P#2122212221222122212221222122212221223..T',
                    '....................................................',
                    '....................................................',
                    '....................................................'
                ],
                portals: [
                    { at: [10, 32], to: 'base', facing: 'north' },
                    { at: [41, 3], to: 'valley', facing: 'south', requires: 'goblinChief' }
                ],
                chests: [{ at: [46, 5], loot: 'chiefChest', requires: 'goblinChief' }]
            },
            // The second region: rocks and gravel, a wolf pack; the wolf king
            // keeps the north-east corner and its chest.
            valley: {
                name: '灰岩山谷',
                rows: [
                    '..T.T..T..T....T.T......T....T.......T..T..T.T..',
                    '.TT.TT.....T.T..T..T...T....T....T.......T......',
                    'T.............................................T.',
                    'T..33433#P#3343334333433343334333433343334333...',
                    '...4..........................3.............4...',
                    '...3.T;;;;.;;T............T...3...........C.3...',
                    '...3...;;;;.;......12O..;;.;;.3.............3..T',
                    '...3..;.;;;;............;;;.;.3.............3.T.',
                    'T..4..;;.;;;;.......w...;;;;..3......K......4...',
                    'TT.3..;;;.;;;.........w..;;;;.3..1..........3...',
                    '...3.h...........1......;.;;;.3.............3..T',
                    '.T.3.................w........3.............3.T.',
                    '.T.4......23O.................3.............4...',
                    '...3.......2..................33333..33333333..T',
                    '...3............;;;.;;;;...........::.......3...',
                    'TT.3............;;;;.;;;;.21O......::.......3..T',
                    '.T.4..2..........;;;;.;;;..........::.......4...',
                    'TT.3..1.....g...;.;;;;.;;..........::....1..3...',
                    '.T.3............;;.;;;;.;.......;.;::;.;;...3...',
                    '...3............;;;.;;;;..g.....;;.::;;.;...3.T.',
                    '...4T..........1O............2..;;;::;;;w...4...',
                    '.T.3.........................32.;;;::;;;;...3...',
                    '...3....;;;;.;......w...1........;;::.;;;..T3..T',
                    '...3.....;;;;...................;.;::;.;;...3...',
                    'T..4....:::::::::::::::::::::::::::::...h...4...',
                    '...3....:;.;;;:...........................1.3...',
                    '.T.3....:;;.;;:.....h.............g.........3...',
                    '...3....:.....:.......1...............21O...3.T.',
                    '...4....:..@..:.............................4.T.',
                    '...3....:.....:.............................3.T.',
                    '...3122#P#221#P#12221222122212221222122212223.T.',
                    '................................................',
                    '................................................',
                    '................................................'
                ],
                portals: [
                    { at: [8, 30], to: 'field', facing: 'north' },
                    { at: [14, 30], to: 'base', facing: 'north' },
                    { at: [9, 3], to: 'cave', facing: 'south' }
                ],
                chests: [{ at: [42, 5], loot: 'kingChest', requires: 'wolfKing' }]
            },
            // A dark cave off the valley (design.md 2.5): nothing to see
            // without a lit torch. Its treasure room is shut by a thicket the
            // torch burns away.
            cave: {
                name: '幽暗洞穴', dark: true, floor: ';',
                rows: [
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;333333333333333333333333333333333333;;;',
                    ';;;33333;;;;33333;;;;;;;;;;;3;;;;;;;;;3;;;',
                    ';;;33333;;;;33333;;;2X;;;;;;3;;;;;;;;;3;;;',
                    ';;;33333;;;;33333;;;;;;;;;;;3;;;;;;C;;3;;;',
                    ';;;3;;;;;;;;33333;;;;;;;;;;;3;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;33333;;;w;;;;;;;3;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;;;;;;;;;;;;3;;;;;;;;X3;;;',
                    ';;;3;;;;g;;;;;;;;;;;;;;;;;;;3;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;333333;;;;;333BBB33333;;;',
                    ';;;3;;;;;;22X;;;;333333;;;;;;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;333333;;;;;;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;w;;333333;;;;;2;X;2;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;333333;3333;;;;;;;;;;3;;;',
                    ';;;3333333;;;;;;;;;;;;;;3333;;;;;;;;;;3;;;',
                    ';;;3333333;;;;;;;;;;;;;;3333;;;w;;;;;;3;;;',
                    ';;;3333333;;;;;;;;;;;;;;3333;;;;;333333;;;',
                    ';;;3333333;;;;;;;;;;;;;;3333;;;;;333333;;;',
                    ';;;3;;;;;;;33333;;;;;;;;3333;;;;;333333;;;',
                    ';;;3;;;;;;;33333;;;;;;;;3333;;g;;333333;;;',
                    ';;;3;;;;;;;33333;;;;;;;;3333;;;;;;;;;;3;;;',
                    ';;;3;;;;2O;;;;;;;;;;;2;;3333;;2;;;;;;;3;;;',
                    ';;;3;;;;;;;;@;;;;;;;;;;;;;;;;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;3;;;',
                    ';;;333333#P#333333333333333333333333333;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;'
                ],
                portals: [{ at: [10, 26], to: 'valley', facing: 'north' }],
                chests: [{ at: [35, 6], loot: 'caveChest' }]
            },
            clearing: {
                name: '训练场', training: true,
                dummyFacing: Math.PI,
                rows: [
                    '..T....T....T......T....T.....T...',
                    'T....T....T....T.T....T....T......',
                    '..T...T.T...T.....T..T...T.T..T.T.',
                    '.T..22221222222122222222122222..T.',
                    '.T..2.....................:..2....',
                    '....1.....................:..2.T..',
                    '..T.2...1.................:..1....',
                    '....#.....................:..2..T.',
                    '.T..P.............@...D..::..1....',
                    '....#..................::....2.T..',
                    '..T.2...............:::......1....',
                    '....1.........1....::........2..T.',
                    '.T..2..............:.........1....',
                    '....1..............:.........2.T..',
                    '....21111211112111112111121112..T.',
                    '..................................',
                    '..................................',
                    '..................................'
                ],
                portals: [{ at: [4, 8], to: 'base', facing: 'east' }]
            },
            // The PVP arena (design.md 8.3): 20 x 11 blocks inside a
            // wall, the same seen from either spawn (point symmetric). Walls
            // inside and to the south are 2 high, so they hide a fighter
            // without hiding one standing behind them from the camera.
            arena: {
                name: '竞技场', duel: true,
                rows: [
                    '.T.TT.......TTT....T.....T..',
                    '.T.T............T..TT......T',
                    '.T.......TT.....T.T.....T...',
                    '...3333333333333333333333...',
                    '...3....................3...',
                    '...3.1......1........1..3...',
                    '.T.3....222..22..22.....3.T.',
                    '...3....2....22..2......3.T.',
                    '.T.3........::::........3...',
                    '.T.3.::@::::::::::::@::.3.T.',
                    '.T.3........::::........3.T.',
                    '...3......2..22....2....3.T.',
                    '.T.3.....22..22..222....3.T.',
                    '...3..1........1......1.3...',
                    '.T.3....................3.T.',
                    '...2222222222222222222222...',
                    '............................',
                    '............................',
                    '............................',
                    '............................'
                ]
            }
        },

        // 10. PVP (design.md 8): one phone hosts and runs the duel,
        // the other sends its controls and draws the host's snapshots,
        // predicting its own moves in between. countdown: seconds from both
        // being ready to the fight. snapshotSeconds: host to guest state;
        // heartbeatSeconds: guest to host when it has nothing else to say;
        // timeoutSeconds: nothing heard for this long and the connection
        // counts as lost. replaySeconds: how far past a snapshot the guest
        // predicts at most; latencySeconds: cap on its one-way estimate.
        // historyEvents: events the host keeps until the guest has them.
        // connectSeconds: how long finding the other phone may take.
        // weapons: the main hands each side may pick before a duel (user
        // 2026-10-02: one of each weapon type); the rest is gear.starter.
        pvp: {
            countdown: 3, snapshotSeconds: 0.05, heartbeatSeconds: 0.25, timeoutSeconds: 5,
            replaySeconds: 0.25, latencySeconds: 0.15, historyEvents: 128, connectSeconds: 12,
            weapons: ['wooden_sword', 'assassin_dagger']
        }
    });
})();
