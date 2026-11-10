import { desc, eq, lt, and } from "drizzle-orm";
import { kbPublicationHistory, knowledgeBases } from "@shared/schema";
import type { db } from "../db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// This helper only accepts the transaction that locked the source. Failure to
// retain evidence must abort visibility/content changes rather than be ignored.
export async function recordKBPublication(
  tx: Transaction,
  source: typeof knowledgeBases.$inferSelect,
  actorId: string | null,
  action: "publish" | "revoke",
  reason: "consent" | "content_edit" | "reprocess",
) {
  await tx.insert(kbPublicationHistory).values({
    sourceId: source.id, agentId: source.agentId, actorId,
    action, reason, contentRevision: source.contentRevision,
  });
}

export async function readKBPublicationHistory(tx: Transaction, sourceId: number, before?: number) {
  return tx.select().from(kbPublicationHistory).where(and(
    eq(kbPublicationHistory.sourceId, sourceId),
    before === undefined ? undefined : lt(kbPublicationHistory.id, before),
  )).orderBy(desc(kbPublicationHistory.id)).limit(50);
}

// Kept inline for the production bundle (which does not ship migration files).
export const kbPublicationHistoryDDL = `
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS content_revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS kb_publication_history (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL,
  agent_id INTEGER NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('publish', 'revoke')),
  reason TEXT NOT NULL CHECK (reason IN ('consent', 'content_edit', 'reprocess')),
  content_revision INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS kb_publication_history_source_id_idx
  ON kb_publication_history (source_id, id);
`;
