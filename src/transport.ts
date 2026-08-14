import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import type { OneBotConfig } from './types'
import type { OneBotActionResponse } from './protocol'

export interface OneBotTransport {
  start(): void
  restart(): void
  stop(): Promise<void>
  request(action: string, params: Record<string, unknown>): Promise<unknown>
}

export interface CredentialResolvers {
  accessToken(): Promise<string | undefined>
  webhookSecret(): Promise<string | undefined>
}

interface Logger {
  warn(message: string): void
}
interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}
const MAX_EVENT_BYTES = 1024 * 1024

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  )
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString()
  if (Array.isArray(data)) return Buffer.concat(data).toString()
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString()
}

function normalizedPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

export class OneBotTransportRuntime implements OneBotTransport {
  private socket: WebSocket | undefined
  private eventSocket: WebSocket | undefined
  private server: Server | undefined
  private wsServer: WebSocketServer | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private stopped = true
  private nextEcho = 1
  private readonly pending = new Map<string, Pending>()
  private resetTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly source: () => OneBotConfig,
    private readonly sink: (value: unknown) => void,
    private readonly credentials: CredentialResolvers,
    private readonly logger: Logger = console
  ) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.open()
  }

  restart(): void {
    if (this.stopped) return
    this.resetTail = this.resetTail.then(() => this.reset(true))
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.resetTail = this.resetTail.then(() => this.reset(false))
    await this.resetTail
  }

  async request(action: string, params: Record<string, unknown>): Promise<unknown> {
    const config = this.source()
    if (config.transport === 'http') {
      const token = await this.credentials.accessToken()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.requestTimeout)
      try {
        const base = config.url.endsWith('/') ? config.url : `${config.url}/`
        const response = await fetch(new URL(encodeURIComponent(action), base), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
          },
          body: JSON.stringify(params),
          signal: controller.signal
        })
        if (!response.ok) throw new Error(`onebot: HTTP API failed (${response.status})`)
        return this.actionData(await response.json())
      } finally {
        clearTimeout(timer)
      }
    }
    const socket = this.socket
    if (socket === undefined || socket.readyState !== WebSocket.OPEN)
      throw new Error('onebot: API connection is not open')
    const echo = String(this.nextEcho++)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo)
        reject(new Error(`onebot: API request timed out after ${config.requestTimeout}ms`))
      }, config.requestTimeout)
      this.pending.set(echo, { resolve, reject, timer })
      socket.send(JSON.stringify({ action, params, echo }), (error) => {
        if (error == null) return
        const pending = this.pending.get(echo)
        if (pending === undefined) return
        clearTimeout(pending.timer)
        this.pending.delete(echo)
        reject(error)
      })
    })
  }

  private actionData(value: unknown): unknown {
    const response = value as Partial<OneBotActionResponse>
    if (response?.status !== 'ok' || response.retcode !== 0) {
      throw new Error(
        `onebot: API request failed (${String(response?.retcode)}): ${response?.wording ?? response?.message ?? ''}`
      )
    }
    return response.data
  }

  private async open(): Promise<void> {
    const generation = this.generation
    try {
      const mode = this.source().transport
      if (mode === 'forward-ws') await this.openForward(generation)
      else await this.openServer(generation, mode)
    } catch (error) {
      if (!this.stopped && generation === this.generation) {
        this.logger.warn(`onebot: transport failed: ${String(error)}`)
        this.scheduleReconnect()
      }
    }
  }

  private async openForward(generation: number): Promise<void> {
    const token = await this.credentials.accessToken()
    if (this.stopped || generation !== this.generation) return
    const socket = new WebSocket(this.source().url, {
      headers: token === undefined ? undefined : { Authorization: `Bearer ${token}` },
      maxPayload: MAX_EVENT_BYTES
    })
    this.socket = socket
    socket.on('message', (data) => this.receive(data))
    socket.on('error', (error) => this.logger.warn(`onebot: WebSocket error: ${error.message}`))
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = undefined
      this.failPending(new Error('onebot: API connection closed'))
      this.scheduleReconnect()
    })
  }

  private async openServer(generation: number, mode: 'reverse-ws' | 'http'): Promise<void> {
    const config = this.source()
    const [token, secret] = await Promise.all([
      this.credentials.accessToken(),
      this.credentials.webhookSecret()
    ])
    if (!isLoopbackHost(config.listenHost)) {
      if (mode === 'reverse-ws' && token === undefined) {
        throw new Error(
          'onebot: access token is required when reverse WebSocket listens beyond loopback'
        )
      }
      if (mode === 'http' && secret === undefined) {
        throw new Error('onebot: webhook secret is required when HTTP listens beyond loopback')
      }
    }
    if (this.stopped || generation !== this.generation) return
    const path = normalizedPath(config.listenPath)
    const server = createServer((request, response) => {
      if (mode === 'http') void this.webhook(request, response, path, secret)
      else {
        response.statusCode = 404
        response.end()
      }
    })
    this.server = server
    if (mode === 'reverse-ws') {
      const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_EVENT_BYTES })
      this.wsServer = wsServer
      server.on('upgrade', (request, socket, head) => {
        if (
          new URL(request.url ?? '/', 'http://localhost').pathname !== path ||
          !this.authorized(request, token)
        ) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
          socket.destroy()
          return
        }
        const role = request.headers['x-client-role']
        const selfId = request.headers['x-self-id']
        if (
          (role !== 'API' && role !== 'Event' && role !== 'Universal') ||
          typeof selfId !== 'string'
        ) {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
          socket.destroy()
          return
        }
        wsServer.handleUpgrade(request, socket, head, (webSocket) =>
          this.acceptReverse(webSocket, role)
        )
      })
    }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.listenPort, config.listenHost, resolve)
    })
  }

  private acceptReverse(socket: WebSocket, role: 'API' | 'Event' | 'Universal'): void {
    if (role === 'API' || role === 'Universal') {
      this.socket?.close()
      this.socket = socket
    }
    if (role === 'Event' || role === 'Universal') {
      this.eventSocket?.close()
      this.eventSocket = socket
    }
    socket.on('message', (data) => this.receive(data))
    socket.on('error', (error) =>
      this.logger.warn(`onebot: reverse WebSocket error: ${error.message}`)
    )
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = undefined
        this.failPending(new Error('onebot: API connection closed'))
      }
      if (this.eventSocket === socket) this.eventSocket = undefined
    })
  }

  private authorized(request: IncomingMessage, token: string | undefined): boolean {
    if (token === undefined) return true
    return request.headers.authorization === `Bearer ${token}`
  }

  private async webhook(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    secret: string | undefined
  ): Promise<void> {
    try {
      if (
        request.method !== 'POST' ||
        new URL(request.url ?? '/', 'http://localhost').pathname !== path
      ) {
        response.statusCode = 404
        response.end()
        return
      }
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        length += buffer.length
        if (length > 1024 * 1024) throw new Error('onebot: webhook body is too large')
        chunks.push(buffer)
      }
      const body = Buffer.concat(chunks)
      if (secret !== undefined) {
        const actual = request.headers['x-signature']
        const expected = `sha1=${createHmac('sha1', secret).update(body).digest('hex')}`
        if (
          typeof actual !== 'string' ||
          actual.length !== expected.length ||
          !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
        ) {
          response.statusCode = 401
          response.end()
          return
        }
      }
      const value: unknown = JSON.parse(body.toString())
      const selfId = (value as { self_id?: unknown })?.self_id
      const headerId = request.headers['x-self-id']
      if (headerId !== undefined && String(selfId) !== headerId) {
        response.statusCode = 400
        response.end()
        return
      }
      this.observeEvent(value)
      response.statusCode = 204
      response.end()
    } catch (error) {
      this.logger.warn(`onebot: webhook rejected: ${String(error)}`)
      if (!response.headersSent) response.statusCode = 400
      response.end()
    }
  }

  private receive(data: RawData): void {
    let value: unknown
    try {
      value = JSON.parse(rawText(data))
    } catch {
      this.logger.warn('onebot: ignored invalid JSON frame')
      return
    }
    const echo = (value as { echo?: unknown })?.echo
    if (typeof echo === 'string' || typeof echo === 'number') {
      const pending = this.pending.get(String(echo))
      if (pending === undefined) return
      this.pending.delete(String(echo))
      clearTimeout(pending.timer)
      try {
        pending.resolve(this.actionData(value))
      } catch (error) {
        pending.reject(error as Error)
      }
      return
    }
    this.observeEvent(value)
  }

  private observeEvent(value: unknown): void {
    const event = value as { post_type?: unknown; meta_event_type?: unknown }
    if (event.post_type === 'meta_event' && event.meta_event_type === 'heartbeat')
      this.armHeartbeat()
    this.sink(value)
  }

  private armHeartbeat(): void {
    const timeout = this.source().heartbeatTimeout
    if (this.heartbeatTimer !== undefined) clearTimeout(this.heartbeatTimer)
    if (timeout === 0) {
      this.heartbeatTimer = undefined
      return
    }
    this.heartbeatTimer = setTimeout(() => {
      this.logger.warn(`onebot: heartbeat timed out after ${timeout}ms`)
      if (this.source().transport === 'forward-ws') this.restart()
      else this.eventSocket?.close()
    }, timeout)
  }

  private scheduleReconnect(): void {
    if (
      this.stopped ||
      this.source().transport !== 'forward-ws' ||
      this.reconnectTimer !== undefined
    )
      return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.open()
    }, this.source().reconnectInterval)
  }

  private async reset(reopen: boolean): Promise<void> {
    this.generation += 1
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer !== undefined) clearTimeout(this.heartbeatTimer)
    this.reconnectTimer = this.heartbeatTimer = undefined
    const socket = this.socket
    const eventSocket = this.eventSocket
    this.socket = this.eventSocket = undefined
    socket?.close()
    if (eventSocket !== socket) eventSocket?.close()
    this.wsServer?.close()
    this.wsServer = undefined
    const server = this.server
    this.server = undefined
    if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()))
    this.failPending(new Error('onebot: transport restarted'))
    if (reopen && !this.stopped) await this.open()
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

export function createOneBotTransport(
  source: () => OneBotConfig,
  sink: (value: unknown) => void,
  credentials: CredentialResolvers,
  logger?: Logger
): OneBotTransport {
  return new OneBotTransportRuntime(source, sink, credentials, logger)
}
