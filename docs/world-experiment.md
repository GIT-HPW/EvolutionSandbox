# WorldExperimentProposal v0

`WorldExperimentProposal v0` 把“从同一历史点试一种不同策略”约束为可验证、需再次确认的文明实验。它不是通用脚本、自然语言执行器或新的状态权威；当前实现只支持文明领域的五类白名单意图。

## 提案与确认

提案绑定以下权威事实：

- `universeId`、源时间线、源 tick 和源 `historyHash`；
- 创建提案时的 controller revision；
- 请求者类型与 ID；
- 白名单 intent、1–3 级强度和新时间线 ID；
- 仅用于解释的标题与理由。

`proposalId` 由全部提案字段规范化后确定性计算。创建提案是纯只读操作，不写 controller，也不创建分支。确认时 `CivilizationController.applyExperiment` 会再次检查 revision、活动时间线、tick、history hash、目标时间线冲突和重复 proposal ID；任一事实变化都会失败关闭。

```text
WorldObservation
      ↓
生成严格提案（不写状态）
      ↓
玩家复核 proposal / source / patch
      ↓ 明确确认
CivilizationController.applyExperiment
      ↓
暂停的新时间线 + 因果记录 + world_experiment_committed 事件
```

## 有限规则偏移

规则偏移只调整现有 `CivilizationSpec.values` 的有效值，最终范围始终限制在 0–100；它不修改人口、资源、知识、生态或凝聚力状态字段。强度只会线性缩放固定模板。

| Intent | 主要偏移 | 明确代价 |
| --- | --- | --- |
| `research_focus` | 提高 knowledge | 略降 expansion |
| `resource_policy` | 提高 expansion | 降低 ecology |
| `settlement_policy` | 提高 expansion 与 collectivism | 无隐藏字段 |
| `ecology_policy` | 提高 ecology | 降低 expansion |
| `cohesion_policy` | 提高 collectivism | 降低 militarism |

每个 CivilizationSpec 仍通过 `autonomy.allowedIntents` 决定允许哪些模板。模型、导演或界面不能增加模板、字段或幅度。

## 因果与重放

文明 controller record 升级为 schema 2。每条时间线新增：

- `policy`：从祖先继承并合并后的有效规则偏移；
- `causality`：当前分支的完整提案、提案 hash、固定 patch 和提交 revision，普通分支为 `null`。

恢复时会从父时间线重放到 branch tick，验证源 history hash，再验证提案 hash、patch 编译结果、策略继承和提交 revision。后续 checkpoint 也必须使用该时间线 policy 确定性重放。schema 1 旧记录会显式迁移为零偏移、无虚构因果的 schema 2 记录。

`WorldObservation v0` 不暴露完整 controller record，只在文明摘要中投影 `baseline`、`unattributed_branch` 或 `verified_experiment`，以及已确认实验的 intent、强度和 proposal ID。

实验不会原地改写父时间线，所以既有 checkpoint 不需要被标记为失效；它们继续属于原因果链。尚未确认的提案如果遇到 revision、活动时间线、tick 或 history hash 变化，会以 `experiment_revision_mismatch` 或 `experiment_source_mismatch` 明确失效，调用端必须重新观察和生成提案，不能自动重放旧提案。

## ESIP 评审与提交

文明适配器提供四类传输无关消息：

- `civilization.experiment.review.requested.v1` / `civilization.experiment.reviewed.v1`：只读复核提案并返回固定 Rule Patch，结果保持 `pending`；
- `civilization.experiment.commit.requested.v1` / `civilization.experiment.committed.v1`：在写入点重新复核全部来源事实，成功后返回新分支快照。

两个请求都必须携带 `expiresat`。宿主必须使用 `experimentBindings` 把每个允许的 `source` 精确绑定到 `actorId` 和 `universeId`，并要求 `subject = actor/<actorId>`；没有绑定的来源默认拒绝。评审不改变 controller revision，提交必须匹配消息、提案和当前 controller 的 revision。成功提交后，完整提案会进入时间线 causality，因此同一 `proposalId` 即使在适配器或 sidecar runtime 重启后重投，也只返回 `duplicate: true`，不会再次创建分支。

## 安全边界与下一步

- 提案 hash 用于一致性和审计，不是数字签名，也不能证明真实人物身份；
- 正式 ESIP 实验消息已经定义，但当前没有浏览器直连端点；模型调用只存在于 openVirFactory 的认证回环接口；
- `requestedBy.type=model` 只是来源声明，不能绕过二次确认；
- 自由文本标题和理由不会进入规则计算；
- Babylon 页面只通过 `CivilizationObservatory` 提交确认，表现层仍不直接写 state。

独立 JSON Schema 位于 `protocol/schemas/world-experiment-proposal-v1.schema.json`。openVirFactory 已增加独立强制工具调用和 Bearer 认证回环端点：模型只生成 intent、强度、标题与理由，适配器把它们与调用方提供的权威上下文组合成固定 `pending` 响应。响应还携带规范化原始请求的确定性 `requestHash`；EvolutionSandbox 复核时必须同时提供原请求并重新计算该 hash，再验证 proposal hash、所有来源字段、目标时间线、允许 intent 和 provider/model 审计。该复核仍不写状态，只有现有 `commitExperiment` 二次确认能够建立分支。

文明 controller record 的 sidecar 恢复、调度租约和 crash-safe pulse 已由独立单写者 runtime 完成；它不会自动确认实验提案。ESIP source/actor/universe 授权、请求过期和提交幂等已经在库级适配器中定义，但仍没有浏览器 CORS、同源身份网关、网络速率限制或真实 provider 自动测试。下一切片应由同源网关把认证会话映射到上述显式绑定，再进行 provider 往返验收；不能把 openVirFactory 回环端点直接暴露给浏览器。
