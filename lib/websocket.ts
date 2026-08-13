/**
 * Real-time notification system using WebSocket.
 * Pushes events to connected admin clients: new feedback, QA pending, system alerts.
 */
import type { Server } from "http"

export type WsEvent = {
  type: "feedback" | "qa_pending" | "system" | "import_done"
  title: string
  message: string
  timestamp: string
  meta?: any
}

const clients = new Set<WebSocket>()
let eventLog: WsEvent[] = []
const MAX_EVENTS = 100

/** Broadcast an event to all connected admin clients */
export function broadcast(event: WsEvent): void {
  event.timestamp = new Date().toISOString()
  eventLog.push(event)
  if (eventLog.length > MAX_EVENTS) eventLog.shift()
  const msg = JSON.stringify(event)
  for (const ws of clients) {
    try { ws.send(msg) } catch { clients.delete(ws) }
  }
}

/** Get recent events (for new connections to catch up) */
export function getRecentEvents(limit = 20): WsEvent[] {
  return eventLog.slice(-limit)
}

/** Upgrade an HTTP request to WebSocket (Bun native) */
export function upgradeToWs(req: Request): Response | null {
  const success = Bun.upgrade(req, {
    data: {},
    onOpen(ws) {
      clients.add(ws)
      // Send recent events for catch-up
      ws.send(JSON.stringify({ type: "connected", events: getRecentEvents(10) }))
    },
    onMessage(ws, message) {
      // Client can send ping to keep alive
      if (message === "ping") ws.send("pong")
    },
    onClose(ws) {
      clients.delete(ws)
    },
  })
  return success
}

/** For Node.js environments (fallback): use Server-Sent Events instead */
export function sseHandler(req: any, res: any): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  })
  // Send recent events
  for (const event of getRecentEvents()) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  // Keep connection open — server sends pings every 30s
  const interval = setInterval(() => {
    res.write(`: ping\n\n`)
  }, 30000)
  req.on("close", () => clearInterval(interval))
}