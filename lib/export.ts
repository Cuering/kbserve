/**
 * Report export — generates PDF-ready HTML reports.
 * Uses a print-friendly HTML format that can be saved as PDF via browser print.
 */
import { getDb } from "./db"
import { generateUserReport, generateAllUsersReport } from "./report"

function htmlReport(title: string, body: string, css?: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  body{font:14px/1.6 -apple-system,sans-serif;color:#1c2733;max-width:800px;margin:0 auto;padding:20px}
  h1{font-size:20px;border-bottom:2px solid #3b6fe0;padding-bottom:8px}
  h2{font-size:16px;color:#3b6fe0;margin-top:20px}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  th,td{padding:6px 10px;border:1px solid #ddd;text-align:left;font-size:13px}
  th{background:#f5f7fa;font-weight:500}
  .stats{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}
  .stat-card{border:1px solid #ddd;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px}
  .stat-card b{display:block;font-size:22px;color:#3b6fe0}
  .stat-card span{font-size:12px;color:#5c6b7a}
  @media print{body{padding:0}}
  ${css || ""}
</style></head>
<body>${body}</body></html>`
}

function escHtml(s: string): string {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]))
}

export function exportReportHtml(type: "user" | "all", userId?: string): string {
  const db = getDb()

  if (type === "user" && userId) {
    const report = generateUserReport(userId)
    const convs = db.query("SELECT * FROM conversations WHERE user_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 10").all(userId) as any[]
    const feedback = db.query("SELECT * FROM kb_feedback WHERE user_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 20").all(userId) as any[]
    const body = `
      <h1>用户分析报告</h1>
      <p>用户: ${escHtml(userId)} | 生成时间: ${new Date().toISOString()}</p>
      <div class=stats>
        <div class=stat-card><b>${convs.length}</b><span>会话</span></div>
        <div class=stat-card><b>${feedback.length}</b><span>反馈</span></div>
        <div class=stat-card><b>${feedback.filter(f => f.rating > 0).length ? (feedback.reduce((a,f) => a + (f.rating || 0), 0) / feedback.filter(f => f.rating > 0).length).toFixed(1) : "0"}</b><span>平均评分</span></div>
      </div>
      <h2>会话记录</h2>
      <table><tr><th>时间</th><th>标题</th><th>消息数</th></tr>
      ${convs.map(c => `<tr><td>${(c.created_at||"").slice(0,10)}</td><td>${escHtml(c.title||"")}</td><td>${c.message_count}</td></tr>`).join("")}
      </table>
      <h2>反馈记录</h2>
      <table><tr><th>时间</th><th>评分</th><th>评论</th></tr>
      ${feedback.map(f => `<tr><td>${(f.created_at||"").slice(0,10)}</td><td>${"★".repeat(f.rating||0)}${"☆".repeat(5-(f.rating||0))}</td><td>${escHtml(f.comment||"")}</td></tr>`).join("")}
      </table>
      <h2>画像详情</h2>
      <pre style="font-size:12px;white-space:pre-wrap">${escHtml(report)}</pre>`
    return htmlReport("用户分析报告", body)
  }

  // All users report
  const users = db.query("SELECT DISTINCT user_id FROM conversations WHERE deleted = 0").all() as any[]
  const body = `
    <h1>用户分析汇总报告</h1>
    <p>生成时间: ${new Date().toISOString()}</p>
    <div class=stats>
      <div class=stat-card><b>${users.length}</b><span>用户数</span></div>
      <div class=stat-card><b>${(db.query("SELECT COUNT(*) AS n FROM conversations WHERE deleted = 0").get() as any).n}</b><span>总会话</span></div>
      <div class=stat-card><b>${(db.query("SELECT COUNT(*) AS n FROM kb_feedback WHERE deleted = 0").get() as any).n}</b><span>总反馈</span></div>
    </div>
    <h2>用户明细</h2>
    <table><tr><th>用户</th><th>会话</th><th>反馈</th><th>平均评分</th></tr>
    ${users.map(u => {
      const convs = (db.query("SELECT COUNT(*) AS n FROM conversations WHERE user_id = ? AND deleted = 0").get(u.user_id) as any).n
      const fb = db.query("SELECT COUNT(*) AS n, AVG(rating) AS avg FROM kb_feedback WHERE user_id = ? AND deleted = 0 AND rating > 0").get(u.user_id) as any
      return `<tr><td>${escHtml(u.user_id)}</td><td>${convs}</td><td>${fb.n}</td><td>${(fb.avg || 0).toFixed(1)}</td></tr>`
    }).join("")}
    </table>`
  return htmlReport("用户汇总报告", body)
}

export function exportKbHtml(): string {
  const docs = getDb().query("SELECT * FROM kb_documents WHERE deleted = 0 ORDER BY updated_at DESC").all() as any[]
  const body = `
    <h1>知识库文档清单</h1>
    <p>共计 ${docs.length} 篇文档 | 生成时间: ${new Date().toISOString()}</p>
    <table><tr><th>标题</th><th>标签</th><th>版本</th><th>状态</th><th>更新时间</th></tr>
    ${docs.map(d => `<tr><td>${escHtml(d.title)}</td><td>${escHtml(d.tags||"")}</td><td>v${d.version}</td><td>${d.status}</td><td>${(d.updated_at||"").slice(0,10)}</td></tr>`).join("")}
    </table>`
  return htmlReport("知识库文档清单", body)
}