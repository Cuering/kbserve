/**
 * Feedback — user ratings on Q&A answers, with admin review flow.
 */
import { getDb, stamp } from "./db"

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
        created_at TEXT, updated_at TEXT, deleted INTEGER DEFAULT 0
      );
    `)
  } catch {}
}

export function feedbackAdd(question: string, answer: string, rating: number, comment = "", userId?: string, convId?: number): Feedback {
  const db = getDb()
  const st = stamp()
  const ts = new Date().toISOString()
  db.query("INSERT INTO kb_feedback (uuid, question, answer, rating, comment, user_id, conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(st.uuid, question, answer, rating, comment, userId ?? null, convId ?? null, ts, ts)
  return db.query("SELECT * FROM kb_feedback ORDER BY id DESC LIMIT 1").get() as Feedback
}

export function feedbackList(reviewed?: boolean, limit = 50): Feedback[] {
  const where = ["deleted = 0"]
  if (reviewed !== undefined) where.push(reviewed ? "reviewed = 1" : "reviewed = 0")
  return getDb().query(`SELECT * FROM kb_feedback WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(limit) as Feedback[]
}

export function feedbackMarkReviewed(id: number): boolean {
  const r = getDb().query("UPDATE kb_feedback SET reviewed = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  return Number(r.changes) > 0
}