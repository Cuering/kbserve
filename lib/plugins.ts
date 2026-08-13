/**
 * Plugin system for kbserve — compatible with AstrBot plugin metadata format.
 * Plugins are .ts/.js files in ~/.kbserve/plugins/ or .astrbot-plugin dirs.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { getDb } from "./db"

export type PluginMeta = {
  name: string
  version: string
  author: string
  desc: string
  repo?: string
  /** AstrBot compatibility: '.' prefix means hidden dotfile */
  astrbot_compat?: boolean
}

export type PluginInstance = {
  meta: PluginMeta
  enabled: boolean
  path: string
  hooks: Record<string, Function>
  config: Record<string, any>
}

const PLUGINS_DIR = join(process.env.EVOLVE_HOME || join(homedir(), ".kbserve"), "plugins")
const plugins: Map<string, PluginInstance> = new Map()

/** Ensure plugins dir exists */
export function ensurePluginsDir(): void {
  try {
    if (!existsSync(PLUGINS_DIR)) mkdirSync(PLUGINS_DIR, { recursive: true })
  } catch {}
}

/** Parse a .astrbot-plugin metadata file (YAML-like key: value format) */
export function parseAstrbotMeta(filePath: string): PluginMeta | null {
  try {
    const raw = readFileSync(filePath, "utf8")
    const lines = raw.split("\n").filter((l) => l.includes(":"))
    const get = (key: string) => {
      const l = lines.find((x) => x.trim().startsWith(key + ":"))
      return l ? l.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "") : ""
    }
    const name = get("name") || get("plugin_name")
    if (!name) return null
    return {
      name,
      version: get("version") || "0.1.0",
      author: get("author") || "unknown",
      desc: get("description") || get("desc") || "",
      repo: get("repo") || get("repository") || "",
      astrbot_compat: true,
    }
  } catch { return null }
}

/** Scan and load all plugins from the plugins directory */
export function scanPlugins(): PluginInstance[] {
  ensurePluginsDir()
  const loaded: PluginInstance[] = []
  try {
    for (const entry of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      const fullPath = join(PLUGINS_DIR, entry.name)
      let meta: PluginMeta | null = null

      if (entry.isDirectory()) {
        // AstrBot-style plugin directory: look for .astrbot-plugin metadata
        const metaFile = join(fullPath, ".astrbot-plugin")
        if (existsSync(metaFile)) {
          meta = parseAstrbotMeta(metaFile)
          if (meta) {
            // Try to load the main plugin file
            const mainFile = join(fullPath, "main.ts")
            const mainJs = join(fullPath, "main.js")
            const entryFile = existsSync(mainFile) ? mainFile : existsSync(mainJs) ? mainJs : null
            if (entryFile) {
              const inst: PluginInstance = {
                meta,
                enabled: true,
                path: fullPath,
                hooks: {},
                config: {},
              }
              plugins.set(meta.name, inst)
              loaded.push(inst)
            }
          }
        }
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
        // Simple single-file plugin
        const name = entry.name.replace(/\.(ts|js)$/, "")
        meta = { name, version: "0.1.0", author: "unknown", desc: "" }
        const inst: PluginInstance = {
          meta,
          enabled: true,
          path: fullPath,
          hooks: {},
          config: {},
        }
        plugins.set(name, inst)
        loaded.push(inst)
      }
    }
  } catch {}
  return loaded
}

export function getPlugins(): PluginInstance[] {
  return [...plugins.values()]
}

export function getPlugin(name: string): PluginInstance | undefined {
  return plugins.get(name)
}

export function togglePlugin(name: string): PluginInstance | undefined {
  const p = plugins.get(name)
  if (p) {
    p.enabled = !p.enabled
    // Persist to DB
    const db = getDb()
    const existing = db.query("SELECT * FROM plugin_config WHERE name = ?").get(name) as any
    if (existing) {
      db.query("UPDATE plugin_config SET enabled = ?, updated_at = ? WHERE name = ?").run(p.enabled ? 1 : 0, new Date().toISOString(), name)
    } else {
      db.query("INSERT INTO plugin_config (name, enabled, created_at, updated_at) VALUES (?, ?, ?, ?)").run(name, p.enabled ? 1 : 0, new Date().toISOString(), new Date().toISOString())
    }
  }
  return p
}

export function ensurePluginTables(): void {
  try {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS plugin_config (
        name TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}',
        created_at TEXT, updated_at TEXT
      );
    `)
  } catch {}
}

// Scan on import
ensurePluginTables()
scanPlugins()