# 确定性文明内核

- 当前状态：第二个工程切片（可控制、可重放、可分支、可通过 ESIP 调用）
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
- 通过 ESIP 创建文明、提交控制命令和读取精简快照。

当前内核尚未接入：

- sidecar 定时调度、进程重启恢复和持久队列；
- Babylon 文明观测台；
- openVirFactory 自然语言生成和战略意图；
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
test/civilization-adapter.test.mjs
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

`createCivilizationAdapter()` 承担单个文明的 ESIP 权威入口，公开六种文明消息：

| 消息 | kind | 用途 |
| --- | --- | --- |
| `civilization.create.requested.v1` | command | 用 spec 创建文明 |
| `civilization.created.v1` | event | 返回初始精简快照 |
| `civilization.command.requested.v1` | command | advance / pause / resume / step / set_speed / branch / switch_timeline |
| `civilization.updated.v1` | event | 返回更新快照和本次事件批次 |
| `civilization.snapshot.requested.v1` | query | 请求当前状态，可限制近期事件数量 |
| `civilization.snapshot.v1` | result | 返回不含内部快照档案的精简视图 |

适配器通过 `controllerChanged(record, snapshot)` 回调把持久化决定交给宿主；回调在成功创建和每次成功命令后执行。协议 schema、AsyncAPI 与示例位于 `protocol/`，执行 `npm run check:protocol` 可验证三者一致。

## 7. 下一切片

下一步是在不改变现有 tick 结果的前提下增加：

1. sidecar 中的文明控制器记录恢复、调度租约和 crash-safe pulse；
2. 可审计的玩家/导演战略意图，让分支从同一历史点产生真实差异；
3. Babylon 文明观测台最小纵切，消费精简快照与事件批次；
4. openVirFactory 的“一句话 → 待确认 CivilizationSpec”适配层。

详细产品推演见 [文明自动演化玩法推演与可行性报告](civilization-simulation-feasibility.md)。
