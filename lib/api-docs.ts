/**
 * API documentation generator — OpenAPI-style JSON spec.
 */
import { APP_NAME, APP_VERSION } from "./app"

export function generateOpenApiSpec(baseUrl: string): any {
  return {
    openapi: "3.0.0",
    info: {
      title: APP_NAME,
      version: APP_VERSION,
      description: "Knowledge Base + Customer Service API",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/qa": {
        post: {
          summary: "Ask a question",
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { question: { type: "string" }, userId: { type: "string" }, topK: { type: "integer" } }, required: ["question"] } } } },
          responses: { "200": { description: "Answer with sources" } },
        },
      },
      "/qa/feedback": {
        post: { summary: "Submit feedback", requestBody: { content: { "application/json": { schema: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" }, rating: { type: "integer" }, comment: { type: "string" }, userId: { type: "string" } }, required: ["question", "answer", "rating"] } } } }, responses: { "200": { description: "OK" } } },
      },
      "/v1/chat/completions": {
        post: { summary: "OpenAI-compatible chat completion", requestBody: { content: { "application/json": { schema: { type: "object", properties: { model: { type: "string" }, messages: { type: "array" }, user: { type: "string" } }, required: ["messages"] } } } }, responses: { "200": { description: "Chat completion response" } } },
      },
      "/kb/search": {
        get: { summary: "Search knowledge base", parameters: [{ name: "q", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Document list" } } },
      },
      "/conv/start": {
        post: { summary: "Start a conversation", requestBody: { content: { "application/json": { schema: { type: "object", properties: { userId: { type: "string" }, userName: { type: "string" }, title: { type: "string" } } } } } }, responses: { "200": { description: "Conversation" } } },
      },
      "/conv/list": {
        get: { summary: "List conversations", parameters: [{ name: "userId", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Conversation list" } } },
      },
      "/webhook": {
        post: { summary: "Webhook endpoint for external IM platforms", requestBody: { content: { "application/json": { schema: { type: "object", properties: { content: { type: "string" }, userId: { type: "string" } } } } } }, responses: { "200": { description: "Reply" } } },
      },
      "/health": {
        get: { summary: "Health check", responses: { "200": { description: "OK" } } },
      },
      "/admin/stats": {
        get: { summary: "System statistics", responses: { "200": { description: "Stats" } } },
      },
      "/admin/kb/list": {
        get: { summary: "List knowledge base documents", responses: { "200": { description: "Document list" } } },
      },
      "/admin/kb/add": {
        post: { summary: "Add a document", requestBody: { content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, tags: { type: "string" } }, required: ["title", "content"] } } } }, responses: { "200": { description: "Created" } } },
      },
      "/admin/kb/delete": {
        post: { summary: "Delete a document", requestBody: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } } } }, responses: { "200": { description: "OK" } } },
      },
      "/admin/qa/list": {
        get: { summary: "List Q&A pairs", responses: { "200": { description: "QA list" } } },
      },
      "/admin/qa/approve": {
        post: { summary: "Approve a Q&A pair", requestBody: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } } } }, responses: { "200": { description: "OK" } } },
      },
      "/admin/feedback": {
        get: { summary: "List unreviewed feedback", responses: { "200": { description: "Feedback list" } } },
      },
      "/admin/persona/get": { get: { summary: "Get persona settings", responses: { "200": { description: "Persona" } } } },
      "/admin/persona/set": { post: { summary: "Update persona settings", requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, greeting: { type: "string" }, about: { type: "string" } } } } } }, responses: { "200": { description: "OK" } } } },
      "/admin/marketplace/list": { get: { summary: "List available marketplace plugins", responses: { "200": { description: "Plugin list" } } } },
      "/admin/marketplace/install": { post: { summary: "Install a plugin from GitHub", requestBody: { content: { "application/json": { schema: { type: "object", properties: { repo: { type: "string" }, name: { type: "string" } }, required: ["repo"] } } } }, responses: { "200": { description: "Install result" } } } },
      "/admin/export/report": { post: { summary: "Export user report as HTML", requestBody: { content: { "application/json": { schema: { type: "object", properties: { type: { type: "string" }, userId: { type: "string" } } } } } }, responses: { "200": { description: "HTML report" } } } },
      "/admin/import": { post: { summary: "Batch import documents from files", requestBody: { content: { "application/json": { schema: { type: "object", properties: { path: { type: "string" }, tags: { type: "string" } } } } } }, responses: { "200": { description: "Import result" } } } },
    },
  }
}

export function generateApiDocHtml(baseUrl: string): string {
  const spec = generateOpenApiSpec(baseUrl)
  const paths = Object.entries(spec.paths)
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API Docs - ${APP_NAME}</title>
<style>body{font:14px/1.5 -apple-system,sans-serif;max-width:960px;margin:0 auto;padding:20px;color:#1c2733}h1{font-size:22px;border-bottom:2px solid #3b6fe0;padding-bottom:8px}h2{font-size:16px;color:#3b6fe0;margin-top:24px}.endpoint{background:#f5f7fa;border:1px solid #e1e4e8;border-radius:8px;padding:12px 16px;margin:8px 0}.method{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#fff;margin-right:8px}.method-get{background:#2e9e62}.method-post{background:#3b6fe0}.path{font-family:monospace;font-size:14px}.desc{color:#5c6b7a;font-size:13px;margin-top:4px}pre{background:#f8f9fa;padding:10px;border-radius:6px;overflow:auto;font-size:12px}code{font-size:12px}</style></head><body>
<h1>${APP_NAME} API</h1><p>Version ${APP_VERSION} | <a href="javascript:location.reload()">Refresh</a></p>`
  for (const [path, methods] of paths) {
    for (const [method, detail] of Object.entries(methods)) {
      html += `<div class=endpoint><span class="method method-${method}">${method.toUpperCase()}</span><span class=path>${path}</span><div class=desc>${detail.summary || ""}</div></div>`
    }
  }
  html += `</body></html>`
  return html
}