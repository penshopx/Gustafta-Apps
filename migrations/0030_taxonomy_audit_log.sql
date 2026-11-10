CREATE TABLE IF NOT EXISTS taxonomy_audit_log (
  id SERIAL PRIMARY KEY,
  taxonomy_id INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS taxonomy_audit_log_node_id_idx
  ON taxonomy_audit_log (taxonomy_id, id);
