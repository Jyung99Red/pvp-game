# 战斗架构

当前正式 PVE、训练与 PVP 共用空间动作引擎。脚本仍为按清单顺序执行的全局经典脚本，没有模块系统或打包器。需要通过 HTTP 打开。

## 启动和资源

`index.html` / `training.html` 提供独立于游戏 CSS 的加载外壳。`core/client_boot.js` 读取 `client-assets.json`，并行获取本地样式、脚本和正式页面 partials；单次请求超时 12 秒，失败重试一次，使用 `cache:no-store`。

本地资源下载完后按清单应用样式、挂载 partials、执行脚本。样式必须具有有效 CSSOM 和可应用的末尾标记，初始化成功才显示页面。空响应、误返回 HTML、样式未应用或脚本异常均保留重试界面。前台恢复/BFCache 返回时检查并修复缺失样式，不重建游戏或重复初始化。

PeerJS 不参与首屏加载。`core/client_dependencies.js` 在创建/加入房间时加载固定版本 1.5.4；合并并发请求，10 秒超时，失败可重新尝试。取消连接后延迟返回的加载结果不能创建房间。

## 职责

| 文件 | 职责 |
|---|---|
| `core/data.js` / `core/effects.js` | 游戏状态、内容与现行属性/效果注册 |
| `core/combat_rules.js` | 共享武器阈值、默认 AP/弹反窗及 AP/SP 回复公式 |
| `core/player.js` / `core/spatial_profiles.js` | 装备/成长聚合、公平档案、开战时固定角色配置 |
| `core/spatial_combat.js` | 圆、扇形、路径、墙、碰撞分离及视野几何 |
| `core/combat_gestures.js` / `ui/combat_input.js` | 语义手势与指针捕获；输入采用 CSS 像素 |
| `pve/spatial_data.js` / `pve/spatial_engine.js` | 数据化动作与技能、运动、伤害、AP/SP、队列、模拟时间 |
| `pve/pve_profiles.js` / `pve/pve_logic.js` | 怪物档案、楼层、收益、死亡/撤退、暂停恢复 |
| `pvp/spatial_duel.js` | 两个人类角色的同步动作、几何命中、同时攻击、双 KO 平局 |
| `pvp/pvp_logic.js` | 主机权威、客机预测/校正、快照、准备/重赛/掉线 |
| `pvp/pvp_net.js` / `pvp/pvp_room.js` | WebRTC 传输、房间生命周期与版本/模式匹配 |
| `ui/ui_spatial_battle.js` | 只读绘制、镜头、特效；每帧一个视野多边形供裁剪和阴影共用 |
| `pve/ui_pve.js` / `pvp/ui_pvp.js` | 各模式的状态显示、输入连接和页面生命周期 |
| `core/save.js` / `core/tick.js` | 成长存档、基地时间/回复；活动 PVE 战斗 HP 由引擎拥有 |

## 当前战斗规则

- 正式 PVE/PVP 重击增伤起点由武器决定：basic/heavy/light 为 300/350/280ms，起点后固定 2 秒满蓄；轻击约 0.3×攻击，重击约 0.3～1.1×攻击。前摇 .45 秒、后摇 .60 秒。训练保留独立配置。
- AP 基础每点 `20/focus` 秒，仅在待机/后摇/硬直回复；SP 每点 `30/focus` 秒，所有存活姿态按模拟时间回复，上限 3，不再从命中或弹反奖励。
- 防御减免 `min(raw×.2, def×.15)`；格挡另乘倍率。心眼修正弹反窗口，技能自动弹反与普通操作弹反分别使用 SP/AP。
- 冲刺预警是路径提示。实际扫掠半宽为路径半宽加怪物碰撞半径，接触判定再计入玩家半径；保持窄线预警供玩家结合模型体积预判。当前位置到锁定终点的预警随剩余距离缩短，碰撞/命中结束冲刺，失衡不被普通收招覆盖。
- PVP 主机以 10ms 步长判定，约 50ms 发送快照。客机预测操作、平滑位置校正，HP/结果来自主机；双方攻击先收集再结算。空间拼刀仍未实现。
- PVP v9 / rule v5；公平与养成分房匹配，公平模式不读取成长。570×630 的 L 墙场地；PVE 510×566，训练 360×400。正式镜头 350×390，客机固定翻转 180 度，技能方向保持屏幕坐标。
- PVE 暂停后保留本场状态，恢复时提示继续；PVP 设置不停战，隐藏、断线或超时结束对局。PVP 不写成长收益。

## 验证

`node --test tests/client-boot.test.cjs tests/spatial-engine.test.cjs tests/pve-spatial.test.cjs tests/pvp-spatial.test.cjs`

启动测试覆盖资源重试、CSS 应用门槛、样式恢复、联机依赖超时/重试与取消。战斗测试覆盖输入、伤害、技能、生命周期和网络同步；真实手机的渲染与网络体验仍需实机验证。浏览器测试使用隔离存档的 `tests/base-browser.html` 和 `tests/pvp-browser.html`，训练本身不读成长存档。
