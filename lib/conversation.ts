/**
 * Conversation management — chat sessions, message storage, user messages.
 */
import { getDb, stamp } from "./db"
import { DEFAULT_TENANT, ensureTenantColumn } from "./tenant"

export type Conversation = {
  id: number
  uuid: string
  user_id: string
  user_name: string
  title: string
  message_count: number
  tenant_id: string
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
        tenant_id TEXT DEFAULT 'default',
        created_at TEXT, updated_at TEXT, deleted INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations (user_id, deleted);
    `)
    ensureTenantColumn("conversations")
    // Ensure bench_memories has user_name column for user profile
    try { getDb().exec("ALTER TABLE bench_memories ADD COLUMN user_name TEXT DEFAULT ''") } catch {}
  } catch {}
}

export function convStart(userId: string, userName = "", title = "", tenantId = DEFAULT_TENANT): Conversation {
  const db = getDb()
  const st = stamp()
  const ts = new Date().toISOString()
  const info = db.query("INSERT INTO conversations (uuid, user_id, user_name, title, message_count, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)")
    .run(st.uuid, userId, userName, title, tenantId, ts, ts)
  return db.query("SELECT * FROM conversations WHERE id = ?").get(Number(info.lastInsertRowid)) as Conversation
}

export function convList(userId?: string, limit = 20, tenantId = DEFAULT_TENANT): Conversation[] {
  const where = ["deleted = 0", "tenant_id = ?"]
  if (userId) where.push("user_id = ?")
  const params: any[] = [tenantId]
  if (userId) params.push(userId)
  params.push(limit)
  const sql = `SELECT * FROM conversations WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`
  return getDb().query(sql).all(...params) as Conversation[]
}

export function convGet(id: number, tenantId = DEFAULT_TENANT): Conversation | null {
  return (getDb().query("SELECT * FROM conversations WHERE id = ? AND tenant_id = ? AND deleted = 0").get(id, tenantId) as Conversation | undefined) ?? null
}