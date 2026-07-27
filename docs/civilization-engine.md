# 确定性文明内核

- 当前状态：可控制、可重放、可分支、可通过 ESIP 调用，并具备 sidecar 恢复与 crash-safe 调度
- 内容 schema：`CivilizationSpec` v1
- 文明状态 schema：v1

## 1. 能力边界

当前内核可以：

- 从经过校验的 `CivilizationSpec` 创建文明；
- 使用字符串 seed 初始化可保存的 32 位 PRNG；
- 以固定顺序推进人口、资源、知识、生态和凝聚力；
- 生成周期事件和时代里程碑；
- 在单次或分批推进时得到相同状态、事件和历史 hash；
- 在达到最大 tick 或崩溃停止条件时结束；
- 在 CLI 中运行三个原创文明预设；
- 通过控制器暂停、继续、单步、设置倍速或显式推进；
- 按固定 tick 生成 hash 链快照，并从最近快照确定性重放；
- 从历史 tick 建立独立子时间线，切换时间线时不回写父时间线；
- 通过 ESIP 创建文明、提交控制命令和读取精简快照；
- 通过 ESIP 只读评审并显式提交受限实验提案；
- 使用原子 checkpoint 恢复完整 controller，并通过时间槽 ID 与 pulse 租约避免重启重复推进。

当前仍未接入：

- 同源身份网关和真实 provider 往返；
- openVirFactory 生成全新 `CivilizationSpec` 的流程；
- 聚落、派系和代表人物的权威状态。

这些能力会在规则语义稳定后逐层接入，AI 和表现客户端不会直接写文明指标。

## 2. 快速运行

在仓库根目录执行：

```powershell
npm run check:content
npm run demo:civilization
npm run demo:civilization:control
```

默认运行 `tidal-archive` 预设的完整 1,000 tick。也可以指定预设和目标 tick：

```powershell
npm run demo:civilization -- ember-steppe 500
npm run demo:civilization -- canopy-accord 1000
```

输出包括最终时代、五项指标、历史 hash、事件数量和里程碑。

控制演示还会执行倍速脉冲、暂停、推进至 300 tick、从 150 tick 分支，并把完整控制器记录重新载入和验证。

应用代码可直接使用控制器，不需要操作 tick 公式：

```js
import { CivilizationController } from "./src/civilization/index.mjs"

const controller = new CivilizationController(spec, {
  timelineId: "main",
  snapshotInterval: 100,
})

controller.control("resume", { expectedRevision: 0 })
controller.advance(100, { expectedRevision: 1 })
controller.branch("green-path", { atTick: 60, expectedRevision: 2 })

const view = controller.snapshot()       // 给 UI / ESIP 的精简视图
const record = controller.exportRecord() // 给权威持久层的完整记录
```

## 3. 目录

```text
content/schemas/civilization-spec.schema.json
content/civilizations/presets/*.json
src/civilization/prng.mjs
src/civilization/validation.mjs
src/civilization/engine.mjs
src/civilization/controller.mjs
src/civilization/index.mjs
cli/civilization-demo.mjs
cli/civilization-control-demo.mjs
scripts/check-civilization-content.mjs
test/civilization-engine.test.mjs
test/civilization-controller.test.mjs
src/interop/civilization-adapter.mjs
src/interop/civilization-runtime.mjs
test/civilization-adapter.test.mjs
test/civilization-runtime.test.mjs
protocol/schemas/civilization-*.schema.json
```

## 4. 确定性约束

- 所有权威指标使用安全整数；生态和凝聚力限制为 0–100。
- 随机数只能通过 `src/civilization/prng.mjs` 生成，PRNG 状态属于文明状态。
- tick 的生产、消耗、人口、知识、生态、凝聚力、事件和时代检查顺序固定。
- 引擎不修改传入的 spec 或 state。
- 单次批量最多推进 10,000 tick，spec 最多声明 1,000,000 tick。
- `historyHash` 和 `checkpointHash` 是用于损坏检测与重放回归的 32 位确定性指纹，不是抵御恶意篡改的密码学证明；跨信任边界持久化时仍需由宿主添加签名或密码学校验值。
- 相同 spec、seed 和分支输入必须生成相同结果；改变规则公式属于需要显式版本和迁移的语义变更。

控制器初始为 `paused`。`pulse()` 只在 `running` 模式执行并按当前 speed 推进，`advance()` 则是权威宿主显式推进，因此暂停时仍可用于管理员快进。每次修改都支持 `expectedRevision`，旧客户端不能覆盖新状态。

快照默认每 100 tick 生成一次；终止状态即使不在周期边界也会生成快照。导入完整记录时，控制器会校验每个快照内容、hash 链、快照间重放结果以及分支与父时间线在分叉 tick 的状态一致性。

## 5. 添加文明预设

1. 在 `content/civilizations/presets/` 创建 JSON 文件。
2. 文件名必须等于文明 id 把下划线改成连字符后的结果。
3. 使用 `$schema` 指向 `../../schemas/civilization-spec.schema.json`。
4. seed 在全部预设中保持唯一。
5. 只使用 schema 声明的自治意图。
6. 运行：

```powershell
npm run check:content
node --test test/civilization-engine.test.mjs
```

内容检查会同时执行 JSON Schema 和运行时语义校验，拒绝未知字段、重复 id/seed 和不匹配的文件名。

## 6. ESIP 应用层接口

`createCivilizationAdapter()` 承担单个文明的 ESIP 权威入口，公开十种文明消息：

| 消息 | kind | 用途 |
| --- | --- | --- |
| `civilization.create.requested.v1` | command | 用 spec 创建文明 |
| `civilization.created.v1` | event | 返回初始精简快照 |
| `civilization.command.requested.v1` | command | advance / pause / resume / step / set_speed / branch / switch_timeline |
| `civilization.updated.v1` | event | 返回更新快照和本次事件批次 |
| `civilization.snapshot.requested.v1` | query | 请求当前状态，可限制近期事件数量 |
| `civilization.snapshot.v1` | result | 返回不含内部快照档案的精简视图 |
| `civilization.experiment.review.requested.v1` | query | 只读校验提案来源并编译固定 Rule Patch |
| `civilization.experiment.reviewed.v1` | result | 返回仍为 `pending` 的提案和 patch，不改变 revision |
| `civilization.experiment.commit.requested.v1` | command | 在提交点重新校验提案并建立差异分支 |
| `civilization.experiment.committed.v1` | event | 返回新分支快照或同一提案的重复确认 |

适配器默认通过 `controllerChanged(record, snapshot)` 回调把持久化决定交给宿主；回调在成功创建和每次成功命令后执行。需要可恢复调度时可改为传入下节的 `CivilizationSidecarRuntime`，两种持久化权威不能同时启用。

实验请求必须携带 `expiresat`，并通过显式 `experimentBindings` 把请求 `source` 绑定到唯一的 `actorId` 与 `universeId`；`subject` 必须等于 `actor/<actorId>`。评审是无副作用 query，提交 command 会重新验证 revision、活动时间线、tick、history hash 和目标时间线。已写入 controller 因果记录的同一 `proposalId` 在进程或 runtime 重启后重投时返回 `duplicate: true`，不会再次创建分支。协议 schema、AsyncAPI 与示例位于 `protocol/`，执行 `npm run check:protocol` 可验证三者一致。

## 7. Sidecar 恢复与 crash-safe pulse

`src/interop/civilization-runtime.mjs` 提供独立于 Luanti 命令队列的文明运行时。checkpoint 保存完整 spec、universe 绑定、controller record、当前 pulse 租约和最近 256 个已完成 pulse ID；文件使用 schema、SHA-256 校验和与临时文件原子替换，损坏、host 变化或 controller 无法确定性重放时拒绝恢复。

```js
import {
  createCheckpointCivilizationRuntimeStore,
  createCivilizationAdapter,
  createCivilizationPulseScheduler,
  createCivilizationSidecarRuntime,
} from "../src/interop/index.mjs"

const runtime = createCivilizationSidecarRuntime({
  store: createCheckpointCivilizationRuntimeStore({
    directory: "runtime/civilization-alpha",
  }),
  hostId: "civilization-engine-alpha",
  leaseMs: 5000,
})
await runtime.initialize()

const adapter = createCivilizationAdapter({ runtime })
const scheduler = createCivilizationPulseScheduler({ runtime, intervalMs: 1000 })
await scheduler.runDue()
```

适配器收到首个 `civilization.create.requested.v1` 后把 spec 与 controller 原子落盘；重建适配器时可直接从同一 runtime 恢复并回答 query。调度器把时间映射为稳定的 `scheduled-pulse:<slot>`：执行前先落盘租约，再从已持久 controller 复制候选并推进，最后原子提交新 controller 与完成记录。

- 租约落盘后进程退出：未到期时其他 worker 返回 `in_flight`，到期后从未改变的 base revision 确定性重算；
- controller 已提交但调用方未收到确认：同一 pulse ID 返回 `duplicate`，不会再次推进；
- 普通 ESIP 命令与 active pulse lease 冲突时失败关闭，不能跨 revision 覆盖；
- 暂停或已终止文明不会留下无效租约；
- 当前实现面向单机单写者，不提供跨进程文件锁、远程共识或无限幂等保留。

## 8. 实验提交与下一切片

正式实验 ESIP 的评审、提交、身份绑定、请求过期和跨重启幂等语义已经完成。它只增加库级协议与权威适配器能力，不会让 openVirFactory 的回环模型端点直接获得 controller 写权限，也没有新增浏览器直连或公网 HTTP 路由。

下一步是在保持现有权威边界的前提下增加：

1. 同源身份网关，把已认证网页会话显式映射为 ESIP source、actor 和 universe；
2. 真实 provider 往返手工验收、超时/速率限制与运维诊断。

Babylon 文明观测台和可审计实验纵切已经完成：页面通过 `WorldObservation v0` 消费精简指标与事件，先只读生成或复核 `WorldExperimentProposal v0`，再次确认后才把请求交回 `CivilizationController`。openVirFactory 已能用独立模型工具返回固定 pending 提案，且不会进入 Luanti 队列。controller record schema 2 为每条时间线保存继承 policy 与直接 causality，旧 schema 1 记录迁移时保持零偏移且不会虚构来源。完整边界见 [WorldExperimentProposal v0](world-experiment.md)。

详细产品推演见 [文明自动演化玩法推演与可行性报告](civilization-simulation-feasibility.md)。
