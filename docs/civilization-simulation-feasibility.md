# 一句话生成与自动演化文明：玩法推演和可行性报告

- 更新日期：2026-07-22
- 适用项目：EvolutionSandbox
- 报告性质：产品与工程可行性分析，不是法律意见

## 1. 执行结论

结论是：**可行，并且与 EvolutionSandbox 现有架构高度匹配。**

《文明》系列适合作为宏观层参考：时代推进、聚落发展、资源取舍、科技与制度、外交贸易、危机和长期目标。以《虚拟人生》为代表的职业/人生事件游戏，以及《模拟人生》等生活模拟，适合作为微观层参考：性格、愿望、职业、关系、家庭和个人事件。

不应把两者简单拼接，也不应复制现成的六边格地图、科技树、领袖、数值表或 UI。推荐形成 EvolutionSandbox 自己的产品定位：

> 一个由自然语言设定初始条件、由确定性规则持续运行、允许玩家或受限 AI 干预、可以从任意历史节点分叉的文明演化沙盒。

现有项目已经解决了最难返工的一部分底层问题：确定性规则、ESIP 消息边界、revision、幂等、身份映射、时间线注册表、持久事件 sidecar、浏览器/Luanti 双平台和 Babylon 表现客户端。尚缺的主要是文明领域模型、tick 调度、快照/分支语义、自然语言配置转换和文明级视觉表达。

综合判断：

| 维度 | 结论 | 说明 |
| --- | --- | --- |
| 技术可行性 | 高 | 当前 Node、ESIP 和持久事件基础足够支撑确定性文明模拟 |
| 架构匹配度 | 高 | 文明事实可以继续由权威适配器写入，表现层只读取快照 |
| 原型实现难度 | 中 | 五项核心指标、聚落和事件系统可以小步实现 |
| 内容生产难度 | 中高 | 科技、制度、事件和人物需要长期开放式内容贡献 |
| 视觉实现难度 | 中 | Babylon 可先做抽象聚落与时代变化，再逐步导入 GLB 资产 |
| 主要风险 | 可控 | 状态爆炸、不可重放、AI 越权、存档膨胀和知识产权近似 |

### 1.1 当前落地状态

2026-07-22 已完成本报告第一个可合并切片：`CivilizationSpec` v1、三个原创预设、可保存的 seeded PRNG、五指标确定性 tick、周期事件、时代里程碑、CLI 演示和 100/1,000 tick 分批重放测试。当前实现位于 `src/civilization/`，尚未接入 ESIP、Babylon、Luanti 或 openVirFactory；这部分边界是刻意保留的，避免在规则稳定前固化跨项目协议。

运行和扩展说明见 [确定性文明内核](civilization-engine.md)。

## 2. 产品目标与非目标

### 2.1 目标体验

用户可以输入：

> 生成一个诞生于潮汐洞穴的海洋文明，以知识和生态为最高价值，不主动战争，自主演化 500 年；我可以随时暂停、修改政策和创建时间线。

系统先生成一份结构化、可审查的文明方案。用户确认后，文明开始运行，并可以：

- 暂停、继续、单步和调整演化速度；
- 查看人口、资源、知识、生态和凝聚力变化；
- 查看聚落、派系、代表人物与重大事件；
- 手动提交政策，或允许 AI 在白名单中自主选择；
- 在任意快照创建新时间线；
- 比较不同政策下的两条文明历史；
- 刷新、重启或切换客户端后继续演化；
- 使用相同 seed 和相同输入重放相同结果。

### 2.2 明确非目标

首个版本不追求：

- 复制《文明》的完整 4X 内容规模；
- 逐个模拟数万名居民的全部日常行为；
- 让大模型在每个 tick 直接生成文明状态；
- 一开始就实现战争、宗教、贸易、城市建设和人物生活的全部细节；
- 将浏览器渲染帧、Babylon 对象或 Luanti 节点作为跨平台权威状态；
- 直接复用其他游戏的名称、角色、文案、图标、美术、界面布局或数值表。

## 3. 参考游戏的可借鉴机制

### 3.1 宏观层：《文明》系列

《文明 VII》的官方开发资料分别讨论了时代结构、帝国扩张与发展、涌现叙事、外交/影响力/贸易等系统。这些资料说明：复杂文明体验不必依赖一个无限增长的单层状态机，可以用时代、目标和事件把长时间跨度分段组织。参考资料见 [Ages](https://civilization.2k.com/civ-vii/archive/dev-diary/ages/)、[Managing Your Empire](https://civilization.2k.com/civ-vii/archive/dev-diary/managing-your-empire/)、[Emergent Narrative](https://civilization.2k.com/civ-vii/archive/dev-diary/emergent-narrative/) 和 [Diplomacy, Influence, and Trade](https://civilization.2k.com/civ-vii/archive/dev-diary/diplomacy-influence-trade/)。

适合抽象借鉴的部分：

| 参考机制 | EvolutionSandbox 转化方式 |
| --- | --- |
| 时代分段 | 使用 `era` 和可验证的时代门槛，阶段转换产生持久事件 |
| 聚落与扩张 | 聚落是资源与人口节点，不要求复制六边格领土 |
| 多种产出 | MVP 只保留人口、资源、知识、生态、凝聚力五项核心指标 |
| 科技与制度 | 使用有前置条件的能力图，而不是复制现有科技树 |
| 外交与贸易 | 派系关系和交换意图通过结构化命令处理 |
| 危机与转折 | 由规则条件和 seeded 事件表产生，不由 LLM 随意改数值 |
| 长期目标 | 使用文明愿景、时代里程碑和停止条件，不照搬胜利类型 |
| 涌现叙事 | 从真实事件日志生成叙事说明，而不是先写故事再伪造状态 |

### 3.2 微观层：《虚拟人生》与生活模拟

早期《虚拟人生》系列的官方一手资料在公开网络上较少，本报告只把它作为“职业路线、人生阶段和随机事件”这一类玩法的方向性参考，不依赖无法核实的具体规则。为了核对生活模拟的公开产品定位，同时参考《模拟人生 4》官方页面描述的人物定制、日常生活、家庭/住宅、社区、关系、职业和人生愿望等机制。[The Sims 4 官方页面](https://www.ea.com/games/the-sims/the-sims-4)

适合抽象借鉴的部分：

- 用少量代表人物承载文明叙事，而不是为每个居民运行完整 AI；
- 人物具有性格、愿望、职业、年龄阶段、关系和记忆；
- 人物事件可以向上影响聚落或文明，但必须有规则化影响上限；
- 职业路线与文明当前时代、资源和制度相关；
- 人物死亡、继承、迁徙和冲突形成可追踪的历史事件；
- 玩家既可以直接控制代表人物，也可以只观察其自主生活。

### 3.3 原创组合：三层模拟

推荐采用三层模型，而不是把宏观和微观规则放进同一个循环：

```text
文明层：时代、总人口、资源、知识、生态、制度、外交
   │
   ├── 聚落/派系层：生产、职业结构、地方政策、关系、迁徙
   │
   └── 代表人物层：性格、愿望、职业、关系、人生事件
```

三层使用不同更新频率：

- 每个 tick：资源生产/消耗、人口与生态的基础变化；
- 每 5–10 tick：聚落、职业结构、迁徙和派系关系；
- 每 25–100 tick：代表人物重大事件、战略 AI 意图、时代评估；
- 达到条件时：危机、时代转换、文明分裂或合并。

这种设计能够同时提供“大历史”和“个人故事”，又不会让性能和事件量随人口线性爆炸。

## 4. 当前项目基础与缺口

### 4.1 已有基础

当前 EvolutionSandbox 已具备：

- 确定性内容包和规则引擎；
- ESIP 0.1 消息外壳、能力声明和默认拒绝策略；
- revision、sequence、幂等响应和 ID 冲突控制；
- 浏览器多 actor 权威适配器和 schema 3 持久存档；
- 时间线创建、加入、注册表 revision 和增量追赶；
- Luanti bridge 与认证回环 sidecar；
- sidecar journal/checkpoint、租约恢复、cursor 和损坏失败关闭；
- Babylon 高精度表现客户端和轻量 WebGL 降级客户端；
- 自动构建、测试、Pages 和公开树安全检查。

### 4.2 核心缺口

| 缺口 | 需要新增的能力 |
| --- | --- |
| 文明定义 | `CivilizationSpec` schema、预设和自然语言转换结果 |
| 文明权威状态 | `CivilizationState`、聚落、派系、代表人物和政策 |
| 时间推进 | 暂停、单步、倍速、最大 tick 和停止条件 |
| 确定性随机 | 可保存状态的 PRNG、seed 派生和固定执行顺序 |
| 快照与分支 | snapshot hash、branch tick、父时间线和重放校验 |
| 事件系统 | 条件、权重、冷却、效果、选择和审计信息 |
| AI 自治 | 自然语言编译、战略意图白名单、预算和频率限制 |
| 文明表现 | 聚落图、时代变化、关系网、事件流和时间线比较 |

## 5. 文明领域模型

### 5.1 `CivilizationSpec`

建议自然语言首先转换为候选配置，而不是直接创建文明：

```json
{
  "schemaVersion": 1,
  "id": "tidal-archive",
  "seed": "civ-tidal-001",
  "name": "潮汐档案文明",
  "origin": {
    "biome": "ocean_cavern",
    "founderPopulation": 120,
    "startingEra": "origin"
  },
  "values": {
    "knowledge": 80,
    "ecology": 75,
    "expansion": 25,
    "militarism": 10,
    "collectivism": 60
  },
  "autonomy": {
    "mode": "autonomous",
    "strategyInterval": 50,
    "allowedIntents": ["research_focus", "resource_policy", "settlement_policy"]
  },
  "stopConditions": {
    "maxTicks": 500,
    "haltOnCollapse": true
  }
}
```

生成流程必须是：

```text
自然语言 → 候选 JSON → schema 校验 → 规则/预算检查 → 用户确认 → 创建命令
```

### 5.2 MVP 权威状态

第一版只保留足以产生有意义取舍的字段：

```text
tick / era / status
population
resources
knowledge
ecology
cohesion
settlements[]
policies[]
milestones[]
recentEventCursor
```

核心指标建议全部使用安全整数或定点数，不使用依赖平台浮点细节的长链计算。

### 5.3 第二阶段扩展

等核心重放稳定后再增加：

- 派系与外交关系；
- 职业结构和阶层流动；
- 代表人物及家庭/师承关系；
- 科技/制度能力图；
- 聚落空间、运输和贸易网络；
- 疾病、灾害、战争与跨文明交流。

## 6. 确定性 tick 推演

每个 tick 必须使用固定顺序，任何 AI 或 UI 都不能插入未记录的状态修改：

1. 读取上一个已确认状态和待执行意图；
2. 按优先级应用已经授权的政策；
3. 计算生产、消耗和资源缺口；
4. 计算人口增长、健康、迁徙和承载压力；
5. 计算生态恢复或损耗；
6. 计算知识积累和能力解锁；
7. 更新聚落与派系关系；
8. 使用当前 PRNG 状态选择符合条件的事件；
9. 应用事件效果并检查时代、分裂、崩溃和停止条件；
10. 生成事件批次、状态摘要和校验值；
11. 原子提交新状态、cursor 和快照索引。

关键约束：

- 相同 spec、seed、父快照和意图序列必须得到相同 hash；
- PRNG 状态属于存档，不能调用未封装的系统随机数；
- 一个 tick 失败时不允许提交半个状态；
- 超出容量、数值边界或最大事件数时失败关闭；
- 大规模快进使用批次命令，但批次内仍按单 tick 语义执行。

## 7. 玩家控制与文明自治

### 7.1 三种模式

| 模式 | 玩家 | AI | 模拟器 |
| --- | --- | --- | --- |
| 手动 | 选择全部政策和关键事件 | 仅解释和建议 | 按玩家意图推进 |
| 辅助 | 确认或拒绝 AI 建议 | 提交候选战略意图 | 校验后推进 |
| 自治 | 设置价值观、边界和停止条件 | 定期选择白名单战略意图 | 始终负责实际数值变化 |

模式可以在运行中切换，但切换本身必须产生权威事件。

### 7.2 AI 不应每 tick 调用

AI 每 tick 参与会造成成本、延迟、不可重放和行为漂移。建议 AI 只在以下时机运行：

- 创建文明配置时；
- 每隔固定的战略周期；
- 时代转换或重大危机时；
- 用户主动要求解释、建议或生成叙事时。

AI 输出只能是类似以下意图：

```json
{
  "intent": "research_focus",
  "target": "ecological_materials",
  "durationTicks": 40,
  "budget": 120,
  "reason": "当前生态压力已接近策略阈值"
}
```

规则引擎决定该意图是否允许、实际花费多少、产生什么结果。模型超时、无效 JSON、未知意图或越权预算都必须安全失败，文明仍可按最后一个有效政策继续运行或自动暂停。

## 8. 时间线与历史分支

现有时间线注册表可以扩展，而不需要复制整个世界数据库。

推荐的分支记录：

```text
timelineId
parentTimelineId
branchTick
parentSnapshotHash
derivedSeed
createdByActorId
creationReason
registryRevision
```

用户选择“回到 230 年并改变生态政策”时，系统不修改原时间线，而是：

1. 查找 tick 230 最近的可信快照；
2. 重放到精确分支点；
3. 校验状态 hash；
4. 创建子时间线和派生 seed；
5. 在新时间线提交政策；
6. 原时间线保持只读可追溯。

对比界面应优先展示差异：人口、生态、知识、聚落数量、时代、关键事件和因果链，而不是同时渲染两个完整 3D 世界。

## 9. ESIP 扩展建议

不要一次加入大量消息。建议先验证本地内核，再逐步注册：

```text
io.evolution.civilization.create.requested.v1
io.evolution.civilization.created.v1
io.evolution.simulation.advance.requested.v1
io.evolution.simulation.control.requested.v1
io.evolution.civilization.intent.requested.v1
io.evolution.civilization.event-batch.v1
io.evolution.civilization.snapshot.v1
```

其中：

- `advance` 指定 expected revision、tick 数量和最大执行预算；
- `control` 只处理 pause/resume/speed，不直接设置文明数值；
- `intent` 是玩家或 AI 的白名单政策意图；
- `event-batch` 避免每个细小事件都成为独立网络消息；
- `snapshot` 是公开摘要，完整内部存档仍由权威端管理。

所有新消息继续遵守现有 target、source、actor、timeline、revision、sequence、幂等和大小限制。

## 10. Babylon 表现方案

首个版本不需要立刻做大型开放世界。可按三个层级迭代：

### 10.1 文明观测台

- 中央领域核心代表文明总体状态；
- 聚落显示为可选择的发光节点；
- 节点连线表示迁徙、资源和知识流；
- 颜色、密度和粒子表现生态、资源和凝聚力；
- 时间轴显示时代、危机和时间线分支；
- 点击聚落查看代表人物和本地事件。

### 10.2 时代场景

- 时代转换触发镜头和场景重构；
- 聚落模型从抽象能量结构逐步升级为建筑群；
- 使用 GLB/glTF、动画组、实例化和 LOD 控制性能；
- 事件只在权威确认后触发粒子、音效和叙事卡片。

### 10.3 可进入的代表聚落

- 浏览器提供有限范围的聚落漫游和代表人物互动；
- Luanti 承担更深的建造、多人和持久空间；
- 两端共享文明事实，不同步每个建筑网格或引擎对象。

## 11. 示例推演

以下是设计推演，不是已经实现的固定剧本。

初始输入：海洋洞穴、知识/生态优先、低军事、自治 500 tick。

可能的确定性进程：

| tick 区间 | 规则状态 | 可见表现 |
| --- | --- | --- |
| 0–50 | 食物稳定、人口缓慢增长、形成第一个聚落 | 核心周围出现水生聚落节点 |
| 51–120 | 知识投入增加，但资源储备下降 | 知识流增强，资源轨道变暗 |
| 121–180 | 触发承载力危机，AI 建议限制扩张 | 危机卡片、生态警戒、等待确认或自治决策 |
| 181–260 | 发展生态材料，恢复环境并建立第二聚落 | 两个聚落建立贸易与知识连线 |
| 261–340 | 新派系要求提高扩张优先级 | 关系图分化，出现创建时间线提示 |
| 341–500 | 原时间线维持生态策略，分支时间线转向工业扩张 | 时间线对比显示人口、生态和知识的长期差异 |

这个过程中的数值结果来自规则和 seed；AI 只负责提出“限制扩张”或“投入生态材料”之类的候选意图，并解释原因。

## 12. 推荐代码与目录边界

首期继续放在 EvolutionSandbox 单仓库中，不需要新建 GitHub 仓库：

```text
content/
  civilizations/
    presets/
    events/
  schemas/
    civilization-spec.schema.json

src/civilization/
  prng.mjs
  engine.mjs
  tick.mjs
  events.mjs
  snapshots.mjs
  validation.mjs

cli/
  civilization-demo.mjs

clients/web-babylon/src/civilization/
  presentation.mjs
  scene.mjs
  timeline-view.mjs

test/
  civilization-engine.test.mjs
  civilization-replay.test.mjs
  civilization-timeline.test.mjs
```

等 `CivilizationSpec`、事件包接口和 ESIP 消息稳定后，再考虑把大型内容包、模型资产或独立 AI provider 拆成可选仓库。

## 13. 里程碑与合并切片

### 13.1 第一个可合并切片：确定性文明内核

新增：

- `CivilizationSpec` schema；
- 可保存状态的 seeded PRNG；
- 五指标文明状态；
- 固定顺序 tick；
- 3 个原创文明预设；
- CLI 运行和摘要输出；
- 100、1,000 tick 重放测试。

验收：

- 相同输入重复运行得到完全相同的状态和事件 hash；
- 原始 spec 不被修改；
- 所有数值保持在声明边界内；
- 达到最大 tick、崩溃或用户停止条件时正确终止；
- 不需要 AI、浏览器或 Luanti 即可测试。

### 13.2 第二个切片：调度、快照和时间线

- pause/resume/step/speed；
- 批量推进与执行预算；
- 定期快照、重放和 snapshot hash；
- 从指定 tick 创建子时间线；
- sidecar 重启后恢复模拟队列和 cursor。

### 13.3 第三个切片：文明观测台

- Babylon 文明总览；
- 五指标和聚落节点；
- 事件时间轴；
- 手动/辅助/自治切换；
- 时间线差异视图；
- 轻量客户端的表格降级视图。

### 13.4 第四个切片：一句话生成

- 自然语言到候选 `CivilizationSpec`；
- 用户确认和字段级修改；
- 无模型的确定性假导演；
- openVirFactory 或独立 provider 适配器；
- prompt 摘要、模型输出 hash、校验和拒绝原因审计。

### 13.5 “一句话文明 Alpha”里程碑

达到以下条件即可视为正式节点：

1. 用户一句话生成并确认一个文明；
2. 文明可以离线确定性运行至少 1,000 tick；
3. 支持暂停、单步、倍速和最大演化步数；
4. 至少存在人口、资源、知识、生态、凝聚力五个相互影响的系统；
5. 至少有两个聚落、一个派系分歧和一个代表人物事件；
6. 可以从任意可信快照创建两条时间线并比较结果；
7. 手动、辅助、自治三种模式都不能越过权威规则；
8. 刷新或 sidecar 重启后继续运行；
9. Babylon 和轻量客户端都能完成核心操作；
10. 完整验证、存档迁移和公开树检查通过。

## 14. 开源协作拆分

稳定的数据边界有利于后续贡献者并行工作：

| 贡献类型 | 可独立任务 |
| --- | --- |
| 规则开发 | 资源公式、事件条件、时代门槛、派系关系 |
| 内容作者 | 文明预设、原创事件、人物模板、叙事文本 |
| 前端开发 | 控制面板、时间轴、差异视图、移动端 |
| 3D/美术 | 聚落模型、时代材质、粒子、动画、音效 |
| AI 集成 | provider 适配器、结构化输出、审计和失败回退 |
| Luanti | 聚落领域、节点映射、多人交互和权限 |
| 测试 | seed 重放、边界条件、长时间运行、存档损坏 |

适合标记为 `good first issue` 的任务包括：原创事件包、文明预设、翻译、UI 文案、固定 seed 测试和低画质表现资源。

## 15. 风险与缓解

| 风险 | 表现 | 缓解措施 |
| --- | --- | --- |
| 状态维度爆炸 | 增加一个系统会影响所有公式 | MVP 限制五指标；新字段必须有迁移和边界测试 |
| 不可重放 | 平台、版本或 AI 输出导致结果不同 | 固定点数、封装 PRNG、记录意图、规则版本和 hash |
| AI 越权 | 模型直接修改人口或生成未知命令 | AI 只能提交 schema 化白名单意图，权威端决定效果 |
| 无限制自治 | 文明高速运行消耗资源或失控 | 最大 tick、时间/事件预算、暂停开关、停止条件 |
| 存档膨胀 | 每 tick 保存完整状态 | 事件批次、周期快照、保留期、压缩和只读归档 |
| 事件重复单调 | 相同危机频繁出现 | 条件、冷却、唯一键、时代范围和历史记忆 |
| UI 信息过载 | 用户无法理解文明为什么变化 | 五指标摘要、因果链、重大事件优先、逐层展开 |
| 渲染规模过大 | 聚落和居民数量压垮浏览器 | 实例化、LOD、代表人物、抽象远景、按需加载 |
| 规则类似现有游戏 | 产品缺乏原创性并产生权利风险 | 独立术语、公式、数据结构、视觉语言和内容来源记录 |

## 16. 知识产权边界

美国版权局的公开 FAQ 说明，版权保护具体的原创表达，但不保护事实、思想、系统或操作方法；同时名称和标识还可能涉及商标。参考抽象玩法并不等于可以复制具体表达。[U.S. Copyright Office FAQ](https://www.copyright.gov/help/faq/faq-protect.html)

本项目应遵守以下工程规则：

- 可以研究时代、资源循环、人物愿望、职业和事件等抽象机制；
- 不复制其他游戏的源代码、文案、图标、界面、音乐、模型和动画；
- 不照搬科技树节点顺序、领袖能力、文明加成、事件文本或数值表；
- 不在产品名称、功能名称或宣传素材中造成官方关联的误解；
- 所有文明、人物、事件、图像和音频记录作者、来源和许可证；
- 历史事实可以作为研究入口，但具体选择、编排和叙述仍应独立创作；
- 商业发布前对名称、商标、素材和内容包进行专门法律审查。

本报告中的游戏名称仅用于比较研究和说明设计来源，不建议成为产品内的命名体系。

## 17. 最终建议

建议正式推进，但调整开发顺序：

```text
CivilizationSpec
      ↓
确定性 PRNG + tick 内核
      ↓
暂停/单步/倍速 + 快照
      ↓
时间线分支与对比
      ↓
Babylon 文明观测台
      ↓
自然语言生成 + 受限 AI 自治
      ↓
聚落、派系、人物和开放内容包
```

第一个实现版本不应先接大模型，也不应先制作大量城市模型。先证明“同一文明可以稳定运行、重放、暂停和分叉”，再让 AI 生成配置和策略，最后扩大视觉与内容规模。这个顺序既符合 EvolutionSandbox 的权威边界，也最适合开源贡献者在稳定接口上并行扩展。

### 参考资料

- [Civilization VII Dev Diary #1: Ages](https://civilization.2k.com/civ-vii/archive/dev-diary/ages/)
- [Civilization VII Dev Diary #3: Managing Your Empire](https://civilization.2k.com/civ-vii/archive/dev-diary/managing-your-empire/)
- [Civilization VII Dev Diary #4: Emergent Narrative](https://civilization.2k.com/civ-vii/archive/dev-diary/emergent-narrative/)
- [Civilization VII Dev Diary #6: Diplomacy, Influence, and Trade](https://civilization.2k.com/civ-vii/archive/dev-diary/diplomacy-influence-trade/)
- [The Sims 4 — Electronic Arts](https://www.ea.com/games/the-sims/the-sims-4)
- [What Does Copyright Protect? — U.S. Copyright Office](https://www.copyright.gov/help/faq/faq-protect.html)
