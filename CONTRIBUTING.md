# 贡献指南

欢迎提交章节规则、测试、Luanti 交互、可访问性和文档改进。

1. Fork 仓库并从 `main` 创建短分支。
2. 修改内容包后运行 `npm run build:content`。
3. 运行 `npm install` 和 `npm run verify`。
4. Pull Request 中说明对应的 `Evolution-` 章节、规则变化、存档兼容性和实际验证方式。

修改 ESIP 时还需要更新 `protocol/` schema、`asyncapi.json`、示例、运行时验证和测试。破坏兼容性的字段变化必须新增消息主版本，不能静默改变已发布的 `v1` 含义。

不要提交世界存档、玩家数据库、日志、模型文件或密钥。新增依赖前说明必要性，并优先使用 Node.js/Luanti 标准能力。提交即表示贡献内容可按 GPL-3.0-or-later 分发。
