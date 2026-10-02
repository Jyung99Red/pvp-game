# 路线和开发笔记

做的顺序、每一步做到哪、新会话怎么开头、自己能测什么。设计见 `design.md`，数值见 `parameters.md`。

## 1. 做过的

整个游戏在 2026-10-01～02 按 6 个里程碑重建（方块 3D、横屏、5 个按钮、骨骼判定）。2D 竖屏的旧版本在标签 `v1-2d`（提交 `2a313c4`），
要看旧代码：`git show 2a313c4:<路径>`。

| 里程碑 | 内容 |
|---|---|
| M1 新骨架 | three.js 接入、横屏外壳、五个按钮的输入层、固定步长模拟、骨骼数学、主角模型和走跑 |
| M2 训练场 | 8 招和派生树、骨骼判定、盾和格挡条、卡肉击退失衡、训练木桩、特效和音效 |
| M3 第一批怪 | 哥布林、野狼、AI、红区、胜负结算 |
| M4 联机对战 | PeerJS 房间、主机判定、访客预测、竞技场、视野遮挡 |
| M5 世界 | 分块地形、实体、交互键、据点和三个区域、首领、掉落、宝箱、存档、镜头遮挡透明 |
| M6 物品和界面 | 装备和属性、药水、火把、枯木丛、幽暗洞穴、背包商店铁匠铺、README |
| M7 武器和采集 | 文档合并成 3 份、武器类型（剑变慢、短刃新招式表）、首领失衡 10 点、对战选武器、走路加快加大步幅、矿石晶石草药和资源点复原 |

每一步结束时：测试全绿、浏览器里能玩到、提交推送、告诉用户要在手机上试什么。用户试完提意见，再开始下一步。

M7（2026-10-02）用户要试：短刃的新连段顺不顺手（A 五连、连段中的 B、突刺、退步斩）、剑慢下来的程度、首领 10 点失衡是否合适、
走路的速度和步子（还漂不漂）、采集按住的时间、资源 5 分钟长回来是否合适、对战里选武器、新材料够不够打造。

## 2. 之后

按大致顺序，开工前先和用户确认：

1. **用户在手机上试 M7 后的调整**：短刃招式的手感、剑慢下来的程度、走路速度、资源点长回来的时间。
2. **怪物系统**：更多招式、派生连段、阶段（怒、疲劳、濒死），新怪物（洞穴、更深的区域）。AI 和判定是分开的，随时能开始。
3. **装备数值**：放在怪物之后，对着怪物的数值调；特殊效果。
4. **更多破坏**：裂墙、拉杆门之类的机关，木箱陶罐之类每次复原的杂物（`design.md` 第 6.5 节）。
5. **据点娱乐动作**（`design.md` 第 9 节第 8 条）。

## 3. 新会话怎么开头

直接发：

> 看 `docs/tasks/roadmap.md` 和 `docs/tasks/design.md`，做 <要做的事>。数值在 `game_config.js`，对照表是 `docs/tasks/parameters.md`。
> 遇到没写到的问题按最简单的做法做，并记进 `design.md`。做完测试全绿、提交推送，然后告诉我要在手机上试什么。

约定（也在 `AGENTS.md`）：

- 可调数值只放 `game_config.js`，改了同步 `parameters.md`。模型形状和关键姿势是 `models/` 里的数据，不是可调数值。
- 新脚本登记到 `client-assets.json`；新页面片段还要在 `index.html` 里加 `#mount-<id>`。
- 完成 = `node --test "tests/*.test.cjs"` 全绿。改了测试断言的内容要说明为什么。
- 代码注释和 `AGENTS.md` 用英文；`README.md`、界面文字、`docs/tasks/` 用中文。
- 文档只有 3 份（这份、`design.md`、`parameters.md`）。新决定写进 `design.md` 对应的节，不另开文件，不写"某某里程碑补的决定"这种流水账。

## 4. 自己能测什么

云端容器里预装了 Chromium 和 Playwright（全局在 `/opt/node22/lib/node_modules/playwright`），无头模式下 WebGL 用软件渲染能跑、能截图、能模拟横屏手机和两根手指。

| 能自己测 | 怎么测 |
|---|---|
| 模拟规则：连段、派生、预输入、停顿线、格挡条、卡肉、失衡、药水 | Node 测试，直接驱动模拟 |
| 判定：每招必中、扫过的角度、矮的怪能被打到、红区 | Node 测试 |
| 联机协议和同步 | Node 测试里主机和访客各跑一份（`tests/duel.test.cjs`），可以加延迟 |
| 页面加载、没有控制台报错、资源清单完整 | 浏览器测试 |
| 画面、按钮布局、文字有没有被挤掉 | 截图后用 Read 打开看 |
| 两根拇指同时操作 | CDP 多点触控 |

| 测不了，要用户在手机上试 | 原因 |
|---|---|
| 手感：按钮位置、连段节奏、走路快慢 | 要真手指 |
| 真实帧率 | 软件渲染只有几帧每秒；能比较的只有绘制次数和三角形数 |
| iPhone 的方向锁定、全屏、安全区 | 容器里只有 Chromium |
| 音效 | 听不到 |
| 两台设备真实联机 | 连不上公共信令服务器 |

### 4.1 浏览器测试的写法

- 启动：`chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })`。
- 横屏手机：`browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })`。
- 多点触控要开 CDP 会话用 `Input.dispatchTouchEvent`（`page.touchscreen.tap` 只能单点）。
- **不要依赖真实时间**：无头模式两帧之间有时隔 0.5～0.75 秒。用 `game.pause()` 停掉实时时钟、`game.run(秒)` 确定地推进；真要测实时循环就等"已经跑过几帧"。
- `tests/browser-smoke.test.cjs` 就是这套办法，找不到 Playwright 时自动跳过。设 `SMOKE_SHOTS=<目录>` 会存截图。
- 用户的 Windows 电脑上：把 `playwright-core` 装在任意目录，设 `PLAYWRIGHT_MODULE=<该目录>/node_modules/playwright-core` 和 `PLAYWRIGHT_CHANNEL=chrome`。

### 4.2 页面上的 `window.game`

- `game.pause()`、`game.run(秒)`、`game.sim`（模拟状态）、`game.map`（当前图）、`game.panel`（打开的面板）、`game.screens`（背包等界面）。
- `game.load('base' | 'field' | 'valley' | 'cave' | 'clearing')` 换区域（从头进），`game.save` 是存档，`game.persist()` 立刻写存档。
  每个浏览器测试用新的 `BrowserContext`，存档从头开始。地址里 `?map=` 直接进某个区域。
- `game.duel` 是对战会话，`game.room` 是房间界面；对战页面不要 `game.pause()`（对局靠真实时间）。
- `game.view.ground.cut.on.value = 0` 关掉镜头遮挡透明。
- 看模型近景：先 `game.view.render(game.sim, 0)`，再把 `game.view.render` 换成空函数，自己摆 `game.view.camera` 并 `game.view.renderer.render(game.view.scene, game.view.camera)`。
- 怪物测试用固定的场地 `tests/fixtures/m3-field.cjs`（游戏里的区域会跟着内容改，测试场地不变）。

### 4.3 两台设备的对战

- 浏览器测试：同一个 `BrowserContext` 里开两个页面，地址都带 `?link=local`，从界面建房、加入、打到结算。
- 真的 PeerJS 加 WebRTC：在临时目录 `npm install peer`，起 `PeerServer({ port, host: '127.0.0.1', path: '/' })`（容器不支持 IPv6），
  两个页面放在**不同的** `BrowserContext`，地址带 `?peer=127.0.0.1:<端口>`。改了 `net/link.js` 时手动跑一遍。

### 4.4 three.js

`npm pack three@<版本>` 后用 esbuild 打成一个压缩文件（`npx esbuild <入口> --bundle --minify --format=esm`），放进 `vendor/three/`。外部 CDN 在容器里连不上，npm 能用。
