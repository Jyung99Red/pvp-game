# Combat Architecture (PVP + PVE)

战斗判定的纯逻辑核心统一在 `combat_resolver.js`(蓄力伤害插值、防御减免、
弹反窗口、五类交锋判定 clash/parry/block/interrupt/hit、side-state 工厂、
`pvpConfig` 时序常量),PVP 和 PVE 两套引擎都调用同一份,保证手感一致。

- **PVP**(`pvp_logic.js`)：WebRTC 联机,Host 判定权威,Guest 只镜像。
- **PVE**(`pve_logic.js`)：Roguelike 地下城,敌人由本地 AI 状态机模拟,
  同一套蓄力/格挡机制打 AI。**已取代早期的单人战斗系统**(旧
  `battle.js` / `ui_battle.js` / 左右手双通道操作已删除)。

两套引擎与各自的 UI(`ui_pvp.js` / `ui_pve.js`)通过 `ui.switchTab()` 切换
不同 `view-section` 共存,全程一起加载,互不冻结、互不干扰。

> 本文档聚焦战斗核心与 PVP 联机层的深度细节。PVE 的 Roguelike 楼层 /
> 装备强化 / 技能 / 经济等玩法层,以及全局文件职责,见 `CLAUDE.md`。

---

## System Overview（以 PVP 为例；PVE 用 ui_pve/pve_logic 替换上两层，无网络层）
┌──────────────────────────────────────────────────────┐
│                     UI Layer                          │
│   ui_pvp.js · fx.js · icons.js                        │
│   Read-only consumers of state. Zero game logic.      │
└───────────────────────┬───────────────────────────────┘
│ reads state.pvpBattle
┌───────────────────────▼───────────────────────────────┐
│                   Logic Layer                          │
│   pvp_logic.js  ── 调用 ──►  combat_resolver.js         │
│   状态机 + Host 判定权威        纯判定/伤害公式(PVP/PVE共享) │
│   不调用 document.*；帧推进靠 tick(dt, now) 传入的时间   │
└───────────────────────┬───────────────────────────────┘
│ send / receive
┌───────────────────────▼───────────────────────────────┐
│                  Network Layer                         │
│   pvp_net.js   — PeerJS 信令 + WebRTC 传输 + 时钟同步    │
│   pvp_room.js  — 房间号配对、连接状态机、hello 握手判重开局 │
└──────────────────────────────────────────────────────┘

**裁决权威：Host 决定所有判定结果。**
- 所有交锋判定都在 Host 这一端的 `pvp_logic` 里跑
- 结果通过 `result` 消息广播给 Guest
- Guest 只渲染,从不自行判定

> 代码注释语言：全部 `.js` 文件的注释已统一改成英文；游戏内显示给玩家的
> 状态文案、日志文案(`status`、`logText` 等字符串字面量)保持中文不变。

---

## File Map

| File | 角色 |
|------|------|
| `core/data.js` | 静态配置,战斗复用其中的装备/属性数值 |
| `core/player.js` | `getStats()` / `getJudgmentMultiplier()` / `getGuardDamageMultiplier()` / `getCritChance()` / `getGuardThorns()` / `getApMax()` / 逐项时序 getter,组装成 profile 传给结算器 |
| `core/effects.js` | `STAT_REGISTRY` / `EFFECT_REGISTRY`,装备效果的单一登记处 |
| `core/combat_resolver.js` | **PVP/PVE 共享的纯判定核心**：`pvpConfig` 时序常量、side-state 工厂、蓄力伤害插值、防御减免、弹反窗口、五类交锋判定；无 DOM/网络/全局写 |
| `core/tick.js` / `ui/ui.js` | 主循环与视图切换,PVP 和 PVE 共用 |
| `ui/fx.js` / `ui/icons.js` | 共享特效与图标库,PVE 和 PVP 都在用 |
| `pve/pve_logic.js` | PVE 引擎：Roguelike 楼层、本地 AI 状态机(佯攻/连段/狂暴)、技能与 buff、runGold 结算；调用 `combat_resolver` 做判定 |
| `pve/ui_pve.js` | PVE 战斗 UI 渲染,只读 `state.pveBattle`,不写游戏状态 |
| `partials/*.html` | 从 `index.html` 拆出的 4 个 view 片段(base/pve-battle/pvp-room/pvp-battle),启动时由 `index.html` 里的 `fetch()` 注入 |
| `pvp/pvp_logic.js` | PVP 引擎：状态机、Host 判定、网络消息处理；判定/伤害公式已抽到 `combat_resolver.js`,本文件只做应用+广播 |
| `pvp/pvp_net.js` | PeerJS 连接、时钟同步、消息收发 |
| `pvp/pvp_room.js` | 房间创建/加入的 UI 流程、hello 握手判断是否要开新一局 |
| `pvp/ui_pvp.js` | PVP 战斗 UI 渲染,只读 `state.pvpBattle`,不写游戏状态 |

---

## 战斗机制 — 蓄力攻击系统

### 蓄力阶段
按下                            松手 / 3秒自动出手
│                                      │
▼                                      ▼
─┼──────────┬─────────────────────────────────►
0s        0.5s                         3s
[EARLY]    [CHARGE ZONE]              [MAX]

### 伤害公式（`combat_resolver.js`，PVP/PVE 共享）

```js
// combat_resolver.js — calcChargeDamage
// earlyReleaseMs 由每一方 profile 传入（装备可改，见"每件装备的时序参数"），
// 不再是写死的全局常量
function calcChargeDamage(chargeMs, atk, earlyReleaseMs = pvpConfig.earlyReleaseMs) {
    if (chargeMs < earlyReleaseMs) return pvpConfig.earlyReleaseDmg; // 1
    const t = Math.min(
        (chargeMs - earlyReleaseMs) / (chargeMaxMs - earlyReleaseMs), 1.0
    );
    const ratio = lerp(0.3, 1.1, t);          // 阈值→0.3倍atk，3s→1.1倍atk
    return Math.max(1, Math.round(atk * ratio));
}
```

```js
// combat_resolver.js — applyDefense（线性减免，PVP/PVE 共用同一套公式）
function applyDefense(rawDmg, def) {
    const reduction = Math.min(rawDmg * 0.20, def * 0.15);
    return Math.max(1, Math.round(rawDmg - reduction));
}
```

**暴击 / 荆棘（`resolveExchange` 内）：**
- 干净命中 / 打断时按攻击方 profile 的 `critChance`(= luck×1%  + `crit_chance`
  装备效果)投骰,命中则伤害 ×`pvpConfig.critMult`(1.5),返回结果带 `crit` 标记。
- 格挡成功时,若防御方 profile 有 `guardThorns`,把一部分原始伤害经防御减免后
  反弹给攻击方(记在 `attackerDmg` 上)。

> 早期 `pvpConfig` 里的 `minChargeDmg` / `maxChargeDmg` / `baseAtk` 参照字段
> 在公式定型后已删除,不再保留。

### 状态机（per player）
    press attack
IDLE ─────────────────► CHARGING
▲                         │ release OR held ≥ 3s
│                         ▼
│                    STRIKE_OUT ──► 交锋判定
│                         │ strikeRecoveryMs (300ms，仅 hit/blocked 时走完整流程)
└─────────────────────────┘
    press guard
IDLE ─────────────────► GUARD_WINDUP (300ms)
│
GUARD_READY ── 超过 guardMaxHoldMs(2000ms)未被击中 → 自动收回 idle
│ 被击中:
┌─────────┴──────────┐
弹反窗口内               弹反窗口外
→ 攻击方反击受伤+硬直     → defender 进入
(parryStunMs 1000ms)     STUNNED 150ms

**对手蓄力中被命中 = 打断：** 若防御方此刻 `phase === 'charging'`（既不在
`strike_out` 也不在 `guard_ready`，所以走不到拼刀/弹反/格挡分支），来犯的
攻击按普通命中公式结算伤害，同时把防御方强制踢出 `charging`，扣
`interruptStunMs`(250ms) 硬直——蓄力作废，按下攻击键时已经扣掉的那 1 点 AP
不退还，等同于一次白白浪费的出招。

**`phase` 的真实取值只有 7 个：** `idle | charging | strike_out |
strike_recover | guard_windup | guard_ready | stunned`。无论是被弹反、被
格挡还是蓄力中被打断，最终都统一落在 `stunned`，区别只在硬直时长(1000ms /
150ms / 250ms)和作用对象(攻击方 / 防守方)——`phase` 上曾经还声明过
`'parry'` / `'blocked'` 两个值，但从未被真正赋值过(底层都走 `'stunned'`)，
已经从 `PHASES` 列表、`_tickSide` 的兜底分支、`ui_pvp.js` 的标签映射表里
一并删掉了。

> 注意区分 `phase`(角色状态机当前阶段)和 `exchange`(单次交锋的判定结果，
> 取值 `'hit'|'blocked'|'parry'|'clash'|'interrupt'`，定义在
> `_resolveExchange` 里)——后者是真实生效、驱动伤害和特效的字段，格挡减伤
> /弹反反击/拼刀对撞/蓄力打断这些玩法都是靠它，不要跟上面的 `phase` 搞混。

**锁定规则：** CHARGING 状态下完全锁 guard 输入,必须先松手出招才能举盾。

**判定细节：**
- 弹反窗口 `parryWindow(judgmentMultiplier, parryWindowBaseMs)`：底数默认
  `pvpConfig.parryWindowMs`,但可由装备(如铁盾 150ms)通过 profile 覆盖,再乘
  `player.getJudgmentMultiplier()`。
- 拼刀窗口固定 `clashWindowMs = 100ms`,不受属性影响。
- 拼刀/弹反的时间比较全部用本机 `Date.now()`墙钟时间(`lastStrikeT` /
  `lastGuardReadyT`),不经过 `pvpNet.correctRemote()` 换算——双方各自固定用
  自己的本地墙钟比较时间差,不会被时钟同步本身的误差或同步未完成的窗口期
  带偏,属于双重保险。

### 每件装备的时序参数

蓄力阈值(`charge_threshold_ms`)与弹反窗口(`parry_window_ms`)不是全局常量,
而是每件装备各自定义、按槽位顺序取第一个生效(`player.getChargeThresholdMs` /
`getParryWindowBaseMs`),打进 profile 的 `earlyReleaseMs` / `parryWindowBaseMs`
传给结算器——所以换武器/盾会真实改变蓄力与弹反手感,不只是数值大小。

### AP 恢复

`apRecoveryMs(spd) = pvpConfig.apRecoveryMs(2000ms) * (10 / spd)`。
spd 越高恢复越快;蓄力/举盾期间不恢复 AP。AP 上限默认 `pvpConfig.apMax`(3),
但可由装备(`ap_max_bonus` 效果)提升,存在 side-state 的 `apMax` 字段上,
`_tickSide` 与 UI 星标都读它。

### 对手可见性

蓄力进度通过 `charge_sync` 消息每 100ms 同步一次,双方信息对等,博弈点在反应
时机而不是信息隐藏。

---

## state.pvpBattle

```js
state.pvpBattle = {
    active: false,

    role: null,               // 'host' | 'guest'
    battleId: null,            // 当前这一局的唯一标识，每条战斗内网络消息都带着它

    self: {
        hp, maxHp,
        phase: 'idle',         // idle|charging|strike_out|strike_recover
                               // |guard_windup|guard_ready|stunned
        phaseTimer: 0,
        chargeStartT: 0,
        chargeMs: 0,
        actionPoints: 3,
        apMax: 3,              // 由 profile 传入，装备可提升（ap_max_bonus）
        actionProgress: 0,
        lastStrikeT: 0,        // Date.now()，出招瞬间，拼刀判定用
        lastChargeMs: 0,       // 上一次出招的蓄力时长，拼刀伤害用
        lastGuardReadyT: 0     // Date.now()，举盾就绪瞬间，弹反判定用
    },

    opponent: {
        ...同上结构,
        chargeProgress: 0,    // 0→1，仅靠 charge_sync 网络消息更新
        displayName: '对手 Lv.N'  // N 来自 hello 消息里对方的 profile.level
    },

    net: { clockOffset, rtt },
    log: []
}
```

> 曾经有一个 `paused` 字段(断线时置 true，用于"暂停战斗、等重连后恢复"的
> 旧流程)，断线重连机制移除后这个字段已经没有任何地方会写入 true，连同
> 输入处理函数里对它的检查一起删掉了——现在断线就是直接结束当前对局，
> 不存在"暂停"这个中间状态。

---

## 网络层 — pvp_net.js + pvp_room.js

### 连接建立流程
Host                                            Guest
│ hostRoom(code)                                 │
├─ peer = new Peer(code)   ← 用房间号当 PeerJS ID  │
├─ 等待 peer.on('open')                          │
│  显示房间号，等待对方输入 ───────────┐           │
│                                     │       joinRoom(code)
│                                     │       ├─ peer = new Peer()  (匿名ID)
│                                     │       ├─ 等待 peer.on('open')
│                                     │       ├─ peer.connect(code) ────►
│◄──────────── peer.on('connection') ─┴────────┘
├─ conn.on('open')                            conn.on('open')
├─ 双方互发 hello（带 battleId + 战斗资料）────────────────────────►
│                                              ◄──────────────────────
├─ 发起 5 轮 ping/pong 时钟同步 ─────────────► 逐条回 pong
├─ 同步完成 → emit('open')（仅 host 侧会触发）
├─ send({msg:'fight_start', battleId})
├─ pvpLogic.startPVP('host', ...)              收到 fight_start 消息
└─ 切到战斗界面                                → pvpLogic.startPVP('guest', ..., battleId) → 切到战斗界面

- Host 用房间号本身作为 PeerJS 的 peer ID 注册;Guest 用匿名 ID 注册,再
  用房间号 `connect()` 到 Host。
- 信令服务器只负责打洞撮合,不转发游戏数据;实际对战数据走建立后的 WebRTC
  DataChannel 直连。
- ICE 配置目前只给了 Google 的公共 STUN,没有配置 TURN。
- **hello 握手**：数据通道一建立就互发,带上 `battleId`（当前没在打就是
  `null`）和 `profile`（等级 + atk/def/spd/maxHp + 衍生倍率）。收到对方
  hello 后比对 `battleId`：一致就什么都不做(说明还在同一场战斗里、只是网络
  抖动)；不一致(对方是刚刷新/重新进房的，battleId 对不上)就由 Host 直接
  发起一局全新的对局，不尝试同步战斗内部细节。

### 时钟同步

Host 发起,Guest 应答,共 `PING_ROUNDS = 5` 轮,每轮间隔 `PING_INTERVAL_MS = 200ms`:
offset_sample = t1 - t0 - rtt/2     // t0=本机发ping时间，t1=对方收到时刻，rtt=本机收到pong往返耗时
clockOffset   = avg(offset_sample)
rtt           = avg(rtt_sample)
correctRemote(remote_t) = remote_t - clockOffset

`offset` 的定义是「guest 时钟 − host 时钟」,所以换算对方时间戳到本机等效
时间要做减法,不是加法——加号会让换算结果偏出真实值达 2×offset,且方向是把
对方事件推到未来,这正是早期版本里格挡/弹反误判的根因。

> `pvp_logic.js` 里出招/举盾相关的两个时间戳(`lastStrikeT`、
> `lastGuardReadyT`)即便有了 `correctRemote()`,仍然选择只用本机
> `Date.now()`,不做网络时钟换算——属于双重保险,避免时钟同步本身的误差或
> 还没同步完成时的窗口期再次引入误判。

### 房间号与连接状态机（pvp_room.js）

- 房间号：6 位数字,`genRoomCode()` 随机生成;`joinRoom()` 侧校验放宽到
  `/^\d{4,8}$/`(4~8位都接受),比实际生成的位数更宽松（见下方已知问题）。
- `pvp-step-*` 系列 DOM 节点对应房间流程的每一步(entry / hosting /
  host-waiting / joining / joining-wait / ready),由 `setStep()` 统一切换
  `hidden` 类。
- **Guest 端不会经过 `pvp-step-ready`**：因为 `pvpNet.on.open` 按设计只在
  Host 侧触发(时钟同步是 Host 发起的,完成后才 emit),Guest 侧的
  `on.open` 永远不会被调用。Guest 实际是停在 `pvp-step-joining-wait`,直到
  收到 `fight_start` 消息才直接跳到战斗界面。
- **断线处理（无"原地重连恢复战斗"）：**
  - 对战中掉线 → 双方各自的 `conn.on('close')` 触发 → `pvpLogic.abortToLobby()`
    + 弹出 `pvp-disconnect-overlay`，遮罩上只有一个"返回大厅"按钮。
  - 还没开打就掉线 → 直接回到 `pvp-step-entry`。
  - 点"返回大厅"(`giveUpToLobby`)会先把 `pvpNet.on.close` 置空再调用
    `pvpNet.close()`(彻底销毁 peer + conn)，避免 `peer.destroy()` 异步触发
    的 close 事件和这里的主动跳转互相打架；随后回到入口，要继续对战只能
    重新走一遍 `hostRoom`/`joinRoom`。
  - 房间号本身有 localStorage 记忆(`_saveLastRoom`/`_loadLastRoom`,20分钟
    内有效)，重新进入"加入房间"步骤时会自动填回上次用过的 Guest 房间号，
    但这只是省得用户记数字，不代表战斗状态能恢复——能不能接上同一个 Host、
    要不要开新一局，全靠上面说的 hello + battleId 机制现场判断。

---

## 网络消息协议

```js
// 时钟同步（pvp_net.js 内部处理，不会冒泡给 pvp_logic）
{ msg:'ping', t0 }
{ msg:'pong', t0, t1 }

// 连接刚建立时的握手，由 pvp_room.js 处理，不会冒泡给 pvp_logic
{ msg:'hello', battleId, profile }   // profile: 等级 + atk/def/spd/maxHp
                                     //   + 衍生字段(判定/格挡倍率、暴击率、
                                     //     荆棘、AP上限、蓄力阈值、弹反窗口)

// 输入动作（统一通过 _sendBattleMsg 自动带上 battleId）
{ msg:'action', type:'charge_start', t, battleId }
{ msg:'action', type:'charge_release', chargeMs, t, battleId }
{ msg:'action', type:'guard_press', t, battleId }
{ msg:'action', type:'guard_ready', t, battleId }
{ msg:'action', type:'guard_release', t, battleId }

// 蓄力进度（持续蓄力期间每100ms一条）
{ msg:'charge_sync', progress, battleId }        // 0→1

// Host 判定结果（绝对HP值，guest直接套用，不用算差值）
{ msg:'result',
  exchange: 'hit'|'blocked'|'parry'|'clash'|'interrupt',
  logText,
  hostHp, guestHp,
  hostStunMs, guestStunMs,
  attackerIsHost,
  battleId }

// 战斗流程
{ msg:'fight_start', battleId }
{ msg:'fight_end', winner:'host'|'guest', battleId }
{ msg:'rematch_request', profile, battleId }
{ msg:'rematch_accept', profile, battleId }
```

`action` / `charge_sync` / `result` / `fight_end` 这几类消息收到时都会先比对
`battleId`：跟本机当前局不一致就直接丢弃(不管具体是对方刷新重连、消息延迟
乱序、还是别的没遇到过的边缘情况)，不去猜该怎么硬套到当前这场战斗上——比
"双方各报一个布尔值猜测状态是否一致"更可靠。

> `pvpNet.sendAction(type, hand)` 这个便捷发送方法曾经存在过，但从未被
> 调用——所有 action 消息都是直接走 `pvpNet.send({msg:'action', ...})`，
> `hand` 字段在 PVP 协议里也从未真正出现过(大概率是早期单人战斗"左右手"
> 概念的残留)，已经从 `pvp_net.js` 里删掉。

---

## ui_pvp.js — 当前布局
┌─────────────────────────────┐
│ 对手名  相位label  🛡️(格挡时)  │
│ [████░░░░] HP                │
│ [蓄力条] hidden切换           │
├──── 战斗区域(武器节点+特效) ───┤
│ [████████] HP          己方名 │
│ [████████] 行动力恢复          │
│ [蓄力 0%~100%] 常驻显示        │  ← 固定占位，按钮位置不受影响
│ ★★★ AP                       │
│ [按住攻击] [按住防御]            │
├──────── log (margin-top) ────┤
└─────────────────────────────┘

加上结算 / 求和重赛 / 断线遮罩三套全屏 overlay：`pvp-result-overlay`、
`pvp-disconnect-overlay`,均由 `ui_pvp.js` 控制 `hidden` 类切换显示。

`updateFrame()` 每 rAF 调用一次,只读 `state.pvpBattle`,不写。

---

## Hard Constraints

- `combat_resolver.js`：纯逻辑,不碰 DOM / 网络 / 全局 state 写;`resolveExchange`
  只读两侧 side-state + profile 并返回结果,应用 HP/眩晕/日志由调用方负责。
- `pvp_logic.js`：不调用 `document.*`；帧推进靠 `tick(dt, now)` 传入时间
  （lastStrikeT / lastGuardReadyT 这两个时间戳例外，见上文）。
- `pvp_net.js`：只管信令、传输、时钟对齐,不做战斗数值计算。
- `ui_pvp.js` / `ui_pve.js`：只读各自的 state 对象,从不写游戏状态。
- Guest 永不自行判定,Host 的 `result` 消息是唯一权威。
- 判定/伤害公式统一在 `combat_resolver.js`,PVP 与 PVE **共享同一套**;
  `player.js` 的 getter 只负责把装备/属性组装成 profile 传进去。
- CHARGING 状态下 guard 输入完全锁定。
- 断线即结束当前对局，没有"原地恢复战斗"的路径——这是有意的设计取舍
  （快节奏对战，断线重连判定的边界情况太多，不如直接开新局更可靠）。

---

## 已知问题 / 注意事项

1. Guest 端永远不会经过 `pvp-step-ready` 步骤(见上文"房间号与连接状态机"),
   如果以后改动连接流程,要注意这个步骤目前实际上是 Host-only 的。
2. 房间号生成是固定 6 位,但 `joinRoom()` 的校验正则接受 4~8 位,范围比实际
   宽,目前没造成问题但两边不完全对齐。
3. ICE 只配置了 STUN,没有 TURN。多数 NAT 环境下能直连成功,但对称型 NAT
   或严格防火墙环境下可能连不通,目前没有兜底方案。

## 可能的后续工作

- 视情况补一个 TURN 服务器配置,提升连接成功率。
- 把房间号位数的生成与校验对齐(确定到底是固定6位还是允许4~8位)。

## 近期变更记录

历史变更条目已并入各自的架构章节（断线设计见 Hard Constraints；蓄力打断
机制见"战斗机制"；注释语言范围见文首约定；partials 拆分/构建工具移除见
File Map），不在这里重复记录演变过程。更细的逐次改动请查 git log。