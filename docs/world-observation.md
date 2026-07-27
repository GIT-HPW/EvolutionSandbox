# WorldObservation v0

`WorldObservation v0` 是原点、恒星和文明共同使用的只读应用层契约。它统一“如何看见世界”，不统一三个领域的演化算法，也不增加新的权威写入口。

当前实验契约使用 `schemaVersion: 1`。`v0` 表示该能力仍处于发布前验证阶段；以后改变字段语义时仍必须增加 schema 版本，不能静默复用版本 1。

## 公共外壳

每份观察包含：

- `universeId`、`timelineId` 和 `domain`：定位世界、分支与领域；
- `tick`、`timeScale`、`revision` 和 `phase`：描述确认后的时间与状态版本；
- `rulePackVersion`：标识生成该状态的规则版本；
- `summary.metrics`：供界面使用的有限标量摘要，不复制完整权威存档；
- `recentEvents`：有序、有限、已经确认的近期事件；
- `capabilities`：声明权威端支持的操作名称，不授予调用权限；
- `provenance`：记录权威、领域来源、观察适配器和源版本。

`timeScale = 0` 表示暂停或行为驱动领域。非零值表示权威控制器当前确认的推进倍率，不是浏览器自行运行的计时器。

运行时验证器位于 `src/world-observation/validation.mjs`，对应 JSON Schema 是 `protocol/schemas/world-observation-v1.schema.json`。两者都拒绝未知外壳字段、重复指标或能力、乱序事件和不完整来源。注册表还会把每个 provider 绑定到预期 universe、domain 和 source，防止观察函数在运行中更换身份。

## 三个领域适配器

- 原点适配器读取内容包、权威 state 与 revision，以 `steps` 作为 tick；
- 恒星适配器先完整验证 `StellarController` 记录和确定性重放，再投影生命周期指标；
- 文明适配器先恢复并验证 checkpoint 链、分支来源和事件记录，再投影当前活动时间线。

适配器只读取调用者提供的状态或记录。观察前后，原点 state、恒星 controller record 和文明 controller record 必须保持逐字段相同。

## 只读注册表

```js
import {
  createCivilizationObservation,
  createOriginObservation,
  createStellarObservation,
  WorldObservationRegistry,
} from "../src/world-observation/index.mjs"

const registry = new WorldObservationRegistry()
  .register("origin-main", {
    domain: "origin",
    universeId: "universe-1",
    source: originPack.id,
    observe: () => createOriginObservation({
      pack: originPack,
      state: originState,
      revision: originRevision,
      universeId: "universe-1",
    }),
  })

const current = registry.get("origin-main")
const all = registry.list()
const comparison = registry.compare("origin-main", "civilization-main")
```

`compare` 只比较公共身份、tick、revision、phase 和摘要指标，不推断两个领域之间的因果关系。

## 当前应用与下一步

Babylon 文明观测台是第一个应用层消费者。页面只从观察契约渲染五指标、事件、时间倍率、阶段和 provenance；`CivilizationObservatory` 把暂停、倍速、单步、推进和已确认实验请求继续发送给既有文明权威控制器，并在成功后重新生成观察。分支比较使用同一只读注册表，不切换或改写权威活动时间线。文明 observation 还以有限字符串指标投影 `baseline`、`unattributed_branch` 或 `verified_experiment`，不会暴露完整 controller record。

当前版本仍没有新增 ESIP 观察查询消息、网络端点或跨进程缓存。`WorldExperimentProposal v0` 已为同一起点的分支增加受限差异意图和可审计因果来源；openVirFactory 现在能从自然语言生成这种严格提案，但响应保持 `pending`，EvolutionSandbox 必须用原始请求 hash 和当前权威来源重新复核，不能把模型输出直接解释为世界修改。详见 [WorldExperimentProposal v0](world-experiment.md)。
