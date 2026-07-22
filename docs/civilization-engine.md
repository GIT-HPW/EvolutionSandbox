# 确定性文明内核

- 当前状态：首个工程切片
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
- 在 CLI 中运行三个原创文明预设。

当前内核尚未接入：

- ESIP 文明消息、sidecar 调度和时间线快照；
- Babylon 文明观测台；
- openVirFactory 自然语言生成和战略意图；
- 聚落、派系和代表人物的权威状态。

这些能力会在规则语义稳定后逐层接入，AI 和表现客户端不会直接写文明指标。

## 2. 快速运行

在仓库根目录执行：

```powershell
npm run check:content
npm run demo:civilization
```

默认运行 `tidal-archive` 预设的完整 1,000 tick。也可以指定预设和目标 tick：

```powershell
npm run demo:civilization -- ember-steppe 500
npm run demo:civilization -- canopy-accord 1000
```

输出包括最终时代、五项指标、历史 hash、事件数量和里程碑。

## 3. 目录

```text
content/schemas/civilization-spec.schema.json
content/civilizations/presets/*.json
src/civilization/prng.mjs
src/civilization/validation.mjs
src/civilization/engine.mjs
src/civilization/index.mjs
cli/civilization-demo.mjs
scripts/check-civilization-content.mjs
test/civilization-engine.test.mjs
```

## 4. 确定性约束

- 所有权威指标使用安全整数；生态和凝聚力限制为 0–100。
- 随机数只能通过 `src/civilization/prng.mjs` 生成，PRNG 状态属于文明状态。
- tick 的生产、消耗、人口、知识、生态、凝聚力、事件和时代检查顺序固定。
- 引擎不修改传入的 spec 或 state。
- 单次批量最多推进 10,000 tick，spec 最多声明 1,000,000 tick。
- `historyHash` 是用于重放回归的 32 位确定性指纹，不是密码学完整性证明；持久快照接入时仍需使用加密校验值。
- 相同 spec、seed 和分支输入必须生成相同结果；改变规则公式属于需要显式版本和迁移的语义变更。

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

## 6. 下一切片

下一步是在不改变现有 tick 结果的前提下增加：

1. 周期快照和可验证重放；
2. pause/resume/step/speed 控制状态机；
3. 从可信 tick 创建子时间线；
4. ESIP 文明创建、推进、控制、事件批次和快照消息；
5. sidecar 重启后的模拟队列与 cursor 恢复。

详细产品推演见 [文明自动演化玩法推演与可行性报告](civilization-simulation-feasibility.md)。
