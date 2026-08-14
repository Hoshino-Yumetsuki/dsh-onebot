import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { OneBotConfig, OneBotConfigPatch, OneBotEditableConfig } from './types'

export const ONEBOT_CONFIG_SERVICE = 'onebotConfig'
const ONEBOT_NS = settingsNamespace('onebot')

export interface OneBotSettingsBridge {
  source(): OneBotConfig
}

const editableKeys = new Set<keyof OneBotEditableConfig>([
  'url',
  'accessTokenRef',
  'reconnectInterval',
  'respondToPrivate',
  'respondToGroup',
  'groupMentionOnly'
])

function editable(config: OneBotConfig): OneBotEditableConfig {
  return { ...config }
}

function validatePatch(patch: OneBotConfigPatch): void {
  for (const key of Object.keys(patch)) {
    if (!editableKeys.has(key as keyof OneBotEditableConfig)) {
      throw new Error(`onebot: unknown configuration field "${key}"`)
    }
  }
  if (patch.url !== undefined && patch.url.trim() === '') throw new Error('onebot: url must not be empty')
  if (patch.accessTokenRef !== undefined && patch.accessTokenRef.trim() === '') {
    throw new Error('onebot: accessTokenRef must not be empty')
  }
  if (patch.reconnectInterval !== undefined && (
    !Number.isSafeInteger(patch.reconnectInterval) || patch.reconnectInterval < 0
  )) {
    throw new Error('onebot: reconnectInterval must be a non-negative safe integer')
  }
}

export class OneBotConfigGateway extends TypertRemoteService {
  private settings: SettingsProvider | undefined

  constructor(
    ctx: Context,
    private readonly bridge: OneBotSettingsBridge
  ) {
    super(ctx, ONEBOT_CONFIG_SERVICE)
    markGatewayRemotes(this)
    ctx.inject(['settings'], (sctx) => {
      this.settings = sctx.settings
      return () => {
        this.settings = undefined
      }
    })
  }

  get(): { config: OneBotEditableConfig; writable: boolean } {
    return {
      config: editable(this.bridge.source()),
      writable: this.settings?.writable === true
    }
  }

  async set(
    patch: OneBotConfigPatch
  ): Promise<{ config: OneBotEditableConfig; writable: boolean }> {
    validatePatch(patch)
    if (Object.keys(patch).length > 0) {
      const settings = this.settings
      if (settings === undefined) {
        throw new Error('onebot: settings service is unavailable — configuration cannot be written')
      }
      await settings.update(ONEBOT_NS, patch)
    }
    return this.get()
  }
}

function markGatewayRemotes(instance: OneBotConfigGateway): void {
  for (const method of ['get', 'set'] as const) {
    const implementation = OneBotConfigGateway.prototype[method] as (
      this: OneBotConfigGateway,
      ...args: unknown[]
    ) => unknown
    Remote(method)(implementation, {
      kind: 'method',
      name: method,
      static: false,
      private: false,
      access: {
        has: (value: object) => method in value,
        get: (value: OneBotConfigGateway) => value[method]
      },
      addInitializer(initializer) {
        initializer.call(instance)
      }
    } as ClassMethodDecoratorContext<OneBotConfigGateway, typeof implementation>)
  }
}
