# EvolutionSandbox Babylon Client

这是 EvolutionSandbox 的高精度浏览器表现客户端。它只负责场景、动画、输入、UI 和音效，继续复用主仓库的内容包、浏览器 ESIP 权威适配器及本地存档。

当前垂直切片覆盖：零维原点、观察、撕裂、融合、大爆炸及首个三维领域。现有 `web/` 轻量客户端继续作为低性能设备和 WebGL 失败时的降级入口。

在仓库根目录运行：

```bash
npm ci
npm run build:web
python -m http.server 4173 --directory dist/site
```

打开 `http://127.0.0.1:4173/babylon/`。浏览器存档与基础版共用；切换客户端不会自动绕过 ESIP 或重置状态。
