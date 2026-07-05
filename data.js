// ====== Active Data: current game state ======
const state = {
    time: { tick: 0, days: 1, hours: 6, minutes: 0, period: 'day' },
    resources: { gold: 0, stone: 0 },
    inventory: {
        exp: 0,
        items: {},
        materials: {}
    },
    base: { buildings: { goldMine: 1, stoneMine: 0, hotSpring: 0, smithy: 0 } },
    player: {
        level: 1,
        baseStats: { maxHp: 100, atk: 10, def: 3, spd: 10, int: 10, luck: 5 },
        currentHp: 100,
        equip: { left: 'wooden_sword', right: 'wooden_shield', armor: null, accessory: null }
    },
    world: {
        status: 'base',
        currentTab: 'base',
        currentArea: null,
        currentFightIndex: 0
    },
    pveBattle: null   // created at runtime by pveLogic.startFight (transient, never saved)
};

// ====== Static Data: game config ======
const content = {
    items: {
        wooden_sword: {
            id: 'wooden_sword', name: "木剑", type: "weapon", icon: "🗡️", iconKey: 'weapon-atk',
            slots: ['left', 'right'],
            stats: { atk: 8, def: 0 },
            effects: [],
            desc: "简陋木剑，无特殊效果"
        },
        iron_sword: {
            id: 'iron_sword', name: "铁剑", type: "weapon", icon: "🗡️", iconKey: 'weapon-atk',
            slots: ['left', 'right'],
            stats: { atk: 22, def: 0 },
            effects: [{ type: 'charge_threshold_ms', value: 700 }],
            desc: "攻击强劲，但蓄力阈值更高，轻点难以脱手"
        },
        wooden_shield: {
            id: 'wooden_shield', name: "木盾", type: "shield", icon: "🛡️", iconKey: 'shield-def',
            slots: ['left', 'right'],
            stats: { atk: 0, def: 8 },
            effects: [{ type: 'guard_damage_reduce', value: 0.25 }],
            desc: "格挡成功时额外减伤 25%"
        },
        iron_shield: {
            id: 'iron_shield', name: "铁盾", type: "shield", icon: "🔰", iconKey: 'shield-def',
            slots: ['left', 'right'],
            stats: { atk: 0, def: 18 },
            effects: [{ type: 'guard_damage_reduce', value: 0.40 }, { type: 'parry_window_ms', value: 150 }],
            desc: "格挡减伤更强，但弹反判定窗口更严格"
        },
        swift_ring: {
            id: 'swift_ring', name: "疾速戒指", type: "accessory", icon: "💍",
            slots: ['accessory'],
            stats: { atk: 0, def: 0, spd: 3 },
            effects: [],
            desc: "穿戴后行动力回复明显加快"
        },
        wooden_armor: {
            id: 'wooden_armor', name: "布甲", type: "armor", icon: "👕",
            slots: ['armor'],
            stats: { atk: 0, def: 5 },
            effects: [],
            desc: "简陋布制护甲，提供基础防御"
        },
        iron_armor: {
            id: 'iron_armor', name: "铁甲", type: "armor", icon: "🥋",
            slots: ['armor'],
            stats: { atk: 0, def: 14 },
            effects: [],
            desc: "坚实铁甲，大幅提升防御"
        },
        wisdom_ring: {
            id: 'wisdom_ring', name: "智慧之环", type: "accessory", icon: "🧿",
            slots: ['accessory'],
            stats: { atk: 0, def: 0, int: 10 }, // +10 int
            effects: [],
            desc: "提升洞察力，显著延长完美拼刀与弹反的判定窗口"
        }
    },

    materials: {
        goblin_ear: { id: 'goblin_ear', name: "哥布林耳", icon: "👂" },
        wolf_pelt: { id: 'wolf_pelt', name: "狼皮", icon: "🐺" },
        orc_tooth: { id: 'orc_tooth', name: "兽人獠牙", icon: "🦷" },
        dragon_scale: { id: 'dragon_scale', name: "龙鳞", icon: "🐉" },
        dragon_fang: { id: 'dragon_fang', name: "龙牙", icon: "🦴" }
    },

    recipes: {
        iron_sword: { materials: { goblin_ear: 3, wolf_pelt: 1 } },
        iron_shield: { materials: { orc_tooth: 3 } },
        swift_ring: { materials: { wolf_pelt: 2, goblin_ear: 1 } },
        wooden_armor: { materials: { goblin_ear: 2 } },
        iron_armor: { materials: { orc_tooth: 2, wolf_pelt: 1 } },
        wisdom_ring: { materials: { goblin_ear: 2, orc_tooth: 1 } }
    },

    enemies: {
        test_combat: {
            name: "测试木桩", hp: 200, atk: 5, def: 1, exp: 20,
            baseMsCharge: 1000,
            acts: {
                act1: { name: "快斩", dmgMult: 1.0, windupMs: 400, recoveryMs: 100 },
                act2: { name: "重击", dmgMult: 1.5, windupMs: 600, recoveryMs: 1000 }
            },
            drops: []
        },
        goblin: {
            name: "哥布林", hp: 55, atk: 12, def: 4, exp: 20,
            iconKey: 'goblin',
            baseMsCharge: 2200,
            acts: {
                act1: { name: "乱挥", dmgMult: 1.0, windupMs: 480, recoveryMs: 200 },
                act2: { name: "猛扑", dmgMult: 1.2, windupMs: 600 }
            },
            drops: [{ id: 'goblin_ear', chance: 0.85, amount: [1, 2] }]
        },       
        wolf: {
            name: "野狼", hp: 50, atk: 18, def: 3, exp: 15,
            baseMsCharge: 1900,
            acts: {
                act1: { name: "撕咬", dmgMult: 1.0, windupMs: 380, recoveryMs: 0 },
                act2: { name: "扑击", dmgMult: 1.3, windupMs: 500, recoveryMs: 0 }
            },
            drops: [{ id: 'wolf_pelt', chance: 0.90, amount: [1, 2] }]
        },
		orc: {
            name: "兽人苦工", hp: 80, atk: 25, def: 8, exp: 50,
            baseMsCharge: 2400,
            acts: {
                act1: { name: "挥锤", dmgMult: 1.0, windupMs: 420, recoveryMs: 250 },
                act2: { name: "砸地", dmgMult: 1.5, windupMs: 600 }
            },
            drops: [{ id: 'orc_tooth', chance: 0.75, amount: [1, 1] }]
        },
        young_dragon: {
            name: "幼龙", hp: 200, atk: 30, def: 8, exp: 120,
            baseMsCharge: 1800,
            acts: {
                act1: { name: "爪击", dmgMult: 1.0, windupMs: 380, recoveryMs: 100 },
                act2: { name: "火焰吐息", dmgMult: 1.5, windupMs: 600 }
            },
            drops: [{ id: 'dragon_scale', chance: 0.80, amount: [1, 2] }]
        },
        elder_dragon: {
            name: "古龙", hp: 500, atk: 55, def: 15, exp: 400,
            baseMsCharge: 1500,
            acts: {
                act1: { name: "龙爪斩", dmgMult: 1.0, windupMs: 350, recoveryMs: 100 },
                act2: { name: "龙焰冲击", dmgMult: 2.0, windupMs: 600, recoveryMs: 200 }
            },
            drops: [
                { id: 'dragon_scale', chance: 1.00, amount: [2, 4] },
                { id: 'dragon_fang', chance: 0.50, amount: [1, 1] }
            ],
            ai: {
                feintChance:     0.35,
                feintAbortMs:    [400, 900],
                comboChance:     0.5,
                comboMax:        2,
                comboDelayMs:    [150, 300],
                enrageThreshold: 0.3,
                enrageAtkMult:   1.4,
                enrageSpdMult:   1.25
            }
        }
    },

    areas: {
        forest: { name: "迷雾森林", encounters: ["goblin", "wolf", "goblin", "orc"] },
        cave: { name: "幽暗洞穴", encounters: ["goblin", "orc", "wolf", "orc"] },
        dragon_cave: { name: "龙之洞", encounters: ["young_dragon", "young_dragon", "elder_dragon"] },
        traning: { name: "训练场", encounters: ["test_combat", "test_combat", "test_combat"] }
    },

    buildings: {
        goldMine: { name: "金矿", baseProduce: { gold: 1 } },
        stoneMine: { name: "采石场", baseProduce: { stone: 1 } },
        hotSpring: { name: "温泉", baseProduce: {} },
        smithy: { name: "铁匠铺", baseProduce: {} }
    },

    slotMeta: {
        left: { label: "武器", hint: "武器/盾牌" },
        right: { label: "副手", hint: "武器/盾牌" },
        armor: { label: "护甲", hint: "护甲" },
        accessory: { label: "饰品", hint: "饰品" }
    }
};