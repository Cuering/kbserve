/**
 * MCP (Model Context Protocol) support for kbserve.
 * Exposes knowledge base operations as MCP tools, so MCP-compatible LLM clients
 * (Claude, Cursor, etc.) can call kbserve resources through the standard protocol.
 *
 * MCP uses JSON-RPC 2.0 over stdio/HTTP-SSE for transport.
 * This implements the HTTP transport: /mcp (POST JSON-RPC).
 */
import { kbSearch, kbList, kbAdd, kbUpdate, kbDelete, kbGetVersions } from "./knowledge"
import { qaAsk } from "./qa"
import { getDb } from "./db"

const TOOLS = [
  {
    name: "kb_search",
    description: "Search the knowledge base for relevant documents",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Search query" }, limit: { type: "number", default: 5 } }, required: ["query"] },
  },
  {
    name: "kb_list",
    description: "List all knowledge base documents",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "archived", "pending"] }, limit: { type: "number", default: 20 } } },
  },
  {
    name: "kb_add",
    description: "Add a document to the knowledge base",
    inputSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, tags: { type: "string" } }, required: ["title", "content"] },
  },
  {
    name: "kb_update",
    description: "Update an existing knowledge base document",
    inputSchema: { type: "object", properties: { id: { type: "number" }, title: { type: "string" }, content: { type: "string" }, tags: { type: "string" } }, required: ["id"] },
  },
  {
    name: "qa_ask",
    description: "Ask the knowledge base a question and get an answer",
    inputSchema: { type: "object", properties: { question: { type: "string" }, userId: { type: "string" } }, required: ["question"] },
  },
  {
    name: "kb_stats",
    description: "Get knowledge base statistics",
    inputSchema: { type: "object", properties: {} },
  },
]

function callTool(name: string, args: any): { content: Array<{ type: string; text: string }>; isError?: boolean } {
  try {
    switch (name) {
      case "kb_search": {
        const results = kbSearch(args.query || "", args.limit || 5)
        return { content: [{ type: "text", text: JSON.stringify(results.map((d) => ({ id: d.id, title: d.title, content: d.content, tags: d.tags }))) }] }
      }
      case "kb_list": {
        const docs = kbList(args.status || undefined, args.limit || 20)
        return { content: [{ type: "text", text: JSON.stringify(docs.map((d) => ({ id: d.id, title: d.title, tags: d.tags, version: d.version, status: d.status }))) }] }
      }
      case "kb_add": {
        const doc = kbAdd(args.title, args.content, args.tags || "")
        return { content: [{ type: "text", text: JSON.stringify(doc) }] }
      }
      case "kb_update": {
        const doc = kbUpdate(args.id, args.title, args.content, args.tags)
        return { content: [{ type: "text", text: JSON.stringify(doc) }] }
      }
      case "qa_ask": {
        // Note: qa_ask needs auth.json provider; returns async. We make this async-capable below.
        throw new Error("qa_ask must be called via async path")
      }
      case "kb_stats": {
        const db = getDb()
        const count = (db.query("SELECT COUNT(*) AS n FROM kb_documents WHERE deleted = 0").get() as any).n
        const active = (db.query("SELECT COUNT(*) AS n FROM kb_documents WHERE deleted = 0 AND status = 'active'").get() as any).n
        return { content: [{ type: "text", text: JSON.stringify({ total: count, active }) }] }
      }
      default:
        return { content: [{ type: "text", text: JSON.stringify({ error: `unknown tool: ${name}` }) }], isError: true }
    }
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ error: (e as Error).message }) }], isError: true }
  }
}

async function callToolAsync(name: string, args: any): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  if (name === "qa_ask") {
    try {
      const result = await qaAsk(args.question, args.userId, 5)
      return { content: [{ type: "text", text: JSON.stringify(result) }] }
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: (e as Error).message }) }], isError: true }
    }
  }
  return callTool(name, args)
}

/**
 * Handle an MCP JSON-RPC request.
 * Implements: initialize, tools/list, tools/call, ping.
 */
export async function handleMcpRequest(raw: string): Promise<any> {
  let req: any
  try { req = JSON.parse(raw) } catch { return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } } }

  const { jsonrpc, id, method, params } = req
  if (jsonrpc !== "2.0") return { jsonrpc: "2.0", id, error: { code: -32600, message: "invalid request" } }

  switch (method) {
    case "initialize":
      return {
        jsonrpc, id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "kbserve-mcp", version: "0.1.0" },
        },
      }
    case "notifications/initialized":
      return null // notification, no response
    case "tools/list":
      return { jsonrpc, id, result: { tools: TOOLS } }
    case "tools/call": {
      const toolName = params?.name || ""
      const toolArgs = params?.arguments || {}
      const result = await callToolAsync(toolName, toolArgs)
      return { jsonrpc, id, result }
    }
    case "ping":
      return { jsonrpc, id, result: {} }
    case "resources/list":
      return { jsonrpc, id, result: { resources: [] } } // no static resources exposed
    default:
      return { jsonrpc, id, error: { code: -32601, message: `method not found: ${method}` } }
  }
}

/** Check if MCP client sends the expected protocol handshake */
export function isMcpRequest(raw: string): boolean {
  try {
    const req = JSON.parse(raw)
    return req?.method === "initialize" || req?.method === "tools/list" || req?.method === "tools/call" || req?.method === "prompts/list"
  } catch { return false }
}