# 卓宠 · zhuochong

桌面宠物平台。宿主是一个 Tauri 2 小窗口，角色以**资源包插件**形式提供：一张 PNG 帧表 + 一份 `manifest.json`，不需要写代码就能做角色。

![龙焰喵](docs/dragon-preview.png)

## 龙焰喵（唯一的内置角色）

AI 立绘 + 程序化动画的 3D 质感机甲猫骑士：黑色面罩青焰竖瞳、盔甲铆钉、盾刻龙纹、手持长剑、背负小龙与蝠翼、分节金属尾。

- **16 个动作**：待机呼吸（会眨眼）、行走、小跑、挥剑斩击（剑光弧 + 落地扬尘）、展翼蓄力（能量冲击环）、跳跃、翻滚、转圈、匍匐、坐地休息、挥手、扭动、睡觉（青瞳熄灭 + zzz）、头晕、被拎起挣扎
- **细节动效**：眼睛辉光呼吸、尾侧飘龙焰余烬、落地投影随高度收缩变淡
- **互动**：单击随机动作（挥剑/展翼/跳跃/翻滚/转圈/挥手）、双击转圈圈、连点 4 下头晕、发呆自己溜达或坐下休息、2 分钟不理它就睡觉、拎起来会挣扎、唤醒时展翼蓄力登场
- 透明无边框置顶窗，拖动移动、位置记忆；托盘菜单：显示/隐藏、打开插件目录、退出
- 插件零执行：宿主只读文件，不运行插件代码

## 快速开始

### 使用（普通用户）

从 [Releases](https://github.com/<owner>/zhuochong/releases) 下载 Windows 安装包（`.exe`）。

安装后：左键拖动移动角色，单击互动，托盘图标有菜单。

### 开发

前置：Node 20+、Rust 1.77+（[rustup](https://rustup.rs)）、Windows 需 WebView2（Win10/11 自带）。
编译环境全部在 E 盘（`E:\BuildTools` + `E:\winsdk`），构建前设置 `PATH/LIB/INCLUDE/RC` 环境变量（见仓库内构建脚本或维护日志）。

```bash
npm install
npm run dragon      # 重新生成龙焰喵精灵图与 manifest（已入库，改动作时才需要）
npm run tauri dev   # 启动宿主（首次编译较慢）
npm run tauri build # 产出安装包
```

### 自检

两个冒烟脚本，改完渲染或宿主代码后跑一遍：

```bash
npm run dev            # 另开一个终端
npm run verify:web     # 浏览器预览模式：精灵渲染、动画、互动、控制台无错
```

```bash
# 真实宿主内校验（含 Rust IPC）：需要先在 9222 上开 WebView2 调试端口
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" \
  ./app/zhuochong.exe
npm run verify:app     # 插件扫描、精灵加载、窗口自适应、行为校验
```

## 做自己的角色

1. 复制 `examples/hello-pet/`，改 `id` / `name`；
2. 准备一张 RGBA PNG 帧表（尺寸 = `cellWidth × columns` × `cellHeight × rows`）；
3. 在 `actions` 里定义 `idle`（必需）与可选动作；
4. 想要进阶互动就加 `behavior` 块（单击池、双击、连点、睡眠，见插件规范）；
5. 把整个文件夹放到插件目录即可被扫描加载。

完整字段说明见 [docs/PLUGIN_SPEC.md](docs/PLUGIN_SPEC.md)。龙焰喵的动作/特效调整方式：

```bash
# 修改 scripts/gen-dragon.mjs 里的 ACTIONS（关键帧表）后重跑
npm run dragon
```

## 目录结构

```
src-tauri/            宿主（Rust）：窗口、托盘、插件扫描、配置读写
src/                  渲染层（TS + canvas）：帧动画、动作状态机
plugins/              内置角色 dragon-flame + 市场索引 index.json
assets/dragon/        AI 生成的 8 张原始姿态图
scripts/gen-dragon.mjs  抠图、归一化、动作帧合成（含特效叠加）
examples/             插件模板
docs/                 插件规范与路线图
```

## 安全边界

v1 平台化刻意**不引入脚本插件**：

- 宿主只读 `manifest.json` 与 PNG，不执行任何插件代码；
- 精灵图文件名白名单校验，禁止 `../` 与绝对路径；
- 无网络、无文件系统访问的插件能力。

行为脚本与数据源联动在 v0.2 之后评估，需要配套沙箱与权限模型，见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 许可

- 代码：[MIT](LICENSE)
- 龙焰喵素材（`plugins/dragon-flame/`、`assets/dragon/`）：CC0-1.0
- 第三方插件素材版权归各自作者，必须可再分发且不含他人 IP
