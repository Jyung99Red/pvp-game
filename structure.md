# PVP Architecture

PVP 是独立的新战斗系统,复用玩家属性与装备数值(`player.js` / `data.js`)。
与单人战斗(`battle.js` / `ui_battle.js`)通过 `ui.switchTab()` 切换不同
`view-section` 共存,两套脚本全程一起加载,互不冻结、互不干扰。

---

## System Overview

```
┌──────────────────────────────────────────────────────┐
│                     UI Layer                          │
│   ui_pvp.js · fx.js · icons.js                        │
│   Read-only consumers of state. Zero game logic.      │
└───────────────────────┬───────────────────────────────┘
                        │ reads state.pvpBattle
┌───────────────────────▼───────────────────────────────┐
│                   Logic Layer                          │
│   pvp_logic.js                                         │
│   Deterministic state machine + 伤害公式 + Host 判定权威 │
│   不调用 document.*；帧推进靠 tick(dt, now) 传入的时间   │
└───────────────────────┬───────────────────────────────┘
                        │ send / receive
┌───────────────────────▼───────────────────────────────┐
│                  Network Layer                         │
│   pvp_net.js   — PeerJS 信令 + WebRTC 传输 + 时钟同步    │
│   pvp_room.js  — 房间号配对、连接状态机、断线重连流程     │
└──────────────────────────────────────────────────────┘
```

**裁决权威：Host 决定所有判定结果。**
- 所有交锋判定都在 Host 这一端的 `pvp_logic` 里跑
- 结果通过 `result` 消息广播给 Guest
- Guest 只渲染,从不自行判定

---

## File Map

| File | 角色 |
|------|------|
| `data.js` | 静态配置,PVP 复用其中的装备/属性数值 |
| `player.js` | `getStats()` / `getJudgmentMultiplier()` / `getGuardDamageMultiplier()` 被 PVP 直接调用 |
| `tick.js` / `ui.js` | 主循环与视图切换,PVP 和单人战斗共用 |
| `fx.js` / `icons.js` | 共享特效与图标库,单人战斗和 PVP 都在用 |
| `battle.js` / `ui_battle.js` | 单人战斗,与 PVP 视图通过 tab 切换共存 |
| `build.py` / `serve.bat` | 构建/开发服务脚本 |
| `pvp_logic.js` | 战斗引擎：状态机、伤害公式、Host 判定、网络消息处理；`pvpConfig` 定义在本文件顶部 |
| `pvp_net.js` | PeerJS 连接、时钟同步、消息收发 |
| `pvp_room.js` | 房间创建/加入/重连的 UI 流程与步骤切换 |
| `ui_pvp.js` | PVP 战斗 UI 渲染,只读 `state.pvpBattle`,不写游戏状态 |

---

## 战斗机制 — 蓄力攻击系统

### 蓄力阶段

```
按下                            松手 / 3秒自动出手
 │                                      │
 ▼                                      ▼
─┼──────────┬─────────────────────────────────►
0s        0.5s                         3s

[EARLY]    [CHARGE ZONE]              [MAX]
```

### 伤害公式

```js
// pvp_logic.js — _calcChargeDamage
function _calcChargeDamage(chargeMs) {
    const atk = player.getStats().atk;
    if (chargeMs < pvpConfig.earlyReleaseMs) return pvpConfig.earlyReleaseDmg; // 1
    const t = Math.min(
        (chargeMs - earlyReleaseMs) / (chargeMaxMs - earlyReleaseMs), 1.0
    );
    const ratio = lerp(0.3, 1.1, t);          // 0.5s→0.3倍atk，3s→1.1倍atk
    return Math.max(1, Math.round(atk * ratio));
}
```

```js
// pvp_logic.js — _applyDefense（PVP 专用线性减免公式，与单人战斗的伤害公式分开维护）
function _applyDefense(rawDmg) {
    const def = player.getStats().def;
    const reduction = Math.min(rawDmg * 0.20, def * 0.15);
    return Math.max(1, Math.round(rawDmg - reduction));
}
```

### 状态机（per player）

```
        press attack
IDLE ─────────────────► CHARGING
  ▲                         │ release OR held ≥ 3s
  │                         ▼
  │                    STRIKE_OUT ──► 交锋判定
  │                         │ strikeRecoveryMs (800ms)
  └─────────────────────────┘

        press guard
IDLE ─────────────────► GUARD_WINDUP (300ms)
                             │
                        GUARD_READY
                             │ 被击中:
                   ┌─────────┴──────────┐
              弹反窗口内               弹反窗口外
              → 攻击方反击受伤+硬直     → defender 进入
                (parryStunMs 600ms)      STUNNED 150ms
```

**锁定规则：** CHARGING 状态下完全锁 guard 输入,必须先松手出招才能举盾。

**判定细节：**
- 弹反窗口 `parryWindowMs * player.getJudgmentMultiplier()`,随属性变化。
- 拼刀窗口固定 `clashWindowMs = 100ms`,不受属性影响。
- 拼刀/弹反的时间比较全部用本机 `Date.now()`墙钟时间(`lastStrikeT` /
  `lastGuardReadyT`),不经过 `pvpNet.correctRemote()` 换算。

### AP 恢复

```
_apRecoveryMs() = pvpConfig.apRecoveryMs(2000ms) * (10 / spd)
```
spd 越高恢复越快;蓄力/举盾期间不恢复 AP。

### 对手可见性

蓄力进度通过 `charge_sync` 消息每 100ms 同步一次,双方信息对等,博弈点在反应
时机而不是信息隐藏。

---

## state.pvpBattle

```js
state.pvpBattle = {
    active: false,
    paused: false,            // 断线时置 true,恢复连接后置回 false

    role: null,               // 'host' | 'guest'

    self: {
        hp, maxHp,
        phase: 'idle',         // idle|charging|strike_out|strike_recover
                               // |guard_windup|guard_ready|parry|stunned
        phaseTimer: 0,
        chargeStartT: 0,
        chargeMs: 0,
        actionPoints: 3,
        actionProgress: 0,
        lastStrikeT: 0,        // Date.now()，出招瞬间，拼刀判定用
        lastChargeMs: 0,       // 上一次出招的蓄力时长，拼刀伤害用
        lastGuardReadyT: 0     // Date.now()，举盾就绪瞬间，弹反判定用
    },

    opponent: {
        ...同上结构,
        chargeProgress: 0,    // 0→1，仅靠 charge_sync 网络消息更新
        displayName: '对手'
    },

    net: { clockOffset, rtt },
    log: []
}
```

---

## 网络层 — pvp_net.js + pvp_room.js

### 连接建立流程

```
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
 ├─ 发起 5 轮 ping/pong 时钟同步 ─────────────► 逐条回 pong
 ├─ 同步完成 → emit('open')（仅 host 侧会触发）
 ├─ send({msg:'fight_start'})
 ├─ pvpLogic.startPVP('host')                  收到 fight_start 消息
 └─ 切到战斗界面                                → pvpLogic.startPVP('guest') → 切到战斗界面
```

- Host 用房间号本身作为 PeerJS 的 peer ID 注册;Guest 用匿名 ID 注册,再
  用房间号 `connect()` 到 Host。
- 信令服务器只负责打洞撮合,不转发游戏数据;实际对战数据走建立后的 WebRTC
  DataChannel 直连。
- ICE 配置目前只给了 Google 的公共 STUN,没有配置 TURN。

### 时钟同步

Host 发起,Guest 应答,共 `PING_ROUNDS = 5` 轮,每轮间隔 `PING_INTERVAL_MS = 200ms`:

```
offset_sample = t1 - t0 - rtt/2     // t0=本机发ping时间，t1=对方收到时刻，rtt=本机收到pong往返耗时
clockOffset   = avg(offset_sample)
rtt           = avg(rtt_sample)

correctRemote(remote_t) = remote_t - clockOffset
```

`offset` 的定义是「guest 时钟 − host 时钟」,所以换算对方时间戳到本机等效
时间要做减法,不是加法——加号会让换算结果偏出真实值达 2×offset,且方向是把
对方事件推到未来,这正是早期版本里格挡/弹反误判的根因。

> `pvp_logic.js` 里出招/举盾相关的两个时间戳(`lastStrikeT`、
> `lastGuardReadyT`)即便有了 `correctRemote()`,仍然选择只用本机
> `Date.now()`,不做网络时钟换算——属于双重保险,避免时钟同步本身的误差或
> 还没同步完成时的窗口期再次引入误判。

### 房间号与连接状态机（pvp_room.js）

- 房间号：6 位数字,`genRoomCode()` 随机生成;`joinRoom()` 侧校验放宽到
  `/^\d{4,8}$/`(4~8位都接受),比实际生成的位数更宽松。
- `pvp-step-*` 系列 DOM 节点对应房间流程的每一步(entry / hosting /
  host-waiting / joining / joining-wait / ready),由 `setStep()` 统一切换
  `hidden` 类。
- **Guest 端不会经过 `pvp-step-ready`**：因为 `pvpNet.on.open` 按设计只在
  Host 侧触发(时钟同步是 Host 发起的,完成后才 emit),Guest 侧的
  `on.open` 永远不会被调用。Guest 实际是停在 `pvp-step-joining-wait`,直到
  收到 `fight_start` 消息才直接跳到战斗界面。
- 断线处理:
  - 对战中掉线 → `pvpLogic.pauseForDisconnect()` + 弹出
    `pvp-disconnect-overlay`,不退出战斗界面。
  - 还没开打就掉线 → 直接回到 `pvp-step-entry`。
  - 重连仅 Guest 可主动发起(`attemptReconnect`);Host 的
    `peer.on('connection')` 一直在监听,只需等待 Guest 重新连入,不需要
    任何主动操作。
  - "放弃返回大厅"(`giveUpToLobby`)会先把 `pvpNet.on.close` 置空再调用
    `pvpNet.close()`,避免 `peer.destroy()` 异步触发的 close 事件和这里
    的主动跳转互相打架。

---

## 网络消息协议

```js
// 时钟同步（pvp_net.js 内部处理，不会冒泡给 pvp_logic）
{ msg:'ping', t0 }
{ msg:'pong', t0, t1 }

// 输入动作
{ msg:'action', type:'charge_start', t }
{ msg:'action', type:'charge_release', chargeMs, t }
{ msg:'action', type:'guard_press', t }
{ msg:'action', type:'guard_ready', t }
{ msg:'action', type:'guard_release', t }

// 蓄力进度（持续蓄力期间每100ms一条）
{ msg:'charge_sync', progress }        // 0→1

// Host 判定结果（绝对HP值，guest直接套用，不用算差值）
{ msg:'result',
  exchange: 'hit'|'blocked'|'parry'|'clash',
  logText,
  hostHp, guestHp,
  hostStunMs, guestStunMs,
  attackerIsHost }

// 战斗流程
{ msg:'fight_start' }
{ msg:'fight_end', winner:'host'|'guest' }
{ msg:'rematch_request' }
{ msg:'rematch_accept' }
```

---

## ui_pvp.js — 当前布局

```
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
```

加上结算 / 求和重赛 / 断线重连三套全屏 overlay：`pvp-result-overlay`、
`pvp-disconnect-overlay`,均由 `ui_pvp.js` 控制 `hidden` 类切换显示。

`updateFrame()` 每 rAF 调用一次,只读 `state.pvpBattle`,不写。

---

## Hard Constraints

- `pvp_logic.js`：不调用 `document.*`；帧推进靠 `tick(dt, now)` 传入时间。
- `pvp_net.js`：只管信令、传输、时钟对齐,不做战斗数值计算。
- `ui_pvp.js`：只读 `state.pvpBattle`,从不写游戏状态。
- Guest 永不自行判定,Host 的 `result` 消息是唯一权威。
- `player.getStats()` / `getJudgmentMultiplier()` / `getGuardDamageMultiplier()`
  直接复用;伤害/防御公式是 PVP 自己单独维护的一套,不复用单人战斗的公式。
- CHARGING 状态下 guard 输入完全锁定。

---

## 已知问题 / 注意事项

1. `pvpConfig.minChargeDmg` / `maxChargeDmg` / `baseAtk` 三个字段未被
   `_calcChargeDamage` 实际使用,伤害是直接拿 `atk` 乘 0.3~1.1 的线性系数。
2. `'blocked'` 这个 phase 永远不会被赋值——格挡命中走的是
   `_setPhase(defender, 'stunned', 150)`。`'blocked'` 只在 `_tickSide`
   的兜底 switch 和 `ui_pvp.js` 的标签映射表里各留了一条死分支,容易和
   `exchange:'blocked'`(交锋结果字段,语义不同)搞混。
3. `pvpNet.sendAction(type, hand)` 这个便捷方法目前没人调用——`pvp_logic.js`
   都是直接 `pvpNet.send({msg:'action', type, t})`,`hand` 字段在 PVP 协议
   里也从未出现过,大概是早期单人战斗"左右手"概念的残留。
4. Guest 端永远不会经过 `pvp-step-ready` 步骤(见上文"房间号与连接状态机"),
   如果以后改动连接流程,要注意这个步骤目前实际上是 Host-only 的。
5. 房间号生成是固定 6 位,但 `joinRoom()` 的校验正则接受 4~8 位,范围比实际
   宽,目前没造成问题但两边不完全对齐。
6. ICE 只配置了 STUN,没有 TURN。多数 NAT 环境下能直连成功,但对称型 NAT
   或严格防火墙环境下可能连不通,目前没有兜底方案。

## 可能的后续工作

- 清理上面 1～3 条死代码/未用字段,或者把它们接上真正的逻辑。
- 视情况补一个 TURN 服务器配置,提升连接成功率。
- 把房间号位数的生成与校验对齐(确定到底是固定6位还是允许4~8位)。