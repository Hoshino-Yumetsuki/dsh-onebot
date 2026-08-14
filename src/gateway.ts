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
  'transport',
  'url',
  'listenHost',
  'listenPort',
  'listenPath',
  'accessTokenRef',
  'webhookSecretRef',
  'reconnectInterval',
  'requestTimeout',
  'heartbeatTimeout',
  'commandPrefix',
  'respondToPrivate',
  'respondToGroup',
  'groupMentionOnly',
  'userAccessMode',
  'userIds',
  'groupAccessMode',
  'groupIds'
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
  if (patch.transport !== undefined && !['forward-ws', 'reverse-ws', 'http'].includes(patch.transport)) {
    throw new Error('onebot: invalid transport')
  }
  for (const key of ['url', 'listenHost', 'listenPath'] as const) {
    if (patch[key] !== undefined && patch[key].trim() === '') throw new Error(`onebot: ${key} must not be empty`)
  }
  if (patch.listenPort !== undefined && (!Number.isSafeInteger(patch.listenPort) || patch.listenPort < 1 || patch.listenPort > 65535)) {
    throw new Error('onebot: listenPort must be an integer between 1 and 65535')
  }
  for (const key of ['reconnectInterval', 'heartbeatTimeout'] as const) {
    if (patch[key] !== undefined && (!Number.isSafeInteger(patch[key]) || patch[key] < 0)) {
      throw new Error(`onebot: ${key} must be a non-negative safe integer`)
    }
  }
  if (patch.requestTimeout !== undefined && (!Number.isSafeInteger(patch.requestTimeout) || patch.requestTimeout < 1)) {
    throw new Error('onebot: requestTimeout must be a positive safe integer')
  }
  for (const key of ['userAccessMode', 'groupAccessMode'] as const) {
    if (patch[key] !== undefined && !['disabled', 'allowlist', 'blocklist'].includes(patch[key])) {
      throw new Error(`onebot: invalid ${key}`)
    }
  }
  for (const key of ['userIds', 'groupIds'] as const) {
    if (patch[key] !== undefined && (!Array.isArray(patch[key]) || patch[key].some((id) => typeof id !== 'string'))) {
      throw new Error(`onebot: ${key} must be an array of strings`)
    }
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
