# 浏览器 ESIP 平台

浏览器发布包含两个表现层：站点根路径的轻量版适合快速加载和低配置设备，`/babylon/` 的 Babylon.js 高精度版提供可旋转、可缩放的三维动漫风场景。两者复用同一个浏览器权威适配器、ESIP 消息类型、内容包、存储键和 actor；在同一浏览器中切换客户端会继续当前进度，不会产生第二套规则状态。

两个客户端都不直接调用规则函数修改页面变量。页面包含两个职责分离的适配器：

```text
浏览器 UI 控制适配器
        │ action/state/timeline command 或 query
        ▼
同页 MemoryRouter（默认拒绝 command/query）
        │ 仅允许 control → sandbox
        ▼
浏览器游戏权威适配器
        │ 已确认结果、领域事件、时间线注册表快照
        ▼
localStorage 多 actor 状态与世界注册表
```

浏览器游戏适配器拥有该浏览器存档的唯一写权限。UI 只发送结构化命令，并用已确认的结果更新画面。每个 actor 有独立状态 revision；世界时间线注册表有独立 registry revision。创建时间线必须同时匹配两者，加入时间线必须匹配 actor 状态 revision，因此两个控制端并发操作不会静默覆盖彼此。

轻量版的动漫风宇宙由本站点内置的原生 WebGL shader 实时渲染；高精度版使用随站点打包的 Babylon.js 模块构建能量内核、信息外壳、时间环、碎片、星场、冲击波和首个三维领域。两个渲染器都只读取适配器已经确认的公开状态，不参与规则计算，也不写入存档。它们不下载纹理、远程脚本或模型；WebGL 不可用时会显示静态降级景观，系统启用“减少动态效果”时会降低动画速度。

存档会持久化最多 64 个 actor、显式 source → actor 身份映射、最多 256 条时间线及其事件历史、双向 sequence 和最近 256 个命令响应。刷新页面后，相同 `source + id` 且内容相同的重投会返回原响应；同一 ID 改变内容或尝试把已绑定 source 换到其他 actor 都会被拒绝。

## 状态与重置

默认 actor 是本地不透明标识 `browser-player`，控制 source 是 `esip://browser/control`，游戏 source 是 `esip://browser/sandbox`，存储键沿用 `evolution-sandbox.esip.browser.v1`。这个默认值是兼容旧浏览器存档的别名，不对应登录名。键名也不等于内部 schema 版本；v0.3 的单 actor 记录和 schema 2 多 actor 记录会显式迁移为 schema 3，其中新增的物质库存与凝聚、稳定、回收里程碑从零开始。未知字段、错误类型、阶段/维度、身份绑定或内容包边界不一致时仍会停止加载，不会静默覆盖存档。

“本地重开”是浏览器平台的本地管理操作，不是跨平台 ESIP 命令。它把当前 actor 状态恢复为内容包初始值，但 revision 继续递增，避免旧命令在重置后意外生效。普通行为、时间线建立、加入和注册表查询都经过 ESIP。注册表查询携带 `afterRevision` 时只返回其后的事件；请求点早于本地保留窗口时返回完整目录并标记 `truncated: true`。

## 安全边界

- 路由器只授权固定的浏览器 control source 向固定 sandbox target 发送 command/query。
- 游戏适配器校验 source → actor 绑定、universe、realm、timeline、状态/注册表 revision、参数和内容规则。
- localStorage 只保存公开游戏数值和幂等元数据，不保存令牌、密码、API key 或 Luanti 玩家数据库。
- 页面 CSP 只允许同源脚本、样式和请求，没有内联脚本、跨域 API 或远程模型调用。
- 浏览器适配器不直接连接 Luanti sidecar；当前 sidecar 继续保持无 CORS、Bearer 认证和回环监听。

这个实现证明了第二种游戏状态权威端可以复用 ESIP 的多人时间线和断线追赶语义，但同页 `MemoryRouter` 不是持久消息系统，也不证明跨主机传输。事件只保留最近 256 条；生产 broker 仍需定义长期保留、删除策略、访问控制，以及由可信服务完成的跨平台身份绑定。
