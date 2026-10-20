import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { Context } from "@deepseek-ai/cordis"
import Loader from "@deepseek-ai/cordis-plugin-loader"
import SettingsForms from "@deepseek-ai/dsh-settings"
import { WebSocketServer } from "ws"

// Exercise the published entry with the real 0.2.1 Loader, volatile config and forms.
await test("DSH settings update reconnects transport and an existing session resumes", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "dsh-onebot-"))
  const ctx = new Context()
  const upstream = new WebSocketServer({ port: 0, host: "127.0.0.1" })
  const replacement = new WebSocketServer({ port: 0, host: "127.0.0.1" })
  const http = createServer()
  t.after(async () => {
    await ctx.fiber.dispose()
    upstream.close()
    replacement.close()
    http.closeAllConnections()
    await new Promise((resolve) => http.close(resolve))
    await rm(home, { recursive: true, force: true })
  })
  await Promise.all([once(upstream, "listening"), once(replacement, "listening")])
  const calls = []
  let queuedReply
  let inbound
  const sessionId = "onebot:42:onebot-v11:private:-:-:7"
  const handle = {
    agent: {
      async whenIdle() {
        if (queuedReply) {
          await queuedReply.execute({ text: "received", quote: true })
          queuedReply = undefined
        }
      },
      followup(message) {
        inbound = message
        queuedReply = replyTool
      }
    },
    async dispose() {}
  }
  let replyTool
  ctx.provide("agentDefaultModel", {
    currentSelection: () => ({ provider: "test", model: "test" })
  })
  ctx.provide("agents", {
    async create() {
      throw new Error("existing session must not be recreated")
    },
    async resume(options) {
      calls.push(options.resumeSessionId)
      const agentCtx = new Context()
      agentCtx.provide("systemPrompt", { context() {} })
      agentCtx.provide("tools", {
        register(tool) {
          replyTool = tool
        }
      })
      options.setup(agentCtx)
      return handle
    }
  })
  ctx.provide("sessionPersistence", {
    async list() {
      return [{ header: { id: sessionId } }]
    }
  })
  ctx.provide("attachments", { imageLimits: { maxImagesPerMessage: 4 } })
  ctx.provide("systemPrompt", {})
  ctx.provide("tools", {})
  ctx.provide("webServer", {
    register({ handler }) {
      http.on("request", handler)
      return () => http.off("request", handler)
    }
  })
  ctx.provide("profileContext", { home, name: "test", writable: true })
  await ctx.plugin(Loader, { baseUrl: new URL("../", import.meta.url).href })
  let entry
  ctx.provide("configEditor", {
    entries: () => (entry ? [entry] : []),
    configuration: () => (entry ? [{ entry, inherited: {}, override: entry.options.config }] : []),
    async edit(current, change) {
      await current.update({ config: change(current.options.config, {}) })
      await ctx.loader.await()
    }
  })
  await ctx.plugin(SettingsForms)
  const connected = once(upstream, "connection")
  await ctx.loader.create({
    id: "custom-onebot",
    name: "./lib/index.js",
    config: { url: `ws://127.0.0.1:${upstream.address().port}` }
  })
  await ctx.loader.await()
  entry = [...ctx.loader.entries()].find((row) => row.options.id === "custom-onebot")
  assert.ok(entry)
  const [socket] = await connected
  http.listen(0, "127.0.0.1")
  await once(http, "listening")
  const endpoint = `http://127.0.0.1:${http.address().port}/onebot/api`
  const post = async (method, body = {}) => {
    const response = await fetch(`${endpoint}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  assert.equal((await post("get")).value.config.url, `ws://127.0.0.1:${upstream.address().port}`)
  const fiber = entry.fiber
  const reconnected = once(replacement, "connection")
  const updated = await post("set", {
    patch: { url: `ws://127.0.0.1:${replacement.address().port}` }
  })
  assert.equal(updated.ok, true)
  assert.equal(updated.value.config.url, `ws://127.0.0.1:${replacement.address().port}`)
  assert.equal(entry.fiber, fiber, "volatile edit must not remount the plugin")
  const [newSocket] = await reconnected
  const sent = once(newSocket, "message")
  newSocket.send(
    JSON.stringify({
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      self_id: 42,
      user_id: 7,
      message_id: 123,
      message: "hello"
    })
  )
  const [raw] = await sent
  const action = JSON.parse(raw.toString())
  assert.deepEqual(calls, [sessionId])
  assert.equal(inbound.source.kind, "onebot")
  assert.deepEqual(inbound.content, [{ type: "text", text: "hello" }])
  assert.equal(action.action, "send_private_msg")
  assert.deepEqual(action.params, {
    user_id: 7,
    message: [
      { type: "reply", data: { id: "123" } },
      { type: "text", data: { text: "received" } }
    ]
  })
  newSocket.send(
    JSON.stringify({ status: "ok", retcode: 0, data: { message_id: 456 }, echo: action.echo })
  )
  socket.close()
})
