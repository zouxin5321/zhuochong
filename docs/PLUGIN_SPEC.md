# 卓宠插件规范 v1（资源包）

一个插件 = 一个文件夹 + 一张 PNG 帧表 + 一份 `manifest.json`。

**宿主编译期不执行插件代码**：插件只能决定「长什么样、怎么动」，不能读文件、发网络请求。这是 v1 的安全边界。

## 1. 目录结构

```
<插件目录>/
├── manifest.json      # 必需，UTF-8
├── spritesheet.png    # 必需（文件名由 manifest 指定）
└── 其他说明文件        # 可选，宿主忽略
```

插件目录：

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\<应用标识>\plugins\` |
| macOS | `~/Library/Application Support/<应用标识>/plugins/` |
| Linux | `~/.local/share/<应用标识>/plugins/` |

托盘菜单「打开插件目录」可直接定位。放在该目录下的每个子文件夹都会被扫描，**同 id 时用户插件覆盖内置插件**。

## 2. manifest.json

```json
{
  "id": "my-pet",
  "name": "我的角色",
  "version": "1.0.0",
  "author": "your-name",
  "description": "一句话介绍",
  "license": "CC0-1.0",
  "minHost": "0.1.0",
  "scale": 2,
  "defaultAction": "idle",
  "sprite": {
    "file": "spritesheet.png",
    "cellWidth": 128,
    "cellHeight": 128,
    "columns": 8,
    "rows": 3
  },
  "actions": {
    "idle":  { "row": 0, "frames": 4, "fps": 4, "loop": true },
    "happy": { "row": 1, "frames": 4, "fps": 8, "loop": false, "next": "idle" },
    "drag":  { "row": 2, "frames": 2, "fps": 8, "loop": true }
  }
}
```

### 字段

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 全局唯一，`[A-Za-z0-9._-]`，≤64 字符 |
| `name` | ✅ | 显示名，托盘/提示用 |
| `version` | ✅ | 语义化版本 |
| `author` / `description` / `license` | — | 市场索引展示用 |
| `minHost` | — | 宿主最低版本；不满足时宿主提示「插件需要更新宿主」 |
| `scale` | — | 显示缩放倍数，支持小数，默认 1（128px 帧格配 1.2 → 约 154px 显示） |
| `defaultAction` | — | 默认动作，缺省取 `actions` 的第一个 |
| `sprite` | ✅ | 帧表几何信息 |
| `actions` | ✅ | 动作表，至少一个 |

### sprite

| 字段 | 说明 |
| --- | --- |
| `file` | 插件目录内的 PNG 文件名，**不允许路径分隔符** |
| `cellWidth` / `cellHeight` | 单帧像素尺寸 |
| `columns` / `rows` | 帧表列数、行数 |

帧表要求：RGBA PNG，尺寸必须为 `cellWidth × columns` 与 `cellHeight × rows`；未使用的格子保持全透明。

### actions

| 字段 | 说明 |
| --- | --- |
| `row` | 该动作在帧表中的行号（从 0 开始） |
| `frames` | 帧数 |
| `fps` | 播放帧率，默认 8 |
| `loop` | 是否循环，默认 `true` |
| `next` | 非循环动作播完后切到的动作，缺省回落默认动作 |

约定动作名（宿主有对应交互时优先使用）：

| 动作 | 触发时机 |
| --- | --- |
| `idle` | 待机（必需，作为兜底） |
| `jump` | 单击角色（click 池默认项） |
| `happy` | 单击角色 / 唤醒 |
| `roll` | 单击池 / 发呆池：翻滚 |
| `spin` | 双击 / 发呆池：转圈圈 |
| `crawl` | 单击池 / 发呆池：爬行 |
| `wiggle` | 单击池 / 发呆池：蠕动 |
| `wave` | 单击池：打招呼 |
| `dizzy` | 连点 4 次：头晕 |
| `sleep` | 长时间无交互：睡觉（循环） |
| `drag` | 被拖拽（拎起来）时（循环） |

未定义的动作会被静默忽略，不会报错——插件只提供 `idle` 也能正常运行。

### behavior（可选）

声明「哪些动作属于哪类事件」。缺省任何一项都回落到宿主默认值：

```json
"behavior": {
  "click":      ["jump", "roll", "spin", "wiggle", "wave", "crawl"],
  "ambient":    ["crawl", "wiggle", "spin"],
  "doubleClick": "spin",
  "combo":      { "count": 4, "windowMs": 1600, "action": "dizzy" },
  "sleep":      { "afterMs": 120000, "action": "sleep" },
  "drag":       "drag",
  "wake":       "jump"
}
```

| 字段 | 说明 |
| --- | --- |
| `click` | 单击时随机播放的动作池（自动避开连续重复） |
| `ambient` | 安静 9 秒后随机「自言自语」的动作池 |
| `doubleClick` | 320ms 内连点两次触发 |
| `combo` | `windowMs` 内点满 `count` 次触发 `action` |
| `sleep` | 无交互超过 `afterMs` 后进入循环动作 |
| `drag` | 拖拽期间循环播放 |
| `wake` | 睡醒 / 拖拽松手时播放 |

宿主负责全部计时与判定，插件永远只是「被叫去做动作」，不需要声明任何行为逻辑。

## 3. 校验与失败行为

宿主逐个读取插件目录，任何一条不满足就**跳过该插件并在控制台打印原因**，不影响其他插件启动：

1. `manifest.json` 必须是合法 JSON；
2. `id` 合法且唯一；
3. `name` 非空；
4. `sprite.file` 存在且为目录内纯文件名；
5. `actions` 非空。

## 4. 分发

1. 把插件文件夹打成 zip（zip 根目录直接包含 `manifest.json`）；
2. 在 `plugins/index.json` 增加条目：`download` 指向 Release 附件地址，`sha256` 填 zip 哈希；
3. 提 PR。

```bash
# 计算哈希
sha256sum my-pet.zip        # Windows: certutil -hashfile my-pet.zip SHA256
```

v0.1 的安装方式是解压到插件目录；安装器与哈希校验在 v0.2 落地（见 `docs/ROADMAP.md`）。

## 5. 素材版权

- 角色形象必须是你自己创作或获得授权；
- **禁止**上传他人 IP（游戏/动漫/商业品牌角色）素材；
- 建议 `license` 填 `CC0-1.0` 或 `CC-BY-4.0`，与代码的 MIT 分开。
