# dsh-onebot

DeepSeek Harness（DSH）的 OneBot v11 适配器，支持 HTTP、正向和反向 WebSocket。仅 `message` 事件与 Agent 交互；`notice`、`request`、`meta_event` 未知事件保留原始负载并进入观测。

## Transport

- `forward-ws`（默认）：连接 OneBot 正向 WebSocket，事件和 action 共用连接
- `reverse-ws`：监听 WebSocket，等待 OneBot 反向连接
- `http`：以 `url` 调用标准 HTTP API，同时在配置的监听地址提供 HTTP POST webhook

四种标准 `post_type` 是 `message`、`notice`、`request`、`meta_event`；只有 `message` 创建 Agent 交互。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `transport` | `forward-ws` | `forward-ws`、`reverse-ws` 或 `http` |
| `url` | `ws://127.0.0.1:3001` | 正向 WS 地址或 HTTP API base URL |
| `listenHost` | `127.0.0.1` | 反向 WS / webhook 监听地址 |
| `listenPort` | `3002` | 监听端口 |
| `listenPath` | `/onebot` | 监听路径 |
| `accessTokenRef` | `ONEBOT_ACCESS_TOKEN` | 访问令牌的 DSH credential ref |
| `webhookSecretRef` | `ONEBOT_WEBHOOK_SECRET` | webhook secret 的 DSH credential ref |
| `reconnectInterval` | `5000` | 重连间隔（毫秒） |
| `requestTimeout` | `30000` | action 请求超时（毫秒） |
| `heartbeatTimeout` | `120000` | 心跳超时（毫秒），`0` 禁用 |
| `commandPrefix` | 空 | 非空时要求此前缀，并从 prompt 移除 |
| `respondToPrivate` | `true` | 响应私聊 |
| `respondToGroup` | `true` | 响应群聊 |
| `groupMentionOnly` | `true` | 群聊要求提及机器人 |
| `userAccessMode` | `disabled` | `disabled`、`allowlist`、`blocklist` |
| `userIds` | `[]` | 用户 ID 列表 |
| `groupAccessMode` | `disabled` | `disabled`、`allowlist`、`blocklist` |
| `groupIds` | `[]` | 群 ID 列表 |

数组在设置 UI 中每行一个 ID，保存时去空白并且去重。token/secret 存入 DSH credentials，配置只保存引用名称。

```yaml
- id: onebot
  name: dsh-onebot
  config:
    transport: forward-ws
    url: ws://127.0.0.1:3001
    listenHost: 127.0.0.1
    listenPort: 3002
    listenPath: /onebot
    accessTokenRef: ONEBOT_ACCESS_TOKEN
    webhookSecretRef: ONEBOT_WEBHOOK_SECRET
    reconnectInterval: 5000
    requestTimeout: 30000
    heartbeatTimeout: 120000
    commandPrefix: ""
    respondToPrivate: true
    respondToGroup: true
    groupMentionOnly: true
    userAccessMode: disabled
    userIds: []
    groupAccessMode: disabled
    groupIds: []
```

## 消息与回复

- 访问控制顺序为私聊/群聊开关、用户名单、群消息的群名单，最后是提及与前缀。ID 转为字符串后进行匹配；空 allowlist 拒绝全部会话，空 blocklist 允许全部会话

- 回复完全由 `onebot_reply` 回复当前来源（文本和/或图片），用 `onebot_action` 执行 OneBot action 和 JSON 参数

- 入站图片只接受 `http(s)` URL 或 `data`/base64，限制重定向和字节数后经 DSH attachments 保存 durable ref

- 有 session persistence 时，先以 `list()` 精确判断存在再恢复会话，否则创建一个新会话；恢复会话错误时不会回退。OneBot API 无法删除 DSH 会话历史，历史需在 DSH 侧管理。

## 开发

```powershell
yarn install
yarn lint
yarn build
```

许可证：MPL-2.0
