/**
 * Tenant management — multi-tenant isolation for kbserve.
 *
 * Each data table carries a `tenant_id TEXT DEFAULT 'default'` column so a
 * single kbserve instance can serve multiple enterprises/organizations with
 * fully isolated knowledge bases, conversations, feedback and user profiles.
 *
 * Backward compatibility: existing rows default to the `default` tenant, so no
 * data migration is required when upgrading.
 */
import { getDb, now, stamp } from "./db"
import { randomUUID } from "crypto"

export type Tenant = {
  id: number
  uuid: string
  name: string
  slug: string
  config: Record<string, any>
  status: "active" | "disabled"
  created_at: string
  updated_at: string
  deleted: number
}

export const DEFAULT_TENANT = "default"

/** kbserve data tables that must carry a tenant_id column. */
const TENANT_TABLES = [
  "kb_documents",
  "kb_versions",
  "qa_pairs",
  "kb_feedback",
  "conversations",
  "user_profile",
] as const

export function ensureTenantTables(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      config TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active',
      created_at TEXT,
      updated_at TEXT,
      deleted INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug, deleted);
  `)
  seedDefaultTenant()
}

/** Ensure the `default` tenant exists so un-tagged data is always addressable. */
function seedDefaultTenant(): void {
  const db = getDb()
  const existing = db.query("SELECT id FROM tenants WHERE slug = ? AND deleted = 0").get(DEFAULT_TENANT)
  if (existing) return
  const st = stamp()
  const ts = now()
  db.query("INSERT OR IGNORE INTO tenants (uuid, name, slug, config, status, created_at, updated_at, deleted) VALUES (?, ?, ?, '{}', 'active', ?, ?, 0)")
    .run(st.uuid, "Default Tenant", DEFAULT_TENANT, ts, ts)
}

/** Idempotently add a tenant_id column to a data table (defaults to 'default'). */
export function ensureTenantColumn(table: string): void {
  try {
    getDb().exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT DEFAULT 'default'`)
  } catch {
    // Column already exists (or table is not present yet) — safe to ignore.
  }
  try {
    getDb().exec(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table} (tenant_id, deleted)`)
  } catch {}
}

/** Add tenant_id to every kbserve data table. Idempotent. */
export function ensureTenantColumns(): void {
  for (const t of TENANT_TABLES) ensureTenantColumn(t)
}

function makeSlug(name: string): string {
  const base = (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
  if (base) return base
  return `t${Date.now().toString(36)}`
}

function parseRow(row: any): Tenant {
  let config: Record<string, any> = {}
  try {
    config = JSON.parse(row?.config || "{}")
  } catch {}
  return { ...row, config } as Tenant
}

export function tenantCreate(name: string, slug?: string, config: Record<string, any> = {}): Tenant {
  const db = getDb()
  const st = stamp()
  const ts = now()
  let finalSlug = (slug || makeSlug(name)).trim().toLowerCase()
  if (db.query("SELECT id FROM tenants WHERE slug = ?").get(finalSlug)) {
    finalSlug = `${finalSlug}-${randomUUID().slice(0, 4)}`
  }
  const info = db.query("INSERT INTO tenants (uuid, name, slug, config, status, created_at, updated_at, deleted) VALUES (?, ?, ?, ?, 'active', ?, ?, 0)")
    .run(st.uuid, name, finalSlug, JSON.stringify(config), ts, ts)
  const row = db.query("SELECT * FROM tenants WHERE id = ?").get(Number(info.lastInsertRowid))
  return parseRow(row)
}

export function tenantList(): Tenant[] {
  return (getDb().query("SELECT * FROM tenants WHERE deleted = 0 ORDER BY created_at ASC, id ASC").all() as any[]).map(parseRow)
}

export function tenantGet(id: number): Tenant | null {
  const row = getDb().query("SELECT * FROM tenants WHERE id = ? AND deleted = 0").get(id) as any
  return row ? parseRow(row) : null
}

export function tenantGetBySlug(slug: string): Tenant | null {
  const row = getDb().query("SELECT * FROM tenants WHERE slug = ? AND deleted = 0").get(slug || "") as any
  return row ? parseRow(row) : null
}

export function tenantUpdate(id: number, fields: { name?: string; slug?: string; config?: Record<string, any>; status?: string }): Tenant | null {
  const existing = tenantGet(id)
  if (!existing) return null
  const db = getDb()
  const ts = now()
  const sets: string[] = []
  const params: unknown[] = []
  if (fields.name !== undefined) { sets.push("name = ?"); params.push(fields.name) }
  if (fields.slug !== undefined) { sets.push("slug = ?"); params.push(String(fields.slug).trim().toLowerCase()) }
  if (fields.config !== undefined) { sets.push("config = ?"); params.push(typeof fields.config === "string" ? fields.config : JSON.stringify(fields.config)) }
  if (fields.status !== undefined) { sets.push("status = ?"); params.push(fields.status) }
  if (!sets.length) return existing
  sets.push("updated_at = ?")
  params.push(ts, id)
  db.query(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ? AND deleted = 0`).run(...params)
  return tenantGet(id)
}

/** Soft-delete a tenant. The `default` tenant is protected. */
export function tenantDelete(id: number): boolean {
  const t = tenantGet(id)
  if (!t || t.slug === DEFAULT_TENANT) return false
  const r = getDb().query("UPDATE tenants SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0").run(now(), id)
  return Number(r.changes) > 0
}