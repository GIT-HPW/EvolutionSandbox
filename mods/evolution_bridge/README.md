# evolution_bridge

`evolution_bridge` 把真实 Luanti `evolution_core` 玩家状态接到本机 Node ESIP sidecar。Luanti 仍是状态权威端，sidecar 只负责验证、排队和传输。

安全边界：

- 只允许 `http://127.0.0.1:<port>` 或 `http://[::1]:<port>`；
- 必须配置至少 32 字符的 Bearer 令牌；
- 只消费状态/注册表查询、固定行为以及时间线创建/加入消息；
- 只执行 7 个 `evolution_core` 固定行为，不接受参数或任意 Lua；
- 通过玩家 revision、命令 ID 缓存和 sidecar 租约防止重复执行；
- 通过 `evolution_core` 的持久身份注册表把不透明 actor ID 解析为在线玩家，不把玩家名写入 ESIP 消息；
- 只操作目标玩家 metadata 和本模组的受控 world mod storage，不读取认证数据库或原始世界数据库。

必须在 Luanti 配置中加入：

```text
secure.http_mods = evolution_bridge
evolution_bridge_token = <与 EVOLUTION_ESIP_TOKEN 相同的随机令牌>
```

完整启动步骤见 [`docs/interop.md`](../../docs/interop.md)。
