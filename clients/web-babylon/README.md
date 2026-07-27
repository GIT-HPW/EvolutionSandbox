# EvolutionSandbox Babylon Client

这是 EvolutionSandbox 的高精度浏览器表现客户端。它只负责场景、动画、输入、UI 和音效，规则状态由主仓库的权威适配器或确定性领域控制器拥有。

默认入口现在是独立的演化纪元大厅。用户先选择已开放阶段，再进入隔离的场景页面；场景内没有任意跳转链接，只能通过“选项”暂停、保存检查点并安全返回大厅。共享导航状态机固定执行“阶段选择 → 加载 → 游玩 → 暂停 → 检查点 → 转场”，刷新当前场景可以恢复，但直接打开未获大厅授权的场景地址会返回阶段选择。

当前公开垂直切片覆盖：零维原点、观察、撕裂、融合、大爆炸过场及首个三维领域的首次物质循环。进入三维领域后，依次创造物质、稳定时空并毁灭回收，即可完成领域锚定任务。物质库存和三个任务里程碑来自 ESIP 已确认状态，刷新后仍可继续。

星辰篇是默认关闭的实验纵切，不进入 GitHub Pages 或普通 `npm run build:web` 产物。实验源码从 `StellarSpec` 和 seed 自主推进物质云、原恒星、稳定燃烧、衰老、爆发与行星盘，提供暂停、单步、推进 10 tick 和 ×1/×4/×16 时间倍率。页面不修改质量、温度或光度字段，只调用 `StellarController` 并渲染其快照；本地记录恢复前会从创世 tick 重新运行验证。恒星正式 ESIP 与 sidecar 调度属于下一阶段。

文明观测台同样只进入实验构建。应用页面只读取 `WorldObservation v0`，通过 Babylon 3D 网络、五指标、确认事件和 provenance 展示文明状态；暂停、倍速、单步、推进、创建/切换分支仍由 `CivilizationController` 权威执行。有限实验必须先生成绑定 revision、tick 与 history hash 的 `WorldExperimentProposal v0`，页面复核固定 Rule Patch 后再次确认才会建立分支。`CivilizationObservatory` 还提供 openVirFactory 请求生成与 pending 响应复核边界，复核必须携带原请求以校验 `requestHash`，但静态浏览器页面不会跨源直连 Agent 或持有 Bridge Token。对照面板可以读取任意已验证时间线，但比较本身不会切换或改写当前权威记录。

现有 `web/` 轻量客户端继续作为低性能设备和 WebGL 失败时的降级入口。旧版浏览器存档会在本地显式迁移，为新增物质状态补零，不会重置已有 revision 或时间线。

## 最速启动

首次克隆后在仓库根目录运行一次：

```bash
npm ci
```

日常预览当前开发版，包括本地恒星实验场景和文明观测台：

```bash
npm run build:web:experimental
python -m http.server 4173 --directory dist/site
```

打开：

- `http://127.0.0.1:4173/babylon/`：本地演化纪元大厅；实验 profile 会提供带 AI 导演面板的原点篇、星辰篇和文明观测台。

只生成与 GitHub Pages 一致的公开大厅时，使用：

```bash
npm run build:web
python -m http.server 4173 --directory dist/site
```

首次安装完成后，每次启动只需要“构建 + 静态服务器”两条命令。原点篇浏览器存档与基础版共用；实验星辰篇和文明观测台分别使用独立的可验证控制器记录，互不覆盖。文明 schema 1 旧记录会迁移为无规则偏移、无虚构因果的 schema 2。构建脚本使用白名单生成页面、内容和 bundle；不要把实验开关加入 Pages workflow。
