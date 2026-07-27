# ESIP：EvolutionSandbox Interop Protocol

ESIP 0.1 是 EvolutionSandbox 的实验性跨游戏语义层。它统一命令、事件、查询、结果、身份上下文和能力声明，但不绑定 HTTP、WebSocket、NATS 或其他传输。

## 五分钟运行

```bash
npm install
npm run check:protocol
npm run demo:interop
npm run demo:director
```

演示会在同一进程中启动一个网页控制端适配器、一个 Luanti 规则侧车适配器和内存路由器。控制端通过 ESIP 发送完整的原点行为序列，权威规则端验证并执行，最后返回三维领域状态。

需要验证真实 Luanti 进程时，使用仓库中的认证回环 HTTP sidecar、`evolution_bridge` 和控制端 CLI；完整步骤见 [`docs/interop.md`](../docs/interop.md)。该传输实现不会改变本页定义的 ESIP 外壳和 payload。

最小发送示例（保存到仓库根目录的 `.mjs` 文件）：

```js
import { EsipAdapter, MemoryRouter, TYPES } from "./src/interop/index.mjs"

const router = new MemoryRouter({
  authorize: (message) => message.kind === "event" || message.kind === "result"
    || (message.source === "esip://web/admin"
      && message.target === "esip://luanti/world-alpha")
})

const client = new EsipAdapter({
  id: "admin",
  source: "esip://web/admin",
  platform: "web",
  consumes: [TYPES.ACTION_APPLIED, TYPES.ERROR],
  produces: [TYPES.ACTION_REQUESTED],
  handle: async (message) => console.log(message.type, message.data),
})

await client.connect(router)
await client.emit(TYPES.ACTION_REQUESTED, "command", {
  context: {
    universeId: "universe-1",
    timelineId: "origin",
    realmId: "origin_0d",
    actorId: "actor-42"
  },
  actionId: "observe",
  parameters: {},
  expectedRevision: 0
}, {
  target: "esip://luanti/world-alpha",
  subject: "actor/actor-42"
})
```

## 目录

- [`ESIP-0001.md`](ESIP-0001.md)：规范、权威边界、可靠性和安全要求。
- [`schemas/`](schemas/)：CloudEvents 兼容外壳与各消息 `data` 的 JSON Schema。
- [`examples/`](examples/)：可以复制和验证的完整消息。
- [`asyncapi.json`](asyncapi.json)：AsyncAPI 3.0 频道与消息说明。
- [`src/interop/`](../src/interop/)：零传输依赖的参考 SDK、路由器和规则适配器。
- [`mods/evolution_bridge/`](../mods/evolution_bridge/)：真实 Luanti 进程的受控 ESIP HTTP 适配器。

在线 schema 地址为 `https://git-hpw.github.io/EvolutionSandbox/esip/schemas/<name>.schema.json`。

`world-observation-v1.schema.json` 是 `WorldObservation v0` 的独立只读快照 schema，目前尚未绑定新的 ESIP 消息频道。它先用于验证原点、恒星和文明能否共享应用层观察契约；接入网络查询前必须另行定义消息类型、授权和目标路由。运行时实现与边界见 [`docs/world-observation.md`](../docs/world-observation.md)。

`world-experiment-proposal-v1.schema.json` 是 `WorldExperimentProposal v0` 的独立提案 schema，并被四类文明实验评审/提交消息引用。当前只有文明领域的确定性编译器能够消费它，并且必须经过只读评审与显式提交才能创建权威分支；模型或网络接入不得把 schema 验证等同于执行授权。完整边界见 [`docs/world-experiment.md`](../docs/world-experiment.md)。

`open-virfactory-experiment-request-v1.schema.json` 与 `open-virfactory-pending-experiment-v1.schema.json` 描述当前回环模型适配器的输入和固定 `pending` 输出。它们本身不是 ESIP 消息，也不会自动转换成提交命令；正式文明 ESIP 消息拥有独立 channel、source/actor/universe 绑定、请求过期和提交幂等语义。当前仍没有跨源浏览器 CORS 或同源身份网关，网络接入还必须补充认证会话映射和速率限制。

## 接入原则

每个平台实现自己的适配器。适配器负责把原生游戏 API 转为 ESIP，并把经过授权的 ESIP 命令转回原生 API。不要让游戏进程直接信任公网消息，也不要把玩家数据库、密码、令牌或任意脚本放进消息。

ESIP 0.1 只承诺实验兼容性。至少有两个真实游戏平台完成断线、重复、乱序和权限测试后，才会讨论稳定的 1.0 版本。

## 多人时间线与身份

平台必须把本地账户显式映射为不透明 `actorId`，不能把 Luanti 玩家名、邮箱或平台登录名直接放入 ESIP。映射归平台身份边界所有；不同平台的 actor ID 即使文本相同，也不能自动视为同一账户。

世界时间线使用独立于玩家状态的 registry revision：

- `timeline.create.requested.v1` 同时携带 `expectedStateRevision` 与 `expectedRegistryRevision`；成功后产生 `timeline.created.v2`。
- `timeline.join.requested.v1` 把 actor 切换到已登记时间线；成功后产生 `timeline.joined.v1`，不会复制地图或资产。
- `timeline.registry.requested.v1` 可用 `afterRevision` 请求增量，`timeline.registry.snapshot.v1` 返回目录、事件和 `truncated` 标记。
- `timeline.created.v1` 保留用于读取旧幂等记录；新实现不得用它表达世界注册表变更。

完整字段、并发和恢复语义见 [`ESIP-0001.md`](ESIP-0001.md)。

## 文明控制

确定性文明使用独立的创建、命令和快照闭环：

- `civilization.create.requested.v1` 提交完整 `CivilizationSpec`，`civilization.created.v1` 返回 revision 0 的暂停状态；
- `civilization.command.requested.v1` 支持推进、暂停、继续、单步、倍速、历史分支和时间线切换，所有命令必须携带 `expectedRevision`；
- `civilization.updated.v1` 返回精简状态和本次事件批次；
- `civilization.snapshot.requested.v1` / `civilization.snapshot.v1` 用于无副作用读取。
- `civilization.experiment.review.requested.v1` / `civilization.experiment.reviewed.v1` 只读复核 `WorldExperimentProposal` 并返回固定 Rule Patch，不能创建分支；
- `civilization.experiment.commit.requested.v1` / `civilization.experiment.committed.v1` 在写入点重新复核全部来源事实，成功后返回新分支快照。

两个实验请求都必须携带 `expiresat`。权威宿主通过显式 binding 把允许的 `source` 精确绑定到 `actorId` 和 `universeId`，并验证 `subject = actor/<actorId>`；评审不改变 revision，提交始终重新检查 expected revision、源时间线、tick、history hash 和目标时间线。同一已提交 `proposalId` 在重启后重投只返回 `duplicate: true`，不会重复写入。

精简快照只包含当前权威状态、时间线摘要和近期事件。周期 checkpoint、hash 链与完整事件档案属于文明权威宿主，不通过普通 ESIP 消息复制。参考实现和应用层示例见 [`docs/civilization-engine.md`](../docs/civilization-engine.md)。

## 受限导演意图

本地导演使用两类消息验证“一句话目标 → 结构化意图”的边界：

- `director.goal.requested.v1` 提交目标、权威观察和 `expectedDirectorRevision`；
- `director.decided.v1` 返回 `proposed` 或 `rejected`、可选意图以及策略、规则和请求 hash 审计字段。

导演结果不是游戏行为事实。`action_suggestion` 不能替代 `action.requested`，`scene_transition_request` 也不能直接切换网页；本地权威审批器会先生成默认待审票据，并在人工批准时重新校验 actor、领域 revision、里程碑和构建白名单。审批记录目前是进程内领域格式，尚未扩展为 ESIP 网络消息；批准后的场景许可也不会自行导航。当前参考实现是完全离线的确定性假导演，说明见 [`docs/director.md`](../docs/director.md)。

## 注册其他游戏的消息类型

核心注册表默认拒绝未知消息。其他游戏可以使用自己的反向域名命名空间，并同时向适配器和路由器注入验证定义：

```js
import { EsipAdapter, EsipError, MemoryRouter, MESSAGE_DEFINITIONS } from "./src/interop/index.mjs"

const type = "com.example.spacegame.player_spawned.v1"
const definitions = {
  ...MESSAGE_DEFINITIONS,
  [type]: {
    kind: "event",
    dataschema: "https://example.com/schemas/player-spawned-v1.json",
    validate(data) {
      if (typeof data.playerId !== "string") {
        throw new EsipError("invalid_message", "playerId is required")
      }
    }
  }
}

const router = new MemoryRouter({ definitions })
const adapter = new EsipAdapter({
  id: "spacegame-a",
  source: "esip://spacegame/world-a",
  platform: "custom",
  consumes: [],
  produces: [type],
  definitions
})
```

自定义类型必须以 `.v1` 等主版本结尾，提供独立 schema 和运行时验证器，并加入该平台的 AsyncAPI 文档。只修改 `produces` 白名单不能让未知 payload 通过验证。
