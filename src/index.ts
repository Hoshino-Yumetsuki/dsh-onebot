import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Config, defaultConfig } from './config'
import { OneBotConfigGateway } from './gateway'
import { OneBotClient } from './onebot'
import type { OneBotConfig } from './types'

export const name = 'onebot'
export const inject = ['agentDefaultModel', 'agents', 'attachments', 'systemPrompt', 'tools']
export const ONEBOT_SETTINGS_NAMESPACE = settingsNamespace('onebot')
export { Config }
export type { OneBotAccessMode, OneBotConfig, OneBotConfigPatch, OneBotEditableConfig, OneBotTransport } from './types'
export { ONEBOT_CONFIG_SERVICE } from './gateway'

export function apply(ctx: Context, config: OneBotConfig = defaultConfig): void {
  let current = () => config
  const client = new OneBotClient(ctx, () => current())
  installSettingsSection(ctx, ONEBOT_SETTINGS_NAMESPACE, Config, config, {
    setSource(source) {
      current = source
    },
    onChange() {
      client.restart()
    }
  })
  new OneBotConfigGateway(ctx, { source: () => current() })
  ctx.effect(() => {
    client.start()
    return () => client.stop()
  }, 'onebot: WebSocket client')
}
