/**
 * Multi-platform IM adapter system for kbserve.
 * Reference: AstrBot's platform adapter pattern.
 *
 * Each platform adapter implements the PlatformAdapter interface.
 * Built-in adapters: Webhook (generic), Telegram.
 * Community adapters can be added as plugins.
 */
import { getDb, stamp } from "./db"
import { kbSearch } from "./knowledge"
import { qaAsk } from "./qa"

export type PlatformMessage = {
  platform: string
  userId: string
  userName: string
  content: string
  messageId: string
  conversationId?: string
  raw?: any
}

export type PlatformReply = {
  content: string
  platform: string
  userId: string
}

export interface PlatformAdapter {
  name: string
  /** Validate and parse an incoming request into a standard message */
  parseIncoming(req: any, body: any): PlatformMessage | null
  /** Send a reply back to the user */
  sendReply(reply: PlatformReply, original: PlatformMessage): Promise<boolean>
  /** Health check */
  health(): boolean
}

// --- Adapter registry ---
const adapters = new Map<string, PlatformAdapter>()

export function registerAdapter(adapter: PlatformAdapter): void {
  adapters.set(adapter.name, adapter)
}

export function getAdapter(name: string): PlatformAdapter | undefined {
  return adapters.get(name)
}

export function listAdapters(): string[] {
  return [...adapters.keys()]
}

// --- Webhook adapter (generic HTTP POST) ---
const webhookAdapter: PlatformAdapter = {
  name: "webhook",
  parseIncoming(req: any, body: any): PlatformMessage | null {
    const text = body?.content || body?.text || body?.message || body?.question || ""
    if (!text) return null
    return {
      platform: "webhook",
      userId: body?.userId || body?.user_id || "webhook-" + (body?.from || "anon"),
      userName: body?.userName || body?.user_name || "Webhook User",
      content: text,
      messageId: body?.messageId || body?.message_id || "wh-" + Date.now(),
    }
  },
  async sendReply(reply: PlatformReply, original: PlatformMessage): Promise<boolean> {
    return true // Webhook relies on the caller to read the response
  },
  health() { return true },
}
registerAdapter(webhookAdapter)

// --- Telegram adapter (uses Bot API) ---
let telegramBotToken = ""
let telegramWebhookUrl = ""

export function configureTelegram(token: string, webhookUrl?: string): void {
  telegramBotToken = token
  telegramWebhookUrl = webhookUrl || ""
}

async function telegramCall(method: string, params: any): Promise<any> {
  if (!telegramBotToken) return null
  try {
    const res = await fetch(`https://api.telegram.org/bot${telegramBotToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
    return await res.json()
  } catch { return null }
}

const telegramAdapter: PlatformAdapter = {
  name: "telegram",
  parseIncoming(req: any, body: any): PlatformMessage | null {
    const msg = body?.message
    if (!msg?.text) return null
    return {
      platform: "telegram",
      userId: "tg-" + (msg.from?.id || "unknown"),
      userName: msg.from?.first_name || "Telegram User",
      content: msg.text,
      messageId: "tg-" + msg.message_id,
      conversationId: "tg-chat-" + msg.chat?.id,
    }
  },
  async sendReply(reply: PlatformReply, original: PlatformMessage): Promise<boolean> {
    if (!telegramBotToken) return false
    const chatId = original.conversationId?.replace("tg-chat-", "") || original.userId.replace("tg-", "")
    const res = await telegramCall("sendMessage", { chat_id: Number(chatId), text: reply.content })
    return res?.ok === true
  },
  health() { return !!telegramBotToken },
}

// --- Process a platform message through Q&A ---
export async function processPlatformMessage(msg: PlatformMessage): Promise<PlatformReply> {
  const result = await qaAsk(msg.content, msg.userId, 5)
  const content = result.answer || result.error || "抱歉，无法回答这个问题。"
  return { content, platform: msg.platform, userId: msg.userId }
}

// --- Ensure platform config table ---
export function ensurePlatformTables(): void {
  try {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS platform_config (
        name TEXT PRIMARY KEY, enabled INTEGER DEFAULT 0,
        config TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT
      );
    `)
  } catch {}
}

export function getPlatformConfig(name: string): any {
  try {
    const row = getDb().query("SELECT config FROM platform_config WHERE name = ?").get(name) as any
    return row ? JSON.parse(row.config) : {}
  } catch { return {} }
}

export function setPlatformConfig(name: string, config: any): void {
  const ts = new Date().toISOString()
  const json = JSON.stringify(config)
  const existing = getDb().query("SELECT name FROM platform_config WHERE name = ?").get(name)
  if (existing) {
    getDb().query("UPDATE platform_config SET config = ?, updated_at = ? WHERE name = ?").run(json, ts, name)
  } else {
    getDb().query("INSERT INTO platform_config (name, enabled, config, created_at, updated_at) VALUES (?, 1, ?, ?, ?)").run(name, json, ts, ts)
  }
  if (name === "telegram" && config.token) configureTelegram(config.token, config.webhookUrl)
}

ensurePlatformTables()