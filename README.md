# EvolutionSandbox

[![verify](https://github.com/GIT-HPW/EvolutionSandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/GIT-HPW/EvolutionSandbox/actions/workflows/ci.yml)
[![pages](https://github.com/GIT-HPW/EvolutionSandbox/actions/workflows/pages.yml/badge.svg)](https://github.com/GIT-HPW/EvolutionSandbox/actions/workflows/pages.yml)

EvolutionSandbox 是把 [`Evolution-`](https://github.com/GIT-HPW/Evolution-) 宇宙剧本逐步转化为高自由度沙盒游戏规则的实验项目。它不是把章节原文硬编码进游戏，而是把“维度、时间线、能量、信息、熵、创造与毁灭”整理为可验证、可保存、可扩展的内容包和状态机。

首个版本完成一个最小可玩闭环：玩家作为零维混沌中的原始能量信息体，通过观察、撕裂和融合改变宇宙状态；达到信息、熵和碎片阈值后触发大爆炸，进入可以创造、毁灭、稳定物质并建立时间线分支的首个三维领域。

## 立即体验

### 1. 浏览器中点击测试

打开 [EvolutionSandbox 原点演化实验](https://git-hpw.github.io/EvolutionSandbox/)。网页不连接服务器、不需要账号，也不会读取任何存档或 API 密钥。网页与 Luanti 模组读取同一份规则内容。

如果 Pages 尚在首次部署，可在 [Actions](https://github.com/GIT-HPW/EvolutionSandbox/actions) 下载 `EvolutionSandbox-tested-*`，或本地运行：

```bash
npm install
npm run demo
npm run verify
```

需要 Node.js 20 或更高版本；规则演示不需要 Luanti。

### 2. 在 Luanti 中游玩

准备 Luanti 服务器和一个游戏。默认使用 Mineclonia，也可通过 `LUANTI_GAME_ID` 指定其他游戏：

```bash
npm install
npm run runtime:prepare
npm run dev
```

如果系统找不到服务器程序，设置 `LUANTI_SERVER_BIN` 为 `luantiserver`/`luantiserver.exe` 的完整路径。连接本地服务器后会进入隔离的零维领域：

- 右键紫色核心观察混沌；
- 右键红色撕裂场产生碎片与熵；
- 右键绿色融合场进行局部自我更新；
- 达到阈值后右键黄色维度门触发大爆炸；
- 输入 `/evo` 可打开同样功能的可点击面板。

状态保存在玩家 metadata 中。重新连接后，阶段、数值和时间线会继续保留。

## 与现有项目快速组合

| 组件 | 角色 | 组合方式 |
| --- | --- | --- |
| `Evolution-` | 世界观和章节原典 | 章节不直接复制；通过 `content/chapters/*.json` 记录来源并转为规则 |
| Luanti | 开源沙盒引擎 | `evolution_core` 作为无硬依赖的 world mod 运行 |
| Mineclonia | 方块、生存和多人玩法底座 | 作为推荐游戏；本项目不修改其源码与玩家数据库 |
| `openVirFactory` | 安全 AI/自动化控制层 | 将 `evolution_core:` 加入节点白名单后，AI 只能使用结构化命令操作允许的节点 |
| `G2Reality` | 未来的现实坐标与地图生成适配器 | 保持为可选边界，不进入首个闭环的核心规则 |
| `SportX` | 未来可借鉴的日历、事件与前端呈现 | 只复用设计思想，不产生运行时依赖 |

与 openVirFactory 一起使用时，把两个项目的 world mods 安装到同一个世界，并在 openVirFactory 配置中设置：

```text
virfactory_allowed_node_prefixes = factory_core:,evolution_core:
evolution_mode = integrated
```

这样 AI 可以放置或移除白名单中的 EvolutionSandbox 节点，但不能执行任意 Lua、替换其他游戏节点或读取玩家数据库。叙事 AI 适合担任导演、NPC 或建造助手；能量、熵、维度跃迁和存档必须继续由确定性规则决定。

更多说明见 [集成边界](docs/integrations.md) 和 [架构](docs/architecture.md)。

## 接入已有世界

不要先复制整个世界到仓库。将环境变量指向世界目录后运行准备脚本：

```bash
EVOLUTION_WORLD_DIR=/path/to/world npm run runtime:prepare
```

脚本会自动选择 `integrated` 模式，只更新 `world.mt` 中的模组开关并安装 `worldmods/evolution_core`；它不会读取或改写 `players.sqlite`、`auth.sqlite`、`map.sqlite` 或 `mod_storage.sqlite`。如果已有同名非托管模组，原模组和 `world.mt` 会备份到忽略提交的 `runtime/backups/`。

集成模式不会自动传送玩家或改动现有区域。玩家明确输入 `/evo start` 后，才会在高空隔离区域生成演化领域。

## 内容包与扩展

规则的唯一编辑源是 [`content/chapters/origin.json`](content/chapters/origin.json)。修改后运行：

```bash
npm run build:content
npm run verify
```

构建脚本会生成 Luanti 使用的 `content.generated.lua`；CI 会拒绝内容源与生成文件不一致的提交。浏览器、命令行模拟器和 Luanti 模组因此共享相同的初始状态、行为消耗、阈值和阶段迁移。

后续章节应新增内容包和迁移规则，不覆盖旧存档语义。完整约定见 [内容包指南](docs/content-packs.md)。

## 仓库结构

```text
content/       世界观到规则的内容包与 schema
src/           与引擎无关的确定性规则实现
web/           可点击浏览器演示
mods/          Luanti 模组和领域呈现
scripts/       构建、运行时准备、安全检查与集成测试
test/          规则回归测试
docs/          架构、集成和迭代说明
```

## 当前边界

- “零维”目前是 Luanti 三维空间中的隔离规则领域，并非真正的零维物理模拟。
- 首版只有原点到首个三维领域，尚未实现 32 维、平行宇宙服务器编排、NPC 或经济系统。
- 多人共享领域，但每位玩家的演化数值和时间线名称独立保存；时间线的世界级分叉仍在路线图中。
- 世界文件、玩家数据、模型权重和 API 密钥都不属于源码仓库。

路线优先级是：稳定小闭环 → 多人时间线事件 → 数据驱动章节加载 → openVirFactory AI 导演 → G2Reality 坐标领域 → 多世界/多服务器维度。

## 安全与许可证

发现漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。不要在 Issue 中上传真实世界、玩家数据库、日志或密钥。

项目采用 [GNU GPL v3 或更高版本](LICENSE)。原始世界观来源及第三方边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
