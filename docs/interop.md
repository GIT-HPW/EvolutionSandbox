# 跨游戏通信接入指南

ESIP 的首要目标是隔离游戏平台差异。每个游戏保留自己的原生 API 和状态权威，平台适配器之间只交换经过验证的 ESIP 业务消息。

```text
本地控制端 ──Bearer/ESIP──> Node sidecar ──租约轮询──> Luanti evolution_bridge
     ↑                              │                         │
     └──────── 已确认结果/游标查询 ──┴── ESIP 事件/结果 <──────┘
                                                        evolution_core
                                                        玩家 metadata（权威）
```

## 两种可运行闭环

不安装 Luanti 时，可以先验证协议语义：

```bash
npm install
npm run demo:interop
```

这个演示不开放网络端口，在同一 Node 进程中验证 schema、权限、目标、revision、幂等和序列。

GitHub Pages 上的浏览器游戏是第二个实际平台实现：UI 控制适配器只发 ESIP command/query，游戏权威适配器验证并持久化已确认状态。它使用同页 MemoryRouter，不连接 Luanti 的认证 sidecar。完整说明见 [浏览器 ESIP 平台](browser-platform.md)。

真实闭环由以下组件组成：

- `src/interop/http-sidecar.mjs`：只监听回环地址的认证 HTTP sidecar；
- `src/interop/sidecar-store.mjs`：内存测试存储和带校验的 journal/checkpoint 持久存储；
- `mods/evolution_bridge`：Luanti 原生 HTTP 适配模组；
- `evolution_core`：最终读取和写入玩家演化状态；
- `cli/sidecar-client.mjs`：用于状态查询和单步行为测试的本地控制端。

## Windows / PowerShell 快速上手

需要 Node.js 20+、带 cURL 支持的 Luanti 服务器，以及一个 Luanti 游戏（推荐 Mineclonia）。在仓库目录生成一次性本地令牌：

```powershell
$env:EVOLUTION_ESIP_TOKEN = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
npm install
npm run runtime:prepare
```

`runtime:prepare` 只有检测到至少 32 字符的令牌时，才会安装并启用 `evolution_bridge`。令牌写入被 Git 忽略的 `runtime/minetest.conf`，不会写入源码或 GitHub。

保持同一个 PowerShell 窗口并启动 sidecar：

```powershell
npm run sidecar
```

sidecar 默认把命令、租约、去重指纹、source sequence、结果和 cursor 持久化到被 Git 忽略的 `runtime/sidecar/`。正常停止和意外重启都从同一目录恢复；测试或临时演示可以显式设置 `$env:ESIP_SIDECAR_STORE = "memory"` 使用纯内存模式。

在第二个终端启动 Luanti：

```powershell
npm run dev
```

进入服务器并保持玩家在线，在聊天栏输入 `/evo identity`，复制返回的不透明 actor ID。在第三个终端复用刚才的同一令牌：

```powershell
$env:EVOLUTION_ESIP_TOKEN = "<第一个终端中的同一令牌>"
npm run sidecar:client -- state <actor-id>
npm run sidecar:client -- action <actor-id> observe
npm run sidecar:client -- timelines <actor-id>
npm run sidecar:client -- create-timeline <actor-id> experiment-a
npm run sidecar:client -- join-timeline <actor-id> origin
npm run sidecar:client -- diagnostics
```

`action` 命令会先查询最新状态和 revision。创建时间线会同时查询玩家状态 revision 与世界 registry revision；加入操作也会先获取最新上下文。Luanti 执行后只返回已确认结果。`timelines <actor-id> <after-revision>` 可请求某个 registry revision 之后的增量事件。不要把令牌或本地 actor 映射粘贴到 Issue、日志或 shell 历史共享文件中。

如果 Luanti 不在系统路径中，官方 Windows 便携包可直接指定其中的 `bin\luanti.exe`：

```powershell
$env:LUANTI_SERVER_BIN = "C:\path\to\luanti-5.x.x-win64\bin\luanti.exe"
npm run dev
```

启动脚本会为 `luanti.exe` 自动加入 `--server`；如果使用单独构建的 `luantiserver.exe`，则不会重复添加该参数。

## Linux / macOS 快速上手

```bash
export EVOLUTION_ESIP_TOKEN="$(openssl rand -hex 32)"
npm install
npm run runtime:prepare
npm run sidecar
```

另开终端运行 `npm run dev`，玩家进入后输入 `/evo identity`，再在带同一令牌的终端运行：

```bash
npm run sidecar:client -- state ACTOR_ID
npm run sidecar:client -- action ACTOR_ID observe
npm run sidecar:client -- timelines ACTOR_ID
```

## 实际消息流程

1. `evolution_bridge` 启动后发布 `capability.hello`。
2. 控制端向 `POST /v1/commands` 提交带 `expiresat` 的状态、行为或时间线 command/query。
3. sidecar 验证 Bearer 令牌、schema、来源、目标、消息大小、序列和过期时间，然后先写入有界持久队列再确认接收。
4. Luanti 从 `GET /v1/commands` 领取短租约消息；租约到期但未确认的消息可以重投。
5. bridge 通过只存在本地的持久身份表将不透明 `actorId` 映射为在线玩家，并检查 universe、realm、timeline 和 revision。
6. `evolution_core` 执行固定行为，或在 world mod storage 中创建/查询时间线；玩家状态与世界注册表使用独立 revision。
7. bridge 向 `POST /v1/messages` 返回已确认状态、行为、领域事件、时间线结果/快照或 `error`。
8. sidecar 持久化结果并完成对应命令；控制端通过 `GET /v1/results?after=<cursor>` 获取结果。

bridge 会在 Luanti mod storage 中保留最近 256 个命令的内容指纹和响应描述。sidecar 同时持久化传输层去重与结果；网络重试不会重复执行动作，重启后可以继续未完成租约或返回已经确认的结果。同一 `source + id` 的内容发生变化会返回 `id_conflict`。

## HTTP 绑定

| 接口 | 调用方 | 用途 |
| --- | --- | --- |
| `GET /health` | 本机监控 | 最小健康状态，不返回令牌或玩家数据 |
| `POST /v1/commands` | 受信控制端 | 提交一个 ESIP command/query |
| `GET /v1/commands` | Luanti bridge | 领取 1–8 个带租约的目标消息 |
| `POST /v1/messages` | Luanti bridge | 发布能力、事件和结果 |
| `GET /v1/results` | 受信控制端 | 按单调 cursor 读取已确认消息 |
| `GET /v1/diagnostics` | 本机运维工具 | 查看存储 revision、积压、租约、尝试次数和 cursor，不返回令牌 |

除 `/health` 外所有接口都要求 `Authorization: Bearer <token>`。令牌必须由 32–256 个 URL-safe ASCII 字符组成。sidecar 强制绑定 `127.0.0.1` 或 `::1`，不提供 CORS，也不接受公网/LAN 监听配置。

## 配置

Node 环境变量：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `EVOLUTION_ESIP_TOKEN` | 无 | 必填，32–256 个 URL-safe ASCII 字符 |
| `ESIP_SIDECAR_HOST` | `127.0.0.1` | 只能是 `127.0.0.1` 或 `::1` |
| `ESIP_SIDECAR_PORT` | `7070` | sidecar 端口 |
| `ESIP_LUANTI_SOURCE` | `esip://luanti/world-alpha` | Luanti 权威端 source/target |
| `ESIP_LUANTI_ADAPTER_ID` | `luanti-world-alpha` | 能力声明适配器 ID |
| `ESIP_ALLOWED_COMMAND_SOURCES` | `esip://local/control` | 逗号分隔命令来源白名单 |
| `ESIP_UNIVERSE_ID` | `universe-1` | 当前世界的 ESIP universe |
| `EVOLUTION_RUNTIME_DIR` | `runtime/` | 本地运行数据根目录 |
| `ESIP_SIDECAR_STORE` | `journal` | `journal` 为持久模式；`memory` 仅用于测试或临时演示 |
| `ESIP_SIDECAR_STORE_DIR` | `runtime/sidecar/` | checkpoint 与 journal 目录 |
| `ESIP_SIDECAR_CHECKPOINT_EVERY` | `100` | 每累计多少次状态变更生成 checkpoint 并压缩 journal |
| `ESIP_SIDECAR_MAX_MESSAGE_BYTES` | `65536` | 单条 HTTP 消息最大字节数 |
| `ESIP_SIDECAR_MAX_PENDING_COMMANDS` | `1000` | 未完成命令容量上限 |
| `ESIP_SIDECAR_MAX_RESULTS` | `1000` | 保留结果数量上限 |
| `ESIP_SIDECAR_SEEN_LIMIT` | `10000` | 去重指纹和命令 ID 保留上限 |
| `ESIP_SIDECAR_LEASE_MS` | `5000` | 命令租约时长 |
| `ESIP_SIDECAR_MAX_COMMAND_TTL_MS` | `60000` | 控制端允许提交的最长命令有效期 |

Luanti 手动安装至少需要：

```text
load_mod_evolution_core = true
load_mod_evolution_bridge = true
secure.http_mods = evolution_bridge
evolution_bridge_token = <与 EVOLUTION_ESIP_TOKEN 相同的令牌>
evolution_bridge_url = http://127.0.0.1:7070
```

不要把 HTTP 对象传给其他模组，也不要把 `evolution_bridge` 加入 `secure.trusted_mods`；它只需要 `secure.http_mods`。

## 故障排查

- `/esip_status`：需要 Luanti `server` 权限，显示 `connected/waiting` 和待发送数量，不显示令牌。
- 日志提示 HTTP API unavailable：确认 Luanti 带 cURL，并配置 `secure.http_mods = evolution_bridge`。
- `identity_unmapped`/`actor_offline`：先让目标玩家进入服务器并用 `/evo identity` 获取当前 actor ID。
- `revision_conflict`/`registry_revision_conflict`/`context_conflict`：重新运行控制端命令，它会先获取最新快照。
- sidecar 返回 401：三个终端使用的令牌不一致。
- sidecar 连接正常但没有命令：确认 `ESIP_LUANTI_SOURCE` 与 Luanti `evolution_bridge_source` 完全一致。
- 查看积压和恢复状态：运行 `npm run sidecar:client -- diagnostics`。
- checkpoint 或 journal 校验失败：sidecar 会拒绝启动而不会静默清空。先停止进程并完整备份 `runtime/sidecar/`，再恢复已知正常的目录；不要直接删除损坏记录后继续运行。
- 修改 Luanti source、adapter ID 或控制来源白名单后提示 binding 不一致：为新的逻辑世界指定新的 `ESIP_SIDECAR_STORE_DIR`，或在确认旧队列已经处理并备份后执行显式迁移。

## 安全边界与当前限制

- sidecar 是本机开发/单机部署边界，不是公网网关；跨主机必须另加 TLS、独立身份、速率限制和审计。
- 默认 journal 模式持久化队列、租约、结果游标、source sequence 和去重记录；checkpoint 与每条 journal 记录都有 schema、连续 revision 和校验值，损坏或绑定不一致时失败关闭。
- 当前持久存储面向单机单 sidecar 进程，不提供多进程写入、远程复制、跨主机共识或生产 broker 的长期保留能力。
- 当前只支持查询状态/时间线、执行 7 个无参数 Evolution 行为和创建/加入时间线，不支持任意 Lua、节点批处理、文件读写或数据库导出。
- `actorId` 是本地生成的不透明标识；玩家名映射不进入 ESIP，但 actor ID 本身仍应按游戏身份标识保护。跨平台不能仅凭两个 actor ID 字符串相同就合并账户。
- 浏览器权威适配器支持按 registry revision 追赶最近 256 个时间线事件；Luanti 可返回同样的注册表增量，sidecar 会持久化结果 cursor，但还不提供主动订阅或跨主机推送。

## Unity、Unreal 或其他游戏

新适配器至少实现：稳定 `source`、持久 sequence、能力声明、输入 schema 验证、授权、幂等存储、原生状态到 ESIP 的映射，以及断线重连策略。

不要统一所有引擎对象。只交换领域跃迁、时间线建立或已确认玩家转移等业务事实；渲染组件、物理帧和引擎内部实体仍由各自游戏管理。自定义消息使用 `com.example.game.event.v1` 风格命名空间，并注册独立 schema 和运行时验证器。

满足以下条件后才引入持久消息系统：

- 至少两个真实游戏平台已完成端到端往返；
- 已确定需要断线追赶或事件重放；
- 已定义消息保留期、访问控制和删除策略；
- 已压测消息大小、速率、重复和乱序；
- 已确定每类状态的唯一权威端。

升级传输时保留 ESIP JSON 语义，不让 broker 的主题、分区或交付特性泄漏进内容规则。
