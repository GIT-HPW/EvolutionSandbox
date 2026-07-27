# Contributing

感谢关注 EvolutionSandbox。官方仓库采用 Fork-first、邀请制贡献，以保护原创世界观和长期思路的连续性。

## 默认开发方式

1. Fork 仓库并在自己的分支中开发；
2. 在 README 和界面中明确标注为非官方版本；
3. 使用自己的发布、运行目录、source、adapter ID 和密钥；
4. 不需要持续追赶或等待官方路线图；
5. 如需分享结果，可使用 Fork showcase Issue，但这不构成合并请求。

## 官方仓库接受什么

- 可复现 Bug 报告；
- 已发布 ESIP 契约的兼容性问题；
- 私密安全报告；
- 由维护者创建邀请 Issue 后，严格限定范围的修复或维护 PR。

未经邀请的世界观、内容、规则、功能、架构、协议和路线图 PR 原则上会关闭而不进入技术评审。请不要把 Fork 的自由演化理解为官方仓库必须吸收修改。

## 受邀 PR 要求

- 链接维护者创建的邀请 Issue；
- 说明目标、非目标、权威归属、兼容、迁移和回滚；
- 通过 `npm run verify` 及 PR 中列出的额外验收；
- 内容包变更说明对应的 `Evolution-` 章节，并运行 `npm run build:content`；
- ESIP 变更同步 `protocol/` schema、AsyncAPI、示例、运行时验证和测试；破坏兼容性的字段变化使用新消息主版本；
- 新增依赖前说明必要性，并优先使用 Node.js、浏览器和 Luanti 标准能力；
- 不提交玩家数据、世界存档、日志、密钥、provider 响应或本地绝对路径；
- 遵守仓库许可证，并只提交有权提供的代码、文档和素材；
- 维护者可以要求缩小范围、重新实现或不合并，避免破坏官方连续性。

## 安全问题

不要公开提交漏洞细节。请使用 GitHub Security Advisory：

<https://github.com/GIT-HPW/EvolutionSandbox/security/advisories/new>

Fork、Issue 和 PR 的完整边界见 `GOVERNANCE.md` 与 `FORKS.md`。
