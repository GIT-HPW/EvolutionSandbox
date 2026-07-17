# 第三方与来源说明

- 世界观来源：[`GIT-HPW/Evolution-`](https://github.com/GIT-HPW/Evolution-)，GNU GPL v3。EvolutionSandbox 对前两篇进行规则化改编，并在内容包中记录来源路径。
- 运行平台：Luanti。Luanti 和各游戏（包括 Mineclonia）由各自作者按各自许可证发布，不随本仓库捆绑。
- 可选集成：[`GIT-HPW/openVirFactory`](https://github.com/GIT-HPW/openVirFactory)，GPL-3.0-or-later，不随本仓库捆绑。
- 开发依赖：`luaparse`，MIT License，仅用于 CI 中的 Lua 语法检查。
- 开发依赖：`ajv`，MIT License，仅用于 CI 中验证 JSON Schema 和协议示例。
- ESIP 事件外壳兼容 [CloudEvents 1.0](https://github.com/cloudevents/spec)，接口说明采用 [AsyncAPI 3.0](https://www.asyncapi.com/)。本仓库未捆绑消息代理或上述规范的实现代码。
