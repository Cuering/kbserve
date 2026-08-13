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

  // --- Admin API ---
  if (url.startsWith("/admin/")) {
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
      }
      json(res, result)
    } catch (e) { json(res, { error: (e as Error).message }, 400) }
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
  const loaded = getPlugins()
  console.log(`kbserve: http://127.0.0.1:${PORT}  (QA / KB / Admin / OpenAI / Plugins)`)
  console.log(`  plugins: ${loaded.length} (${loaded.filter((p) => p.enabled).length} enabled)`)
  if (loaded.length) for (const p of loaded) console.log(`    ${p.meta.name} v${p.meta.version}${p.enabled ? "" : " [disabled]"}${p.meta.astrbot_compat ? " (AstrBot)" : ""}`)
})