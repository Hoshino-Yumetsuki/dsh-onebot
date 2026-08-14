import z from '@deepseek-ai/schemastery'
import type { OneBotConfig } from './types'

export const Config: z<OneBotConfig> = z.object({
  transport: z.union(['forward-ws', 'reverse-ws', 'http']).default('forward-ws').description('传输模式'),
  url: z.string().default('ws://127.0.0.1:3001').description('正向 WebSocket 地址或 HTTP API 基础地址'),
  listenHost: z.string().default('127.0.0.1').description('反向 WebSocket 或 HTTP webhook 监听地址'),
  listenPort: z.number().default(3002).min(1).max(65535).step(1).description('监听端口'),
  listenPath: z.string().default('/onebot').description('反向 WebSocket 或 HTTP webhook 监听路径'),
  accessTokenRef: z.string().default('ONEBOT_ACCESS_TOKEN').description('访问令牌的 DSH 凭据引用'),
  webhookSecretRef: z.string().default('ONEBOT_WEBHOOK_SECRET').description('webhook 签名密钥的 DSH 凭据引用'),
  reconnectInterval: z.number().default(5000).min(0).step(1).description('断线重连间隔（毫秒）'),
  requestTimeout: z.number().default(30000).min(1).step(1).description('OneBot API 请求超时（毫秒）'),
  heartbeatTimeout: z.number().default(120000).min(0).step(1).description('心跳超时（毫秒，0 表示禁用）'),
  commandPrefix: z.string().default('').description('命令前缀（留空表示不启用前缀门控）'),
  respondToPrivate: z.boolean().default(true).description('是否响应私聊消息'),
  respondToGroup: z.boolean().default(true).description('是否响应群聊消息'),
  groupMentionOnly: z.boolean().default(true).description('群聊中是否仅响应提及机器人的消息'),
  userAccessMode: z.union(['disabled', 'allowlist', 'blocklist']).default('disabled').description('用户访问控制模式'),
  userIds: z.array(z.string()).default([]).description('用户 ID 列表'),
  groupAccessMode: z.union(['disabled', 'allowlist', 'blocklist']).default('disabled').description('群访问控制模式'),
  groupIds: z.array(z.string()).default([]).description('群 ID 列表')
}) as z<OneBotConfig>

export const defaultConfig: OneBotConfig = {
  transport: 'forward-ws',
  url: 'ws://127.0.0.1:3001',
  listenHost: '127.0.0.1',
  listenPort: 3002,
  listenPath: '/onebot',
  accessTokenRef: 'ONEBOT_ACCESS_TOKEN',
  webhookSecretRef: 'ONEBOT_WEBHOOK_SECRET',
  reconnectInterval: 5000,
  requestTimeout: 30000,
  heartbeatTimeout: 120000,
  commandPrefix: '',
  respondToPrivate: true,
  respondToGroup: true,
  groupMentionOnly: true,
  userAccessMode: 'disabled',
  userIds: [],
  groupAccessMode: 'disabled',
  groupIds: []
}
