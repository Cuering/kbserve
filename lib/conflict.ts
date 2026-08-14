/**
 * Knowledge base conflict detection — identifies duplicate, near-duplicate, and
 * contradictory documents within the KB. Helps admins keep the knowledge base clean.
 *
 * Detection modes:
 *  - duplicate:      exact same title/content (overlap ~1.0)
 *  - near_duplicate: title/content highly similar (overlap >= 0.8) but not identical
 *  - contradiction:  same topic/semantic anchor but conflicting statements
 */
import { getDb } from "./db"
import { DEFAULT_TENANT } from "./tenant"

/**
 * Zero-dependency tokenizer: English/numbers as whole words, Chinese as
 * 2-char bigrams (n-gram overlap handles near-duplicate phrasing, e.g. 于/在).
 */
function tokens(s: string): Set<string> {
  const out = new Set<string>()
  const low = (s || "").toLowerCase()
  // English words & numbers (>=2 chars)
  for (const w of low.split(/[^a-z0-9]+/i)) if (w.length > 1) out.add(w)
  // Chinese bigrams (each adjacent 2-char CJK pair)
  const cjk = low.replace(/[^\u4e00-\u9fff\u3400-\u4dbf]/g, " ")
  for (let i = 0; i < cjk.length - 1; i++) {
    const ch1 = cjk[i], ch2 = cjk[i + 1]
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch1 + ch2)) out.add(ch1 + ch2)
  }
  return out
}

function overlap(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.min(ta.size, tb.size)
}

/** Look for contradiction keywords: pairs that express opposite states. */
const CONTRADICTIONS: Array<Array<RegExp>> = [
  [/^\s*(yes|true|enabled|on|active|支持|启用|开启|允许|是|有用)\b/i, /^\s*(no|false|disabled|off|inactive|不支持|禁用|关闭|拒绝|否|无用)\b/i],
  [/change(?:d)?|rotate|renew|alter|设置|修改|更换|重置/i, /never|no (?:more|longer)|永不|不再|停止|取消|无需/i],
  [/must\s+change|change(?:d)? every|every \d+ days?|每\d+天|每 \d+ 天|定期|频率/i, /(?:never|no \w* expir|expires? never|永不|不过期|长期有效|无限期)/i],
  [/allow|permit|支持|允许|启用|开启/i, /deny|prohibit|forbid|not allowed|不支持|禁止|禁用|拒绝|关闭/i],
]

function isContradiction(a: string, b: string): boolean {
  for (const [x, y] of CONTRADICTIONS) {
    const ax = x.test(a), ay = y.test(a)
    const bx = x.test(b), by = y.test(b)
    if (ax && by) return true
    if (ay && bx) return true
  }
  return false
}

export type Conflict = {
  docA: { id: number; title: string }
  docB: { id: number; title: string }
  type: "duplicate" | "near_duplicate" | "contradiction"
  similarity: number
  overlap: number
}

export function detectConflicts(threshold = 0.8, tenantId = DEFAULT_TENANT): Conflict[] {
  const db = getDb()
  const docs = db.query("SELECT id, title, content, deleted FROM kb_documents WHERE deleted = 0 AND tenant_id = ?").all(tenantId) as Array<{ id: number; title: string; content: string; deleted: number }>
  const conflicts: Conflict[] = []
  const seen = new Set<string>()

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i], b = docs[j]
      if (seen.has(`${a.id}|${b.id}`)) continue
      const sim = overlap(a.content || "", b.content || "")
      const titleSim = overlap(a.title || "", b.title || "")

      // Contradiction: shared title anchor OR high content overlap + opposing statements
      const sharedAnchor = titleSim >= 0.6 || (overlap(a.title, b.content) >= 0.3 && overlap(b.title, a.content) >= 0.3)
      const contra = isContradiction(a.content, b.content)

      if (sim >= 0.98 || (sim >= 0.9 && titleSim >= 0.9)) {
        conflicts.push({ docA: { id: a.id, title: a.title }, docB: { id: b.id, title: b.title }, type: "duplicate", similarity: sim, overlap: sim })
      } else if (contra && (sharedAnchor || sim >= threshold * 0.6)) {
        conflicts.push({ docA: { id: a.id, title: a.title }, docB: { id: b.id, title: b.title }, type: "contradiction", similarity: sim, overlap: sim })
      } else if (sim >= threshold || (sim >= threshold - 0.1 && titleSim >= 0.7)) {
        conflicts.push({ docA: { id: a.id, title: a.title }, docB: { id: b.id, title: b.title }, type: "near_duplicate", similarity: sim, overlap: sim })
      }
      seen.add(`${a.id}|${b.id}`)
    }
  }

  // Sort: duplicates first, then contradictions, then near_duplicates
  const order = { duplicate: 0, contradiction: 1, near_duplicate: 2 }
  conflicts.sort((x, y) => order[x.type] - order[y.type] || y.similarity - x.similarity)
  return conflicts
}

export function conflictStats(tenantId = DEFAULT_TENANT): { total: number; duplicates: number; near_duplicates: number; contradictions: number } {
  const conflicts = detectConflicts(0.8, tenantId)
  const d: any = { total: conflicts.length, duplicates: 0, near_duplicates: 0, contradictions: 0 }
  for (const c of conflicts) d[c.type + (c.type === "near_duplicate" ? "s" : "")]++
  // Normalize key names
  d.duplicates = conflicts.filter((c) => c.type === "duplicate").length
  d.near_duplicates = conflicts.filter((c) => c.type === "near_duplicate").length
  d.contradictions = conflicts.filter((c) => c.type === "contradiction").length
  return { total: conflicts.length, duplicates: d.duplicates, near_duplicates: d.near_duplicates, contradictions: d.contradictions }
}