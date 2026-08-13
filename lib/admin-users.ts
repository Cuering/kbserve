/**
 * Multi-admin user management — accounts, roles, permissions, login sessions.
 * Replaces the simple single-token auth with proper multi-user support.
 */
import { getDb, stamp } from "./db"
import { createHash, randomBytes } from "crypto"

export type AdminUser = {
  id: number
  uuid: string
  username: string
  role: "admin" | "editor" | "viewer"
  display_name: string
  created_at: string
  updated_at: string
  deleted: number
}

export type AdminSession = {
  id: number
  user_id: number
  token: string
  expires_at: string
  created_at: string
}

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex")
}

function generateToken(): string {
  return "kbs-" + randomBytes(24).toString("hex")
}

export function ensureAdminTables(): void {
  try {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE, username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, role TEXT DEFAULT 'editor',
        display_name TEXT DEFAULT '', created_at TEXT, updated_at TEXT,
        deleted INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL,
        expires_at TEXT, created_at TEXT
      );
    `)
  } catch {}
}

/** Create the first admin account (seeded if no admins exist) */
export function seedAdmin(): void {
  const db = getDb()
  const count = (db.query("SELECT COUNT(*) AS n FROM admin_users WHERE deleted = 0").get() as any).n
  if (count === 0) {
    const st = stamp()
    const ts = new Date().toISOString()
    const hash = hashPassword("admin")
    db.query("INSERT INTO admin_users (uuid, username, password_hash, role, display_name, created_at, updated_at) VALUES (?, 'admin', ?, 'admin', 'Administrator', ?, ?)")
      .run(st.uuid, hash, ts, ts)
    console.log("  seeded default admin account: admin / admin")
  }
}

export function login(username: string, password: string): { ok: boolean; token?: string; user?: any; error?: string } {
  const db = getDb()
  const user = db.query("SELECT * FROM admin_users WHERE username = ? AND deleted = 0").get(username) as any
  if (!user) return { ok: false, error: "User not found" }
  if (user.password_hash !== hashPassword(password)) return { ok: false, error: "Invalid password" }
  const token = generateToken()
  const ts = new Date().toISOString()
  const expires = new Date(Date.now() + 7 * 86400000).toISOString()
  db.query("INSERT INTO admin_sessions (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)").run(user.id, token, expires, ts)
  return { ok: true, token, user: { id: user.uuid, username: user.username, role: user.role, display_name: user.display_name } }
}

export function verifySession(token: string): AdminUser | null {
  if (!token) return null
  const db = getDb()
  const session = db.query("SELECT * FROM admin_sessions WHERE token = ? AND expires_at > ?").get(token, new Date().toISOString()) as any
  if (!session) return null
  const user = db.query("SELECT * FROM admin_users WHERE id = ? AND deleted = 0").get(session.user_id) as any
  return user || null
}

export function logout(token: string): void {
  getDb().query("DELETE FROM admin_sessions WHERE token = ?").run(token)
}

export function listUsers(): any[] {
  return getDb().query("SELECT uuid, username, role, display_name, created_at FROM admin_users WHERE deleted = 0 ORDER BY created_at").all()
}

export function createUser(username: string, password: string, role: string = "editor", displayName: string = ""): any {
  const db = getDb()
  const existing = db.query("SELECT id FROM admin_users WHERE username = ? AND deleted = 0").get(username)
  if (existing) return { error: "Username already exists" }
  const st = stamp()
  const ts = new Date().toISOString()
  const hash = hashPassword(password)
  db.query("INSERT INTO admin_users (uuid, username, password_hash, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(st.uuid, username, hash, role, displayName, ts, ts)
  return { ok: true, username, role }
}

export function deleteUser(uuid: string): boolean {
  const r = getDb().query("UPDATE admin_users SET deleted = 1, updated_at = ? WHERE uuid = ?").run(new Date().toISOString(), uuid)
  return Number(r.changes) > 0
}

export function changePassword(uuid: string, oldPassword: string, newPassword: string): { ok: boolean; error?: string } {
  const db = getDb()
  const user = db.query("SELECT * FROM admin_users WHERE uuid = ? AND deleted = 0").get(uuid) as any
  if (!user) return { ok: false, error: "User not found" }
  if (user.password_hash !== hashPassword(oldPassword)) return { ok: false, error: "Current password is incorrect" }
  db.query("UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(newPassword), new Date().toISOString(), user.id)
  return { ok: true }
}

ensureAdminTables()
seedAdmin()