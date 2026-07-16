# 架构

EvolutionSandbox 把叙事、规则、引擎呈现和外部自动化分为四层：

```text
Evolution- 章节原典
        ↓ 来源映射
content/chapters/*.json
        ↓ 同一确定性状态机
命令行测试 ── 浏览器演示 ── Luanti evolution_core
                                  ↓ 可选白名单边界
                            openVirFactory / AI
```

内容包定义初始状态、数值边界、阶段、行为和迁移阈值。`src/rules-engine.mjs` 是浏览器与自动测试的参考实现；构建脚本把同一内容包确定性地生成 Lua 表，由 `evolution_core/state.lua` 执行。

Luanti 层只负责领域、节点、交互界面和玩家 metadata。它不负责改写章节源，也不访问外部模型。外部 AI 只能经过 openVirFactory 的认证结构化桥，并受命令类型、节点前缀、坐标、批量大小和 metadata 白名单限制。

首版状态归属于玩家，领域布局归属于世界。未来加入世界级时间线时，应使用新的 schema 版本和显式存档迁移，不能让内容包更新静默重写已有玩家状态。
