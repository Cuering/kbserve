/**
 * LLM-powered Q&A — uses opencode's auth.json to reuse the same provider.
 * Reads the conversation context + knowledge base hits, then calls the LLM.
 */
import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { kbSearch } from "./knowledge"
import { DEFAULT_TENANT } from "./tenant"

const AUTH_FILE = join(homedir(), ".local", "share", "opencode", "auth.json")
const OPENCODE_CONFIG = join(homedir(), ".config", "opencode", "opencode.jsonc")

function readProvider(): { baseURL: string; model: string; apiKey: string } | null {
  try {
    const raw = readFileSync(OPENCODE_CONFIG, "utf8")
      .replace(/^\s*"\$schema".*$/m, "")
      .replace(/\/\/[^\n"]*$/gm, "")
      .replace(/,\s*(\n\s*[}\]])/g, "$1")
    const cfg = JSON.parse(raw)
    const auth = existsSync(AUTH_FILE) ? JSON.parse(readFileSync(AUTH_FILE, "utf8")) : {}
    const prefer = ["sensenova", "openai", "deepseek", "anthropic", "gemini", "grok", "zhipuai"]
    for (const name of prefer) {
      const prov = cfg.provider?.[name]
      if (!prov) continue
      const key = auth[name]?.key
      if (!key) continue
      const baseURL = (prov.options?.baseURL || "").replace(/\/+$/, "") || "https://api.openai.com/v1"
      const models = Object.keys(prov.models || {})
      return { baseURL, model: models[0] || "gpt-4o-mini", apiKey: key }
    }
    return null
  } catch { return null }
}

export type QaResult = {
  answer: string
  sources: Array<{ title: string; score: number }>
  ok: boolean
  error?: string
}

/**
 * Answer a user question using the knowledge base + LLM.
 * 1. Search KB for relevant docs
 * 2. Build a prompt with context
 * 3. Call LLM
 * 4. Return answer + sources
 */
export async function qaAsk(question: string, userId?: string, topK = 5, tenantId = DEFAULT_TENANT): Promise<QaResult> {
  const provider = readProvider()
  if (!provider) return { answer: "", sources: [], ok: false, error: "No LLM provider configured. Add an API key in opencode settings." }

  const kbHits = kbSearch(question, topK, tenantId)
  const context = kbHits.length
    ? kbHits.map((d, i) => `[${i + 1}] ${d.title}\n${d.content.slice(0, 800)}`).join("\n\n")
    : "暂无相关知识库文档。"

  const prompt = `你是一个知识库客服助手。请根据以下知识库内容回答用户问题。

知识库内容：
${context}

用户问题：${question}

请基于知识库内容回答。如果知识库中没有相关信息，请如实说明。回答要简洁准确。`

  try {
    const res = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: "你是一个专业的知识库客服助手，回答基于提供的知识库内容。" },
          { role: "user", content: prompt },
        ],
        max_tokens: 1500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => "")
      return { answer: "", sources: [], ok: false, error: `LLM error ${res.status}: ${err.slice(0, 200)}` }
    }
    const json = await res.json()
    const answer = (json.choices?.[0]?.message?.content || "").trim()
    const sources = kbHits.map((d) => ({ title: d.title, score: 0 }))
    return { answer, sources, ok: true }
  } catch (err) {
    return { answer: "", sources: [], ok: false, error: `LLM call failed: ${(err as Error).message}` }
  }
}