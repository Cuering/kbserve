import { getDb, now, stamp } from "./db"
import { DEFAULT_TENANT, ensureTenantColumn } from "./tenant"

export type UserProfile = {
  id: number
  uuid: string | null
  origin: string | null
  keyword: string
  content: string
  tenant_id: string
  created_at: string
  updated_at: string | null
  deleted: number
}

export function ensureUserTables(): void {
  try { ensureTenantColumn("user_profile") } catch {}
}

export function userAdd(keyword: string, content: string, tenantId = DEFAULT_TENANT) {
  const db = getDb()
  const existing = db.query("SELECT * FROM user_profile WHERE keyword = ? AND tenant_id = ?").get(keyword, tenantId) as UserProfile | undefined
  const ts = now()
  if (existing) {
    db.query("UPDATE user_profile SET content = ?, updated_at = ?, deleted = 0 WHERE id = ?").run(content, ts, existing.id)
    return { keyword, content, id: existing.id, uuid: existing.uuid }
  }
  const st = stamp()
  const info = db.query("INSERT INTO user_profile (uuid, origin, keyword, content, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(st.uuid, st.origin, keyword, content, tenantId, ts, ts)
  return { keyword, content, id: Number(info.lastInsertRowid), uuid: st.uuid }
}

export function userList(tenantId = DEFAULT_TENANT) {
  return getDb().query("SELECT keyword, content, created_at FROM user_profile WHERE tenant_id = ? AND deleted = 0 ORDER BY created_at DESC").all(tenantId)
}

export function userRemove(keyword: string, tenantId = DEFAULT_TENANT) {
  const res = getDb().query("UPDATE user_profile SET deleted = 1, updated_at = ? WHERE keyword = ? AND tenant_id = ? AND deleted = 0").run(now(), keyword, tenantId)
  return { removed: Number(res.changes) }
}