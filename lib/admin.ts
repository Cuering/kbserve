/**
 * Admin — knowledge base management, feedback review, Q&A approval.
 */
import { kbList, kbUpdate, kbDelete, kbApproveQa, kbRejectQa, kbListQa, kbAdd } from "./knowledge"
import { feedbackList, feedbackMarkReviewed } from "./feedback"
import { generateUserReport, generateAllUsersReport } from "./report"
import { convList } from "./conversation"
import { userList } from "./user"
import { DEFAULT_TENANT } from "./tenant"

export const adminApi = {
  // Knowledge base
  kbList: (status?: string, tenantId = DEFAULT_TENANT) => kbList(status, 50, tenantId),
  kbUpdate: (id: number, title: string, content: string, tags?: string, tenantId = DEFAULT_TENANT) => kbUpdate(id, title, content, tags, tenantId),
  kbDelete: (id: number, tenantId = DEFAULT_TENANT) => kbDelete(id, tenantId),
  kbAdd: (title: string, content: string, tags?: string, tenantId = DEFAULT_TENANT) => kbAdd(title, content, tags ?? "", "admin", tenantId),

  // Q&A review
  qaList: (status?: string, tenantId = DEFAULT_TENANT) => kbListQa(status, 50, tenantId),
  qaApprove: (id: number, tenantId = DEFAULT_TENANT) => kbApproveQa(id, tenantId),
  qaReject: (id: number, tenantId = DEFAULT_TENANT) => kbRejectQa(id, tenantId),

  // Feedback
  feedbackList: (unreviewedOnly?: boolean, tenantId = DEFAULT_TENANT) => feedbackList(unreviewedOnly, 50, tenantId),
  feedbackMarkReviewed: (id: number, tenantId = DEFAULT_TENANT) => feedbackMarkReviewed(id, tenantId),

  // Reports
  userReport: (userId: string, tenantId = DEFAULT_TENANT) => generateUserReport(userId, tenantId),
  allUsersReport: (tenantId = DEFAULT_TENANT) => generateAllUsersReport(tenantId),

  // Overview
  stats: (tenantId = DEFAULT_TENANT) => {
    const db = require("./db").getDb()
    const kbCount = (db.query("SELECT COUNT(*) AS n FROM kb_documents WHERE deleted = 0 AND tenant_id = ?").get(tenantId) as any).n
    const fbCount = (db.query("SELECT COUNT(*) AS n FROM kb_feedback WHERE deleted = 0 AND reviewed = 0 AND tenant_id = ?").get(tenantId) as any).n
    const qaPending = (db.query("SELECT COUNT(*) AS n FROM qa_pairs WHERE deleted = 0 AND status = 'pending' AND tenant_id = ?").get(tenantId) as any).n
    const convCount = (db.query("SELECT COUNT(*) AS n FROM conversations WHERE deleted = 0 AND tenant_id = ?").get(tenantId) as any).n
    const userCount = (db.query("SELECT COUNT(DISTINCT user_id) AS n FROM conversations WHERE deleted = 0 AND tenant_id = ?").get(tenantId) as any).n
    return { kbCount, pendingFeedback: fbCount, pendingQa: qaPending, conversations: convCount, users: userCount }
  },
}