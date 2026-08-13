#!/usr/bin/env bun
/**
 * kbserve — main server entry point.
 * Serves: public Q&A API, admin API, web UI.
 */
import { createServer } from "http"
import type { IncomingMessage, ServerResponse } from "http"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { initDb, getDb } from "./lib/db"

// Set data directory
process.env.EVOLVE_HOME ||= join(homedir(), ".kbserve")
initDb()

// Ensure bench tables
require("./lib/bench.ts")

import { qaAsk } from "./lib/qa"
import { feedbackAdd } from "./lib/feedback"
import { convStart, convList } from "./lib/conversation"
import { kbSearch, kbAdd, kbList, kbUpdate, kbDelete } from "./lib/knowledge"
import { adminApi } from "./lib/admin"
import { generateUserReport, generateAllUsersReport } from "./lib/report"
import { recordCall, getCallStats } from "./lib/dashboard-log"

const PORT = Number(process.env.KBSERVE_PORT || 3090)

function json(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" })
  res.end(JSON.stringify(data, null, 2))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (c) => { data += c })
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return }

  const url = (req.url || "/").split("?")[0]
  const method = req.method || "GET"

  // Health check
  if (url === "/health" && method === "GET") { json(res, { ok: true, pid: process.pid }) }; return

  // ---- Public API ----
  if (url === "/qa" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const result = await qaAsk(body.question, body.userId, body.topK || 5)
      recordCall("qa", "qa.ask", body.question.slice(0, 100))
      json(res, result)
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

  // Conversation
  if (url === "/conv/start" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const conv = convStart(body.userId || "anonymous", body.userName || "", body.title || "")
      json(res, conv)
    } catch (e) { json(res, { error: (e as Error).message }, 400) }
    return
  }

  if (url === "/conv/list" && method === "GET") {
    const userId = new URL(req.url || "/", "http://x").searchParams.get("userId") || undefined
    json(res, convList(userId))
    return
  }

  // Knowledge base search (public)
  if (url === "/kb/search" && method === "GET") {
    const q = new URL(req.url || "/", "http://x").searchParams.get("q") || ""
    json(res, kbSearch(q))
    return
  }

  // ---- Admin API ----
  if (url.startsWith("/admin/")) {
    const action = url.replace("/admin/", "")
    switch (action) {
      case "kb/list": json(res, adminApi.kbList()); return
      case "kb/add": {
        if (method !== "POST") { json(res, { error: "POST required" }, 405); return }
        const body = JSON.parse(await readBody(req))
        json(res, adminApi.kbAdd(body.title, body.content, body.tags))
        recordCall("kb", "admin.kb.add", body.title)
        return
      }
      case "kb/update": {
        if (method !== "POST") { json(res, { error: "POST required" }, 405); return }
        const body = JSON.parse(await readBody(req))
        json(res, adminApi.kbUpdate(body.id, body.title, body.content, body.tags))
        return
      }
      case "kb/delete": {
        if (method !== "POST") { json(res, { error: "POST required" }, 405); return }
        const body = JSON.parse(await readBody(req))
        json(res, { ok: adminApi.kbDelete(body.id) })
        return
      }
      case "qa/list": json(res, adminApi.qaList()); return
      case "qa/approve": {
        const body = JSON.parse(await readBody(req))
        json(res, { ok: adminApi.qaApprove(body.id) })
        return
      }
      case "qa/reject": {
        const body = JSON.parse(await readBody(req))
        json(res, { ok: adminApi.qaReject(body.id) })
        return
      }
      case "feedback": json(res, adminApi.feedbackList(true)); return
      case "feedback/review": {
        const body = JSON.parse(await readBody(req))
        json(res, { ok: adminApi.feedbackMarkReviewed(body.id) })
        return
      }
      case "report/user": {
        const userId = new URL(req.url || "/", "http://x").searchParams.get("userId") || ""
        const report = generateUserReport(userId || "anonymous")
        json(res, { report })
        return
      }
      case "report/all": json(res, { report: generateAllUsersReport() }); return
      case "stats": json(res, adminApi.stats()); return
      case "calls": json(res, getCallStats()); return
    }
  }

  // Web UI
  if (url === "/" || url === "/index.html") {
    const html = readFileSync(join(__dirname, "dashboard", "index.html"), "utf8")
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(html)
    return
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ error: `not found: ${url}` }))
})

server.listen(PORT, () => {
  console.log(`kbserve: http://127.0.0.1:${PORT}  (QA / KB / Admin)`)
})