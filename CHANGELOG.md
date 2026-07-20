# Changelog

## Unreleased

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
