# evolution_core

`evolution_core` 是一个不依赖特定游戏的 Luanti world mod。它把 `Evolution-` 前两篇中的零维混沌、能量信息体、熵增、撕裂、融合和大爆炸变成可保存的规则状态机。

- `standalone` 模式会把玩家送入隔离的演化领域，适合新世界。
- `integrated` 模式不会自动传送或改动现有区域，玩家明确执行 `/evo start` 后才进入演化领域。
- 状态保存在 Luanti 玩家 metadata 中；不会读取或导出认证数据库、玩家数据库或 API 密钥。
- 所有可由外部 AI 放置的节点都使用 `evolution_core:` 前缀，可通过 openVirFactory 的节点白名单进行约束。

编辑 `content/chapters/origin.json` 后在仓库根目录运行 `npm run build:content`，不要直接编辑 `content.generated.lua`。
