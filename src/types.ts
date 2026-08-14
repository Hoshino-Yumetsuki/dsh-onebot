export interface OneBotConfig {
  url: string
  accessTokenRef: string
  reconnectInterval: number
  respondToPrivate: boolean
  respondToGroup: boolean
  groupMentionOnly: boolean
}

export type OneBotEditableConfig = OneBotConfig
export type OneBotConfigPatch = Partial<OneBotConfig>
