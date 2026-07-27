# Architecture Decision Records

ADR 记录会长期影响模块边界、权威归属、协议、存档、安全或运维的决定。架构说明描述当前系统；ADR 解释为什么选择该方案、拒绝了什么方案，以及未来在什么条件下可以替换。

## 使用规则

1. 复制 `0000-template.md`，使用下一个四位编号和简短文件名。
2. 状态从 `proposed` 开始，经 PR 审阅后变为 `accepted`；被替换时标记 `superseded` 并链接新 ADR。
3. 一个 ADR 只处理一个决定，不记录普通实现步骤或临时待办。
4. 涉及多个仓库时，ADR 必须链接兼容矩阵、integration Issue 和双方 PR。
5. 代码、schema 和运维文档不得与已接受 ADR 冲突；需要改变时先提交新 ADR。
