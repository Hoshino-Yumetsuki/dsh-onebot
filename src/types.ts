export type OneBotTransport = 'forward-ws' | 'reverse-ws' | 'http'
export type OneBotAccessMode = 'disabled' | 'allowlist' | 'blocklist'

export interface OneBotConfig {
  transport: OneBotTransport
  url: string
  listenHost: string
  listenPort: number
  listenPath: string
  accessTokenRef: string
  webhookSecretRef: string
  reconnectInterval: number
  requestTimeout: number
  heartbeatTimeout: number
  commandPrefix: string
  respondToPrivate: boolean
  respondToGroup: boolean
  groupMentionOnly: boolean
  userAccessMode: OneBotAccessMode
  userIds: string[]
  groupAccessMode: OneBotAccessMode
  groupIds: string[]
}

export type OneBotEditableConfig = OneBotConfig
export type OneBotConfigPatch = Partial<OneBotConfig>
