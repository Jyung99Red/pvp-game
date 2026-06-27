# PVP Architecture — Structure Plan

> PVP is a standalone new system. Borrows player stats + equipment values.
> Single-player mode may break during development, restored at Step 7.

---

## System Overview

```
┌──────────────────────────────────────────────────────┐
│                     UI Layer                          │
│   ui_pvp.js · fx.js · icons.js                       │
│   Read-only consumers of state. Zero game logic.     │
└───────────────────────┬──────────────────────────────┘
                        │ reads state.pvpBattle
┌───────────────────────▼──────────────────────────────┐
│                   Logic Layer                         │
│   pvp_logic.js                                        │
│   Deterministic. No DOM. No Date.now().               │
│   · tick(dt, now)        time advance                 │
│   · applyAction(action)  handle any input             │
│   · resolveExchange()    Host-side judgment           │
└───────────────────────┬──────────────────────────────┘
                        │ send / receive
┌───────────────────────▼──────────────────────────────┐
│                  Network Layer                        │
│   pvp_net.js                                          │
│   · WebRTC DataChannel                                │
│   · Ping/pong clock alignment                        │
│   · Message router → pvp_logic.applyAction()         │
└──────────────────────────────────────────────────────┘
```

**Judgment authority: Host decides all exchanges.**
- All exchange resolution runs on Host's `pvp_logic`
- Results broadcast to Guest via `result` message
- Guest renders only, never self-judges

---

## File Map

### Untouched

| File | Reason |
|------|--------|
| `data.js` | Static config. PVP reuses item/stat values. |
| `player.js` | Stat helpers. PVP calls `getStats()`, `getJudgmentMultiplier()` directly. |
| `fx.js` | Effects library, reused by ui_pvp.js |
| `icons.js` | Icon library |

### Temporarily broken, restored at Step 7

| File | Plan |
|------|------|
| `battle.js` | Frozen during PVP dev. Restored in Step 7. |
| `ui_battle.js` | Same. |

### New files

| File | Role |
|------|------|
| `pvp_logic.js` | PVP battle engine, pure logic |
| `pvp_net.js` | WebRTC + clock sync + message protocol |
| `ui_pvp.js` | PVP battle UI renderer |
| `pvp_room.js` | Room creation/join, SDP + QR exchange |

### Modified

| File | Changes |
|------|---------|
| `index.html` | Add PVP room view + battle view, new script tags |
| `data.js` | Add `pvpConfig` block |

---

## Combat Mechanics — Charge Attack System

### Core Concept

Hold attack button to charge. Release to strike. Charge duration determines damage.
Both players are symmetric. Defense (guard/parry) is unchanged from existing system.

### Charge Phases

```
Press down                     Release / Auto-fire at 3s
    │                                      │
    ▼                                      ▼
────┼──────────┬─────────────────────────────────►
   0s        0.5s                         3s

  [EARLY]    [CHARGE ZONE]              [MAX]
  dmg = 1    dmg scales linearly        dmg = maxChargeDmg
             from minChargeDmg → max
```

| Zone | Condition | Damage |
|------|-----------|--------|
| Early release | held < 0.5s | 1 (fixed, flat) |
| Normal charge | 0.5s ≤ held < 3s | Linear: `minChargeDmg + (held - 0.5) / 2.5 * (maxChargeDmg - minChargeDmg)` |
| Max charge | held ≥ 3s | `maxChargeDmg` (auto-release triggered) |

### Damage Formula

```js
function calcChargeDamage(chargeMs, atkStat) {
  const held = chargeMs / 1000;

  if (held < 0.5) return 1;

  const t = Math.min((held - 0.5) / 2.5, 1.0);   // 0→1 across charge zone
  const base = lerp(pvpConfig.minChargeDmg, pvpConfig.maxChargeDmg, t);

  // atk scales the output; def applied on receiver side (existing formula)
  return Math.round(base * (atkStat / pvpConfig.baseAtk));
}
```

Values TBD (placeholder):
```js
pvpConfig: {
  minChargeDmg: 5,
  maxChargeDmg: 30,
  baseAtk: 10,           // reference atk for scaling
  chargeMaxMs: 3000,
  earlyReleaseMs: 500,
  earlyReleaseDmg: 1,
  ...
}
```

### State Machine (per player)

```
          press attack
IDLE ──────────────────► CHARGING
  ▲                          │  release OR held ≥ 3s
  │                          ▼
  │                     STRIKE_OUT ──► exchange resolution
  │                          │  recoveryMs
  └──────────────────────────┘

          press guard
IDLE ──────────────────► GUARD_WINDUP (300ms)
                              │
                         GUARD_READY
                              │  hit received:
                    ┌─────────┴──────────┐
               parry window           normal guard
               → PARRY                → BLOCKED
               (counter dmg)          (reduced dmg)
```

**Lock rule:** CHARGING state locks out guard input entirely.
Player must release (fire the attack) before they can guard.

### Opponent Visibility

During CHARGING, opponent sees:
- A visible charge progress bar (0 → 100% over 3s)
- Synced via `action` messages sent on press + periodic `charge_sync` ticks (every 100ms)
- No hiding the charge — full information, skill is in reaction timing

### Exchange Resolution (Host only)

```
Attacker fires STRIKE_OUT → Host checks defender's current phase:

GUARD_READY + within parryWindowMs of guard activation
  → PARRY: defender deals counter damage, attacker stunned

GUARD_READY (normal block)
  → BLOCKED: defender takes reduced damage (guard_damage_reduce effect applies)

Both in STRIKE_OUT within 100ms of each other
  → CLASH: both take 50% of respective charge damage, both enter recovery

Anything else
  → HIT: defender takes full charge damage (def formula applied)
```

### Damage Reception (existing formula, unchanged)

```js
// from player.js — reused as-is
const actual = Math.max(1, Math.floor((amount * amount) / (amount + def * 0.5)));
```

---

## state.pvpBattle — New State Block

Standalone, does not touch existing `state.battle`.

```js
state.pvpBattle = {
  active: false,
  role: null,                  // 'host' | 'guest'

  self: {
    hp: 0, maxHp: 0,
    phase: 'idle',             // 'idle'|'charging'|'strike_out'|'recovery'
                               // |'guard_windup'|'guard_ready'|'parry'|'stunned'
    phaseTimer: 0,             // ms remaining in current phase
    chargeStartT: 0,           // timestamp when charge began (for damage calc)
    chargeMs: 0,               // current held duration (updated each tick)
    actionPoints: 3,
    actionProgress: 0
  },

  opponent: {
    hp: 0, maxHp: 0,
    phase: 'idle',
    phaseTimer: 0,
    chargeProgress: 0,         // 0→1, received from network sync
    actionPoints: 3,
    displayName: '对手'
  },

  net: {
    clockOffset: 0,            // written by pvp_net after ping/pong
    rtt: 0
  },

  log: []
}
```

---

## pvp_logic.js

```js
const pvpLogic = {
  tick(dt, now) {
    this._tickSide(state.pvpBattle.self, dt, now);
    this._tickSide(state.pvpBattle.opponent, dt, now);
  },

  applyAction(action) {
    // action.origin === 'local'  → mutate self, if Host trigger resolveExchange
    // action.origin === 'remote' → mutate opponent mirror
  },

  resolveExchange(chargeMs, now) {
    // Host only. Reads opponent.phase, computes result, broadcasts via pvp_net.
  },

  applyResult(result) {
    // Guest only. Applies pre-computed result to self + opponent.
  },

  _tickSide(side, dt, now) {
    // AP recovery, phase timer countdown, auto-release at chargeMaxMs
    if (side.phase === 'charging') {
      side.chargeMs = now - side.chargeStartT;
      if (side.chargeMs >= pvpConfig.chargeMaxMs) {
        this._fireAttack(side);   // auto-release
      }
    }
    if (side.phaseTimer > 0) {
      side.phaseTimer = Math.max(0, side.phaseTimer - dt);
      if (side.phaseTimer === 0) this._onPhaseEnd(side);
    }
  }
}
```

---

## pvp_net.js

### Connection Flow

```
Host                               Guest
  │                                   │
  ├─ createOffer()                    │
  ├─ encode SDP → QR + text ────────►│
  │                        scan/paste │
  │                     createAnswer()│
  │◄──────── paste answer ────────────┤
  ├─ setRemoteDescription()           │
  │◄════════ DataChannel open ═══════►│
  ├─ ping × 5 (clock sync)           │
  └─ send fight_start ──────────────►│
```

No STUN/TURN needed on LAN.

### Message Protocol

```js
// Clock sync
{ msg: 'ping', t0: Number }
{ msg: 'pong', t0: Number, t1: Number }

// Player input
{ msg: 'action',
  type: 'charge_start' | 'charge_release' | 'guard_press' | 'guard_release',
  t: Number }                          // sender clock, offset-corrected on receive

// Charge progress sync (every 100ms during charge)
{ msg: 'charge_sync', progress: Number }   // 0→1

// Host judgment result
{ msg: 'result',
  exchange: 'hit' | 'blocked' | 'parry' | 'clash',
  selfDmg: Number,        // damage to the local player (each client reads own field)
  opponentDmg: Number,
  selfStunMs: Number,
  opponentStunMs: Number }

// Fight control
{ msg: 'fight_start' }
{ msg: 'fight_end', winner: 'host' | 'guest' }
{ msg: 'rematch_request' }
{ msg: 'rematch_accept' }
```

### Clock Alignment

```js
// 5 rounds of ping/pong, average the offset
offset = avg( (pong.t1 - ping.t0 - RTT) / 2 )
corrected_t = remote_t + offset
```

---

## pvp_room.js

```js
const pvpRoom = {
  async hostRoom() {
    const pc = pvpNet.init('host');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const code = btoa(JSON.stringify(offer));
    pvpRoomUI.showQR(code);     // qrcode.js
    pvpRoomUI.showCode(code);   // text fallback
  },

  async joinRoom(encodedOffer) {
    const offer = JSON.parse(atob(encodedOffer));
    const pc = pvpNet.init('guest');
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    pvpRoomUI.showCode(btoa(JSON.stringify(answer)));
  },

  async hostReceiveAnswer(encodedAnswer) {
    const answer = JSON.parse(atob(encodedAnswer));
    await pvpNet.pc.setRemoteDescription(answer);
  }
}
```

---

## ui_pvp.js — Layout

```
┌─────────────────────────────┐
│  对手名   ████░░░░  HP 80   │  ← opponent HP bar
│  [████░░░░░░░░░░░░░] 蓄力   │  ← opponent charge progress (visible)
│  相位: CHARGING / GUARD     │
│                             │
│  ─────── 战斗区域 ──────    │
│     [冲击特效 / 弹反闪光]    │
│                             │
│  [████████░░] HP 60  己方名  │  ← self HP
│  [██████████] 蓄力进度       │  ← self charge bar
│  行动力: ★★☆               │
│  [按住攻击]   [按住防御]      │
└─────────────────────────────┘
```

`ui_pvp.updateFrame()` called each rAF. Reads `state.pvpBattle` only. No writes.

---

## index.html Additions

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>

<script src="pvp_logic.js"></script>
<script src="pvp_net.js"></script>
<script src="pvp_room.js"></script>
<script src="ui_pvp.js"></script>

<!-- View: PVP Room -->
<div id="view-pvp-room" class="view-section hidden">
  <div class="panel">
    <h2>⚔️ PVP 对战</h2>
    <div class="btn-row">
      <button onclick="pvpRoom.hostRoom()">🏠 创建房间</button>
      <button onclick="pvpRoomUI.showJoinInput()">🔗 加入房间</button>
    </div>
    <div id="pvp-qr-area"></div>
    <textarea id="pvp-code-input" placeholder="粘贴对方的连接码..."></textarea>
    <button id="pvp-connect-btn">连接</button>
    <div id="pvp-room-status"></div>
  </div>
</div>

<!-- View: PVP Battle -->
<div id="view-pvp-battle" class="view-section hidden">
  <!-- rendered by ui_pvp.js -->
</div>
```

---

## Implementation Order

```
Step 1 — pvp_net.js
  WebRTC offer/answer on LAN
  DataChannel open + echo test
  Ping/pong clock sync

Step 2 — pvp_room.js + Room UI
  QR generation (qrcode.js)
  SDP text fallback
  On connect → trigger Step 3

Step 3 — pvp_logic.js skeleton
  state.pvpBattle init
  tick(): AP recovery + phase timers + auto-release
  applyAction(): local input → self phase transitions

Step 4 — Single-side battle running
  Charge bar renders on both sides
  charge_sync messages keep opponent bar updated
  ui_pvp.js renders both players

Step 5 — Host judgment
  resolveExchange() all four outcomes
  result message broadcast
  Guest applyResult()

Step 6 — Win/loss + rematch
  HP zero detection
  fight_end message
  Rematch flow

Step 7 — Restore single-player
  battle.js + ui_battle.js unfrozen
  Both systems coexist, separate entry points
```

---

## Hard Constraints

- `pvp_logic.js`: no `document.*`, no `Date.now()`. Time via arguments only.
- `pvp_net.js`: no game math. Transport + clock only.
- `ui_pvp.js`: reads `state.pvpBattle`, never writes game state.
- Guest never self-judges. Host result is authoritative.
- `player.getStats()` and `player.getJudgmentMultiplier()` reused as-is. No rewrite.
- Charge lock: while `self.phase === 'charging'`, guard input is ignored entirely.
