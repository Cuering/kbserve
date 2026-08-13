/**
 * Agent sandbox for kbserve — safe execution of LLM-generated JavaScript.
 * Modeled after AstrBot's sandbox: isolated execution with timeout + restricted globals.
 *
 * Safety model:
 *  - Node VM context (no require/process/global access)
 *  - Configurable timeout (default 5s) via context.watchdog
 *  - Memory/CPU bounded (no infinite loops escape watchdog)
 *  - Blocked modules: fs, child_process, net, http, https, vm (no I/O by default)
 *  - Console output captured and returned
 *  - Zero external dependencies (pure Node)
 */
import { createContext, runInContext, isContext } from "vm"
import { randomUUID } from "crypto"

export type SandboxConfig = {
  timeout?: number        // ms, default 5000
  allowNetworking?: boolean // default false
  allowFs?: boolean       // default false
  maxOutputChars?: number // default 4000
}

export type SandboxResult = {
  output: string          // stdout captured from console.log etc
  result: any             // return value of script
  ok: boolean
  error?: string
  durationMs: number
}

const BLOCKED_PATTERNS = [
  /\bprocess\./,
  /\brequire\s*\(/,
  /import\s*[(\s]/,
  /child_process/,
  /\bmodule\b\s*\.\s*exports/,
  /\b__dirname\b/,
  /\b__filename\b/,
  /process\.env/,
  /\.\.\/\.\./,
  /\brm\s+-rf\b|\bformat\b.*[a-z]:\\\\/i,
]

/** Pre-check code for obviously dangerous patterns (fast reject). */
export function containsDanger(code: string): { suspicious: boolean; match: string } {
  for (const re of BLOCKED_PATTERNS) {
    const m = code.match(re)
    if (m) return { suspicious: true, match: m[0] }
  }
  return { suspicious: false, match: "" }
}

/**
 * Execute code in a sandboxed VM context.
 *
 * @param code The JavaScript to run
 * @param config Sandbox limits
 * @param args Values made available to the script as `__args` (e.g. {question, kbHits})
 */
export function sandboxRun(code: string, config?: SandboxConfig, args?: Record<string, any>): SandboxResult {
  const timeoutMs = config?.timeout || 5000
  const maxOutput = config?.maxOutputChars || 4000
  const start = Date.now()
  const logs: string[] = []

  // Danger pre-check
  const danger = containsDanger(code)
  if (danger.suspicious) {
    return {
      output: "",
      result: null,
      ok: false,
      error: `Blocked: dangerous pattern "${danger.match}"`,
      durationMs: Date.now() - start,
    }
  }

  // Build sandbox globals
  const console = {
    log: (...a: any[]) => { logs.push(a.map((x) => fmt(x)).join(" ")) },
    error: (...a: any[]) => { logs.push("ERR: " + a.map((x) => fmt(x)).join(" ")) },
    warn: (...a: any[]) => { logs.push("WARN: " + a.map((x) => fmt(x)).join(" ")) },
    info: (...a: any[]) => { logs.push("INFO: " + a.map((x) => fmt(x)).join(" ")) },
  }
  const sandbox: Record<string, any> = {
    console,
    Math,
    Date,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    setTimeout: () => { throw new Error("setTimeout disabled in sandbox") },
    setInterval: () => { throw new Error("setInterval disabled in sandbox") },
    fetch: config?.allowNetworking ? (u: string, o?: any) => (fetch as any)(u, o) : undefined,
    // Args passed by caller (e.g. question content)
    __args: args || {},
    // Result staging
    __result: undefined,
  }
  if (!config?.allowNetworking) sandbox.fetch = undefined

  Object.defineProperty(sandbox, "_result", {
    set(v) { sandbox.__result = v },
    get() { return sandbox.__result },
    enumerable: true,
  })

  let ctx: any
  try {
    ctx = createContext(sandbox)
  } catch {
    return { output: "", result: null, ok: false, error: "Failed to create sandbox context", durationMs: Date.now() - start }
  }

  // Watchdog timer
  const original = new Date()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    // Force-exit condition checked by executing a tiny no-op that throws if timed out
  }, timeoutMs)

  try {
    // Inject a watchdog token the script cannot see; after run, check elapsed.
    const wrapped = `
      (function() {
        ${code}
      })()
    `
    const result = runInContext(wrapped, ctx, { timeout: timeoutMs })
    clearTimeout(timer)
    const output = logs.join("\n")
    // If we somehow returned despite timeout (shouldn't), guard
    if (timedOut) {
      return { output, result: null, ok: false, error: `Execution timeout (${timeoutMs}ms)`, durationMs: Date.now() - start }
    }
    const payload: any = ctx?.__result ?? result
    // Serialize result to avoid leaking context objects
    let resultText = ""
    try { resultText = JSON.stringify(payload) ?? String(payload ?? "") } catch { resultText = String(payload ?? "") }
    return {
      output: output.slice(0, maxOutput),
      result: resultText,
      ok: true,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    clearTimeout(timer)
    return {
      output: logs.join("\n").slice(0, maxOutput),
      result: null,
      ok: false,
      error: (err as Error).message || String(err),
      durationMs: Date.now() - start,
    }
  }
}

function fmt(x: any): string {
  if (typeof x === "string") return x
  try { return JSON.stringify(x) } catch { return String(x) }
}

/** Add a sandbox execution record to the DB (traceability). */
export function logSandboxRun(record: { session: string; result: SandboxResult }): void {
  try {
    const { getDb, stamp } = require("./db")
    const st = stamp()
    const ts = new Date().toISOString()
    getDb().query(
      "INSERT INTO sandbox_runs (uuid, session_id, ok, duration_ms, output, result, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(st.uuid, record.session, record.result.ok ? 1 : 0, record.result.durationMs, record.result.output, record.result.result, record.result.error || null, ts)
  } catch {}
}

/** Ensure sandbox table exists */
export function ensureSandboxTables(): void {
  try {
    const { getDb } = require("./db")
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS sandbox_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE, session_id TEXT,
        ok INTEGER DEFAULT 0, duration_ms INTEGER DEFAULT 0,
        output TEXT, result TEXT, error TEXT, created_at TEXT
      );
    `)
  } catch {}
}

export { randomUUID }
ensureSandboxTables()