# 集成边界

## Luanti 与 Mineclonia

`evolution_core` 不声明硬依赖，可作为 world mod 装入不同 Luanti 游戏。Mineclonia 是默认推荐底座，但领域节点不调用其专用 API。若某个游戏改变出生或传送行为，应在独立适配模组中处理，不把兼容代码塞入核心状态机。

## openVirFactory

openVirFactory 是可选的 AI/自动化控制层，不是启动 EvolutionSandbox 的前置条件。组合时：

1. 将 `factory_core`、`factory_ai` 和 `evolution_core` 放到同一世界的 `worldmods/`。
2. 在服务端配置 `secure.http_mods = factory_ai`。
3. 使用至少 32 字节的随机桥接令牌。
4. 将节点白名单设为 `factory_core:,evolution_core:`。
5. 保持 `secure.enable_security = true`，不要恢复任意 Lua 执行接口。

这只授权 AI 操作允许的节点。玩家演化行为仍通过 `/evo` 或 `evolution_core.api.apply_action` 的受控调用执行；未来若开放 AI 触发行为，应新增逐项验证的结构化命令，而不是 `run_lua`。

## 已有世界与玩家数据

运行时准备脚本只管理 `world.mt`、本模组目录和单独的运行配置。SQLite 世界、认证与玩家数据属于部署数据，始终保持在 Git 忽略范围内。外部世界默认进入 `integrated` 模式，不自动传送玩家。

## G2Reality 与 SportX

G2Reality 可在未来提供坐标映射、现实地图生成和物理设备边界；SportX 可提供时间轴、事件日历和网页信息架构参考。两者都应通过稳定事件或适配器连接，避免成为 `evolution_core` 的硬依赖。
