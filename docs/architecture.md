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
src/civilization/ 确定性 tick 内核 ── CLI / 重放测试
        ↓ 后续接入快照、时间线与 ESIP 文明权威适配器
Babylon 文明观测台 ← openVirFactory 文明导演（只提交受限意图）
```

内容包定义初始状态、数值边界、阶段、行为和迁移阈值。`src/rules-engine.mjs` 是浏览器与自动测试的参考实现；构建脚本把同一内容包确定性地生成 Lua 表，由 `evolution_core/state.lua` 执行。

`src/civilization/` 是独立于原点行为状态机的文明模拟内核。它从 `CivilizationSpec` 创建五指标文明状态，使用可保存的 seeded PRNG、整数运算和固定 tick 顺序生成事件、时代里程碑与重放指纹。当前切片只通过 CLI 和测试运行，尚未成为 ESIP、浏览器或 Luanti 的状态权威；后续适配器必须在不让 AI 或渲染层写入指标的前提下接入。

浏览器平台与 Luanti 平台分别拥有自己的状态权威。轻量 WebGL 客户端和 `clients/web-babylon` 高精度客户端只负责表现与输入，共用同一个浏览器游戏权威适配器；适配器把多 actor 状态、物质库存与里程碑、身份映射、世界时间线注册表、revision、事件历史、序列和最近命令响应保存在 localStorage。Babylon 的过场、任务面板和物质实体都从已确认快照派生，不保存第二套进度。Luanti 层把玩家状态和匿名 actor ID 保存在 metadata，把身份映射及时间线注册表保存在 world mod storage，并负责领域、节点和交互界面。各表现客户端都不改写章节源，也不访问外部模型。外部 AI 只能经过 openVirFactory 的认证结构化桥，并受命令类型、节点前缀、坐标、批量大小和 metadata 白名单限制。

ESIP 位于引擎与传输之间。`src/interop/` 提供消息验证、能力适配器、内存参考路由器和本机 HTTP sidecar；正式 sidecar 默认使用带 schema、连续 revision 和校验值的本地 journal/checkpoint 存储，重启后恢复命令、租约、sequence、去重记录、结果和 cursor。`evolution_bridge` 只把经过双重验证的状态查询与固定行为映射到 `evolution_core.api`。`protocol/` 提供独立 schema 和 AsyncAPI。ESIP 不拥有游戏状态，每一份可变状态仍由一个明确平台负责最终写入。

演化数值归属于 actor，时间线目录和领域布局归属于世界。创建时间线同时检查玩家状态 revision 与世界注册表 revision，加入时间线检查两者；权威端负责协调对应存储，Luanti 若在写入间意外中断，会在玩家下次进入时把有效的旧玩家时间线补登记到世界注册表。浏览器旧存档会显式迁移到 schema 3，Luanti 旧玩家时间线也使用同一补登记路径。后续改变既有语义时仍必须发布新 schema 版本和显式迁移。
