import type { OneBotConfig } from './types'

export interface OneBotSegment {
  type: string
  data: Record<string, unknown>
}

interface OneBotEventBase {
  post_type: string
  time?: number
  self_id?: string | number
  raw: Record<string, unknown>
  [key: string]: unknown
}

export interface OneBotMessageEvent extends OneBotEventBase {
  post_type: 'message' | 'message_sent'
  message_type: 'private' | 'group'
  self_id: string | number
  user_id: string | number
  group_id?: string | number
  message_id?: string | number
  message: string | OneBotSegment[]
  raw_message: string
}

export type OneBotEvent = OneBotMessageEvent | OneBotEventBase

export interface OneBotActionResponse<T = unknown> {
  status: string
  retcode: number
  data: T
  message?: string
  wording?: string
  echo?: unknown
}

type AccessConfig = Pick<
  OneBotConfig,
  | 'respondToPrivate'
  | 'respondToGroup'
  | 'groupMentionOnly'
  | 'commandPrefix'
  | 'userAccessMode'
  | 'userIds'
  | 'groupAccessMode'
  | 'groupIds'
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isId(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

function decodeCq(value: string, parameter = false): string {
  const decoded = value.replace(/&#91;/g, '[').replace(/&#93;/g, ']')
  return (parameter ? decoded.replace(/&#44;/g, ',') : decoded).replace(/&amp;/g, '&')
}

function cqSegments(message: string): OneBotSegment[] {
  const segments: OneBotSegment[] = []
  const pattern = /\[CQ:([^,\]]+)((?:,[^,\]]+=[^,\]]*)*)\]/g
  let offset = 0
  for (const match of message.matchAll(pattern)) {
    const index = match.index
    if (index > offset)
      segments.push({ type: 'text', data: { text: decodeCq(message.slice(offset, index)) } })
    const data: Record<string, unknown> = {}
    for (const item of match[2].slice(1).split(',')) {
      if (!item) continue
      const separator = item.indexOf('=')
      if (separator >= 0) data[item.slice(0, separator)] = decodeCq(item.slice(separator + 1), true)
    }
    segments.push({ type: match[1], data })
    offset = index + match[0].length
  }
  if (offset < message.length)
    segments.push({ type: 'text', data: { text: decodeCq(message.slice(offset)) } })
  return segments
}

function normalizeSegments(value: unknown): OneBotSegment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const segments: OneBotSegment[] = []
  for (const valueSegment of value) {
    if (
      !isRecord(valueSegment) ||
      typeof valueSegment.type !== 'string' ||
      !isRecord(valueSegment.data)
    )
      return undefined
    segments.push({ type: valueSegment.type, data: valueSegment.data })
  }
  return segments
}

export function parseEvent(value: unknown): OneBotEvent | undefined {
  if (!isRecord(value) || typeof value.post_type !== 'string') return undefined
  const raw = value
  if (value.post_type !== 'message' && value.post_type !== 'message_sent')
    return { ...value, raw } as OneBotEvent
  if (
    (value.message_type !== 'private' && value.message_type !== 'group') ||
    !isId(value.self_id) ||
    !isId(value.user_id) ||
    (value.message_id !== undefined && !isId(value.message_id)) ||
    (value.message_type === 'group' && !isId(value.group_id))
  )
    return undefined

  const segments = normalizeSegments(value.message)
  if (
    typeof value.message !== 'string' &&
    segments === undefined &&
    typeof value.raw_message !== 'string'
  )
    return undefined
  const message =
    typeof value.message === 'string' ? value.message : (segments ?? (value.raw_message as string))
  const rawMessage =
    typeof value.raw_message === 'string'
      ? value.raw_message
      : typeof message === 'string'
        ? message
        : message
            .map((segment) =>
              segment.type === 'text' && typeof segment.data.text === 'string'
                ? segment.data.text
                : ''
            )
            .join('')
  return { ...value, message, raw_message: rawMessage, raw } as OneBotMessageEvent
}

export function isMessageEvent(event: OneBotEvent): event is OneBotMessageEvent {
  return (
    (event.post_type === 'message' || event.post_type === 'message_sent') &&
    'message_type' in event &&
    'user_id' in event &&
    'message' in event &&
    'raw_message' in event
  )
}

export function messageSegments(event: OneBotMessageEvent): OneBotSegment[] {
  return typeof event.message === 'string' ? cqSegments(event.message) : event.message
}

export function mentionsSelf(event: OneBotMessageEvent): boolean {
  const selfId = String(event.self_id)
  return messageSegments(event).some(
    (segment) => segment.type === 'at' && String(segment.data.qq) === selfId
  )
}

export function messageContent(event: OneBotMessageEvent): string {
  const selfId = String(event.self_id)
  return messageSegments(event)
    .filter((segment) => segment.type !== 'at' || String(segment.data.qq) !== selfId)
    .map((segment) =>
      segment.type === 'text' && typeof segment.data.text === 'string' ? segment.data.text : ''
    )
    .join('')
    .trim()
}

function idAllowed(
  id: string | number,
  mode: 'disabled' | 'allowlist' | 'blocklist',
  ids: readonly string[]
): boolean {
  if (mode === 'disabled') return true
  const included = ids.includes(String(id))
  return mode === 'allowlist' ? included : !included
}

export function accessAllowed(event: OneBotMessageEvent, config: AccessConfig): boolean {
  if (event.message_type === 'private') {
    if (!config.respondToPrivate) return false
  } else {
    if (!config.respondToGroup || !isId(event.group_id)) return false
  }
  if (!idAllowed(event.user_id, config.userAccessMode, config.userIds)) return false
  if (event.message_type === 'group') {
    if (!idAllowed(event.group_id as string | number, config.groupAccessMode, config.groupIds))
      return false
    if (config.groupMentionOnly && !mentionsSelf(event)) return false
  }
  return config.commandPrefix === '' || messageContent(event).startsWith(config.commandPrefix)
}

export function sessionKey(event: OneBotMessageEvent): string {
  const group = event.message_type === 'group' ? String(event.group_id) : '-'
  return ['onebot', event.self_id, 'onebot-v11', event.message_type, group, event.user_id]
    .map((part) => encodeURIComponent(String(part)))
    .join(':')
}
