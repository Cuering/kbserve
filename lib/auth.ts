/**
 * Simple admin authentication for kbserve.
 * Token-based: a single admin token configured via env or settings.
 * No user registration needed - just one admin key for the management panel.
 */
import { getDb } from "./db"

const ADMIN_TOKEN_ENV = process.env.KBSERVE_ADMIN_TOKEN || ""

/** Verify an admin token */
export function verifyToken(token: string): boolean {
  if (!token) return false
  // Check env var first
  if (ADMIN_TOKEN_ENV && token === ADMIN_TOKEN_ENV) return true
  // Check DB config
  const stored = getDb().query("SELECT value FROM config WHERE key = 'admin_token'").get() as any
  if (stored && token === stored.value) return true
  return false
}

/** Generate a random admin token */
export function generateToken(): string {
  return "kb-" + Array.from({ length: 24 }, () => Math.random().toString(36)[2]).join("")
}

/** Set a new admin token */
export function setToken(token: string): void {
  const ts = new Date().toISOString()
  const existing = getDb().query("SELECT key FROM config WHERE key = 'admin_token'").get()
  if (existing) {
    getDb().query("UPDATE config SET value = ?, updated_at = ? WHERE key = 'admin_token'").run(token, ts)
  } else {
    getDb().query("INSERT INTO config (key, value, created_at, updated_at) VALUES ('admin_token', ?, ?, ?)").run(token, ts, ts)
  }
}

/** Get the current admin token (masked) */
export function getToken(): string {
  const stored = getDb().query("SELECT value FROM config WHERE key = 'admin_token'").get() as any
  return stored?.value || ADMIN_TOKEN_ENV || ""
}

/** Check if auth is configured */
export function isAuthConfigured(): boolean {
  return !!(ADMIN_TOKEN_ENV || getToken())
}