# EvolutionSandbox Babylon Client

这是 EvolutionSandbox 的高精度浏览器表现客户端。它只负责场景、动画、输入、UI 和音效，继续复用主仓库的内容包、浏览器 ESIP 权威适配器及本地存档。

当前垂直切片覆盖：零维原点、观察、撕裂、融合、大爆炸过场及首个三维领域的首次物质循环。进入三维领域后，依次创造物质、稳定时空并毁灭回收，即可完成领域锚定任务。物质库存和三个任务里程碑来自 ESIP 已确认状态，刷新后仍可继续。

现有 `web/` 轻量客户端继续作为低性能设备和 WebGL 失败时的降级入口。旧版浏览器存档会在本地显式迁移，为新增物质状态补零，不会重置已有 revision 或时间线。

在仓库根目录运行：

```bash
npm ci
npm run build:web
python -m http.server 4173 --directory dist/site
```

打开 `http://127.0.0.1:4173/babylon/`。浏览器存档与基础版共用；切换客户端不会自动绕过 ESIP 或重置状态。
