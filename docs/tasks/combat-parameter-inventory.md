# 战斗参数盘点（按当前代码）

盘点日期：2026-09-14；2026-09-16 复核（怪物 HP/DEF 重调、地牢相关行删除）。

本文只记录当前实现，服务于后续属性重设计；数值单位以代码语义为准。**数值以 `game_config.js` 为准**，本文是它的对照表：代码改了要顺手改这里，行号会漂移，定位以符号名/文件为准而不是行号。

当前所有面向玩法和平衡调整的数值以根目录 `game_config.js` 为唯一来源。该文件按成长、资源与伤害、输入、技能、训练模板、场地、区域、怪物动作和内容表分区，并使用英文注释标明单位和覆盖关系。模拟步长、网络超时、协议校验及纯表现常量继续由各自模块管理。

## 1. 读表规则与参数来源

| 来源 | 职责 | 关键事实 |
|---|---|---|
| `game_config.js` | 所有面向玩法和平衡调整的数值与内容表 | 唯一调参入口；修改后刷新页面并开始新战斗生效 |
| `pve/spatial_data.js` | 把集中配置转换成空间引擎现有接口 | 不再定义独立数值；负责角度、敌人动作和技能覆盖的适配 |
| `pve/pve_profiles.js` | 把敌人与玩家成长属性合成为正式 PVE preset | 复制训练模板，应用玩家属性，替换怪物 HP/DEF/动作伤害/AI 覆盖 |
| `pve/spatial_engine.js` | 纯模拟、时序、输入、碰撞调用、伤害、AI、技能 | 消费配置和派生后的 preset，不保存平衡参数副本 |
| `core/spatial_profiles.js` | 公平/养成 PVP 档案与玩家属性映射 | 公平档案和伤害系数均读取集中配置 |
| `core/data.js` | 运行时 state 与 content 副本 | 初始状态读取配置；content 从冻结配置深复制，供运行时安全使用 |
| `pvp/spatial_duel.js` | 两名人类的同步空间对局、同时命中收集、PVP 判定、快照 | 双方共用新防御公式；当前没有空间对刀/Clash 规则 |

世界坐标、半径、范围、移动速度都使用同一套无量纲世界单位；速度是世界单位/秒，角度是弧度。动作的 `windup`、`lock`、`active`、`recovery` 是秒；技能疾速持续时间也是秒。arena 的 `atMs/startMs/intervalMs` 是毫秒，PVE 在 `pve/pve_logic.js:L135-L142` 以 10ms 调用边界转换。手势死区和取消半径是 CSS 像素（`core/combat_gestures.js:L3-L24`）。

## 2. 共享空间模板与固定时序

### 2.1 训练基础模板

以下是 `gameConfig.training` 的固定基础值；训练场直接采用，正式 PVE/PVP 从这里深复制后套用 profile。

| 参数 | 值 | 单位/作用 |
|---|---:|---|
| 训练场 `width × height` | `360 × 400` | 世界单位；正式 PVE 覆盖为 `510 × 566`，PVP 覆盖为 `570 × 630` |
| `fullCharge` | `1.6` | 秒；正式 profile 按 `chargeThresholdMs/1000 + 2` 计算 |
| `playerSpeed` | `115` | 世界单位/秒 |
| `playerTurn` | `8` | 弧度/秒；普通自动转向/移动转向基础值 |
| `chargeMoveMultiplier` | `.6` | 蓄力移动倍率（2026-09-13） |
| `chargeTurnMultiplier` | `.65` | 蓄力转向倍率 |
| `guardMoveMultiplier` | `.3` | `guard_start`/`guard` 移动倍率 |
| `guardTurnMultiplier` | `.5` | 防御转向倍率 |
| `motion` | `{move:1,turn:1,chargeMove:1,chargeTurn:1}` | 装备/临时 buff 的四个独立乘区 |
| 玩家出生点 | `(180,275)`，半径 `12`，朝向 `-π/2` | 世界单位 |
| 训练敌人出生点 | `(180,160)`，半径 `23`，HP `360/360`，朝向 `π/2` | 世界单位；正式 PVE 替换 HP/DEF |
| `moveRamp` | `32` | CSS 像素；输入偏移超过死区后，速度倍率按 `(输入长度-12)/32` 线性爬升，最高 1 |
| `apMax` | `5` | 玩家 AP 上限基础值；`spatialEngine.create` 初始满 AP |
| `apRegen` | `.7` | 玩家 AP/秒（正式 PVE/PVP 会由 focus 重算） |
| `guardStartup` | `.16` | 秒；进入 `guard` 前的起步时间 |
| `parryWindow` | `.18` | 秒；正式 profile 由 `parryWindowBaseMs × judgmentMultiplier` 重算并最多 1 秒 |
| `parryCost` | `.5` | AP；自动弹反不扣 AP，普通防御窗口内弹反扣此值；这是与弹反技能 SP 费用不同的两个参数 |
| 防御转向基础值 | 使用 `playerTurn=8` | 弧度/秒；实际再乘 `motion.turn` 与 `guardTurnMultiplier` |
| `blockMultiplier` | `.25` | 训练基础承伤倍率；正式 profile 为 `.4 × guardDamageMultiplier` |
| `parryDamage` | `10` | 训练弹反原始反击伤害；正式为 `round(atk×.5)` |
| `hitStun` | `.35` | 秒；被敌人命中或 PVP 命中后的玩家硬直基础时长 |
| `stagger.threshold/duration` | `3 / 1.5` | 怪物累计 stagger 点数 / 秒 |
| `stagger.parry` | `1` | 弹反增加的 stagger 点数；招式的失衡值写在招式表（见 2.2） |
| `atk` | `60` | 训练用攻击力；招式伤害 = atk × 招式倍率。正式模式用角色 ATK |

正式 PVE 中出生点在深复制模板上整体平移 `(75,83)`，保持原 encounter 距离（`pve/pve_profiles.js:L9-L12`）。正式 PVP 以场地中心 `(285,315)` 为基准，主机 `(285,405)`、客机 `(285,225)`，双方半径都为 `12`（`pvp/spatial_duel.js:L14-L20`）。

### 2.2 玩家招式表（连招初版，2026-09-30）

招式表在 `gameConfig.combo`，所有武器共用；`pve/spatial_data.js` 把 `arc`（π 倍数）转成弧度后挂到基础预设的 `combo` 上。每招分三段：前摇（`attack` 阶段）→ 挥动（`swing`）→ 后摇（`recover`）。时序按招式写死，不受属性和装备影响。

- **命中**：挥动期间刀从扇形一侧扫到另一侧（`sweep` 1 从朝向左侧扫向右侧，-1 反向）。每个模拟步把刀扫过的角度区间当作一个小扇形做圆盘相交，所以快速挥动不会漏判；每招对同一目标只中一次，站在起刀一侧的先挨打。
- **派生点 `derive`**：从挥动结束起算。已缓冲下一段时，到派生点立刻出招，剩余后摇跳过；收尾招没有派生点，后摇完整放完。
- **连段窗口**：后摇结束后 `pauseAfterRecovery=.20s` 为停顿线，`windowAfterRecovery=.70s` 窗口关闭，之后回到第 1 段。越过停顿线再轻点走 `pause` 派生；节点没有停顿派生时按普通轻点。真正开始移动、受击会中断连段。
- **伤害** = `max(1, round(atk × ratio))`；蓄力斩为 `atk × (ratio + chargeRatio × 充能比例)`，充能比例在 `chargeThreshold` 到 `fullCharge` 之间线性插值，阈值前为 0。正式模式再过暴击和防御公式。
- **失衡**：命中时给怪物加该招的 `stagger` 点数，取代原来"重击 +1"的规则。

| 序列 | ID | 名称 | 射程 / 扇形 | 前摇 / 挥动 / 后摇 / 派生点 (s) | 倍率 | 失衡 | 派生 |
|---|---|---|---|---|---:|---:|---|
| `T` | `slash` | 横扫 | 69 / `.52π` | .10 / .08 / .30 / .12 | .30 | 0 | T→回扫，H→上挑 |
| `T T` | `backslash` | 回扫 | 72 / `.56π` | .10 / .08 / .36 / .14 | .32 | 0 | T→回旋斩，H→下劈，停顿 T→连刺 |
| `T T T` | `spin` | 回旋斩 | 78 / `2π` | .16 / .18 / .60 / — | .55 | 1 | 收尾 |
| `T T - T` | `thrust` | 连刺 | 100 / `.14π` | .12 / .06 / .55 / — | .60 | 1 | 收尾 |
| `T H` | `rising` | 上挑 | 85 / `.50π` | .30 / .10 / .60 / — | .70 | 1.5 | 收尾 |
| `T T H` | `cleave` | 下劈 | 95 / `.30π` | .30 / .08 / .65 / — | .80 | 1.5 | 收尾 |
| `H` | `charged` | 蓄力斩 | 60→103 / `.28π→.68π` | .45 / .12 / .60 / .25 | .30 + .80×充能 | 1 | T→追斩 |
| `H T` | `follow` | 追斩 | 75 / `.50π` | .10 / .08 / .45 / — | .40 | .5 | 收尾 |

正式 PVE/PVP profile 将 `chargeThresholdMs` 转为 `chargeThreshold` 秒，并计算 `fullCharge = chargeThreshold + 2`。武器模板决定蓄力增伤起点；从起点后固定2秒达到满伤害。训练仍保留 `1.6s` 基础满蓄值。

### 2.3 输入、排队和帧边界

| 规则 | 当前实现 |
|---|---|
| 模拟步长 | PVE `pve_logic` 固定每 `10ms` 调用 `spatialEngine.step`；PVP `pvpLogic` 累积后每 `10ms` 调用 `spatialDuel.step`（`pve/pve_logic.js:L127-L155`、`pvp/pvp_logic.js:L98-L112`） |
| 单次补帧上限 | 引擎 `step/advanceActor` 将 `dt` 限制到 `0.05s`；PVE 外层每次最多累计 `.1s`，PVP 外层最多 `.25s` |
| 输入状态 | `idle / charging / attack / swing / recover / stunned / guard_start / guard`；`attack` 是前摇，`swing` 期间逐步判定命中，再进入 recovery |
| 锁定状态 | `attack/swing/recover/stunned`；锁定期间只保留一个可替换的 queued command，不积累攻击 backlog；缓冲的轻点在派生点执行 |
| 轻重击触发 | 中央 move 通道：短按松手轻击；先拖动则锁定普通移动直到松手；原位按住 `.25s` 后蓄力，拖动同时移动／转向，松手采用人物实际朝向；启用取消时，距本次落指点 `24px` 内松手取消 |
| 蓄力移动/转向 | 移动倍率 `.6`；转向倍率 `.65`，再乘独立 `motion.chargeMove/chargeTurn` |
| 防御启动/持续 | `guardStartup=.16s` 后生效；移动 ×`.3`、转向 ×`.5`；正面判定为防御者朝向攻击来源 ±90° |
| AP回复 | 玩家只在 `idle/recover/stunned` 回 AP（`pve/spatial_engine.js:L330`）；正式 PVE/PVP `apRegen = 1000 / apRecoveryMs(专注)`，基础为 2 秒/点 |
| SP回复 | 活跃战斗中按模拟时间累计小数进度，基础 3 秒/点、上限 3；暂停/局外/结束不增长，满点不继续累计 |
| 命中/攻击快照 | 命中使用出手时的 `origin/facing/shape`，挥动期间逐步判定、每招每个目标只中一次；被命中会清理右手输入但保留可恢复的移动按住状态 |

攻击命中使用圆盘-扇区相交，目标半径计入范围和扇形边缘；移动使用小步碰撞，步长最多约为半径的一半，防止穿墙（`core/spatial_combat.js:L52-L127`）。

`combatGestures.config.holdSeconds=.24` 及 `hold()` 仍保留在 `core/combat_gestures.js:L3-L10`，但当前输入链没有调用 `combatGestures.hold()`；`spatialEngine.press()` 对 action 会立即 dispatch charge（`pve/spatial_engine.js:L142-L149`）。因此 `.24s` 不是当前实际的起蓄延迟。武器仍共用 `light/heavy` 几何与 windup/recovery，但蓄力阈值已按 basic/heavy/light 模板派生。

## 3. 技能参数与资源流

共享技能定义在 `gameConfig.skills`，模式覆盖放在 `gameConfig.skillOverrides`，由 `pve/spatial_data.js` 的 `skillRules()` 合成。当前 PVE/PVP 都使用相同基础参数；两种 PVP 的 `skillMode` 均为 `'fair'`，在此只选择共同的基础技能规则，不代表养成对战也使用公平属性档案。角色属性另由房间模式决定。

| 技能 | 方向 | SP费用 | 成功效果 | 约束/覆盖 |
|---|---|---:|---|---|
| `heal` 治疗 | 上 | `2` | 回复 `floor(maxHp×.3)`，不超过最大 HP | 满血时按下前和执行时都拒绝，不扣 SP、不替换已有队列 |
| `haste` 疾速 | 右 | `2` | 持续 `10s`；蓄力进度速率 ×`1.5`；移动全姿态 ×`1.10`；非 charging 转向 ×`1.05` | 同 ID buff 刷新，不叠加；移动/转向仍再乘装备和临时 motion buff |
| `full` 满蓄 | 下 | `2` | charging 时立即满蓄，否则设置一次性 `instantCharge` | 已有 `instantCharge` 时拒绝；一次性消费 |
| `parry` 弹反 | 左 | `3` | 设置一次 `autoParry`，下一次符合条件的攻击自动弹反 | 已有 auto-parry 时拒绝；自动弹反不扣 AP；注意普通 guard parry 仍消耗 `.5 AP` |

技能按成功执行时扣 SP；锁定期间可排队，队列真正执行才扣点（`pve/pve_logic.js:L245-L251`、`pvp/spatial_duel.js:L26-L31`）。SP 不再因命中/弹反瞬间增加，而由共享引擎按时间生成；PVE 跨战斗保留点数与小数进度，PVP 快照同步进度且客机预测不生成可消费 SP。训练允许免费练习的“页面适配”规则不改变共享技能定义。

## 4. 正式 PVE 玩家/伤害派生

`pveProfiles.create()` 先复制训练模板，再用 `spatialProfiles.local()` 和玩家当前 HP 应用正式属性（`pve/pve_profiles.js:L6-L17`）。`spatialProfiles.apply()` 的关键公式如下（`core/spatial_profiles.js:L50-L63`）：

| 派生值 | 当前公式 |
|---|---|
| 玩家 maxHP/HP/DEF | `maxHp=stats.maxHp`；`hp=clamp(currentHp,0,maxHp)`；`def=stats.def` |
| 玩家 AP上限 | `floor(stats.apMax)`，至少 1 |
| 玩家 AP回复 | `1000 / combatRules.apRecoveryMs(focus)`，即 `focus/20 AP/s` |
| 玩家 SP回复 | `1000 / combatRules.spRecoveryMs(focus)`，即专注 10 时 `1/3 SP/s`；基础单位时间比 AP 慢 1.5 倍 |
| 满蓄/伤害阈值 | 正式 `chargeThreshold=chargeThresholdMs/1000`，`fullCharge=chargeThreshold+2s`；训练 `fullCharge=1.6s` |
| 正面弹反窗口 | `clamp(parryWindowBaseMs×judgmentMultiplier/1000,0,1)s` |
| 正式格挡承伤 | `blockMultiplier=clamp(.4×guardDamageMultiplier,0,1)` |
| 弹反伤害 | `max(1,round(atk×.5))`，再按敌 DEF 防御减伤 |
| 招式伤害 | `max(1,round(atk×招式倍率))`；蓄力斩 `atk×(.3+.8×充能比例)`，见 2.2 |
| 正式暴击 | `critChance` 命中判定；暴击伤害 ×`1.5`（`pve/spatial_engine.js:L258-L268`） |
| 防御减伤 | `max(1, round(raw × (1 - def/(def + 17.5))))`，等价于 `max(1, round(raw × 17.5/(def+17.5)))`；DEF=17.5 时承受约 50% 原始伤害 |
| 荆棘 | 格挡时 `defended(raw×guardThorns, 攻击者DEF)` 反射 |

正式 PVE 敌人 AP 上限为 `max(1, ai.apMax||5)`；`ai.focus` 只通过 AP 回复公式生效，未参与移动速度、前摇、后摇或攻击范围（`pve/pve_profiles.js:L15-L17`、`pve/spatial_engine.js:L340-L377`）。

## 5. PVE 敌人基础属性与动作总表

### 5.1 基础属性、动作伤害倍率和基础伤害

`gameConfig.content.enemies` 中的 HP/ATK/DEF/EXP 即当前基础值。动作名称只用于显示；每个动作的几何/时序来自 `gameConfig.enemyMoves`，正式伤害为 `round(enemy.atk × multiplier)` 且至少 1。下表“基础伤害”按当前数值现算。

| ID（名称） | HP | ATK | DEF | EXP | AI focus | 动作1：名称 / multiplier → 伤害 | 动作2：名称 / multiplier → 伤害 |
|---|---:|---:|---:|---:|---:|---|---|
| `test_combat`（测试木桩） | 200 | 5 | 1 | 20 | 10默认 | 快斩 / `.6` → 3 | 重击 / `1` → 5 |
| `goblin`（哥布林） | 35 | 12 | 3 | 20 | 10默认 | 乱挥 / `.6` → 7 | 猛扑 / `.9` → 11 |
| `wolf`（野狼） | 30 | 18 | 2 | 15 | 10默认 | 撕咬 / `.6` → 11 | 扑击 / `.9` → 16 |
| `orc`（兽人苦工） | 50 | 25 | 5 | 50 | 10默认 | 挥锤 / `.7` → 18 | 砸地 / `1.1` → 28 |
| `young_dragon`（幼龙） | 120 | 30 | 6 | 120 | 10默认 | 爪击 / `.7` → 21 | 火焰吐息 / `1.1` → 33 |
| `skeleton_warrior`（骷髅武士） | 100 | 34 | 9 | 80 | 10默认 | 骨刃斩 / `.7` → 24 | 碎骨击 / `1.1` → 37 |
| `shadow_assassin`（暗影刺客） | 85 | 42 | 7 | 100 | 12 | 影袭 / `.6` → 25 | 致命突刺 / `1.1` → 46 |
| `stone_golem`（岩石傀儡） | 250 | 30 | 22 | 120 | 8 | 岩拳 / `.7` → 21 | 地裂 / `1.1` → 33 |
| `elder_dragon`（古龙） | 500 | 55 | 15 | 400 | 10默认 | 龙爪斩 / `.7` → 39 | 龙焰冲击 / `1.1` → 61 |
| `abyss_lord`（深渊领主） | 850 | 70 | 20 | 700 | 10默认 | 深渊爪 / `.7` → 49 | 湮灭波动 / `1.1` → 77 |

数值即当前基础值，没有任何楼层缩放或 run 修正：区域里的怪就是这些数。动作伤害由 ATK 与 multiplier 现算（`round(atk × multiplier)`，至少 1），因此改 ATK 会同时改动作伤害。

### 5.2 每个动作的几何与时序

动作数组完整定义在 `gameConfig.enemyMoves`。所有敌人动作 `active=.16s`，但引擎在 active 起点只调用一次 `enemyHit()`，不是每个渲染帧重复命中。当前所有正式敌人动作在基础定义上统一增加 `windup +.10s`、`recovery +.15s`；`lock` 数值不变，因此锁定段相对变短。`lock` 是前摇最后一段的固定朝向时间：当 windup 剩余时间大于 lock 时仍追踪玩家；剩余时间不大于 lock 后停止追踪。`range` 是扇区半径；配置表中的 `arc` 是 π 倍数。

| ID | 动作1：kind / range / arc | windup / lock / active / recovery | 动作2：kind / range / arc | windup / lock / active / recovery |
|---|---|---|---|---|
| `test_combat` | sector / 90 / `.60π` | 1.30 / .40 / .16 / .95s | circle / 85 | 1.60 / .50 / .16 / 1.15s |
| `goblin` | sector / 90 / `.65π` | 1.30 / .40 / .16 / .85s | sector / 120 / `.40π` | 1.60 / .50 / .16 / 1.15s |
| `wolf` | sector / 85 / `.45π` | 1.05 / .30 / .16 / .75s | dash corridor / 150 / 宽 18 | 直线预警；蓄力 1.15 / 锁向 .35 / 距离 150 / 速度 280/s / 收招 1.35s |
| `orc` | sector / 115 / `.65π` | 1.45 / .45 / .16 / 1.05s | circle / 105 | 1.75 / .55 / .16 / 1.35s |
| `young_dragon` | sector / 110 / `.65π` | 1.25 / .40 / .16 / .95s | sector / 170 / `.40π` | 1.75 / .55 / .16 / 1.25s |
| `skeleton_warrior` | sector / 100 / `.55π` | 1.20 / .40 / .16 / .95s | sector / 135 / `.70π` | 1.60 / .50 / .16 / 1.15s |
| `shadow_assassin` | sector / 100 / `.35π` | .90 / .30 / .16 / .70s | dash corridor / 180 / 宽 12 | 直线预警；蓄力 .65 / 锁向 .25 / 距离 180 / 速度 450/s / 收招 1.05s |
| `stone_golem` | sector / 135 / `.65π` | 1.60 / .50 / .16 / 1.25s | circle / 120 | 1.90 / .65 / .16 / 1.55s |
| `elder_dragon` | sector / 140 / `.65π` | 1.20 / .40 / .16 / 1.00s | sector / 185 / `.50π` | 1.75 / .55 / .16 / 1.35s |
| `abyss_lord` | sector / 145 / `.60π` | 1.15 / .40 / .16 / .95s | circle / 130 | 1.70 / .55 / .16 / 1.35s |

### 5.3 共同 AI 节奏与逐怪物覆盖

训练基础 AI（`gameConfig.training.ai`）对正式 PVE 仍是默认值：

| 参数 | 默认值 | 作用 |
|---|---:|---|
| `initialDelay` | `.8s` | 战斗开始后首次进入攻击决策前的等待 |
| `delay` | `.45s` | 普通攻击结束后回到 approach 的等待 |
| `speed` | `47` | approach 移动速度，世界单位/秒 |
| `stopDistance` | `88` | 距玩家不大于此值时停止接近 |
| `attackDistance` | `150` | 距离小于此值且 timer=0、AP≥1 才起手 |
| `turn` | `3` | approach 转向速度，弧度/秒 |
| `trackingTurn` | `1.6` | 前摇未进入 lock 段时的追踪转向速度，弧度/秒 |
| `comboChance` | `0` | 每次 active 结束时追加 combo 的概率 |
| `comboMax` | `0` | 连续追加 combo 次数上限 |
| `comboDelay` | `.2s` | 由 `comboDelayMs[0]` 转换而来；缺省为 200ms |
| `enrageThreshold` | `0` | HP 比例低于等于此值时进入 enrage；0 表示关闭 |
| `enrageAtkMult` | `1.3` | 缺省 enrage 攻击倍率；Boss 有覆盖 |
| `enrageSpdMult` | `1.2` | 缺省 enrage timer/AP回复倍率；Boss 有覆盖 |

当前逐怪物 AI 覆盖只有：`shadow_assassin.ai.focus=12`、`stone_golem.ai.focus=8`；两名 Boss 另有 combo/enrage，均在 `gameConfig.content.enemies` 中定义。

| 怪物 | comboChance / comboMax | `comboDelayMs` 实际读取 | enrageThreshold | enrageAtkMult / enrageSpdMult |
|---|---:|---:|---:|---:|
| 古龙 | `.5 / 2` | `[150,300]` 只取 `150ms` | `.3` | `1.4 / 1.25` |
| 深渊领主 | `.6 / 3` | `[120,260]` 只取 `120ms` | `.4` | `1.5 / 1.3` |

Combo 在 active 结束转入恢复阶段时选择，不要求该招命中；每个 combo 仍使用动作数组轮换。enrage 会乘敌人 timer 消耗和 AP 回复，并乘命中 raw damage。模板 windup/recovery 数值虽不变，实际阶段耗时会除以 enrageSpdMult，因而更快；approach 移速和攻击几何不变（`pve/spatial_engine.js:L340-L377`）。

### 5.4 Arena 效果与战斗收益

| 怪物/机制 | 参数 | 当前行为 |
|---|---|---|
| 古龙 `burning_ground` | `startMs=20000`、`intervalMs=3000`、`pct=.03` | 20s 后播报；首个伤害落在约 23s；之后每 3s 双方各受自身 maxHP 的 3%（至少 1），`core/arena_effects.js` |
| 深渊领主 `ap_surge` | `atMs=30000`、`apRateMult=2` | 30s 后双方 AP 回复 ×2，过渡帧播报一次，`core/arena_effects.js` |
| PVE arena 结算 | — | 只在 `pve_logic` 驱动；环境伤害与同一 10ms 步中的攻击一起结算，双方同时死亡判玩家败北；当前 PVP 不使用 arena |
| 金币 | `adventure.goldPerExp=.6` | `goldReward=round(exp×.6)`，胜利当场入账；没有 run 结算，死亡也不清空已得金币（`pve/pve_logic.js` 的 `_onVictory`） |
| 区域刷新 | `adventure.monsterRespawnSeconds=60` | 被打死的区域怪 60 秒后回岗位重生；Boss 不重生。 |

## 6. PVP 固定规则（当前 v10 / rule v7）

### 6.1 档案与开局

公平档案在 `core/spatial_profiles.js:L7-L18`：`level=1, maxHp=120, atk=30, def=8, focus=10, insight=10, apMax=5, critChance=0, guardThorns=0, chargeThresholdMs=300ms, parryWindowBaseMs=180ms, judgmentMultiplier=1, guardDamageMultiplier=1`，四个 motion 倍率均为 1。养成对战使用本地玩家/对手 profile；双方 profile 通过 normalize 限制范围并在开战时冻结/复制。

PVP 建局时两边从满 HP、满 AP 开始，`skillPoints=0`（`pvp/spatial_duel.js:L9-L23`）。技能仍是共享定义，四技能费用为 `heal 2 / haste 2 / full 2 / parry 3 SP`。Settings 可以改个人 `cancelAtCenter/autoFace`，不会改变公平档案数值。

### 6.2 场地、墙体、可见性与同时命中

当前 PVP 场地在 `gameConfig.pvpArena`：`570×630`，布局 ID `pvp-l-v1`，version `1`。

| 墙 | 矩形（x,y,width,height）世界单位 |
|---|---|
| 左竖 | `(135,200,24,130)` |
| 左横 | `(135,306,110,24)` |
| 右竖 | `(411,300,24,130)` |
| 右横 | `(325,300,110,24)` |

移动和双方分离都受同一墙列表/边界约束；攻击只有在扇区命中且攻击起点到目标中心线不被墙阻断时才有效（`pvp/spatial_duel.js:L71-L88`、`core/spatial_combat.js:L68-L127`）。双方按各自位置计算 line-of-sight；事件带 `visibleTo`，墙后事件由表现层过滤。

每个 10ms step 先让双方基于对方上一 movement snapshot 各自推进，再做对称分离，然后收集两边本 step 挥动扫过的角度区间，统一判定、统一 apply，最后才结束本步挥完的招式（`pvp/spatial_duel.js` 的 `step`）。双方同时死亡结果是 `draw`；单边死亡结果为 `host` 或 `guest`。当前明确没有 spatial Clash：攻击之间不会因同时/近同时出手自动进入对撞规则，文件本身也注明 Stage two 才加入。

### 6.3 PVP 判定和资源效果

当前 `judge()` 顺序是：扇区命中 → 墙体阻断则 miss → 防守者正面 guard/AP 条件 → auto parry 或 guard 窗口内 parry → crit → block/hit（`pvp/spatial_duel.js:L73-L88`）。

| 结果 | 条件 | 效果 |
|---|---|---|
| miss | 几何未命中或中心线被墙阻断 | 此结算不再改变 HP/AP/SP；起手已花掉的 1 AP 不退还；阻断会带 `blocked=true` |
| auto parry | 防守者有 `autoParry` 且没有同时满足普通 guard | 消费一次 autoParry；攻击者受到 `defended(parryDamage,攻击者DEF)`；攻击者硬直 `hitStun` |
| 普通 parry | 正面 guard、AP≥1 且 `time-guardReadyAt ≤ parryWindow` | 扣防守者 `parryCost=.5 AP`；攻击者受弹反伤害并硬直 |
| block | 正面 guard、AP≥1，但超出 parry window | 扣 1 AP；承伤 `round(defended(raw,def)×blockMultiplier)`；若有荆棘，攻击者受反伤 |
| hit | 其余几何命中 | 承伤 `defended(raw,def)`；防守者硬直 `hitStun=.35s` |
| crit | 非 guard 的普通 hit；由攻击者 `critChance` 随机判定 | raw ×1.5 后再过防御公式；公平模式 critChance=0 |

现行共享默认值与 AP/SP 回复位于 `core/combat_rules.js`；PVE 空间判定由 `spatial_engine` 处理，PVP 同步判定由 `spatial_duel` 处理。

### 6.4 网络和版本固定值

| 参数 | 当前值/规则 | 路径 |
|---|---|---|
| protocol `VERSION` | `10` | `pvp/pvp_logic.js`；因防御公式变化升级 |
| `RULE_VERSION` | `7` | `pvp/pvp_logic.js`；连招招式表与挥动判定上线时升级 |
| 场地校验 | 每个 start/rematch/snapshot 校验 `pvp-l-v1` + version 1 | `pvp/pvp_logic.js:L14-L16,L179-L183` |
| 开局倒计时 | `1.5s` | `pvp/pvp_logic.js:L73-L81` |
| 主机模拟 | 固定 `.01s`；主机 ready 后运行权威 duel | `pvp/pvp_logic.js:L98-L112` |
| 主机快照 | 距上次发送达到 `50ms` 后，在显示循环中发送；目标约20Hz，受帧率影响 | `pvp/pvp_logic.js:L122-L125` |
| 客机心跳 | 距上次发送达到 `250ms` 后，在显示循环中发送；受帧率影响 | `pvp/pvp_logic.js:L122-L125` |
| 客机预测 | 只推进本地 actor；HP、胜负保持快照权威 | `pvp/spatial_duel.js:L174-L186` |
| 中断 | hidden、超过约 5s 未收到消息、disconnect/abort 会终止对局 | `pvp/pvp_logic.js:L113-L127,L246-L251` |

## 7. 装备与强化对战输入（当前已消费的效果）

基础玩家、装备和强化数值定义在 `game_config.js`；运行时由 `core/data.js` 和 `core/player.js` 消费。初始属性仍为 `baseStats={maxHp:100, atk:10, def:3, focus:10, insight:10, luck:5}`，默认装备木剑+木盾。只有 `atk/def` 受每级 +10% 强化，强化等级上限 5、费用为 `100×(当前等级+1)` 金币，且同 itemId 的所有堆叠共享等级。

| 装备 | 基础 stats | 效果 | 当前消费位置 |
|---|---|---|---|
| 木剑 | atk +8 | `chargeOffsetMs=0` | 蓄力阈值 300ms（基准值） |
| 铁剑 | atk +22 | `chargeOffsetMs=+50` | 蓄力阈值 350ms（基准 300 + 50） |
| 木盾 | def +6 | `guard_damage_reduce=.25` | 正式格挡倍率乘 `.75` |
| 铁盾 | def +24 | `guard_damage_reduce=.40`、`parry_window_ms=150` | 正式格挡倍率乘 `.60`；第一件窗口效果覆盖基础 |
| 疾速戒指 | focus +3 | 无 | 专注提高，AP 与 SP 都回复更快 |
| 布甲 | def +3 | 无 | `game_config.js` → `content.items.wooden_armor` |
| 铁甲 | def +20 | 无 | `game_config.js` → `content.items.iron_armor` |
| 智慧之环 | insight +10 | 无 | 提高心眼；窗口倍率由 `gameConfig.progression.insight` 控制 |
| 刺客短刃 | atk +14 | `chargeOffsetMs=-20`、`crit_chance=.20` | 蓄力阈值 280ms；暴击率另行累加 |
| 荆棘甲 | def +10 | `guard_thorns=.5` | 格挡成功时反射 raw 的 50%，再过攻击者 DEF |
| 战意戒指 | 无 | `ap_max_bonus=1` | AP 上限基础 5→6 |

效果注册表还定义了 `spatial_move_speed`、`spatial_turn_speed`、`charge_move_speed`、`charge_turn_speed` 四种运动效果（`core/effects.js:L13-L28`），但当前 `content.items` 没有装备实例使用它们；它们只有在以后加入 item effect 后才会进入 `player.getSpatialMotion()`（`core/player.js:L62-L68`）。

装备的 per-item timing 效果不是相加：按 `left → right → armor → accessory`，第一件带该 type 的装备胜出；crit/thorns/AP 上限等效果则分别累加（`core/player.js:L22-L57`）。PVP 公平模式完全不读取这些养成效果；养成模式才将其映射到本地 profile。

## 8. 设计边界

- PVP 当前协议 v10 / rule v7，L 墙场地 570×630、共享相机 350×390；空间拼刀待实现。
- `comboDelayMs` 只读取首项；`ai.focus` 只改变 AP 回复。
- 技能弹反消耗 3 SP，普通操作弹反消耗 .5 AP，两者独立。
- 冲刺预警为窄路径提示，实际扫掠半宽为 dash.width + enemy.radius，接触判定再计入 player.radius。

## 9. 2026-09-13 实施覆盖（以本节覆盖前文冲突描述）

本轮已把以下设计接入共享空间引擎，旧存档字段继续兼容：

| 项目 | 当前实现 |
|---|---|
| 心眼 | 使用 `insight` 属性；通过 `getInsight()` / `getParryWindowMultiplier()` 作为弹反窗口钩子，当前为 `max(.5, 1 + (心眼-10)×.03)`，数值可后续单独调整 |
| 专注 | 使用 `focus` 属性；通过 `getFocus()` 同时影响 AP 和 SP 回复。基础 AP 为 2000ms/点，SP 为 3000ms/点，因此 SP 默认慢 1.5 倍 |
| SP | 战斗模拟时间按小数进度回复，上限 3；暂停、局外和结束不增长；移除命中/弹反整点奖励；PVE 跨战斗保留小数，PVP 客机不自行生成可消费 SP |
| 移速 | `motion.move` 与 `spatial_move_speed` 已是独立移动倍率钩子；目前没有装备实例使用该词条，未把专注混入移动速度 |
| 武器蓄力起点 | 基准 `resources.chargeThresholdMs=300ms` 加武器自己的 `chargeOffsetMs`，再按 `chargeThresholdRangeMs={min:200,max:450}` 夹紧（`core/combat_rules.js` 的 `weaponChargeThresholdMs()`）：木剑 `0`→300ms、铁剑 `+50`→350ms、刺客短刃 `-20`→280ms。离散的 light/heavy/basic 模板已移除，新增武器只需一个数字；强化只作用于 atk/def，不会改变该阈值，profile 仍统一使用 `chargeThresholdMs`，三把武器数值未变所以协议/规则版本不需要升级 |
| 怪物冲刺 | 狼 `扑击`：直线预警、蓄力 `1.05s`、锁向 `.35s`、距离 `150`、速度 `280/s`、轨迹宽 `18`、收招 `1.20s`；暗影刺客 `致命突刺`：直线预警、`.55s/.25s/180/450/s/12/.90s`。冲刺沿实际路径检测一次命中，撞身体、墙或边界停止，不穿身 |
| PVP 协议 | 当前 `VERSION=10`、`RULE_VERSION=6`，双方必须匹配；本次因防御公式变化升级 |

本节之后，前文关于 PVP v6/rule v2、命中/弹反增加 SP、铁剑 700ms、短刃 400ms、狼/刺客原地扇形攻击的描述均视为历史基线。技能效果与费用本轮暂不调整。
