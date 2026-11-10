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
