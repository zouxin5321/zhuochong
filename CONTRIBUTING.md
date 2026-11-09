# 贡献指南

## 提交角色插件

1. Fork 仓库，在 `plugins/<your-pet-id>/` 放 `manifest.json` + `spritesheet.png`；
2. 本地验证：`npm install && npm run tauri dev`，右键能切到你的角色；
3. 打 zip 传到 Release（或直接在 PR 里附 zip 链接），在 `plugins/index.json` 增加条目；
4. 提 PR，说明素材来源与授权。

素材必须是你自己创作或已获授权，禁止他人 IP（游戏/动漫/品牌角色）。

## 提交代码

- 一个 PR 只做一件事；
- 改宿主能力时同步更新 `docs/PLUGIN_SPEC.md`；
- 改插件字段必须向后兼容：新字段一律可选，缺省行为不变；
- 提交前跑 `npm run build`（前端类型检查 + 构建）与 `cargo check`（`src-tauri/`）。

## 插件规范变更

涉及 manifest 的破坏性变更需要：升 `manifest.version` + 在规范里写迁移说明 + 宿主保留旧字段兼容至少一个小版本。
