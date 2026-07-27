# 架构

EvolutionSandbox 把叙事、规则、引擎呈现、跨游戏语义和外部自动化分层：

```text
Evolution- 章节原典
        ↓ 来源映射
content/chapters/*.json
        ↓ 同一确定性状态机
命令行测试 ── 浏览器游戏权威适配器 ── Luanti evolution_core
                ↕ MemoryRouter              ↕ evolution_bridge
     轻量 WebGL / Babylon 客户端  ESIP 0.1 ← 认证回环 HTTP sidecar
                                                ↓ Node Adapter / openVirFactory
                                                ↓ 可替换持久传输
                                           其他游戏适配器

content/civilizations/presets/*.json
        ↓ CivilizationSpec v1
src/civilization/ 确定性 tick 内核 ── 控制器 / hash 链快照 / 历史分支
        ↕ ESIP 文明权威适配器 ── CLI / 重放与冲突测试
Babylon 文明观测台 ← openVirFactory 文明导演（只提交受限意图）

content/stellar/presets/*.json
        ↓ StellarSpec v1
src/stellar/ 确定性恒星生命周期 ── StellarController / CLI / 创世重放验证
        ↓ 已确认快照
Babylon 场景大厅 / 受控场景状态机
        ├─ 公开原点篇
        └─ 实验星辰篇（默认不进入 Pages 构建）

玩家一句话目标 → 确定性假导演 → ESIP 导演决策 / 审计
                                     ├─ 叙事提示
                                     ├─ 行为建议（未执行）
                                     └─ 场景申请（未切换）

原点权威 ─┐
恒星权威 ─┼─→ WorldObservation v0 → 只读注册表 → 文明观测台
文明权威 ─┘          （无写入口）                    ↓
                                  WorldExperimentProposal v0（待确认）
                                                        ↓ 明确确认
                                CivilizationController → 因果分支
```

文明与恒星内核共享 `src/determinism/prng.mjs` 的 seeded PRNG 和非密码学重放指纹；领域状态、公式和验证器彼此独立。

内容包定义初始状态、数值边界、阶段、行为和迁移阈值。`src/rules-engine.mjs` 是浏览器与自动测试的参考实现；构建脚本把同一内容包确定性地生成 Lua 表，由 `evolution_core/state.lua` 执行。

`src/civilization/` 是独立于原点行为状态机的文明模拟内核。它从 `CivilizationSpec` 创建五指标文明状态，使用可保存的 seeded PRNG、整数运算和固定 tick 顺序生成事件、时代里程碑与重放指纹。`CivilizationController` 在其上增加 revision 控制、暂停/倍速/单步、周期快照、导入重放验证和历史分支；`src/interop/civilization-adapter.mjs` 是当前唯一的文明 ESIP 写入口。适配器对外只发送精简快照，完整快照链由权威宿主持久化。AI、定时器和渲染层都不能直接写文明指标。

`src/interop/civilization-runtime.mjs` 是可选的单写者 sidecar 宿主。它把 spec、universe 绑定与 controller record 写入带 SHA-256 校验和的原子 checkpoint；ESIP 普通命令和调度 pulse 都先在复制出的 controller 上计算，持久提交成功后才替换内存权威。pulse 使用稳定时间槽 ID、写前租约、base revision 与有界完成记录：租约过期后可以从未改变的记录重算，同一已完成 ID 重试不会再次推进。该存储与 Luanti 传输队列的 `SidecarStore` 分离，避免把文明领域状态塞进消息 broker。

`src/stellar/` 把 Evolution- 第1章第5篇映射为独立的 StellarSpec 与整数 tick 生命周期。规则从物质云自动经历原恒星、稳定燃烧、红巨星、爆发和行星盘；`StellarController` 拥有暂停、单步、倍速、revision 和本地记录，恢复时从 spec 与 seed 重放到保存 tick。Babylon 星辰页目前是默认关闭的实验源：普通构建按场景注册表白名单只生成大厅和公开原点篇，不读取、复制或打包星辰页面、样式、StellarSpec 与 bundle；只有显式 `build:web:experimental` 才把它与导演实验入口加入本地大厅。正式 stellar ESIP、持久 sidecar 调度和有差异来源的时间线分支将在后续切片增加。

Babylon 宏观场景采用独立页面隔离，但所有入口共享 `scene-flow.mjs` 导航记录。用户必须先从大厅选择构建允许的场景；进入后只有当前场景可运行，选项菜单先暂停本地调度，再以“checkpointing”状态写入场景自己的权威 revision、tick、phase 和可用 hash，成功后才允许返回大厅。导演批准的转场同样必须经过暂停和检查点，并要求检查点 revision 与审批计划一致；场景流随后保存一次性目标许可，schema 1 旧记录显式迁移到 schema 2。大厅只会高亮人工许可的目标，或为用户主动启动的全自动自检自动消费许可。浏览器返回、直接地址和异常卸载不能授权另一个场景；大厅加载时会把遗留运行记录显式恢复为阶段选择。这个导航检查点与自动运行记录只保存交接元数据，不复制或替代 ESIP、StellarController 等领域权威存档。

本地导演纵切由 `src/director/` 的确定性目标映射、可恢复审批闸门和 `src/interop/director-adapter.mjs` 组成。适配器只接受显式 source 白名单中的 `director.goal.requested.v1`，使用独立导演 revision，把结果保存为带策略 ID、规则 ID 和请求 hash 的 `director.decided.v1`。导演不能导入规则引擎、文明控制器或 Babylon 导航代码；提案必须先登记为默认 `pending` 的审批票据。只有绑定 actor 明确批准，并且审批闸门重新确认 scene、phase、游戏 revision、行为白名单或转场里程碑后，才会生成受限权威计划。闸门在调用执行器前持久化 `executing`，恢复到不确定状态时禁止自动重试。`director-app.mjs` 只由 experimental profile 打包；它把批准行为交回原点运行时，再通过原有 ESIP 浏览器权威确认，或在最终审计落盘后把场景许可交给场景流。全自动按钮只预授权固定的本地自检序列，通过 `auto-evolution.mjs` 记录跨页面接力状态；它不能自动批准普通导演目标。公开 profile 不复制导演 HTML、CSS 或入口。当前导演路径没有外部模型调用；openVirFactory 的文明实验模型路径是下文所述的独立待确认适配器，不会自动获得导演审批权限。

`src/world-observation/` 在三个领域权威之上提供只读公共外壳。原点适配器读取 state 与 revision，恒星适配器验证完整 controller record 和确定性重放，文明适配器验证 checkpoint 链、事件与分支来源；三者只投影 identity、tick、timeScale、phase、有限摘要、近期事件、能力和 provenance，不复制完整存档。注册表把 provider 绑定到预期 universe、domain 和 source，并在每次读取时重新严格验证。`capabilities` 只是能力描述，不替代 ESIP 授权；观察层没有 `apply`、`control` 或存档写入接口。Babylon 文明观测台是首个消费者：应用页面只读 observation，独立 `CivilizationObservatory` 才能把用户控制交回原文明控制器。完整契约见 [WorldObservation v0](world-observation.md)。

`src/world-experiment/` 把文明战略差异编译为五类固定 Rule Patch。提案绑定 universe、源时间线、tick、history hash、controller revision、请求者和目标时间线；生成提案不写状态，明确确认后 `CivilizationController` 才创建暂停分支。controller record schema 2 在时间线保存继承 policy 与直接 causality，恢复时同时验证父分支重放、提案 hash、patch 编译结果和 revision。自由文本不进入规则计算，`requestedBy.type=model` 也不代表执行授权。完整边界见 [WorldExperimentProposal v0](world-experiment.md)。

openVirFactory 的模型适配使用独立 `propose_world_experiment` 强制工具和 Bearer 认证回环路由。模型只接收目标与允许 intent，不接收设置权威上下文的工具字段；Node 适配器把候选与调用方提供的来源绑定后固定标记为 `pending`。EvolutionSandbox 的 openVirFactory 适配器必须持有原始请求，重新计算 `requestHash`，并验证 proposal hash、当前来源、目标时间线、允许 intent 和 provider/model 审计。该回环路径不调用 Luanti `sendCommand`，不自动调用 `commitExperiment`，也不是文明 ESIP channel 的网络入口。正式 ESIP 评审/提交由文明权威适配器独立处理；请求 source 必须显式绑定 actor 与 universe，且只有携带过期时间的 commit 命令在写入点重校验后才能创建分支。

浏览器平台与 Luanti 平台分别拥有自己的状态权威。轻量 WebGL 客户端与 Babylon 原点页共用浏览器游戏权威适配器；适配器把多 actor 状态、物质库存与里程碑、身份映射、世界时间线注册表、revision、事件历史、序列和最近命令响应保存在 localStorage。Babylon 星辰页使用隔离的 StellarController 记录。所有 Babylon 过场、任务面板、物质实体和恒星效果都从已确认快照派生，不保存第二套指标进度。Luanti 层把玩家状态和匿名 actor ID 保存在 metadata，把身份映射及时间线注册表保存在 world mod storage，并负责领域、节点和交互界面。各表现客户端都不改写章节源，也不访问外部模型。外部 AI 只能经过 openVirFactory 的认证结构化桥，并受命令类型、节点前缀、坐标、批量大小和 metadata 白名单限制。

ESIP 位于引擎与传输之间。`src/interop/` 提供消息验证、能力适配器、内存参考路由器和本机 HTTP sidecar；正式 sidecar 默认使用带 schema、连续 revision 和校验值的本地 journal/checkpoint 存储，重启后恢复命令、租约、sequence、去重记录、结果和 cursor。文明扩展增加创建、控制、更新、快照及实验评审/提交十类消息，并沿用 `expectedRevision` 冲突保护；实验提交还从 controller causality 恢复跨重启幂等。导演扩展增加目标请求和审计决策两类消息，使用独立 `expectedDirectorRevision`。`evolution_bridge` 只把经过双重验证的状态查询与固定行为映射到 `evolution_core.api`。`protocol/` 提供独立 schema 和 AsyncAPI。ESIP 不拥有游戏状态，每一份可变状态仍由一个明确平台负责最终写入。

演化数值归属于 actor，时间线目录和领域布局归属于世界。创建时间线同时检查玩家状态 revision 与世界注册表 revision，加入时间线检查两者；权威端负责协调对应存储，Luanti 若在写入间意外中断，会在玩家下次进入时把有效的旧玩家时间线补登记到世界注册表。浏览器旧存档会显式迁移到 schema 3，Luanti 旧玩家时间线也使用同一补登记路径。后续改变既有语义时仍必须发布新 schema 版本和显式迁移。
