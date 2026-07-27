# 兼容矩阵

EvolutionSandbox、ESIP 和 openVirFactory 独立发布，版本号不要求相同。只有本表明确列出的组合才是已验收组合；功能分支和 Draft PR 不构成发布承诺。

| EvolutionSandbox | ESIP | openVirFactory | 能力范围 | 状态 |
| --- | --- | --- | --- | --- |
| `0.5.x` | `0.1` 核心消息 | `0.2.x` | 认证回环 bridge、结构化 Luanti 命令 | 已发布基线 |
| [PR #8](https://github.com/GIT-HPW/EvolutionSandbox/pull/8) | `0.1` 文明实验扩展 | [openVirFactory PR #3](https://github.com/GIT-HPW/openVirFactory/pull/3) | 固定 pending 提案、只读评审、显式提交 | Draft，未发布 |

## 更新规则

1. 协议生产者先发布 schema、运行时验证、示例和失败语义，消费者随后声明支持范围。
2. 每次跨仓库变更必须由一个 integration Issue 关联双方 PR 和联合验收结果。
3. 收紧既有合法输入、改变字段含义或权威归属必须发布新的消息/schema 主版本。
4. provider、网页或传输接入不得因为“兼容”而绕过身份绑定、审批或权威端重新验证。
5. 发布前必须把 Draft 行提升为具体版本，或从发布范围中明确移除。
