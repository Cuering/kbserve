/**
 * Plugin marketplace — discover, install, and manage plugins from GitHub.
 * Supports: one-click install from GitHub repos, version checking, dependency resolution.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { getDb } from "./db"
import { scanPlugins, ensurePluginsDir, parseAstrbotMeta } from "./plugins"

const MARKETPLACE_INDEX_URL = "https://raw.githubusercontent.com/Cuering/kbserve-plugins/main/index.json"
const PLUGINS_DIR = join(process.env.EVOLVE_HOME || join(homedir(), ".kbserve"), "plugins")

export type MarketplacePlugin = {
  name: string
  version: string
  author: string
  description: string
  repo: string
  type: "astrbot" | "kbserve"
  downloads?: number
  updated_at?: string
}

/** Fetch the plugin marketplace index */
export async function fetchMarketplace(): Promise<MarketplacePlugin[]> {
  try {
    const res = await fetch(MARKETPLACE_INDEX_URL, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

/** Install a plugin from a GitHub repo */
export async function installPlugin(repo: string, name?: string): Promise<{ ok: boolean; message: string }> {
  try {
    ensurePluginsDir()
    const pluginName = name || repo.split("/").pop() || "plugin"
    const targetDir = join(PLUGINS_DIR, pluginName)

    if (existsSync(targetDir)) {
      return { ok: false, message: `Plugin "${pluginName}" already exists` }
    }

    // Try to download the plugin from GitHub
    const dlUrl = `https://api.github.com/repos/${repo}/contents`
    const res = await fetch(dlUrl, {
      headers: { Accept: "application/vnd.github.v3.raw" },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      return { ok: false, message: `Cannot access repo: ${repo} (${res.status})` }
    }

    // Create plugin directory and download files
    mkdirSync(targetDir, { recursive: true })
    const files = await res.json()
    let downloaded = 0
    for (const file of Array.isArray(files) ? files : []) {
      if (file.type === "file" && (file.name.endsWith(".ts") || file.name.endsWith(".js") || file.name === ".astrbot-plugin" || file.name === "package.json")) {
        try {
          const content = await fetch(file.download_url, { signal: AbortSignal.timeout(10000) }).then((r) => r.text())
          writeFileSync(join(targetDir, file.name), content)
          downloaded++
        } catch {}
      }
    }

    if (downloaded === 0) {
      // Clean up empty directory
      try { require("fs").rmSync(targetDir, { recursive: true, force: true }) } catch {}
      return { ok: false, message: "No installable files found in repo" }
    }

    // Rescan plugins
    scanPlugins()
    return { ok: true, message: `Installed "${pluginName}" (${downloaded} files)` }
  } catch (e) {
    return { ok: false, message: `Install failed: ${(e as Error).message}` }
  }
}

/** Uninstall a plugin */
export function uninstallPlugin(name: string): { ok: boolean; message: string } {
  const dir = join(PLUGINS_DIR, name)
  if (!existsSync(dir)) return { ok: false, message: `Plugin "${name}" not found` }
  try {
    require("fs").rmSync(dir, { recursive: true, force: true })
    scanPlugins()
    return { ok: true, message: `Uninstalled "${name}"` }
  } catch (e) {
    return { ok: false, message: `Uninstall failed: ${(e as Error).message}` }
  }
}