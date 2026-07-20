# 浏览器 ESIP 平台

浏览器演示不是直接调用规则函数修改页面变量。页面包含两个职责分离的适配器：

```text
浏览器 UI 控制适配器
        │ action.requested / state.requested
        ▼
同页 MemoryRouter（默认拒绝 command/query）
        │ 仅允许 control → sandbox
        ▼
浏览器游戏权威适配器
        │ action.applied / state.snapshot / realm.transitioned
        ▼
localStorage 持久状态
```

浏览器游戏适配器拥有该浏览器存档的唯一写权限。UI 只发送带 `expectedRevision` 的结构化命令，并用已确认的结果更新画面。状态、revision、适配器 outbound sequence、每个来源的 inbound sequence 及最近 256 个命令响应都会持久化。刷新页面后，相同 `source + id` 的重投会返回原响应，不会再次执行行为。

## 状态与重置

默认 actor 是 `browser-player`，source 是 `esip://browser/sandbox`，存储键是 `evolution-sandbox.esip.browser.v1`。存储记录使用显式 schema；字段、类型、阶段/维度或内容包边界不一致时会停止加载，不会静默覆盖存档。

“本地重开”是浏览器平台的本地管理操作，不是跨平台 ESIP 命令。它把游戏状态恢复为内容包初始值，但 revision 继续递增，避免旧命令在重置后意外生效。普通行为和时间线建立都经过 ESIP；`branch_timeline` 需要单一字符串 `name` 参数，并产生 `timeline.created` 事件。

## 安全边界

- 路由器只授权固定的浏览器 control source 向固定 sandbox target 发送 command/query。
- 游戏适配器校验 actor、universe、realm、timeline、revision、参数和内容规则。
- localStorage 只保存公开游戏数值和幂等元数据，不保存令牌、密码、API key 或 Luanti 玩家数据库。
- 页面 CSP 只允许同源脚本、样式和请求，没有内联脚本、跨域 API 或远程模型调用。
- 浏览器适配器不直接连接 Luanti sidecar；当前 sidecar 继续保持无 CORS、Bearer 认证和回环监听。

这个实现证明了第二种游戏状态权威端可以复用 ESIP 语义，但同页 `MemoryRouter` 不是持久消息系统，也不证明跨主机传输。引入 broker 前仍需定义断线追赶、消息保留、删除策略和跨平台身份映射。
