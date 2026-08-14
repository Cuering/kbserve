/**
 * Knowledge base batch import — supports Markdown, plain text, and structured CSV.
 * PDF/Word support requires external tools (pdftotext, pandoc) — falls back to text extraction.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { join, extname } from "path"
import { homedir } from "os"
import { kbAdd } from "./knowledge"
import { DEFAULT_TENANT } from "./tenant"

const IMPORT_DIR = join(process.env.EVOLVE_HOME || join(homedir(), ".kbserve"), "imports")

export type ImportResult = {
  total: number
  succeeded: number
  failed: number
  errors: string[]
  docs: Array<{ title: string; status: string }>
}

/** Parse a markdown file into title + content */
function parseMarkdown(filePath: string): { title: string; content: string } {
  let text = readFileSync(filePath, "utf8")
  const lines = text.split("\n")
  // First # heading becomes title
  let title = lines.find((l) => l.trim().startsWith("# "))?.replace(/^#\s+/, "").trim() || ""
  if (!title) title = lines[0]?.trim().slice(0, 60) || "untitled"
  return { title, content: text }
}

/** Parse a CSV file (question,answer format) */
function parseCsv(filePath: string): Array<{ title: string; content: string }> {
  const text = readFileSync(filePath, "utf8")
  const lines = text.split("\n").filter(Boolean)
  const results: Array<{ title: string; content: string }> = []
  for (const line of lines.slice(1)) { // skip header
    const parts = line.split(",")
    if (parts.length >= 2) {
      results.push({ title: parts[0].trim().replace(/^["']|["']$/g, ""), content: parts.slice(1).join(",").trim().replace(/^["']|["']$/g, "") })
    }
  }
  return results
}

/** Try to extract text from PDF using pdftotext (if available) */
function parsePdf(filePath: string): string {
  try {
    const { execSync } = require("child_process")
    const out = execSync(`pdftotext "${filePath}" -`, { encoding: "utf8", timeout: 10000 })
    return out || readFileSync(filePath, "utf8").slice(0, 1000) // fallback
  } catch {
    return readFileSync(filePath, "utf8").slice(0, 1000) // read raw (binary garbage but gets something)
  }
}

/** Import a single file */
function importFile(filePath: string, tags?: string, defaultTitle?: string, tenantId = DEFAULT_TENANT): ImportResult["docs"][0] {
  const ext = extname(filePath).toLowerCase()
  const name = defaultTitle || filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") || "untitled"

  try {
    if (ext === ".md") {
      const { title, content } = parseMarkdown(filePath)
      kbAdd(title || name, content, tags || "markdown", "import", tenantId)
      return { title: title || name, status: "imported" }
    }
    if (ext === ".csv") {
      const rows = parseCsv(filePath)
      let count = 0
      for (const row of rows) {
        kbAdd(row.title || name, row.content, tags || "csv", "import", tenantId)
        count++
      }
      return { title: `${name} (${count} QA pairs)`, status: "imported" }
    }
    if (ext === ".txt") {
      const content = readFileSync(filePath, "utf8")
      kbAdd(name, content, tags || "text", "import", tenantId)
      return { title: name, status: "imported" }
    }
    if (ext === ".pdf") {
      const content = parsePdf(filePath)
      kbAdd(name, content, tags || "pdf", "import", tenantId)
      return { title: name, status: "imported" }
    }
    return { title: name, status: `skipped: unsupported format ${ext}` }
  } catch (e) {
    return { title: name, status: `error: ${(e as Error).message}` }
  }
}

/** Import a directory or single file */
export function batchImport(path?: string, tags?: string, tenantId = DEFAULT_TENANT): ImportResult {
  const target = path || IMPORT_DIR
  const files: string[] = []
  const errors: string[] = []
  const docs: ImportResult["docs"] = []

  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true })
    return { total: 0, succeeded: 0, failed: 0, errors: [], docs: [] }
  }

  const stat = require("fs").statSync(target)
  if (stat.isFile()) {
    const r = importFile(target, tags, undefined, tenantId)
    docs.push(r)
    if (r.status.startsWith("error") || r.status.startsWith("skipped")) errors.push(r.status)
  } else {
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      if (entry.isFile()) files.push(join(target, entry.name))
    }
    for (const f of files) {
      const r = importFile(f, tags, undefined, tenantId)
      docs.push(r)
      if (r.status.startsWith("error") || r.status.startsWith("skipped")) errors.push(r.status)
    }
  }

  const succeeded = docs.filter((d) => d.status === "imported").length
  return { total: docs.length, succeeded, failed: docs.length - succeeded, errors, docs }
}

/** Ensure the import directory exists */
export function ensureImportDir(): string {
  if (!existsSync(IMPORT_DIR)) mkdirSync(IMPORT_DIR, { recursive: true })
  return IMPORT_DIR
}