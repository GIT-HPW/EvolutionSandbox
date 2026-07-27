# 本地 AI 导演最小闭环

状态：本地实验，已具备权威意图审批闸门、受控场景转移、全自动演化自检和隔离的 Babylon 网页面板；尚未接入外部模型或 GitHub Pages。

## 1. 目标

导演层把玩家的一句话目标转换为严格受限、可审计的结构化意图。它不拥有游戏状态，也不直接调用规则引擎、切换网页、写存档或执行脚本。

```text
玩家目标
   ↓ director.goal.requested.v1
确定性假导演 + 本地策略
   ↓ director.decided.v1
叙事提示 / 行为建议 / 场景切换申请
   ↓ 本地审批票据（默认 pending / 零写入）
玩家明确批准 ──→ 权威端重新观察并校验 revision
   ↓
行为命令 / 叙事发布 / 场景许可（许可本身不切换页面）
```

当前使用确定性假导演验证协议和安全边界，不调用 OpenAI 或其他外部模型。相同目标、权威观察和策略会得到相同意图、规则 ID 与请求 hash。

## 2. 本地运行

在 `EvolutionSandbox` 根目录执行内置三目标演示：

```powershell
npm run demo:director
```

测试一句自定义目标：

```powershell
npm run demo:director -- "让宇宙进入星辰时代"
```

预览一张待审票据，默认不会执行：

```powershell
npm run demo:director:approval
```

明确批准或拒绝一条行为建议：

```powershell
npm run demo:director:approval -- --approve "继续观察这个新生宇宙"
npm run demo:director:approval -- --decline "继续观察这个新生宇宙"
```

构建并启动仅供本地测试的网页导演实验场：

```powershell
npm run build:web:experimental
python -m http.server 4173 --directory dist/site
```

打开 <http://127.0.0.1:4173/babylon/>，在大厅进入“次世代原点演化”，再点击右上角“AI 导演”。不带 `--experimental` 的普通 `npm run build:web` 仍只生成公开原点页，不包含导演 HTML、样式或 bundle。

需要快速验证完整闭环时，可以直接点击控制区的“全自动演化”。它会从干净原点状态开始，自动完成大爆炸、物质凝聚、稳定与回收，再通过受限导演审批和一次性场景许可进入星辰篇。星辰页会以 ×16 时间倍率继续运行到稳定行星盘；运行期间再次点击同一按钮可以请求安全停止。

单独运行导演测试：

```powershell
node --test test/director.test.mjs test/director-adapter.test.mjs test/director-approval.test.mjs
```

导演协议演示只使用同进程 `MemoryRouter`。审批演示使用内存中的原点规则权威，只有显式传入 `--approve` 且票据仍然有效时才执行一次；两种演示都不会启动网络服务、读取模型密钥或修改浏览器/Luanti/文明存档。

## 3. 当前允许的意图

| 意图 | 参数 | 当前作用 |
| --- | --- | --- |
| `narrative_cue` | `cue`、`tone` | 提供叙事提示，不改状态 |
| `action_suggestion` | `actionId` | 建议当前已开放行为，不执行行为 |
| `scene_transition_request` | 来源/目标场景、前置里程碑、确认模式 | 申请转场，不切换页面 |

默认策略只允许原点七个行为、`origin` 与 `stellar` 两个场景，以及满足 `realm_anchored` 后从原点申请进入星辰篇。场景转移固定为 `manual_confirm`；即使导演提出申请，后续仍必须由场景权威端验证检查点并由用户确认。

## 4. 权威观察

调用端必须提交一份有边界的观察：

- 当前 `sceneId`、规则 `phase` 和状态 revision；
- 权威端已经开放的行为；
- 已确认里程碑；
- 当前构建实际包含的场景。

导演策略会再次与自己的行为、场景和转场白名单求交集，不能只相信 UI 提交的 `availableActions` 或 `availableScenes`。

## 5. 审计与恢复

每次通过身份与 revision 检查的请求产生连续导演 revision，并记录：

- 策略 ID；
- `deterministic_fake` 引擎标识；
- 不包含外部密钥的请求 hash；
- 命中的规则 ID；
- 接受或拒绝结果；
- 完整结构化意图。

适配器把每个授权 source 显式绑定到一个不透明 `actorId` 和 `universeId`，并要求 subject 等于 `actor/<actorId>`。它保存最近 256 个 `source + id` 指纹与响应。恢复后，相同 ID 和相同授权请求返回原决策且不增加 revision；同一身份下复用 ID 并改变目标或上下文会返回 `id_conflict`，改变 actor、universe 或 subject 会先被身份绑定拒绝。`directorChanged` 持久化失败时，本地 revision 和处理记录不会前移。

## 6. 权威意图审批器

`src/director/approval.mjs` 位于导演和实际权威之间。应用层必须先把可信导演结果登记成审批票据，再由绑定到该提案的 actor 选择 `approve` 或 `decline`。

审批时会重新读取权威观察，并检查：

- actor 与提案上下文一致；
- scene、phase 和状态 revision 没有变化；
- 建议行为仍在权威可用行为集合中；
- 转场来源、目标构建、里程碑和 `manual_confirm` 模式仍然有效。

批准后的计划分为 `action_command`、`narrative_release` 和 `scene_transition_permit`。场景许可本身不直接操作 `window.location`；审批完成并持久化最终审计结果后，应用层才会暂停场景、写入与批准 revision 一致的检查点，再把一次性许可交给 `SceneFlowController`。检查点或许可验证失败时留在当前场景。闸门在调用权威执行器前先持久化 `executing`，因此恢复到不确定状态时只会返回 `reconciliation_required`，不会自动重试并造成双重执行。成功、失败、拒绝和重复确认均保留可恢复审计状态。

审批记录当前是本地领域格式，还没有增加新的 ESIP 网络消息。这样可先验证最小安全闭环，避免在交互语义稳定前扩大公开协议。

实验网页把导演记录和审批记录分别保存在独立 localStorage key。刷新后可以恢复最近票据；相同目标在相同状态下产生的确定性 intent ID 还会与原始请求 ID 一起构成票据 ID，因此重复目标不会互相覆盖。批准行为通过原点页现有的 `performAction → action.requested → browser authority` 路径执行，画面只读取 `action.applied` 后的状态。审批在收到权威 `action.applied` 并更新 revision 后立即完成，不再等待最长约 3.4 秒的领域跃迁动画；面板显示本次权威确认的毫秒数，动画继续播放期间保持游戏 busy 锁并临时禁止下一次批准。面板打开时普通行为按钮和自动演化入口暂停接受输入。

## 7. 全自动演化自检

“全自动演化”不是给 AI 增加无限权限，而是用户通过一次明确点击授权一条固定、确定性、可中止的本地测试策略：

```text
重置原点权威状态
    ↓
执行内容包 demo 行为并逐步等待 ESIP 确认
    ↓
创造物质 → 稳定时空 → 回收物质
    ↓
确认 realm_anchored 与当前 revision
    ↓
生成固定星辰目标并建立审批票据
    ↓
以本次按钮点击授权自动批准该白名单票据
    ↓
暂停 → 检查点 → 一次性转场许可
    ↓
大厅自动接力 → 星辰 ×16 自主演化
```

自动运行记录保存在独立的 `evolution-sandbox.auto-evolution.v1` 本地键中，只记录运行 ID、来源、目标、阶段、时间和错误摘要，不复制领域权威状态。原点仍由浏览器 ESIP 适配器拥有，恒星仍由 `StellarController` 拥有。手工导演目标、未知规则和外部模型输出不会因为存在这个按钮而自动获得批准。

## 8. 尚未包含

- openVirFactory 驱动的导演决策或任何导演真实模型调用；
- 多用户速率限制、配额和跨进程身份服务；
- 公开演示入口。

只读 `WorldObservation v0`、Babylon 文明观测台、可审计 `WorldExperimentProposal v0` 和 openVirFactory pending 实验适配已经完成。模型不能调用 controller，玩家确认时还必须重新验证 revision、tick 与 history hash。该适配器只服务文明实验，不会让当前确定性导演自动变成外部模型导演；导演模型接入仍需复用独立审批票据和 ESIP 身份边界。
