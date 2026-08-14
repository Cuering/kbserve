/**
 * Feedback — user ratings on Q&A answers, with admin review flow.
 */
import { getDb, stamp } from "./db"
import { DEFAULT_TENANT, ensureTenantColumn } from "./tenant"

export type Feedback = {
  id: number
  uuid: string
  question: string
  answer: string
  rating: number
  comment: string
  user_id: string
  conversation_id: number
  reviewed: number
  tenant_id: string
  created_at: string
  updated_at: string
  deleted: number
}

export function ensureFeedbackTables(): void {
  try {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS kb_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE, question TEXT NOT NULL, answer TEXT NOT NULL,
        rating INTEGER DEFAULT 0, comment TEXT DEFAULT '',
        user_id TEXT, conversation_id INTEGER,
        reviewed INTEGER DEFAULT 0,
        tenant_id TEXT DEFAULT 'default',
        created_at TEXT, updated_at TEXT, deleted INTEGER DEFAULT 0
      );
    `)
    ensureTenantColumn("kb_feedback")
  } catch {}
}

export function feedbackAdd(question: string, answer: string, rating: number, comment = "", userId?: string, convId?: number, tenantId = DEFAULT_TENANT): Feedback {
  const db = getDb()
  const st = stamp()
  const ts = new Date().toISOString()
  const info = db.query("INSERT INTO kb_feedback (uuid, question, answer, rating, comment, user_id, conversation_id, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(st.uuid, question, answer, rating, comment, userId ?? null, convId ?? null, tenantId, ts, ts)
  return db.query("SELECT * FROM kb_feedback WHERE id = ?").get(Number(info.lastInsertRowid)) as Feedback
}

export function feedbackList(reviewed?: boolean, limit = 50, tenantId = DEFAULT_TENANT): Feedback[] {
  const where = ["deleted = 0", "tenant_id = ?"]
  if (reviewed !== undefined) where.push(reviewed ? "reviewed = 1" : "reviewed = 0")
  const params: any[] = [tenantId, limit]
  return getDb().query(`SELECT * FROM kb_feedback WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...params) as Feedback[]
}

export function feedbackMarkReviewed(id: number, tenantId = DEFAULT_TENANT): boolean {
  const r = getDb().query("UPDATE kb_feedback SET reviewed = 1, updated_at = ? WHERE id = ? AND tenant_id = ?").run(new Date().toISOString(), id, tenantId)
  return Number(r.changes) > 0
}