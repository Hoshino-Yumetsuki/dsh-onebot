# dsh-onebot

DeepSeek Harness（DSH）的 OneBot v11 正向 WebSocket 插件。接收私聊和群聊消息，将消息送入 DSH，并在本轮 agent loop 结束后发送最后一条助手文本。

## 安装

```powershell
dsh plugin --profile web add dsh-onebot
```

插件包中的 `cordis.patch.yml` 会注册稳定 row id `onebot`。插件依赖 DSH 的 `agents` 和 `agentDefaultModel` 服务，并使用当前默认模型创建按会话隔离的 agent。

## OneBot 配置

默认连接 `ws://127.0.0.1:3001`。OneBot 实现需开启 v11 正向 WebSocket 服务。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `url` | `ws://127.0.0.1:3001` | OneBot v11 正向 WebSocket 地址 |
| `accessTokenRef` | `ONEBOT_ACCESS_TOKEN` | DSH credentials 中保存访问令牌的引用名 |
| `reconnectInterval` | `5000` | 断线重连间隔，单位毫秒 |
| `respondToPrivate` | `true` | 回复私聊消息 |
| `respondToGroup` | `true` | 回复群聊消息 |
| `groupMentionOnly` | `true` | 群聊仅在提及机器人时响应 |

访问令牌不写入插件配置。将令牌存入 DSH credentials 的 `ONEBOT_ACCESS_TOKEN`（或 `accessTokenRef` 指定的引用）；连接时插件发送 `Authorization: Bearer <token>`。未配置对应 credential 时不发送 Authorization 头。

这些字段也会出现在 DSH 的“设置 → 插件 → 插件配置”中，修改后连接会自动重启。

也可在 profile 的用户 `cordis.patch.yml` 中覆盖整份配置：

```yaml
- id: onebot
  name: dsh-onebot
  config:
    url: ws://127.0.0.1:3001
    accessTokenRef: ONEBOT_ACCESS_TOKEN
    reconnectInterval: 5000
    respondToPrivate: true
    respondToGroup: true
    groupMentionOnly: true
```

## 消息与回复语义

- 处理 `post_type=message` 且 `message_type=private|group` 的事件。
- 私聊按机器人账号和用户隔离会话；群聊还按群与发送者隔离。
- 同一会话的消息串行处理。
- 群聊启用 `groupMentionOnly` 时，支持 CQ 字符串和 segment 数组中的 `at` 判断，并在送入 agent 前移除机器人的 CQ `at`。
- 插件等待 agent 回到 idle，再从本轮 `turn/end` 所属区间取最后一条 `assistant/message` 的文本块。
- 回复使用 `send_private_msg` 或 `send_group_msg`，并通过 OneBot `echo` 匹配 API 响应。

## 开发

```powershell
yarn install
yarn lint
yarn build
```

许可证：MPL-2.0
