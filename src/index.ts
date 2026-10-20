import type { Context, Volatile } from "@deepseek-ai/cordis"
import { Config } from "./config"
import { registerOneBotConfigGateway } from "./gateway"
import { OneBotClient } from "./onebot"
import type { OneBotConfig } from "./types"

export const name = "onebot"
export const inject = [
  "agentDefaultModel",
  "agents",
  "attachments",
  "systemPrompt",
  "tools",
  "webServer"
]
export { Config }
export type {
  OneBotAccessMode,
  OneBotConfig,
  OneBotConfigPatch,
  OneBotEditableConfig,
  OneBotTransport
} from "./types"
export { registerOneBotConfigGateway } from "./gateway"

export function apply(ctx: Context, config: Volatile<OneBotConfig>): void {
  const client = new OneBotClient(ctx, () => config.get())
  ctx.on("loader/volatile-update", () => client.restart())
  ctx.inject(["settings"], (sctx) =>
    sctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber))
  )
  registerOneBotConfigGateway(ctx, { source: () => config.get() })
  ctx.effect(() => {
    client.start()
    return () => client.stop()
  }, "onebot: WebSocket client")
}
