/**
 * Conversation management — chat sessions, message storage, user messages.
 */
import { getDb, stamp } from "./db"

export type Conversation = {
  id: number
  uuid: string
  user_id: string
  user_name: string
  title: string
  message_count: number
  created_at: string
  updated_at: string
  deleted: number
}

export function ensureConvTables(): void {
  try {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE, user_id TEXT NOT NULL, user_name TEXT DEFAULT '',
        title TEXT DEFAULT '', message_count INTEGER DEFAULT 0,
        created_at TEXT, updated_at TEXT, deleted INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations (user_id, deleted);
    `)
    // Ensure bench_memories has user_name column for user profile
    try { getDb().exec("ALTER TABLE bench_memories ADD COLUMN user_name TEXT DEFAULT ''") } catch {}
  } catch {}
}

export function convStart(userId: string, userName = "", title = ""): Conversation {
  const db = getDb()
  const st = stamp()
  const ts = new Date().toISOString()
  db.query("INSERT INTO conversations (uuid, user_id, user_name, title, message_count, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
    .run(st.uuid, userId, userName, title, ts, ts)
  return db.query("SELECT * FROM conversations ORDER BY id DESC LIMIT 1").get() as Conversation
}

export function convList(userId?: string, limit = 20): Conversation[] {
  const where = ["deleted = 0"]
  if (userId) where.push("user_id = ?")
  const sql = `SELECT * FROM conversations WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`
  return getDb().query(sql).all(...(userId ? [userId, limit] : [limit])) as Conversation[]
}

export function convGet(id: number): Conversation | null {
  return (getDb().query("SELECT * FROM conversations WHERE id = ? AND deleted = 0").get(id) as Conversation | undefined) ?? null
}