import WebSocket, { type RawData } from 'ws'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installModelSelection, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { OneBotConfig } from './types'

interface OneBotMessageEvent {
  post_type: 'message'
  message_type: 'private' | 'group'
  self_id: string | number
  user_id: string | number
  group_id?: string | number
  raw_message: string
  message?: unknown
}

interface PendingRequest {
  resolve(): void
  reject(error: Error): void
}

interface SessionEntry {
  handle: AgentHandle
  tail: Promise<void>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function messageEvent(value: unknown): OneBotMessageEvent | undefined {
  const item = record(value)
  if (item?.post_type !== 'message') return undefined
  if (item.message_type !== 'private' && item.message_type !== 'group') return undefined
  if (typeof item.self_id !== 'string' && typeof item.self_id !== 'number') return undefined
  if (typeof item.user_id !== 'string' && typeof item.user_id !== 'number') return undefined
  if (item.message_type === 'group' && typeof item.group_id !== 'string' && typeof item.group_id !== 'number') {
    return undefined
  }
  const rawMessage = typeof item.raw_message === 'string'
    ? item.raw_message
    : typeof item.message === 'string' ? item.message : undefined
  if (rawMessage === undefined) return undefined
  return { ...item, raw_message: rawMessage } as unknown as OneBotMessageEvent
}

function mentionsSelf(event: OneBotMessageEvent): boolean {
  const id = String(event.self_id)
  if (new RegExp(`\\[CQ:at,qq=${id}(?:,[^\\]]*)?\\]`).test(event.raw_message)) return true
  if (!Array.isArray(event.message)) return false
  return event.message.some((segment) => {
    const item = record(segment)
    const data = record(item?.data)
    return item?.type === 'at' && String(data?.qq) === id
  })
}

function promptText(event: OneBotMessageEvent): string {
  const self = String(event.self_id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return event.raw_message
    .replace(new RegExp(`\\[CQ:at,qq=${self}(?:,[^\\]]*)?\\]`, 'g'), '')
    .trim()
}

function sessionKey(event: OneBotMessageEvent): string {
  const group = event.message_type === 'group' ? String(event.group_id) : '-'
  return ['onebot', event.self_id, 'onebot-v11', event.message_type, group, event.user_id]
    .map((part) => encodeURIComponent(String(part)))
    .join(':')
}

function finalText(events: readonly SessionEvent[], firstSeq: number): string {
  let currentTurn: number | undefined
  let lastTurn: number | undefined
  let text = ''
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      currentTurn = event.data.turn
      continue
    }
    if (event.type === 'assistant/message' && event.data.turn === currentTurn) {
      const joined = event.data.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (joined !== '') text = joined
      continue
    }
    if (event.type === 'turn/end' && event.data.turn === currentTurn) lastTurn = currentTurn
  }
  return lastTurn === undefined ? '' : text
}

export class OneBotClient {
  private socket: WebSocket | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private connectionGeneration = 0
  private nextEcho = 1
  private readonly pending = new Map<string, PendingRequest>()
  private readonly sessions = new Map<string, SessionEntry>()
  private readonly sessionPromises = new Map<string, Promise<SessionEntry>>()

  constructor(
    private readonly ctx: Context,
    private readonly source: () => OneBotConfig
  ) {}

  start(): void {
    this.stopped = false
    void this.connect()
  }

  restart(): void {
    if (this.stopped) return
    this.connectionGeneration += 1
    this.clearReconnect()
    const socket = this.socket
    this.socket = undefined
    socket?.close()
    this.failPending(new Error('onebot: connection restarted'))
    void this.connect()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.connectionGeneration += 1
    this.clearReconnect()
    const socket = this.socket
    this.socket = undefined
    socket?.close()
    this.failPending(new Error('onebot: connection closed'))
    await Promise.allSettled([...this.sessionPromises.values()])
    await Promise.allSettled([...this.sessions.values()].map((entry) => entry.handle.dispose()))
    this.sessions.clear()
    this.sessionPromises.clear()
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.connect()
    }, this.source().reconnectInterval)
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.socket !== undefined) return
    const generation = this.connectionGeneration
    const config = this.source()
    try {
      const credential = await this.ctx.get('credentials')?.resolve(credentialRef(config.accessTokenRef))
      if (this.stopped || generation !== this.connectionGeneration || this.socket !== undefined) return
      const socket = new WebSocket(config.url, {
        headers: credential === undefined ? undefined : { Authorization: `Bearer ${credential.value}` }
      })
      this.socket = socket
      socket.on('message', (data) => { this.receive(data) })
      socket.on('error', (error) => {
        this.ctx.logger.warn(`onebot: WebSocket error: ${error.message}`)
      })
      socket.on('close', () => {
        if (this.socket !== socket) return
        this.socket = undefined
        this.failPending(new Error('onebot: connection closed'))
        this.scheduleReconnect()
      })
    } catch (error) {
      if (generation !== this.connectionGeneration) return
      this.ctx.logger.warn(`onebot: connection failed: ${String(error)}`)
      this.scheduleReconnect()
    }
  }

  private receive(data: RawData): void {
    let value: unknown
    try {
      const json = typeof data === 'string'
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString()
          : Array.isArray(data)
            ? Buffer.concat(data).toString()
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString()
      value = JSON.parse(json)
    } catch {
      this.ctx.logger.warn('onebot: ignored invalid JSON frame')
      return
    }
    const item = record(value)
    if (typeof item?.echo === 'string' || typeof item?.echo === 'number') {
      const echo = String(item.echo)
      const pending = this.pending.get(echo)
      if (pending === undefined) return
      this.pending.delete(echo)
      if (item.status === 'ok' && item.retcode === 0) pending.resolve()
      else pending.reject(new Error(`onebot: API request failed (${String(item.retcode)})`))
      return
    }
    const event = messageEvent(value)
    if (event === undefined || !this.accepts(event)) return
    const text = promptText(event)
    if (text === '') return
    const key = sessionKey(event)
    void this.enqueue(key, event, text).catch((error: unknown) => {
      this.ctx.logger.warn(`onebot: message handling failed: ${String(error)}`)
    })
  }

  private accepts(event: OneBotMessageEvent): boolean {
    const config = this.source()
    if (event.message_type === 'private') return config.respondToPrivate
    return config.respondToGroup && (!config.groupMentionOnly || mentionsSelf(event))
  }

  private async enqueue(key: string, event: OneBotMessageEvent, text: string): Promise<void> {
    const entry = await this.session(key)
    if (this.stopped) throw new Error('onebot: client is stopped')
    const work = entry.tail.then(() => this.run(entry, event, text))
    entry.tail = work.catch(() => {})
    await work
  }

  private session(key: string): Promise<SessionEntry> {
    const existing = this.sessions.get(key)
    if (existing !== undefined) return Promise.resolve(existing)
    const pending = this.sessionPromises.get(key)
    if (pending !== undefined) return pending
    const creation = this.createSession(key).finally(() => this.sessionPromises.delete(key))
    this.sessionPromises.set(key, creation)
    return creation
  }

  private async createSession(key: string): Promise<SessionEntry> {
    if (this.stopped) throw new Error('onebot: client is stopped')
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(key),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
      }
    })
    if (this.stopped) {
      await handle.dispose()
      throw new Error('onebot: client is stopped')
    }
    const entry = { handle, tail: Promise.resolve() }
    this.sessions.set(key, entry)
    return entry
  }

  private async run(entry: SessionEntry, event: OneBotMessageEvent, text: string): Promise<void> {
    const { agent } = entry.handle
    if (this.stopped) throw new Error('onebot: client is stopped')
    await agent.whenIdle()
    if (this.stopped) throw new Error('onebot: client is stopped')
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' }
    }))
    await agent.whenIdle()
    if (this.stopped) throw new Error('onebot: client is stopped')
    const reply = finalText(agent.session.events, firstSeq)
    if (reply === '') return
    if (event.message_type === 'private') {
      await this.request('send_private_msg', { user_id: event.user_id, message: reply })
    } else {
      await this.request('send_group_msg', { group_id: event.group_id, message: reply })
    }
  }

  private request(action: string, params: Record<string, unknown>): Promise<void> {
    const socket = this.socket
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('onebot: connection is not open'))
    }
    const echo = String(this.nextEcho++)
    return new Promise<void>((resolve, reject) => {
      this.pending.set(echo, { resolve, reject })
      socket.send(JSON.stringify({ action, params, echo }), (error) => {
        if (error === undefined) return
        this.pending.delete(echo)
        reject(error)
      })
    })
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }
}
