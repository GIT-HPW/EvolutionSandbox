# EvolutionSandbox Babylon Client

这是 EvolutionSandbox 的高精度浏览器表现客户端。它只负责场景、动画、输入、UI 和音效，规则状态由主仓库的权威适配器或确定性领域控制器拥有。

当前垂直切片覆盖：零维原点、观察、撕裂、融合、大爆炸过场及首个三维领域的首次物质循环。进入三维领域后，依次创造物质、稳定时空并毁灭回收，即可完成领域锚定任务。物质库存和三个任务里程碑来自 ESIP 已确认状态，刷新后仍可继续。

星辰篇是默认关闭的实验纵切，不进入 GitHub Pages 或普通 `npm run build:web` 产物。实验源码从 `StellarSpec` 和 seed 自主推进物质云、原恒星、稳定燃烧、衰老、爆发与行星盘，提供暂停、单步、推进 10 tick 和 ×1/×4/×16 时间倍率。页面不修改质量、温度或光度字段，只调用 `StellarController` 并渲染其快照；本地记录恢复前会从创世 tick 重新运行验证。恒星正式 ESIP 与 sidecar 调度属于下一阶段。

现有 `web/` 轻量客户端继续作为低性能设备和 WebGL 失败时的降级入口。旧版浏览器存档会在本地显式迁移，为新增物质状态补零，不会重置已有 revision 或时间线。

在仓库根目录运行：

```bash
npm ci
npm run build:web
python -m http.server 4173 --directory dist/site
```

打开：

- `http://127.0.0.1:4173/babylon/`：公开的原点与首个三维领域。

需要仅在本地审阅尚未公开的星辰纵切时，显式执行：

```bash
npm run build:web:stellar:experimental
python -m http.server 4173 --directory dist/site
```

再打开 `http://127.0.0.1:4173/babylon/stellar.html`。原点篇浏览器存档与基础版共用；实验星辰篇使用独立的可验证控制器记录，两者不会互相覆盖。不要把实验开关加入 Pages workflow。
