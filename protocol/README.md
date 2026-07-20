# ESIP：EvolutionSandbox Interop Protocol

ESIP 0.1 是 EvolutionSandbox 的实验性跨游戏语义层。它统一命令、事件、查询、结果、身份上下文和能力声明，但不绑定 HTTP、WebSocket、NATS 或其他传输。

## 五分钟运行

```bash
npm install
npm run check:protocol
npm run demo:interop
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
