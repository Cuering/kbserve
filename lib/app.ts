/**
 * kbserve — Knowledge Base + Customer Service Engine
 *
 * Reuses selfforge's core retrieval engine (bench.ts, retrieve.ts, ingest.ts)
 * and adds: knowledge base document management, LLM-powered Q&A, user profiling,
 * feedback collection, admin document management, and report generation.
 *
 * Architecture:
 *   serve.ts          — HTTP server entry (port 3090)
 *   lib/db.ts         — SQLite (copied from selfforge, extended schema)
 *   lib/bench.ts      — memory storage/retrieval (copied from selfforge)
 *   lib/retrieve.ts   — enhanced retrieval (copied from selfforge)
 *   lib/ingest.ts     — entity extraction (copied from selfforge)
 *   lib/user.ts       — user profile (copied from selfforge)
 *   lib/knowledge.ts  — knowledge base CRUD + versioning
 *   lib/qa.ts         — LLM Q&A (reuses auth.json from opencode)
 *   lib/conversation.ts — conversation management
 *   lib/feedback.ts   — user feedback collection
 *   lib/report.ts     — user analysis report generation
 *   lib/admin.ts      — admin operations
 *   dashboard/        — SPA web UI
 *
 * Data tables:
 *   kb_documents   — knowledge base documents
 *   kb_versions    — document version history
 *   kb_feedback    — user feedback on answers
 *   qa_pairs       — approved Q&A pairs
 *   user_profiles  — extended user profiles
 *   conversations  — chat sessions
 *   reports        — generated reports
 */
export const APP_NAME = "kbserve"
export const APP_VERSION = "0.1.0"
export const APP_PORT = 3090
export const DB_NAME = "kbserve.db"