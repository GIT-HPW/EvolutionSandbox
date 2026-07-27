# Changelog

## Unreleased

- 增加文明实验 ESIP 评审/提交四类消息、严格运行时验证、JSON Schema、AsyncAPI 通道和完整消息样例。
- 实验 query/command 强制 `expiresat` 与显式 source → actor/universe 绑定；评审保持只读，提交时重新校验 revision 与因果来源。
- 已提交 proposal 的幂等依据保存在 controller causality 中，适配器或 sidecar runtime 重启后重投不会重复创建分支。
- 增加文明 sidecar runtime：原子 checkpoint 恢复、host/universe/spec 绑定、写前 pulse 租约和有界 `pulseId` 幂等记录。
- 增加按时间槽生成稳定 pulse ID 的调度器；租约中断可在过期后确定性重算，提交后确认丢失不会重复推进 tick。
- `createCivilizationAdapter` 可选择由该 runtime 持久化并在适配器重建后恢复权威；runtime 与旧 `controllerChanged` 回调不能同时拥有持久化权限。
- 增加 `CivilizationSpec` v1、三个原创文明预设和 schema/运行时双重内容校验。
- 增加可保存的 seeded PRNG、五指标确定性文明 tick、周期事件、时代里程碑与重放指纹；单次 1,000 tick 和 100+900 分批推进结果一致。
- 增加 `demo:civilization` CLI、文明内核说明、玩法可行性报告和长时间重放/边界测试，并纳入根 `verify`。
- 为首个三维领域增加权威物质库存，以及凝聚、稳定、回收三个持久里程碑；无物质时不再允许稳定或毁灭。
- Babylon 客户端增加大爆炸领域跃迁过场、领域锚定任务面板、状态驱动的物质实体与完成反馈，并为六项核心状态调整响应式布局。
- 浏览器存储升级为 schema 3；schema 2 存档显式补齐新增物质字段，保留 actor、revision、时间线、序列与幂等记录。
- 增加 `clients/web-babylon` 高精度浏览器客户端垂直切片，提供动漫化能量核心、时间环、碎片、三维领域、镜头、辉光、冲击波和程序化音效。
- Babylon 客户端复用现有内容包、浏览器 ESIP 权威适配器、control sequence 和 localStorage 存档；基础 WebGL 版继续作为轻量降级入口。
- 将 Babylon 客户端纳入根 npm workspace、Pages 静态构建、CSP/权威边界测试和 4 MiB 初始 JavaScript 包体预算。
- 增加 `SidecarStore` 抽象、内存测试实现和本地 journal/checkpoint 持久实现。
- sidecar 默认在 `runtime/sidecar/` 持久化命令、租约、尝试次数、去重、source sequence、结果和单调 cursor。
- checkpoint 与 journal 使用版本化 schema、连续 revision 和校验值；损坏、记录缺口或世界绑定冲突时失败关闭。
- 增加认证诊断接口和 `sidecar:client diagnostics`，以及入队、租约、结果三个中断点的重启恢复测试。
- 本地导演实验页把已批准的 `scene_transition_permit` 接入场景控制器：暂停权威运行、校验同 revision 检查点、写入一次性许可并安全返回阶段大厅。
- 本地实验页增加“全自动演化”自检：一键完成原点与首次物质循环，通过固定白名单导演流程进入星辰篇，并以 ×16 倍率继续验证恒星生命周期。
- 场景导航记录升级为 schema 2，显式迁移 schema 1，并为转场许可、自动接力、旧记录恢复和单次消费增加测试。
- 增加只读 `WorldObservation v0` 公共外壳、严格运行时验证器和独立 JSON Schema，并为原点、恒星、文明提供不改写权威状态的观察适配器。
- 增加只读世界观察注册表，统一列出、查询和比较三个领域，同时校验 universe、domain 与 provenance source 绑定。
- 增加默认不进入公开构建的 Babylon 文明观测台，以 `WorldObservation v0` 驱动五指标、确认事件、3D 文明网络和来源显示。
- 文明观测台支持暂停、倍速、单步、批量推进、时间线创建/切换与只读分支比较；所有修改先进入 `CivilizationController`，界面不直接读写文明 state 字段。
- 增加严格 `WorldExperimentProposal v0`、五类白名单文明规则偏移和可验证时间线因果记录；提案只读生成，必须再次确认且源 revision、tick 或 history hash 变化时失败关闭。
- 文明控制器记录升级为 schema 2，旧记录显式迁移为零偏移；实验分支按继承 policy 确定性重放，Babylon 观测台增加提案复核、确认和因果来源展示。
- 增加 openVirFactory pending 实验响应适配器和请求/响应 JSON Schema；模型提案必须重新匹配当前 universe、时间线、tick、history hash、revision、允许 intent 与 provider/model 审计。
- `CivilizationObservatory` 可生成不含写权限的 openVirFactory 请求，并只读复核返回提案；复核不会创建分支，仍须调用既有二次确认路径。

## 0.5.0 - 2026-07-20

- 增加自包含的动漫风 WebGL 3D 宇宙场景，随 ESIP 已确认状态、行为和时间线切换实时变化。
- 增加 WebGL 失败静态降级、响应式布局、减少动态效果适配和构建产物测试。
- 将行为控制压缩到 3D 场景右侧，并为阶段锁定、条件不足、执行中、成功和失败提供就地反馈。
- 将开场叙事和后续已确认事件镜像到 3D 场景消息板，保留最近 6 条并以序列动画滚动显示。

## 0.4.0 - 2026-07-20

- 增加世界级多人时间线注册表，以及创建、加入、完整快照和断线增量追赶消息。
- Luanti 使用持久化不透明 actor ID 映射玩家，不再把玩家名暴露为跨平台身份。
- 浏览器 ESIP 权威适配器升级为多 actor 存档，并持久化身份映射、注册表 revision、事件历史、双向序列和幂等响应。
- Luanti bridge 持久化命令内容指纹，重复命令可安全重放，复用 ID 提交不同内容会拒绝执行。
- 增加跨 actor 时间线创建/加入、revision 冲突、身份冒用、旧存档迁移和真实 Luanti 往返测试。

## 0.3.1 - 2026-07-20

- 统一处理 Windows 与 POSIX 可执行文件路径，修复 Linux CI 对 `luanti.exe` 路径的识别。

## 0.3.0 - 2026-07-20

- 增加真实的 Luanti `evolution_bridge` ↔ Node ESIP sidecar 本机 HTTP 闭环。
- 增加 Bearer 令牌、回环地址限制、消息大小/来源/目标白名单、命令过期、revision 和幂等保护。
- 增加命令租约重投、结果游标查询、控制端 CLI、运行时 opt-in 安装和端到端 HTTP 测试。
- 兼容官方 Windows 便携包中的 `luanti.exe`，启动时自动启用专用服务器模式。

## 0.2.0 - 2026-07-17

- 增加实验性 EvolutionSandbox Interop Protocol（ESIP）0.1。
- 增加 CloudEvents 兼容外壳、8 类消息、11 个 JSON Schema 和 AsyncAPI 说明。
- 增加能力协商、显式命令授权、定向路由、消息大小限制、幂等、ID 冲突、序列重放和 revision 检查。
- 增加零传输依赖的 Node 参考 SDK、内存路由器、Evolution 规则适配器和跨平台闭环演示。
- 增加协议 schema/示例自动验证与平台接入、安全和升级说明。

## 0.1.0 - 2026-07-16

- 增加从零维原点到首个三维领域的确定性可玩闭环。
- 增加浏览器演示、命令行演示和 Luanti `evolution_core` 模组。
- 增加玩家状态、时间线分支、独立/集成模式和安全的已有世界安装流程。
- 增加内容生成、规则测试、Lua 语法检查、公开树秘密扫描、CI、Pages 和发布工作流。
