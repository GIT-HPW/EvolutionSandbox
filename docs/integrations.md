# 集成边界

## Luanti 与 Mineclonia

`evolution_core` 不声明硬依赖，可作为 world mod 装入不同 Luanti 游戏。Mineclonia 是默认推荐底座，但领域节点不调用其专用 API。若某个游戏改变出生或传送行为，应在独立适配模组中处理，不把兼容代码塞入核心状态机。

## openVirFactory

openVirFactory 是可选的 AI/自动化控制层，不是启动 EvolutionSandbox 的前置条件。组合时：

1. 将 `factory_core`、`factory_ai` 和 `evolution_core` 放到同一世界的 `worldmods/`。
2. 在服务端配置 `secure.http_mods = factory_ai,evolution_bridge`（未启用 ESIP 时不需要后者）。
3. 使用至少 32 字节的随机桥接令牌。
4. 将节点白名单设为 `factory_core:,evolution_core:`。
5. 保持 `secure.enable_security = true`，不要恢复任意 Lua 执行接口。

这只授权 AI 操作允许的节点。玩家演化行为仍通过 `/evo` 或 `evolution_core.api.apply_action` 的受控调用执行。仓库内置 sidecar 已验证 schema、来源、目标和权限，再由 `evolution_bridge` 映射到逐项允许的结构化命令。

当前确定性导演仍未连接外部模型。另一个更窄的纵切已经把 openVirFactory Node Agent 接到文明实验提案：Bearer 认证的 `POST /v1/world-experiments/propose` 使用独立强制工具调用，只允许模型选择白名单 intent、1–3 级强度和解释文字，并固定返回 `status=pending`。universe、源时间线、tick、history hash、revision、允许 intent 和目标时间线由调用方绑定；响应不进入 Luanti 命令队列，也不调用文明控制器。

EvolutionSandbox 的 `CivilizationObservatory.experimentRequest` 生成请求，`reviewExternalExperiment` 使用原请求 `requestHash` 重新验证 proposal hash、当前权威来源和 provider/model 审计。复核仍是只读操作，玩家必须继续通过明确提交二次确认。文明 controller 现在可以由独立 sidecar runtime 恢复并用租约安全调度，但该 runtime 不会自动提交 pending 实验。

文明适配器已经提供正式的 ESIP review/commit 消息，并强制请求过期时间、source → actor/universe 显式绑定、提交点重校验和跨 runtime 重启幂等。openVirFactory 的回环端点本身仍不是 ESIP 频道，也不开放浏览器 CORS；真实网页接入需要同源网关把已认证会话映射到上述 ESIP 身份绑定，不能由浏览器自报 actor。导演模型若后续接入，仍必须分别转换为 `narrative_cue`、`action_suggestion` 或 `scene_transition_request` 并经过原审批器，不能借用实验端点扩大权限。边界见 [导演最小闭环](director.md) 与 [WorldExperimentProposal v0](world-experiment.md)。

## 已有世界与玩家数据

运行时准备脚本只管理 `world.mt`、本模组目录和单独的运行配置。SQLite 世界、认证与玩家数据属于部署数据，始终保持在 Git 忽略范围内。外部世界默认进入 `integrated` 模式，不自动传送玩家。

## 浏览器沙盒

浏览器页面是独立游戏状态权威端，不是 Luanti 玩家数据库的网页镜像。它通过 ESIP 处理行为、状态查询、世界时间线创建/加入及注册表增量追赶，并把非敏感游戏状态和显式 source → actor 映射保存到 localStorage。浏览器不会直接调用 Luanti sidecar；不同平台的 actor ID 也不能仅凭字符串相同就自动合并。若未来需要浏览器与 Luanti 跨进程通信，应由同源后端或专用网关完成认证和明确的身份绑定，不能为方便而给当前回环 sidecar 增加宽松 CORS。

## G2Reality 与 SportX

G2Reality 可在未来提供坐标映射、现实地图生成和物理设备边界；SportX 可提供时间轴、事件日历和网页信息架构参考。两者都应通过 [ESIP 适配器](interop.md) 连接，避免成为 `evolution_core` 的硬依赖。
