/**
 * Report generation — user profile analysis, conversation summary, PDF/JSON export.
 */
import { getDb } from "./db"
import { userList } from "./user"
import { DEFAULT_TENANT } from "./tenant"

export type Report = {
  id: number
  uuid: string
  user_id: string
  type: string
  content: string
  created_at: string
}

export function ensureReportTables(): void {
  try {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS kb_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE, user_id TEXT, type TEXT DEFAULT 'profile',
        content TEXT, created_at TEXT
      );
    `)
  } catch {}
}

export function generateUserReport(userId: string, tenantId = DEFAULT_TENANT): string {
  const profile = userList(tenantId)
  const conversations = getDb().query("SELECT * FROM conversations WHERE user_id = ? AND tenant_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 10").all(userId, tenantId) as any[]
  const feedback = getDb().query("SELECT * FROM kb_feedback WHERE user_id = ? AND tenant_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 20").all(userId, tenantId) as any[]

  const lines = [`# 用户分析报告 — ${userId}`, `生成时间: ${new Date().toISOString()}`]
  lines.push("")
  lines.push("## 用户画像")
  if (profile.length) {
    for (const p of profile) lines.push(`- ${p.keyword}: ${p.content}`)
  } else {
    lines.push("（无画像数据）")
  }
  lines.push("")
  lines.push("## 会话记录")
  for (const c of conversations) {
    lines.push(`- ${c.created_at?.slice(0, 10)}: ${c.title || "（无标题）"} (${c.message_count} 条消息)`)
  }
  lines.push("")
  lines.push("## 反馈统计")
  const ratings = feedback.map((f) => f.rating).filter((r) => r > 0)
  if (ratings.length) {
    const avg = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    lines.push(`- 总反馈: ${feedback.length} 条`)
    lines.push(`- 平均评分: ${avg}/5`)
    lines.push(`- 差评(≤2): ${ratings.filter((r) => r <= 2).length} 条`)
  } else {
    lines.push("（暂无反馈数据）")
  }
  return lines.join("\n")
}

export function generateAllUsersReport(tenantId = DEFAULT_TENANT): string {
  const users = getDb().query("SELECT DISTINCT user_id FROM conversations WHERE tenant_id = ? AND deleted = 0").all(tenantId) as any[]
  const lines = ["# 用户分析汇总报告", `生成时间: ${new Date().toISOString()}`, ""]
  lines.push(`总用户数: ${users.length}`)
  for (const u of users) {
    const convs = getDb().query("SELECT COUNT(*) AS n FROM conversations WHERE user_id = ? AND tenant_id = ? AND deleted = 0").get(u.user_id, tenantId) as any
    const fb = getDb().query("SELECT COUNT(*) AS n, AVG(rating) AS avg FROM kb_feedback WHERE user_id = ? AND tenant_id = ? AND deleted = 0 AND rating > 0").get(u.user_id, tenantId) as any
    lines.push(`- ${u.user_id}: ${convs.n} 会话, ${fb.n} 反馈, 平均评分 ${(fb.avg || 0).toFixed(1)}`)
  }
  return lines.join("\n")
}