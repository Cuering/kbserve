/**
 * Knowledge Base — document CRUD, versioning, tagging, search.
 */
import { getDb, stamp } from "./db"

export type KbDoc = {
  id: number
  uuid: string
  title: string
  content: string
  tags: string
  status: "active" | "archived" | "pending"
  version: number
  source: string
  created_at: string
  updated_at: string
  deleted: number
}

export type KbVersion = {
  id: number
  doc_id: number
  title: string
  content: string
  version: number
  created_at: string
}

export function ensureKbTables(): void {
  try {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS kb_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE, title TEXT NOT NULL, content TEXT NOT NULL,
        tags TEXT DEFAULT '', status TEXT DEFAULT 'active',
        version INTEGER DEFAULT 1, source TEXT DEFAULT 'manual',
        created_at TEXT, updated_at TEXT, deleted INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_kb_tags ON kb_documents (status, deleted);
      CREATE TABLE IF NOT EXISTS kb_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL, title TEXT, content TEXT,
        version INTEGER, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS qa_pairs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE, question TEXT NOT NULL, answer TEXT NOT NULL,
        source TEXT, doc_id INTEGER, status TEXT DEFAULT 'pending',
        created_at TEXT, updated_at TEXT, deleted INTEGER DEFAULT 0
      );
    `)
  } catch {}
}

export function kbAdd(title: string, content: string, tags = "", source = "manual"): KbDoc {
  const db = getDb()
  const st = stamp()
  const ts = new Date().toISOString()
  db.query("INSERT INTO kb_documents (uuid, title, content, tags, status, version, source, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?)")
    .run(st.uuid, title, content, tags, source, ts, ts)
  const id = Number(db.query("SELECT last_insert_rowid() AS n").get()!.n)
  db.query("INSERT INTO kb_versions (doc_id, title, content, version, created_at) VALUES (?, ?, ?, 1, ?)").run(id, title, content, ts)
  return db.query("SELECT * FROM kb_documents WHERE id = ?").get(id) as KbDoc
}

export function kbUpdate(id: number, title: string, content: string, tags?: string): KbDoc | null {
  const db = getDb()
  const doc = db.query("SELECT * FROM kb_documents WHERE id = ? AND deleted = 0").get(id) as KbDoc | undefined
  if (!doc) return null
  const ts = new Date().toISOString()
  const newVer = doc.version + 1
  db.query("UPDATE kb_documents SET title = ?, content = ?, tags = ?, version = ?, updated_at = ? WHERE id = ?")
    .run(title, content, tags ?? doc.tags, newVer, ts, id)
  db.query("INSERT INTO kb_versions (doc_id, title, content, version, created_at) VALUES (?, ?, ?, ?, ?)").run(id, title, content, newVer, ts)
  return db.query("SELECT * FROM kb_documents WHERE id = ?").get(id) as KbDoc
}

export function kbDelete(id: number): boolean {
  const r = getDb().query("UPDATE kb_documents SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0").run(new Date().toISOString(), id)
  return Number(r.changes) > 0
}

export function kbSearch(query: string, limit = 20): KbDoc[] {
  const q = `%${query}%`
  return getDb()
    .query("SELECT * FROM kb_documents WHERE deleted = 0 AND status = 'active' AND (title LIKE ? OR content LIKE ? OR tags LIKE ?) ORDER BY updated_at DESC LIMIT ?")
    .all(q, q, q, limit) as KbDoc[]
}

export function kbList(status?: string, limit = 50): KbDoc[] {
  const where = ["deleted = 0"]
  if (status) where.push("status = ?")
  const sql = `SELECT * FROM kb_documents WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`
  const params: any[] = status ? [status, limit] : [limit]
  return getDb().query(sql).all(...params) as KbDoc[]
}

export function kbGetVersions(docId: number): KbVersion[] {
  return getDb().query("SELECT * FROM kb_versions WHERE doc_id = ? ORDER BY version DESC").all(docId) as KbVersion[]
}

export function kbAddQaPair(question: string, answer: string, source = "conversation", docId?: number): any {
  const db = getDb()
  const st = stamp()
  const ts = new Date().toISOString()
  const info = db.query("INSERT INTO qa_pairs (uuid, question, answer, source, doc_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(st.uuid, question, answer, source, docId ?? null, ts, ts)
  return { id: Number(info.lastInsertRowid), question, status: "pending" }
}

export function kbApproveQa(id: number): boolean {
  const r = getDb().query("UPDATE qa_pairs SET status = 'approved', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  return Number(r.changes) > 0
}

export function kbRejectQa(id: number): boolean {
  const r = getDb().query("UPDATE qa_pairs SET status = 'rejected', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  return Number(r.changes) > 0
}

export function kbListQa(status?: string, limit = 50): any[] {
  const where = ["deleted = 0"]
  if (status) where.push("status = ?")
  return getDb().query(`SELECT * FROM qa_pairs WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...(status ? [status, limit] : [limit])) as any[]
}