# 内容包指南

每个内容包至少包含：稳定的 `id`、语义版本、原典来源、初始状态、数值边界、阶段、行为和一条可自动完成的演示路径。

新增规则时遵循以下约束：

1. 先在 `content/` 中表达规则，不直接在网页或 Lua 中写第二份数值。
2. 行为 ID 使用小写字母、数字和下划线；已经发布的 ID 不改名。
3. 阶段迁移必须有明确条件，并有成功与失败测试。
4. 内容包必须记录对应的 `Evolution-` 章节路径和改编说明。
5. 改动旧状态字段时提升 schema，并提供玩家 metadata 迁移函数。
6. 运行 `npm run build:content` 生成 Lua，再运行 `npm run verify`。

`content.generated.lua` 是发布时供 Luanti 直接运行的产物，应提交，但不可手工修改。网页与命令行直接读取 JSON；CI 的 `check:content` 保证两者一致。
