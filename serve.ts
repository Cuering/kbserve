/**
 * kbserve server — enhanced with: OpenAI-compatible API, persona, plugin, stats.
 */
import { createServer } from "http"
import type { IncomingMessage, ServerResponse } from "http"
import { readFileSync, existsSync, readdirSync, writeFileSync, statSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"

process.env.EVOLVE_HOME ||= join(homedir(), ".kbserve")
const { initDb, getDb, getConfig, setConfig } = await import("./lib/db")
initDb()
require("./lib/bench.ts")

import { qaAsk } from "./lib/qa"
import { feedbackAdd, feedbackList, feedbackMarkReviewed } from "./lib/feedback"
import { convStart, convList } from "./lib/conversation"
import { kbSearch, kbAdd, kbList, kbUpdate, kbDelete, kbAddQaPair, kbApproveQa, kbRejectQa, kbListQa, kbGetVersions } from "./lib/knowledge"
import { generateUserReport, generateAllUsersReport } from "./lib/report"
import { recordCall, getCallStats } from "./lib/dashboard-log"
import { scanPlugins, getPlugins, togglePlugin, ensurePluginTables } from "./lib/plugins"
import { processPlatformMessage, getPlatformConfig, setPlatformConfig, listAdapters, ensurePlatformTables } from "./lib/platform"
import { fetchMarketplace, installPlugin, uninstallPlugin } from "./lib/marketplace"
import { verifySession, login, logout, listUsers, createUser, deleteUser, changePassword } from "./lib/admin-users"
import { exportReportHtml, exportKbHtml } from "./lib/export"
import { batchImport, ensureImportDir } from "./lib/import"
import { generateApiDocHtml } from "./lib/api-docs"
import { broadcast, sseHandler } from "./lib/websocket"
import { handleMcpRequest, isMcpRequest } from "./lib/mcp"
import { sandboxRun, logSandboxRun, ensureSandboxTables } from "./lib/sandbox"

const PORT = Number(process.env.KBSERVE_PORT || 3090)
const __dirname = dirname(fileURLToPath(import.meta.url))

// --- OpenAI-compatible chat completions endpoint ---
async function openaiChat(raw: string): Promise<any> {
  const body = JSON.parse(raw)
  const messages = body.messages || []
  const model = body.model || "default"
  const userMsg = messages.filter((m: any) => m.role === "user").pop()?.content || ""
  const result = await qaAsk(userMsg, body.user || "api", 5)
  return {
    id: "chatcmpl-" + Date.now(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: result.answer || (result.error || "No answer") },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: userMsg.length, completion_tokens: (result.answer || "").length, total_tokens: userMsg.length + (result.answer || "").length },
  }
}

// --- Plugin system (AstrBot-compatible) ---

function json(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" })
  res.end(JSON.stringify(data, null, 2))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (c) => data += c)
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

// --- Stats collection ---
function computeStats() {
  const db = getDb()
  const r = (sql: string, ...p: any[]) => (db.query(sql).get(...p) as any)?.n ?? 0
  return {
    kbCount: r("SELECT COUNT(*) AS n FROM kb_documents WHERE deleted = 0"),
    pendingFeedback: r("SELECT COUNT(*) AS n FROM kb_feedback WHERE deleted = 0 AND reviewed = 0"),
    pendingQa: r("SELECT COUNT(*) AS n FROM qa_pairs WHERE deleted = 0 AND status = 'pending'"),
    conversations: r("SELECT COUNT(*) AS n FROM conversations WHERE deleted = 0"),
    users: r("SELECT COUNT(DISTINCT user_id) AS n FROM conversations WHERE deleted = 0"),
    todayConvs: r("SELECT COUNT(*) AS n FROM conversations WHERE deleted = 0 AND created_at >= date('now')"),
    todayFeedback: r("SELECT COUNT(*) AS n FROM kb_feedback WHERE deleted = 0 AND created_at >= date('now')"),
    avgRating: (db.query("SELECT AVG(rating) AS a FROM kb_feedback WHERE deleted = 0 AND rating > 0").get() as any)?.a ?? 0,
  }
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return }

  const url = (req.url || "/").split("?")[0]
  const method = req.method || "GET"

  // Health
  if (url === "/health") { json(res, { ok: true, pid: process.pid, plugins: getPlugins().length }); return }

  // OpenAI-compatible API
  if (url === "/v1/chat/completions" && method === "POST") {
    try {
      recordCall("api", "openai.chat", "completions")
      json(res, await openaiChat(await readBody(req)))
    } catch (e) { json(res, { error: { message: (e as Error).message } }, 400) }
    return
  }

  // Public Q&A
  if (url === "/qa" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      json(res, await qaAsk(body.question, body.userId, body.topK || 5))
      recordCall("qa", "qa.ask", body.question?.slice(0, 100))
    } catch (e) { json(res, { error: (e as Error).message }, 400) }
    return
  }

  if (url === "/qa/feedback" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const fb = feedbackAdd(body.question, body.answer, body.rating || 0, body.comment || "", body.userId, body.conversationId)
      if (body.rating && body.rating <= 2) {
        broadcast({ type: "feedback", title: "新差评反馈", message: `评分 ${body.rating}/5: ${(body.question || "").slice(0, 60)}`, timestamp: "", meta: { question: body.question, rating: body.rating } })
      }
      json(res, { ok: true, id: fb.id })
    } catch (e) { json(res, { error: (e as Error).message }, 400) }
    return
  }

  // Public KB search
  if (url === "/kb/search" && method === "GET") {
    const q = new URL(req.url || "/", "http://x").searchParams.get("q") || ""
    json(res, kbSearch(q))
    return
  }

  // Conversation
  if (url === "/conv/start" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      json(res, convStart(body.userId || "anonymous", body.userName || "", body.title || ""))
    } catch (e) { json(res, { error: (e as Error).message }, 400) }
    return
  }
  if (url === "/conv/list" && method === "GET") {
    const userId = new URL(req.url || "/", "http://x").searchParams.get("userId") || undefined
    json(res, convList(userId))
    return
  }

  // Stats
  if (url === "/api/stats") { json(res, computeStats()); return }
  if (url === "/api/calls") { json(res, getCallStats()); return }

  // Auth check
  function checkAuth(): any {
    const auth = req.headers["authorization"] || ""
    const token = auth.replace(/^Bearer\s+/i, "") || ""
    return verifySession(token)
  }

  // Auth endpoints (no auth required)
  if (url === "/auth/login" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const result = login(body.username || "admin", body.password || "")
      json(res, result)
    } catch (e) { json(res, { error: (e as Error).message }, 400) }
    return
  }
  if (url === "/auth/logout" && method === "POST") {
    const auth = req.headers["authorization"] || ""
    const token = auth.replace(/^Bearer\s+/i, "")
    logout(token)
    json(res, { ok: true })
    return
  }
  if (url === "/auth/me") {
    const user = checkAuth()
    if (user) json(res, { ok: true, user: { id: user.uuid, username: user.username, role: user.role, display_name: user.display_name } })
    else json(res, { ok: false }, 401)
    return
  }

  // --- Admin API (requires auth) ---
  if (url.startsWith("/admin/")) {
    const user = checkAuth()
    if (!user) { json(res, { error: "unauthorized" }, 401); return }
    try {
      const action = url.replace("/admin/", "")
      const body = method === "POST" ? JSON.parse(await readBody(req)) : {}
      const q = new URL(req.url || "/", "http://x").searchParams
      let result: any = { error: "unknown action" }
      switch (action) {
        case "kb/list": result = kbList(); break
        case "kb/add": result = kbAdd(body.title, body.content, body.tags || ""); recordCall("kb", "kb.add", body.title); break
        case "kb/update": result = kbUpdate(body.id, body.title, body.content, body.tags); break
        case "kb/delete": result = { ok: kbDelete(body.id) }; break
        case "kb/versions": result = kbGetVersions(Number(q.get("id") || body.id)); break
        case "qa/list": result = kbListQa(q.get("status") || undefined); break
        case "qa/approve": result = { ok: kbApproveQa(body.id) }; break
        case "qa/reject": result = { ok: kbRejectQa(body.id) }; break
        case "feedback": result = feedbackList(q.get("unreviewed") !== "false"); break
        case "feedback/review": result = { ok: feedbackMarkReviewed(body.id) }; break
        case "report/user": result = { report: generateUserReport(q.get("userId") || "") }; break
        case "report/all": result = { report: generateAllUsersReport() }; break
        case "stats": result = computeStats(); break
        case "calls": result = getCallStats(); break
        // Persona
        case "persona/get": result = { name: getConfig("persona_name") || "kbserve", greeting: getConfig("persona_greeting") || "您好！我是知识库客服助手，请问有什么可以帮助您的？", about: getConfig("persona_about") || "基于知识库的智能客服系统" }; break
        case "persona/set": setConfig("persona_name", body.name); setConfig("persona_greeting", body.greeting); setConfig("persona_about", body.about); result = { ok: true }; break
        // Provider
        case "provider/get": result = { provider: getConfig("llm_provider") || "auto", model: getConfig("llm_model") || "", apiKey: getConfig("llm_api_key") || "" }; break
        case "provider/set": setConfig("llm_provider", body.provider); setConfig("llm_model", body.model); setConfig("llm_api_key", body.apiKey); result = { ok: true }; break
        // Plugins
        case "plugins/list": result = { plugins: getPlugins().map((p) => ({ name: p.meta.name, enabled: p.enabled, version: p.meta.version, author: p.meta.author, desc: p.meta.desc, astrbot_compat: p.meta.astrbot_compat })) }; break
        case "plugins/toggle": { const r = togglePlugin(body.name); result = r ? { ok: true, name: r.meta.name, enabled: r.enabled } : { error: "not found" }; break }
        // Platform
        case "platform/list": result = { adapters: listAdapters() }; break
        case "platform/get": result = { config: getPlatformConfig(body.name || q.get("name") || "webhook") }; break
        case "platform/set": {
          setPlatformConfig(body.name, body.config)
          if (body.name === "telegram" && body.config?.token) require("./lib/platform").configureTelegram(body.config.token, body.config.webhookUrl)
          if (body.name === "wechat" && body.config?.appId) require("./lib/platform").configWeChat(body.config.appId, body.config.secret, body.config.token)
          if (body.name === "feishu" && body.config?.appId) require("./lib/platform").configFeishu(body.config.appId, body.config.secret)
          if (body.name === "dingtalk" && body.config?.appKey) require("./lib/platform").configDingTalk(body.config.appKey, body.config.secret)
          result = { ok: true }
          break
        }
        // Marketplace
        case "marketplace/list": result = { plugins: await fetchMarketplace() }; break
        case "marketplace/install": result = await installPlugin(body.repo, body.name); break
        case "marketplace/uninstall": result = uninstallPlugin(body.name); break
        // Export
        case "export/report": result = { html: exportReportHtml(body.type || "all", body.userId) }; break
        case "export/kb": result = { html: exportKbHtml() }; break
        // Import
        case "import": result = batchImport(body.path, body.tags); break
        case "import/dir": result = { path: ensureImportDir() }; break
        // Users
        case "users/list": if (user.role !== "admin") { result = { error: "forbidden" }; break } result = listUsers(); break
        case "users/create": if (user.role !== "admin") { result = { error: "forbidden" }; break } result = createUser(body.username, body.password, body.role || "editor", body.displayName || ""); break
        case "users/delete": if (user.role !== "admin") { result = { error: "forbidden" }; break } result = { ok: deleteUser(body.uuid) }; break
        case "users/password": result = changePassword(user.uuid, body.oldPassword, body.newPassword); break
        // Sandbox
        case "sandbox/run": {
          ensureSandboxTables()
          const sr = sandboxRun(body.code || "", { timeout: body.timeout || 5000, allowNetworking: !!body.allowNetworking }, body.args)
          logSandboxRun({ session: body.session || "manual", result: sr })
          result = sr
          break
        }
      }
      json(res, result)
    } catch (e) { json(res, { error: (e as Error).message }, 400) }
    return
  }

  // Platform webhook endpoint
  if (url === "/webhook" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const msg = require("./lib/platform").getAdapter("webhook")?.parseIncoming(req, body)
      if (msg) {
        const reply = await processPlatformMessage(msg)
        json(res, { reply: reply.content })
      } else json(res, { error: "unparseable" }, 400)
    } catch (e) { json(res, { error: (e as Error).message }, 400) }
    return
  }

  // WeChat Official Account webhook (GET=verify, POST=message)
  if (url === "/webhook/wechat") {
    // Verification: WeChat sends echostr in GET query
    if (method === "GET") {
      const query = new URL(req.url || "/", "http://x").searchParams
      const echostr = query.get("echostr") || ""
      res.writeHead(200, { "Content-Type": "text/plain" })
      res.end(echostr)
      return
    }
    try {
      const body = JSON.parse(await readBody(req))
      const msg = require("./lib/platform").getAdapter("wechat")?.parseIncoming(req, body)
      if (msg) {
        const reply = await processPlatformMessage(msg)
        // Reply as WeChat XML
        const xml = `<xml><ToUserName><![CDATA[${msg.conversationId?.replace("wx-","")||""}]]></ToUserName><FromUserName><![CDATA[kbserve]]></FromUserName><CreateTime>${Math.floor(Date.now()/1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${reply.content}]]></Content></xml>`
        res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" })
        res.end(xml)
      } else { res.writeHead(200); res.end("success") }
    } catch (e) { res.writeHead(200); res.end("success") }
    return
  }

  // Feishu webhook (requires challenge response)
  if (url === "/webhook/feishu" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      // Feishu URL verification: respond with challenge
      if (body.challenge) {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ challenge: body.challenge }))
        return
      }
      const msg = require("./lib/platform").getAdapter("feishu")?.parseIncoming(req, body)
      if (msg) { await processPlatformMessage(msg) }
      res.writeHead(200); res.end("{}")
    } catch (e) { res.writeHead(200); res.end("{}") }
    return
  }

  // DingTalk webhook
  if (url === "/webhook/dingtalk" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const msg = require("./lib/platform").getAdapter("dingtalk")?.parseIncoming(req, body)
      if (msg) { await processPlatformMessage(msg) }
      res.writeHead(200); res.end("{}")
    } catch (e) { res.writeHead(200); res.end("{}") }
    return
  }

  // Telegram webhook receiver
  if (url === "/webhook/telegram" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const msg = require("./lib/platform").getAdapter("telegram")?.parseIncoming(req, body)
      if (msg) {
        await processPlatformMessage(msg) // reply sent via sendReply
        json(res, { ok: true })
      } else json(res, { ok: true }) // Telegram expects 200 even for non-text
    } catch (e) { json(res, { error: (e as Error).message }, 400) }
    return
  }

  // MCP endpoint (HTTP transport, JSON-RPC 2.0)
  if (url === "/mcp" && method === "POST") {
    try {
      const raw = await readBody(req)
      if (isMcpRequest(raw)) {
        const result = await handleMcpRequest(raw)
        if (result === null) { res.writeHead(202); res.end(); return }
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" })
        res.end(JSON.stringify(result))
        return
      }
    } catch (e) { /* fall through to regular handling */ }
  }

  // WebSocket / SSE endpoint for real-time notifications
  if (url === "/ws" || url === "/events") {
    if (url === "/ws" && typeof Bun !== "undefined") {
      const { upgradeToWs } = require("./lib/websocket")
      const upgraded = upgradeToWs(req as any)
      if (upgraded) return
    }
    // Fallback: Server-Sent Events
    sseHandler(req, res)
    return
  }

  // API docs
  if (url === "/api-docs") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(generateApiDocHtml(`http://127.0.0.1:${PORT}`))
    return
  }

  // Web UI
  if (url === "/" || url === "/index.html") {
    const html = readFileSync(join(__dirname, "dashboard", "index.html"), "utf8")
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(html)
    return
  }

  json(res, { error: `not found: ${url}` }, 404)
})

server.listen(PORT, () => {
  ensurePluginTables()
  ensurePlatformTables()
  const loaded = getPlugins()
  const adapters = listAdapters()
  console.log(`kbserve: http://127.0.0.1:${PORT}  (QA / KB / Admin / OpenAI / Plugins)`)
  console.log(`  plugins: ${loaded.length} (${loaded.filter((p) => p.enabled).length} enabled)`)
  console.log(`  platforms: ${adapters.join(", ")}`)
  if (loaded.length) for (const p of loaded) console.log(`    ${p.meta.name} v${p.meta.version}${p.enabled ? "" : " [disabled]"}${p.meta.astrbot_compat ? " (AstrBot)" : ""}`)
})