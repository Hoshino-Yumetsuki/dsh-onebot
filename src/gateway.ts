import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'
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
  if (
    patch.transport !== undefined &&
    !['forward-ws', 'reverse-ws', 'http'].includes(patch.transport)
  ) {
    throw new Error('onebot: invalid transport')
  }
  for (const key of ['url', 'listenHost', 'listenPath'] as const) {
    if (patch[key] !== undefined && patch[key].trim() === '')
      throw new Error(`onebot: ${key} must not be empty`)
  }
  if (
    patch.listenPort !== undefined &&
    (!Number.isSafeInteger(patch.listenPort) || patch.listenPort < 1 || patch.listenPort > 65535)
  ) {
    throw new Error('onebot: listenPort must be an integer between 1 and 65535')
  }
  for (const key of ['reconnectInterval', 'heartbeatTimeout'] as const) {
    if (patch[key] !== undefined && (!Number.isSafeInteger(patch[key]) || patch[key] < 0)) {
      throw new Error(`onebot: ${key} must be a non-negative safe integer`)
    }
  }
  if (
    patch.requestTimeout !== undefined &&
    (!Number.isSafeInteger(patch.requestTimeout) || patch.requestTimeout < 1)
  ) {
    throw new Error('onebot: requestTimeout must be a positive safe integer')
  }
  for (const key of ['userAccessMode', 'groupAccessMode'] as const) {
    if (patch[key] !== undefined && !['disabled', 'allowlist', 'blocklist'].includes(patch[key])) {
      throw new Error(`onebot: invalid ${key}`)
    }
  }
  for (const key of ['userIds', 'groupIds'] as const) {
    if (
      patch[key] !== undefined &&
      (!Array.isArray(patch[key]) || patch[key].some((id) => typeof id !== 'string'))
    ) {
      throw new Error(`onebot: ${key} must be an array of strings`)
    }
  }
}

interface WebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
}

export function registerOneBotConfigGateway(ctx: Context, bridge: OneBotSettingsBridge): void {
  let settings: SettingsProvider | undefined
  ctx.inject(['settings'], (sctx) => {
    settings = sctx.settings
    return () => {
      settings = undefined
    }
  })
  ctx.inject(['webServer'], (sctx) =>
    sctx.effect(
      () =>
        sctx.webServer.register({
          kind: 'prefix',
          path: '/onebot/api',
          handler: (request, response) => handleRequest(request, response, bridge, settings)
        }),
      'onebot: settings API'
    )
  )
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  bridge: OneBotSettingsBridge,
  settings: SettingsProvider | undefined
): Promise<void> {
  if (request.method !== 'POST')
    return writeJson(response, 405, failure('method-not-allowed', 'POST only'))
  const contentType = request.headers['content-type']
  if (
    typeof contentType !== 'string' ||
    !contentType.toLowerCase().startsWith('application/json')
  ) {
    return writeJson(response, 415, failure('unsupported-media-type', 'application/json required'))
  }
  const host = request.headers.host
  const origin = request.headers.origin
  const fetchSite = request.headers['sec-fetch-site']
  if (
    host === undefined ||
    !isLoopbackHost(host) ||
    fetchSite === 'cross-site' ||
    (origin !== undefined && new URL(origin).host !== host)
  ) {
    return writeJson(
      response,
      403,
      failure('forbidden-origin', 'trusted same-origin request required')
    )
  }
  const pathname = new URL(request.url ?? '/', 'http://dsh.internal').pathname
  const method = pathname.startsWith('/onebot/api/') ? pathname.slice('/onebot/api/'.length) : ''
  try {
    if (method === 'get') {
      writeJson(
        response,
        200,
        success({ config: editable(bridge.source()), writable: settings?.writable === true })
      )
      return
    }
    if (method === 'set') {
      const body = await readJson(request)
      const patch = body.patch
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        throw new Error('onebot: set requires a plain-object patch')
      }
      validatePatch(patch as OneBotConfigPatch)
      if (Object.keys(patch).length > 0) {
        if (settings === undefined) throw new Error('onebot: settings service is unavailable')
        await settings.update(ONEBOT_NS, patch as OneBotConfigPatch)
      }
      writeJson(
        response,
        200,
        success({ config: editable(bridge.source()), writable: settings?.writable === true })
      )
      return
    }
    writeJson(response, 404, failure('not-found', 'unknown OneBot settings method'))
  } catch (error) {
    writeJson(
      response,
      400,
      failure('invalid-request', error instanceof Error ? error.message : String(error))
    )
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 64 * 1024) throw new Error('onebot: settings request is too large')
    chunks.push(buffer)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('onebot: settings request must be a JSON object')
  }
  return value as Record<string, unknown>
}
function isLoopbackHost(authority: string): boolean {
  try {
    const hostname = new URL(`http://${authority}`).hostname
    if (hostname === 'localhost' || hostname === '[::1]') return true
    const parts = hostname.split('.')
    return (
      parts.length === 4 &&
      parts[0] === '127' &&
      parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    )
  } catch {
    return false
  }
}

function success(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value }
}

function failure(
  code: string,
  message: string
): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } }
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
