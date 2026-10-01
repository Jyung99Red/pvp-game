# 放置地牢

方块风格的 3D 动作 RPG，在手机浏览器里横屏玩。项目使用原生 HTML、CSS 和 JavaScript，没有打包器和安装步骤；3D 画面用 three.js（已放在 `vendor/three/`，离线可用）。

**正在重建。** 2D 竖屏版本在标签 `v1-2d`（提交 `2a313c4`）。重建按 [docs/tasks/rebuild-plan.md](docs/tasks/rebuild-plan.md) 分 6 个里程碑进行，现在完成的是 **M1 新骨架**：横屏外壳、五个按钮的输入层、方块空地、主角的待机和走路。连段、怪物、PVP、据点和装备界面会在后面的里程碑里回来。

## 开始运行

Windows 下直接双击项目根目录的 [Run-Game.bat](Run-Game.bat)。脚本会启动本地服务并在默认浏览器打开游戏；保持脚本窗口开启即可继续游玩，关闭窗口会停止服务。

服务监听所有网卡。手机和电脑连在同一个网络时，用脚本窗口里“Phone on the same network”那一行的地址在手机浏览器打开即可。

脚本需要系统已安装 Python，并会自动尝试 `py` 和 `python`。也可以在项目目录手动运行：

```powershell
python -m http.server 8422
```

然后打开 [http://localhost:8422](http://localhost:8422)。资源通过 `fetch()` 和 `import()` 加载，不能直接用 `file://` 打开 `index.html`。

## 操作

只支持横屏，竖屏时会提示把手机横过来。Android 上第一次触摸会请求全屏。

| 操作 | 触屏 | 键盘 |
|---|---|---|
| 移动 | 左半屏任意处按下出现摇杆，拖动 | WASD 或方向键 |
| A | 右下大按钮 | J |
| B | A 上方 | K |
| 副手 | A 左边（显示当前副手的图标） | L |
| 交互 | 左上方 | E |

最多同时两个触点（左右拇指）。现在 A、B、副手和交互只有按下的反馈，功能从 M2 开始加。左上角显示帧率、绘制调用次数和三角形数量，方便在手机上看性能。

## 测试

```powershell
node --test "tests/*.test.cjs"
```

Node 测试覆盖启动器、矩阵和盒子相交、骨骼和正向运动学、走路动作、模拟循环、移动和碰撞、按钮布局。`tests/browser-smoke.test.cjs` 在装了 Playwright 时用无头浏览器打开真实页面（横屏加载、画面、竖屏提示、两指同时操作），没装时跳过。手感、真实帧率、iPhone 行为仍要在真机上检查。

## 项目结构

```text
core/       模拟和数学（不依赖页面和 three.js）、启动器
models/     模型数据：骨架、方块、装备、关键姿势、调色板
render/     three.js 画面
ui/         输入层、启动和界面
vendor/     第三方文件（three.js）
partials/   启动时挂载的页面片段
tests/      Node 测试和浏览器冒烟测试
```

进行中的设计在 `docs/tasks/`。新增或删除脚本、样式及页面片段时，要同步更新 `client-assets.json`。
