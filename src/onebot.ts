import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installModelSelection, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-attachment'
import { accessAllowed, isMessageEvent, messageContent, messageSegments, parseEvent, sessionKey, type OneBotMessageEvent } from './protocol'
import { saveIncomingImages } from './images'
import { createOneBotTransport, type OneBotTransport } from './transport'
import type { OneBotConfig } from './types'

interface ReplyCandidate {
  text?: string
  images: string[]
}

interface ReplyState {
  active: boolean
  candidate?: ReplyCandidate
}

interface SessionEntry {
  handle: AgentHandle
  tail: Promise<void>
  reply: ReplyState
}


function replyMessageId(value: unknown): string | number {
  if (value !== null && typeof value === 'object' && 'message_id' in value) {
    const id = value.message_id
    if (typeof id === 'string' || typeof id === 'number') return id
  }
  throw new Error('onebot: send action returned no message_id')
}

export class OneBotClient {
  private readonly transport: OneBotTransport
  private readonly sessions = new Map<string, SessionEntry>()
  private readonly sessionPromises = new Map<string, Promise<SessionEntry>>()
  private readonly seenMessageIds = new Set<string>()
  private readonly seenMessageOrder: string[] = []
  private stopped = true

  constructor(
    private readonly ctx: Context,
    private readonly source: () => OneBotConfig
  ) {
    const resolveCredential = async (ref: string): Promise<string | undefined> => {
      const credential = await ctx.get('credentials')?.resolve(credentialRef(ref))
      return credential?.value
    }
    this.transport = createOneBotTransport(source, (value) => this.receive(value), {
      accessToken: () => resolveCredential(source().accessTokenRef),
      webhookSecret: () => resolveCredential(source().webhookSecretRef)
    }, ctx.logger)
  }

  start(): void {
    this.stopped = false
    this.transport.start()
  }

  restart(): void {
    if (!this.stopped) this.transport.restart()
  }

  async stop(): Promise<void> {
    this.stopped = true
    await this.transport.stop()
    await Promise.allSettled([...this.sessionPromises.values()])
    await Promise.allSettled([...this.sessions.values()].map((entry) => entry.tail))
    await Promise.allSettled([...this.sessions.values()].map((entry) => entry.handle.dispose()))
    this.sessions.clear()
    this.sessionPromises.clear()
  }

  private receive(value: unknown): void {
    const event = parseEvent(value)
    if (event === undefined) {
      this.ctx.logger.warn('onebot: ignored malformed event')
      return
    }
    if (!isMessageEvent(event)) return
    if (event.post_type === 'message_sent' || !accessAllowed(event, this.source()) || this.duplicate(event)) return
    const config = this.source()
    let text = messageContent(event)
    if (config.commandPrefix !== '') text = text.slice(config.commandPrefix.length).trimStart()
    const imageSources = messageSegments(event)
      .filter((segment) => segment.type === 'image')
      .map((segment) => typeof segment.data.url === 'string' ? segment.data.url : segment.data.file)
      .filter((source): source is string => typeof source === 'string' && /^(?:https?:|data:|base64:\/\/)/i.test(source))
    if (text === '' && imageSources.length === 0) return
    const key = sessionKey(event)
    void this.enqueue(key, event, text, imageSources).catch((error: unknown) => {
      this.ctx.logger.warn(`onebot: message handling failed: ${String(error)}`)
    })
  }

  private duplicate(event: OneBotMessageEvent): boolean {
    if (event.message_id === undefined) return false
    const key = `${event.self_id}:${event.message_type}:${event.message_id}`
    if (this.seenMessageIds.has(key)) return true
    this.seenMessageIds.add(key)
    this.seenMessageOrder.push(key)
    if (this.seenMessageOrder.length > 4096) {
      const oldest = this.seenMessageOrder.shift()
      if (oldest !== undefined) this.seenMessageIds.delete(oldest)
    }
    return false
  }

  private async enqueue(key: string, event: OneBotMessageEvent, text: string, images: string[]): Promise<void> {
    const entry = await this.session(key, event)
    if (this.stopped) throw new Error('onebot: client is stopped')
    const work = entry.tail.then(() => this.run(entry, event, text, images))
    entry.tail = work.catch(() => {})
    await work
  }

  private session(key: string, event: OneBotMessageEvent): Promise<SessionEntry> {
    const existing = this.sessions.get(key)
    if (existing !== undefined) return Promise.resolve(existing)
    const pending = this.sessionPromises.get(key)
    if (pending !== undefined) return pending
    const creation = this.createSession(key, event).finally(() => this.sessionPromises.delete(key))
    this.sessionPromises.set(key, creation)
    return creation
  }

  private async createSession(key: string, event: OneBotMessageEvent): Promise<SessionEntry> {
    if (this.stopped) throw new Error('onebot: client is stopped')
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const sessionId = SessionId(key)
    const reply: ReplyState = { active: false }
    const setup = (agentCtx: Context): void => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
      agentCtx.systemPrompt.context({
        name: 'onebot:message-source',
        order: 100,
        text: `OneBot v11 message source: self_id=${String(event.self_id)}, message_type=${event.message_type}, user_id=${String(event.user_id)}${event.group_id === undefined ? '' : `, group_id=${String(event.group_id)}`}. Reply only by calling onebot_reply.`
      })
      agentCtx.tools.register(this.replyTool(reply))
    }
    const options = { agentOptions: { provider: selection.provider, model: selection.model }, setup }
    const persistence = this.ctx.get('sessionPersistence')
    const exists = persistence === undefined
      ? false
      : (await persistence.list()).some((header) => header.id === sessionId)
    const handle = exists
      ? await this.ctx.agents.resume({ resumeSessionId: sessionId, ...options })
      : await this.ctx.agents.create({ sessionId, meta: { cwd: process.cwd() }, ...options })
    if (this.stopped) {
      await handle.dispose()
      throw new Error('onebot: client is stopped')
    }
    const entry = { handle, tail: Promise.resolve(), reply }
    this.sessions.set(key, entry)
    return entry
  }

  private replyTool(state: ReplyState) {
    return defineTool({
      name: 'onebot_reply',
      description: 'Set the final reply for the current OneBot turn. Later calls replace the earlier candidate.',
      parameters: {
        text: { type: 'string', description: 'Reply text. Omit when sending only images.' },
        images: { type: 'array', items: { type: 'string' }, description: 'Optional image sources accepted by the OneBot implementation.' }
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }]
      },
      execute: async (args) => {
        if (!state.active) throw new Error('onebot_reply is only available while processing an inbound OneBot message')
        const images = args.images ?? []
        if ((args.text === undefined || args.text === '') && images.length === 0) {
          throw new Error('onebot_reply requires text or at least one image')
        }
        state.candidate = { text: args.text, images }
        return 'Final OneBot reply queued; a later onebot_reply call in this turn replaces it.'
      }
    })
  }


  private async run(entry: SessionEntry, event: OneBotMessageEvent, text: string, imageSources: string[]): Promise<void> {
    const { agent } = entry.handle
    await agent.whenIdle()
    if (this.stopped) throw new Error('onebot: client is stopped')
    const content: ContentBlock[] = []
    if (text !== '') content.push({ type: 'text', text })
    content.push(...await saveIncomingImages(this.ctx, imageSources, this.source().requestTimeout))
    entry.reply.active = true
    entry.reply.candidate = undefined
    try {
      agent.followup(createUserMessage({
        content,
        source: {
          kind: 'plugin',
          plugin: 'dsh-onebot',
          form: 'notice',
          summary: `OneBot ${event.message_type} message from ${String(event.user_id)}`
        }
      }))
      await agent.whenIdle()
    } finally {
      entry.reply.active = false
    }
    const reply = entry.reply.candidate as ReplyCandidate | undefined
    entry.reply.candidate = undefined
    if (reply === undefined || this.stopped) return
    const segments: Array<{ type: string; data: Record<string, unknown> }> = []
    if (reply.text !== undefined && reply.text !== '') segments.push({ type: 'text', data: { text: reply.text } })
    for (const image of reply.images) segments.push({ type: 'image', data: { file: image } })
    const action = event.message_type === 'private' ? 'send_private_msg' : 'send_group_msg'
    const target = event.message_type === 'private' ? { user_id: event.user_id } : { group_id: event.group_id }
    replyMessageId(await this.transport.request(action, { ...target, message: segments }))
  }
}
