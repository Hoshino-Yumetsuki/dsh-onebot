import z from '@deepseek-ai/schemastery'
import type { OneBotConfig } from './types'

export const Config: z<OneBotConfig> = z.object({
  url: z.string().default('ws://127.0.0.1:3001').description('OneBot v11 正向 WebSocket 地址'),
  accessTokenRef: z.string().default('ONEBOT_ACCESS_TOKEN').description('访问令牌的凭据引用'),
  reconnectInterval: z
    .number()
    .default(5000)
    .min(0)
    .step(1)
    .description('连接断开后的重连间隔（毫秒）'),
  respondToPrivate: z.boolean().default(true).description('是否回复私聊消息'),
  respondToGroup: z.boolean().default(true).description('是否回复群聊消息'),
  groupMentionOnly: z.boolean().default(true).description('群聊中是否仅响应提及机器人的消息')
}) as z<OneBotConfig>

export const defaultConfig: OneBotConfig = {
  url: 'ws://127.0.0.1:3001',
  accessTokenRef: 'ONEBOT_ACCESS_TOKEN',
  reconnectInterval: 5000,
  respondToPrivate: true,
  respondToGroup: true,
  groupMentionOnly: true
}
