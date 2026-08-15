# dsh-onebot

DeepSeek Harness（DSH）的 OneBot v11 适配器，支持 HTTP、正向和反向 WebSocket

## Transport

- `forward-ws`（默认）：连接 OneBot 正向 WebSocket，事件和 action 共用连接
- `reverse-ws`：监听 WebSocket，等待 OneBot 反向连接
- `http`：以 `url` 调用标准 HTTP API，同时在配置的监听地址提供 HTTP POST webhook

四种标准 `post_type` 是 `message`、`notice`、`request`、`meta_event`；只有 `message` 创建 Agent 交互。
传输层接受并解析四种标准 `post_type`；只有 `message` 事件进入 Agent，其余事件不创建会话或回复。

## 安装

```bash
dsh plugin --profile web add dsh-onebot

## 配置

| 字段                | 默认值                  | 说明                                 |
| ------------------- | ----------------------- | ------------------------------------ |
| `transport`         | `forward-ws`            | `forward-ws`、`reverse-ws` 或 `http` |
| `url`               | `ws://127.0.0.1:3001`   | 正向 WS 地址或 HTTP API base URL     |
| `listenHost`        | `127.0.0.1`             | 反向 WS / webhook 监听地址           |
| `listenPort`        | `3002`                  | 监听端口                             |
| `listenPath`        | `/onebot`               | 监听路径                             |
| `accessTokenRef`    | `ONEBOT_ACCESS_TOKEN`   | 访问令牌的 DSH credential ref        |
| `webhookSecretRef`  | `ONEBOT_WEBHOOK_SECRET` | webhook secret 的 DSH credential ref |
| `reconnectInterval` | `5000`                  | 重连间隔（毫秒）                     |
| `requestTimeout`    | `30000`                 | action 请求超时（毫秒）              |
| `heartbeatTimeout`  | `120000`                | 心跳超时（毫秒），`0` 禁用           |
| `commandPrefix`     | 空                      | 非空时要求此前缀，并从 prompt 移除   |
| `respondToPrivate`  | `true`                  | 响应私聊                             |
| `respondToGroup`    | `true`                  | 响应群聊                             |
| `groupMentionOnly`  | `true`                  | 群聊要求提及机器人                   |
| `userAccessMode`    | `disabled`              | `disabled`、`allowlist`、`blocklist` |
| `userIds`           | `[]`                    | 用户 ID 列表                         |
| `groupAccessMode`   | `disabled`              | `disabled`、`allowlist`、`blocklist` |
| `groupIds`          | `[]`                    | 群 ID 列表                           |

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
    commandPrefix: ''
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

- 回复由会话作用域内的 `onebot_reply` 提交候选；同一轮多次调用时以后一次为准，仅在 Agent 本轮进入 idle 后向当前来源发送一次文本和/或图片。插件不暴露任意 OneBot action，也不会转发 agent loop 的中间助手文本

- 入站图片只接受公网 `http(s)` URL 或带媒体类型的 `data:` URL，限制重定向、总下载时间和字节数后经 DSH attachments 保存 durable ref；不读取 OneBot 机器本地路径，单独 `base64://` 因缺少可信媒体类型而拒绝

- reverse WebSocket / HTTP webhook 绑定非回环地址时，分别必须能解析访问令牌 / webhook 签名密钥，否则监听拒绝启动；WebSocket 与 webhook 入站负载上限均为 1 MiB

- 有 session persistence 时，先以 `list()` 精确判断存在再恢复会话，否则创建一个新会话；恢复会话错误时不会回退。OneBot API 无法删除 DSH 会话历史，历史需在 DSH 侧管理。

## 开发

```powershell
yarn install
yarn lint
yarn build
```

许可证：MPL-2.0
