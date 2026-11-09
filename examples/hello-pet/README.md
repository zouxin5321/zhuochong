# 插件模板：hello-pet

最小可运行的插件骨架。复制本目录改名即可：

```bash
cp -r examples/hello-pet plugins/my-pet
```

1. 编辑 `manifest.json`：至少改 `id`（全局唯一）、`name`；
2. 把 `spritesheet.png` 换成自己的帧表（可先直接复制内置角色的图，用来验证流程）；
3. 放到插件目录后右键角色切换，或重启宿主。

```bash
# Windows
copy plugins\builtin-default\spritesheet.png examples\hello-pet\spritesheet.png

# macOS / Linux
cp plugins/builtin-default/spritesheet.png examples/hello-pet/spritesheet.png
```

字段含义见 [../../docs/PLUGIN_SPEC.md](../../docs/PLUGIN_SPEC.md)。
