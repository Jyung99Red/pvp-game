// Game tuning entry point. Loaded before both the game and training scripts.
// Edit values here, then reload the page / start a new battle to apply them.
// All comments are English; player-facing names and descriptions stay Chinese.
// Times use seconds unless the field ends in Ms. Positions/ranges use world units;
// speeds use world units/second, angles use radians unless explicitly noted.
// Ratios use 0..1 (0.30 = 30%); multipliers use 1 as the unchanged value.
// The training section also supplies shared movement, action timing and SP limits.
// Formal profiles override training damage, resource rates and character stats.
// Simulation steps, network limits, collision precision and CSS remain in their owners.
// Existing saves retain earned base stats. Equipment values apply on reload.
// PVP balance changes require a RULE_VERSION bump in pvp/pvp_logic.js.
const gameConfig = (() => {
    const config = {
        // 1. Character growth, equipment enhancement and recovery.
        progression: {
            baseStats: { maxHp: 100, atk: 10, def: 3, focus: 10, insight: 10, luck: 5 },
            startingEquipment: { left: 'wooden_sword', right: 'wooden_shield', armor: null, accessory: null },
            levelStats: { maxHp: 20, atk: 3, def: 2, focus: 0.2, insight: 1 },
            levelExpPerLevel: 100, // Required EXP = current level * this value.
            buildingUpgrade: { baseGold: 50, levelExponent: 2 },
            enhancement: { maxLevel: 5, statBonusPerLevel: 0.10, goldPerLevel: 100 },
            insight: { baseline: 10, windowPerPoint: 0.03, minMultiplier: 0.5 },
            critChancePerLuck: 0.01,
            // Recovery runs once per second, including during active PVE.
            recovery: { passiveEveryTicks: 2, passiveHp: 1, hotSpringCombatPenalty: 1, reviveHpRatio: 0.10 },
        },

        // 2. Formal PVE/PVP resource rules and damage coefficients.
        resources: {
            focusBaseline: 10, minFocus: 0.1,
            apMax: 5, apRecoveryMs: 2000, spRecoveryMs: 3000,
            attackApCost: 1, guardRequiredAp: 1, blockApCost: 1,
            chargeThresholdMs: 300,
            weaponChargeThresholdMs: { basic: 300, heavy: 350, light: 280 },
            parryWindowMs: 200,
        },
        damage: {
            // Damage = max(1, round(raw * (1 - DEF / (DEF + defenseConstant)))).
            // DEF equal to defenseConstant halves incoming raw damage.
            defenseConstant: 17.5,
            critMultiplier: 1.5,
            lightAtkRatio: 0.30,
            heavyAtkRatio: 0.30,
            heavyChargeAtkRatio: 0.80,
            parryAtkRatio: 0.50,
            blockMultiplier: 0.40, // Multiplied by equipment guard reduction.
            fullChargeAfterThreshold: 2,
            maxParryWindow: 1,
            fallbackHeavyRangeRatio: 0.60,
            fallbackHeavyArcRatio: 0.40,
        },

        // 3. Touch input. Distances are CSS pixels; hysteresis is radians.
        input: { deadZone: 12, holdSeconds: 0.25, cancelRadius: 24, skillDeadZone: 24, directionHysteresis: 0.12 },
        controls: { cancelAtCenter: true, autoFace: false },

        // 4. Skills shared by PVE and both PVP modes. Costs are SP.
        skills: {
            heal: { id: 'heal', name: '治疗', direction: 'up', cost: 2, healRatio: 0.3 },
            haste: { id: 'haste', name: '疾速', direction: 'right', cost: 2, duration: 10, chargeRate: 1.5, moveMultiplier: 1.1, turnMultiplier: 1.05 },
            full: { id: 'full', name: '满蓄', direction: 'down', cost: 2 },
            parry: { id: 'parry', name: '弹反', direction: 'left', cost: 3 }
        },
        // Optional per-skill overrides: { pve: { heal: { healRatio: 0.4 } }, fair: {} }.
        // Both PVP modes use fair skill rules; character stats remain mode-specific.
        skillOverrides: { pve: {}, fair: {} },

        // 5. Training baseline, also copied before formal mode overrides.
        // Formal profiles replace HP/DEF, AP/SP recovery, damage and charge limits.
        training: {
            width: 360, height: 400,
            fullCharge: 1.6, // Training only; formal charge duration comes from damage/resources.
            playerSpeed: 115, // Base movement speed shared by all modes.
            playerTurn: 8, chargeMoveMultiplier: 0.6, chargeTurnMultiplier: 0.65,
            guardMoveMultiplier: 0.3, guardTurnMultiplier: 0.5,
            motion: { move: 1, turn: 1, chargeMove: 1, chargeTurn: 1 },
            player: { x: 180, y: 275, radius: 12, facing: -Math.PI / 2, hp: 120, maxHp: 120 },
            enemy: { x: 180, y: 160, radius: 23, facing: Math.PI / 2, hp: 360, maxHp: 360 },
            ai: { initialDelay: 0.8, delay: 0.45, speed: 47, stopDistance: 88, attackDistance: 150, turn: 3, trackingTurn: 1.6 },
            stagger: { threshold: 3, duration: 1.5, heavy: 1, parry: 1 },
            apRegen: 0.7, // Training AP/second; formal rates come from focus.
            moveRamp: 32, // CSS pixels beyond the dead zone to reach full speed.
            hitStun: 0.35, // Shared hit stun duration.
            blockMultiplier: 0.25, parryDamage: 10, // Training only; formal values use damage coefficients.
            parryCost: 0.5, // Shared AP cost for manual parry; the skill costs SP instead.
            guardStartup: 0.16, // Shared delay before guard becomes active.
            parryWindow: 0.18, apMax: 5, // Training defaults; formal profiles override both.
            skillPointMax: 3, // SP cap shared by training, PVE and PVP.
            spRegen: 1 / 3, // Training SP/second; formal rates come from focus.
            light: { kind: 'sector', range: 69, arc: Math.PI * 0.52, damage: 18, windup: 0.10, recovery: 0.28 },
            heavy: { kind: 'sector', minRange: 60, range: 103, minArc: Math.PI * 0.28, arc: Math.PI * 0.68, damage: 28, chargeBonus: 30, windup: 0.45, recovery: 0.6 },
            sweep: { kind: 'sector', range: 145, arc: Math.PI * 0.64, windup: 1.35, lock: 0.45, active: 0.16, recovery: 1.3, damage: 25 },
            stomp: { kind: 'circle', range: 110, windup: 1.5, lock: 0.55, active: 0.16, recovery: 1.45, damage: 30 }
        },

        // 6. Camera and arenas. PVE spawn offsets preserve encounter distances.
        camera: { width: 350, height: 390, followRate: 12, leadRate: 8, leadSeconds: 0.16, maxLead: 24 },
        pveArena: { width: 510, height: 566, spawnOffsetX: 75, spawnOffsetY: 83 },
        pvpSpawnOffset: 90, // Each player starts this far from the arena center.
        pvpArena: {
            width: 570, height: 630, layoutId: 'pvp-l-v1', version: 1,
            walls: [
                { id: 'left-vertical', x: 135, y: 200, width: 24, height: 130 },
                { id: 'left-horizontal', x: 135, y: 306, width: 110, height: 24 },
                { id: 'right-vertical', x: 411, y: 300, width: 24, height: 130 },
                { id: 'right-horizontal', x: 325, y: 300, width: 110, height: 24 }
            ]
        },
        fairProfile: {
            level: 1, maxHp: 120, atk: 30, def: 8, focus: 10, insight: 10, apMax: 5,
            critChance: 0, guardThorns: 0, chargeThresholdMs: 300, parryWindowBaseMs: 180,
            judgmentMultiplier: 1, guardDamageMultiplier: 1,
            motion: { move: 1, turn: 1, chargeMove: 1, chargeTurn: 1 }
        },

        // 7. Dungeon scaling and common enemy behavior.
        dungeon: { statGrowthPerFloor: 0.08, goldPerExp: 0.60 },
        enemyDefaults: { apMax: 5, focus: 10, comboChance: 0, comboMax: 0, comboDelayMs: 200,
            enrageThreshold: 0, enrageAtkMult: 1.3, enrageSpdMult: 1.2 },
        enemyTiming: { windupBonus: 0.10, recoveryBonus: 0.15, active: 0.16 },
        arenaEffects: {
            ap_surge: { atMs: 30000, apRateMult: 2 },
            burning_ground: { startMs: 20000, intervalMs: 3000, pct: 0.03 },
        },

        // 8. Enemy moves. arc is a multiple of PI in this section only.
        // windup/recovery are base times; enemyTiming bonuses are added once.
        // Dash width is the path half-width; body radius also affects collision.
        enemyMoves: {
            test_combat: [
                { kind: 'sector', range: 90, arc: 0.6, windup: 1.2, lock: 0.4, recovery: 0.8, multiplier: 0.6 },
                { kind: 'circle', range: 85, windup: 1.5, lock: 0.5, recovery: 1, multiplier: 1 }
            ],
            goblin: [
                { kind: 'sector', range: 90, arc: 0.65, windup: 1.2, lock: 0.4, recovery: 0.7, multiplier: 0.6 },
                { kind: 'sector', range: 120, arc: 0.4, windup: 1.5, lock: 0.5, recovery: 1, multiplier: 0.9 }
            ],
            wolf: [
                { kind: 'sector', range: 85, arc: 0.45, windup: 0.95, lock: 0.3, recovery: 0.6, multiplier: 0.6 },
                { kind: 'dash', windup: 1.05, lock: 0.35, recovery: 1.2, multiplier: 0.9, distance: 150, speed: 280, width: 18 }
            ],
            orc: [
                { kind: 'sector', range: 115, arc: 0.65, windup: 1.35, lock: 0.45, recovery: 0.9, multiplier: 0.7 },
                { kind: 'circle', range: 105, windup: 1.65, lock: 0.55, recovery: 1.2, multiplier: 1.1 }
            ],
            young_dragon: [
                { kind: 'sector', range: 110, arc: 0.65, windup: 1.15, lock: 0.4, recovery: 0.8, multiplier: 0.7 },
                { kind: 'sector', range: 170, arc: 0.4, windup: 1.65, lock: 0.55, recovery: 1.1, multiplier: 1.1 }
            ],
            skeleton_warrior: [
                { kind: 'sector', range: 100, arc: 0.55, windup: 1.1, lock: 0.4, recovery: 0.8, multiplier: 0.7 },
                { kind: 'sector', range: 135, arc: 0.7, windup: 1.5, lock: 0.5, recovery: 1, multiplier: 1.1 }
            ],
            shadow_assassin: [
                { kind: 'sector', range: 100, arc: 0.35, windup: 0.8, lock: 0.3, recovery: 0.55, multiplier: 0.6 },
                { kind: 'dash', windup: 0.55, lock: 0.25, recovery: 0.9, multiplier: 1.1, distance: 180, speed: 450, width: 12 }
            ],
            stone_golem: [
                { kind: 'sector', range: 135, arc: 0.65, windup: 1.5, lock: 0.5, recovery: 1.1, multiplier: 0.7 },
                { kind: 'circle', range: 120, windup: 1.8, lock: 0.65, recovery: 1.4, multiplier: 1.1 }
            ],
            elder_dragon: [
                { kind: 'sector', range: 140, arc: 0.65, windup: 1.1, lock: 0.4, recovery: 0.85, multiplier: 0.7 },
                { kind: 'sector', range: 185, arc: 0.5, windup: 1.65, lock: 0.55, recovery: 1.2, multiplier: 1.1 }
            ],
            abyss_lord: [
                { kind: 'sector', range: 145, arc: 0.6, windup: 1.05, lock: 0.4, recovery: 0.8, multiplier: 0.7 },
                { kind: 'circle', range: 130, windup: 1.6, lock: 0.55, recovery: 1.2, multiplier: 1.1 }
            ]
        },

        // 9. Content catalog: equipment stats/effects, enemies, drops, recipes,
        // floor pools, bosses, buildings and shop prices. IDs are stable save keys.
        content: {
            items: {
                wooden_sword: {
                    id: 'wooden_sword', name: "木剑", type: "weapon", icon: "🗡️", iconKey: 'weapon-atk',
                    weaponTemplate: 'basic',
                    slots: ['left', 'right'],
                    stats: { atk: 8, def: 0 },
                    effects: [],
                    desc: "简陋木剑，无特殊效果"
                },
                iron_sword: {
                    id: 'iron_sword', name: "铁剑", type: "weapon", icon: "🗡️", iconKey: 'weapon-atk',
                    weaponTemplate: 'heavy',
                    slots: ['left', 'right'],
                    stats: { atk: 22, def: 0 },
                    effects: [],
                    desc: "重型武器，蓄力增伤起点比标准武器晚约 50ms"
                },
                wooden_shield: {
                    id: 'wooden_shield', name: "木盾", type: "shield", icon: "🛡️", iconKey: 'shield-def',
                    slots: ['left', 'right'],
                    stats: { atk: 0, def: 6 },
                    effects: [{ type: 'guard_damage_reduce', value: 0.25 }],
                    desc: "格挡成功时额外减伤 25%"
                },
                iron_shield: {
                    id: 'iron_shield', name: "铁盾", type: "shield", icon: "🔰", iconKey: 'shield-def',
                    slots: ['left', 'right'],
                    stats: { atk: 0, def: 24 },
                    effects: [{ type: 'guard_damage_reduce', value: 0.40 }, { type: 'parry_window_ms', value: 150 }],
                    desc: "格挡减伤更强，但弹反判定窗口更严格"
                },
                swift_ring: {
                    id: 'swift_ring', name: "疾速戒指", type: "accessory", icon: "💍",
                    slots: ['accessory'],
                    stats: { atk: 0, def: 0, focus: 3 },
                    effects: [],
                    desc: "提升专注，使行动力与技能点回复加快"
                },
                wooden_armor: {
                    id: 'wooden_armor', name: "布甲", type: "armor", icon: "👕",
                    slots: ['armor'],
                    stats: { atk: 0, def: 3 },
                    effects: [],
                    desc: "简陋布制护甲，提供基础防御"
                },
                iron_armor: {
                    id: 'iron_armor', name: "铁甲", type: "armor", icon: "🥋",
                    slots: ['armor'],
                    stats: { atk: 0, def: 20 },
                    effects: [],
                    desc: "坚实铁甲，大幅提升防御"
                },
                wisdom_ring: {
                    id: 'wisdom_ring', name: "智慧之环", type: "accessory", icon: "🧿",
                    slots: ['accessory'],
                    stats: { atk: 0, def: 0, insight: 10 }, // +10 insight
                    effects: [],
                    desc: "提升心眼，延长弹反判定窗口"
                },
                assassin_dagger: {
                    id: 'assassin_dagger', name: "刺客短刃", type: "weapon", icon: "🔪", iconKey: 'weapon-atk',
                    weaponTemplate: 'light',
                    slots: ['left', 'right'],
                    stats: { atk: 14, def: 0 },
                    effects: [{ type: 'crit_chance', value: 0.20 }],
                    desc: "轻型武器，蓄力增伤起点比标准武器早约 20ms，且易命中要害"
                },
                thorn_armor: {
                    id: 'thorn_armor', name: "荆棘甲", type: "armor", icon: "🌵",
                    slots: ['armor'],
                    stats: { atk: 0, def: 10 },
                    effects: [{ type: 'guard_thorns', value: 0.5 }],
                    desc: "格挡成功时将一半原始伤害反弹给攻击者"
                },
                vigor_ring: {
                    id: 'vigor_ring', name: "战意戒指", type: "accessory", icon: "🔥",
                    slots: ['accessory'],
                    stats: { atk: 0, def: 0 },
                    effects: [{ type: 'ap_max_bonus', value: 1 }],
                    desc: "行动力上限提升 1 点"
                }
            },

            materials: {
                goblin_ear: { id: 'goblin_ear', name: "哥布林耳", icon: "👂" },
                wolf_pelt: { id: 'wolf_pelt', name: "狼皮", icon: "🐺" },
                orc_tooth: { id: 'orc_tooth', name: "兽人獠牙", icon: "🦷" },
                dragon_scale: { id: 'dragon_scale', name: "龙鳞", icon: "🐉" },
                dragon_fang: { id: 'dragon_fang', name: "龙牙", icon: "🦴" },
                shadow_crystal: { id: 'shadow_crystal', name: "暗影结晶", icon: "🔮" }
            },

            recipes: {
                iron_sword: { materials: { goblin_ear: 3, wolf_pelt: 1 } },
                iron_shield: { materials: { orc_tooth: 3 } },
                swift_ring: { materials: { wolf_pelt: 2, goblin_ear: 1 } },
                wooden_armor: { materials: { goblin_ear: 2 } },
                iron_armor: { materials: { orc_tooth: 2, wolf_pelt: 1 } },
                wisdom_ring: { materials: { goblin_ear: 2, orc_tooth: 1 } },
                assassin_dagger: { materials: { wolf_pelt: 2, shadow_crystal: 2 } },
                thorn_armor: { materials: { orc_tooth: 2, shadow_crystal: 2, dragon_scale: 1 } },
                vigor_ring: { materials: { shadow_crystal: 3, goblin_ear: 1 } }
            },

            // Enemy act names are display metadata; enemyMoves defines geometry and timings.
            enemies: {
                test_combat: {
                    name: "测试木桩", hp: 200, atk: 5, def: 1, exp: 20,
                    acts: {
                        act1: { name: "快斩" },
                        act2: { name: "重击" }
                    },
                    drops: []
                },
                goblin: {
                    name: "哥布林", hp: 55, atk: 12, def: 4, exp: 20,
                    iconKey: 'goblin',
                    acts: {
                        act1: { name: "乱挥" },
                        act2: { name: "猛扑" }
                    },
                    drops: [{ id: 'goblin_ear', chance: 0.85, amount: [1, 2] }]
                },
                wolf: {
                    name: "野狼", hp: 50, atk: 18, def: 3, exp: 15,
                    acts: {
                        act1: { name: "撕咬" },
                        act2: { name: "扑击" }
                    },
                    drops: [{ id: 'wolf_pelt', chance: 0.90, amount: [1, 2] }]
                },
                orc: {
                    name: "兽人苦工", hp: 80, atk: 25, def: 8, exp: 50,
                    acts: {
                        act1: { name: "挥锤" },
                        act2: { name: "砸地" }
                    },
                    drops: [{ id: 'orc_tooth', chance: 0.75, amount: [1, 1] }]
                },
                young_dragon: {
                    name: "幼龙", hp: 200, atk: 30, def: 8, exp: 120,
                    acts: {
                        act1: { name: "爪击" },
                        act2: { name: "火焰吐息" }
                    },
                    drops: [{ id: 'dragon_scale', chance: 0.80, amount: [1, 2] }]
                },
                // ── Deep floors (10+) ──
                skeleton_warrior: {
                    name: "骷髅武士", hp: 130, atk: 34, def: 10, exp: 80,
                    acts: {
                        act1: { name: "骨刃斩" },
                        act2: { name: "碎骨击" }
                    },
                    drops: [
                        { id: 'orc_tooth', chance: 0.40, amount: [1, 1] },
                        { id: 'shadow_crystal', chance: 0.35, amount: [1, 1] }
                    ]
                },
                shadow_assassin: {
                    name: "暗影刺客", hp: 95, atk: 42, def: 6, exp: 100,
                    acts: {
                        act1: { name: "影袭" },
                        act2: { name: "致命突刺" }
                    },
                    ai: { focus: 12 },
                    drops: [{ id: 'shadow_crystal', chance: 0.60, amount: [1, 2] }]
                },
                stone_golem: {
                    name: "岩石傀儡", hp: 320, atk: 30, def: 24, exp: 120,
                    acts: {
                        act1: { name: "岩拳" },
                        act2: { name: "地裂" }
                    },
                    ai: { focus: 8 },
                    drops: [
                        { id: 'orc_tooth', chance: 0.60, amount: [1, 2] },
                        { id: 'shadow_crystal', chance: 0.25, amount: [1, 1] }
                    ]
                },
                // ── Bosses (content.bossRotation) ──
                elder_dragon: {
                    name: "古龙", hp: 500, atk: 55, def: 15, exp: 400,
                    acts: {
                        act1: { name: "龙爪斩" },
                        act2: { name: "龙焰冲击" }
                    },
                    drops: [
                        { id: 'dragon_scale', chance: 1.00, amount: [2, 4] },
                        { id: 'dragon_fang', chance: 0.50, amount: [1, 1] }
                    ],
                    ai: {
                        comboChance:     0.5,
                        comboMax:        2,
                        comboDelayMs:    [150, 300],
                        enrageThreshold: 0.3,
                        enrageAtkMult:   1.4,
                        enrageSpdMult:   1.25
                    },
                    // Arena effect (arena_effects.js): dragon flame ignites the
                    // ground 20s in -- both sides burn every 3s, stalling loses
                    arena: [{ key: 'burning_ground',
                              logText: '🔥 龙焰点燃了地面！双方持续受到灼烧' }]
                },
                abyss_lord: {
                    name: "深渊领主", hp: 850, atk: 70, def: 20, exp: 700,
                    acts: {
                        act1: { name: "深渊爪" },
                        act2: { name: "湮灭波动" }
                    },
                    drops: [
                        { id: 'shadow_crystal', chance: 1.00, amount: [2, 3] },
                        { id: 'dragon_fang', chance: 0.80, amount: [1, 2] }
                    ],
                    ai: {
                        comboChance:     0.6,
                        comboMax:        3,
                        comboDelayMs:    [120, 260],
                        enrageThreshold: 0.4,
                        enrageAtkMult:   1.5,
                        enrageSpdMult:   1.3
                    },
                    // Arena effect: 30s in the abyss surges -- BOTH sides' AP
                    // recharges 2x, the whole fight shifts up-tempo
                    arena: [{ key: 'ap_surge',
                              logText: '🌀 深渊涌动！双方行动力恢复加速' }]
                }
            },

            // Roguelike dungeon floors (replaces the old fixed-area system).
            // Every bossFloorInterval'th floor (9, 18, 27...) is a boss floor,
            // rotating through bossRotation (floor 9 → [0], 18 → [1], 27 → [0]...).
            // Non-boss floors pick one enemy at random from the tier whose maxFloor
            // covers the ABSOLUTE floor number; floors past the last tier keep
            // drawing from it (stat scaling continues via _scaledEnemyData).
            floorPools: [
                { maxFloor: 3,  pool: ['goblin', 'wolf'] },
                { maxFloor: 6,  pool: ['goblin', 'wolf', 'orc'] },
                { maxFloor: 8,  pool: ['orc', 'young_dragon'] },
                { maxFloor: 12, pool: ['orc', 'young_dragon', 'skeleton_warrior'] },
                { maxFloor: 17, pool: ['skeleton_warrior', 'shadow_assassin', 'stone_golem'] }
            ],
            bossRotation: ['elder_dragon', 'abyss_lord'],
            bossFloorInterval: 9,

            buildings: {
                hotSpring: { name: "温泉", baseProduce: {} },
                smithy:    { name: "铁匠铺", baseProduce: {} },
                shop:      { name: "商店", baseProduce: {} }
            },

            // Shop: spend gold to buy materials directly (gold now comes from
            // combat/floor clears, not a production building) -- placeholder prices.
            shopPrices: {
                goblin_ear:     15,
                wolf_pelt:      20,
                orc_tooth:      25,
                dragon_scale:   60,
                dragon_fang:    120,
                shadow_crystal: 90
            },

            slotMeta: {
                left: { label: "武器", hint: "武器/盾牌" },
                right: { label: "副手", hint: "武器/盾牌" },
                armor: { label: "护甲", hint: "护甲" },
                accessory: { label: "饰品", hint: "饰品" }
            }
        },
    };
    // Templates are immutable; state and battle adapters create their own copies.
    function freeze(value) {
        for (const child of Object.values(value)) {
            if (child && typeof child === 'object') freeze(child);
        }
        return Object.freeze(value);
    }
    return freeze(config);
})();
