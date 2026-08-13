/**
 * Admin — knowledge base management, feedback review, Q&A approval.
 */
import { kbList, kbUpdate, kbDelete, kbApproveQa, kbRejectQa, kbListQa, kbAdd } from "./knowledge"
import { feedbackList, feedbackMarkReviewed } from "./feedback"
import { generateUserReport, generateAllUsersReport } from "./report"
import { convList } from "./conversation"
import { userList } from "./user"

export const adminApi = {
  // Knowledge base
  kbList: (status?: string) => kbList(status),
  kbUpdate: (id: number, title: string, content: string, tags?: string) => kbUpdate(id, title, content, tags),
  kbDelete: (id: number) => kbDelete(id),
  kbAdd: (title: string, content: string, tags?: string) => kbAdd(title, content, tags ?? "", "admin"),

  // Q&A review
  qaList: (status?: string) => kbListQa(status),
  qaApprove: (id: number) => kbApproveQa(id),
  qaReject: (id: number) => kbRejectQa(id),

  // Feedback
  feedbackList: (unreviewedOnly?: boolean) => feedbackList(unreviewedOnly),
  feedbackMarkReviewed: (id: number) => feedbackMarkReviewed(id),

  // Reports
  userReport: (userId: string) => generateUserReport(userId),
  allUsersReport: () => generateAllUsersReport(),

  // Overview
  stats: () => {
    const db = require("./db").getDb()
    const kbCount = (db.query("SELECT COUNT(*) AS n FROM kb_documents WHERE deleted = 0").get() as any).n
    const fbCount = (db.query("SELECT COUNT(*) AS n FROM kb_feedback WHERE deleted = 0 AND reviewed = 0").get() as any).n
    const qaPending = (db.query("SELECT COUNT(*) AS n FROM qa_pairs WHERE deleted = 0 AND status = 'pending'").get() as any).n
    const convCount = (db.query("SELECT COUNT(*) AS n FROM conversations WHERE deleted = 0").get() as any).n
    const userCount = (db.query("SELECT COUNT(DISTINCT user_id) AS n FROM conversations WHERE deleted = 0").get() as any).n
    return { kbCount, pendingFeedback: fbCount, pendingQa: qaPending, conversations: convCount, users: userCount }
  },
}