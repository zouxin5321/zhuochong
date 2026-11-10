# 发布清单（Release Checklist）

每次发版照着走一遍。目标：用户从看到宣传 → 下载 → 跑起来，全程不超过 2 分钟。

## 1. 发布前自检

- [ ] `npm run verify:web` 通过（9/9）
- [ ] `npm run verify:app` 通过（23/23，宿主带 9222 调试端口）
- [ ] `npm run verify:real` 通过（6/6，系统级真实鼠标注入）
- [ ] 手玩一遍核心链路：单击 / 双击大招 / 三连双击升满级 / 拖拽 / 睡眠唤醒
- [ ] `manifest.json` 版本号已提升（semver：修 bug +0.0.x，加动作/功能 +0.x.0）
- [ ] 清空 `app/` 后重新从 `src-tauri/target/release/` 同步（避免残留旧插件）

## 2. 打包产物

构建（E 盘工具链环境变量见维护日志）：

```bash
npm run tauri -- build
```

同步绿色版目录并打包 zip：

```bash
cp -f src-tauri/target/release/zhuochong.exe app/
rm -rf app/plugins && cp -r src-tauri/target/release/plugins app/plugins
cd app && zip -r ../zhuochong-v<版本>-win64.zip . && cd ..
```

产物要求：

- [ ] `zhuochong-v<版本>-win64.zip`（绿色版，解压即用）
- [ ] zip 内含 `zhuochong.exe` + `plugins/`（确认插件版本与主程序一致）
- [ ] 解压到全新目录试运行一次（防止依赖开发机残留配置）

## 3. Release 页面

- [ ] Tag：`v<版本>`，标题：`v<版本> · <一句话亮点>`
- [ ] 上传 zip 产物
- [ ] Release Notes 三段式：
  - **新东西**：用户视角写（"双击放大招"而不是"新增 ultimate action"）
  - **修了什么**：只写用户能感知的
  - **升级说明**：覆盖安装即可 / 需要删除旧配置等

## 4. 宣传素材（随版本更新）

- [ ] `npm run promo` 重录 `docs/demo.gif`（README 顶图，超过 5MB 就降帧或缩到 256px）
- [ ] README 的下载徽章链接指向新版本号（或用 latest 链接）
- [ ] 录一条 15~30 秒竖屏短视频（B站/抖音/小红书）：封面用 Lv3 十字剑气爆发帧
- [ ] 截 2~3 张静帧图备用（发帖用）：待机特写、Lv2 剑气、满级十字爆发

## 5. 分发渠道

| 渠道 | 动作 |
|---|---|
| GitHub Releases | 主发布，tag + notes + zip |
| B站 / 抖音 / 小红书 | 30 秒演示视频，简介放 GitHub 链接 |
| V2EX / 酷安 | 发帖「分享一个自制的桌面宠物」，附 GIF |
| Reddit | r/rust（技术角度）、桌面美化社区 |
| Awesome 清单 | 找 desktop-pet / shimeji 相关列表提 PR 收录 |

## 6. 已知短板（发版前如实告知用户）

- [ ] 无代码签名：SmartScreen 会拦，README 与 Release Notes 都要写放行方法
- [ ] 绿色版卸载 = 删目录（配置存于用户目录，README 说明位置）
- [ ] 仅支持 Windows（Tauri 理论可跨平台，未验证 macOS/Linux）

## 7. 发布后

- [ ] 在新环境（或虚拟机）从头下载一遍，验证链接与解压可用
- [ ] Issues 打开，置顶一个「反馈模板」（系统版本 / 复现步骤 / 表现）
- [ ] 把 Star 数 / 下载量记到维护日志，作为迭代优先级参考
