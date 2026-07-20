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

真实闭环由以下组件组成：

- `src/interop/http-sidecar.mjs`：只监听回环地址的认证 HTTP sidecar；
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

在第二个终端启动 Luanti：

```powershell
npm run dev
```

进入服务器并保持玩家在线。在第三个终端复用刚才的同一令牌，查询真实玩家状态：

```powershell
$env:EVOLUTION_ESIP_TOKEN = "<第一个终端中的同一令牌>"
npm run sidecar:client -- state <玩家名>
npm run sidecar:client -- action <玩家名> observe
```

`action` 命令会先查询最新状态和 revision，再发送行为请求；Luanti 执行后返回 `action.applied`。不要把令牌粘贴到 Issue、日志或 shell 历史共享文件中。

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

另开终端运行 `npm run dev`，玩家进入后，在带同一令牌的终端运行：

```bash
npm run sidecar:client -- state PLAYER
npm run sidecar:client -- action PLAYER observe
```

## 实际消息流程

1. `evolution_bridge` 启动后发布 `capability.hello`。
2. 控制端向 `POST /v1/commands` 提交带 `expiresat` 的 `state.requested` 或 `action.requested`。
3. sidecar 验证 Bearer 令牌、schema、来源、目标、消息大小、序列和过期时间，然后进入有界内存队列。
4. Luanti 从 `GET /v1/commands` 领取短租约消息；租约到期但未确认的消息可以重投。
5. bridge 将 `actorId` 映射为在线玩家，并检查 universe、realm、timeline 和 `expectedRevision`。
6. `evolution_core.api` 执行固定白名单行为并写回玩家 metadata；每次状态写入都会增加持久 revision。
7. bridge 向 `POST /v1/messages` 返回 `state.snapshot`、`action.applied`、`realm.transitioned` 或 `error`。
8. sidecar 完成对应命令；控制端通过 `GET /v1/results?after=<cursor>` 获取结果。

bridge 会在 Luanti mod storage 中保留最近 256 个命令的响应描述。网络重试不会重复执行动作，sidecar 重启后再次投递同一命令时也能重新生成确认结果。

## HTTP 绑定

| 接口 | 调用方 | 用途 |
| --- | --- | --- |
| `GET /health` | 本机监控 | 最小健康状态，不返回令牌或玩家数据 |
| `POST /v1/commands` | 受信控制端 | 提交一个 ESIP command/query |
| `GET /v1/commands` | Luanti bridge | 领取 1–8 个带租约的目标消息 |
| `POST /v1/messages` | Luanti bridge | 发布能力、事件和结果 |
| `GET /v1/results` | 受信控制端 | 按单调 cursor 读取已确认消息 |

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
- `actor_offline`：目标玩家必须已进入服务器且保持在线。
- `revision_conflict`/`context_conflict`：重新运行控制端命令，它会先获取最新快照。
- sidecar 返回 401：三个终端使用的令牌不一致。
- sidecar 连接正常但没有命令：确认 `ESIP_LUANTI_SOURCE` 与 Luanti `evolution_bridge_source` 完全一致。

## 安全边界与当前限制

- sidecar 是本机开发/单机部署边界，不是公网网关；跨主机必须另加 TLS、独立身份、速率限制和审计。
- 当前队列、结果游标、source 序列记录保存在 Node 内存中，sidecar 重启后不会恢复；Luanti 玩家状态、revision 和已处理命令缓存会保留。
- 当前只支持查询状态和执行 7 个无参数 Evolution 行为，不支持任意 Lua、节点批处理、文件读写或数据库导出。
- `actorId` 当前等于 Luanti 玩家名，不能把消息或结果公开转发到不可信平台。
- 真实第二游戏平台尚未接入；在完成第二个适配器前不引入持久 broker。

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
