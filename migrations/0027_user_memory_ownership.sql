-- Add explicit ownership for user memories. Deliberately leave existing rows
-- with user_id NULL: session_id is not a trustworthy way to infer an owner.
ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS user_id varchar(255);

CREATE INDEX IF NOT EXISTS user_memories_user_agent_idx
  ON user_memories (user_id, agent_id);

-- Review records are append-only decisions. No FK cascade to memories: the
-- evidence trail must survive even if an approved memory is later deleted.
CREATE TABLE IF NOT EXISTS legacy_memory_reviews (
  id serial PRIMARY KEY,
  memory_id integer NOT NULL,
  proposed_user_id varchar(255) NOT NULL,
  evidence_ref text NOT NULL,
  evidence_sha256 varchar(64) NOT NULL,
  submitted_by varchar(255) NOT NULL,
  submitted_at timestamp NOT NULL DEFAULT now(),
  reviewed_by varchar(255),
  reviewed_at timestamp,
  decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'approved', 'rejected')),
  rationale text,
  CONSTRAINT legacy_memory_reviews_distinct_reviewers
    CHECK (reviewed_by IS NULL OR reviewed_by <> submitted_by)
);
CREATE INDEX IF NOT EXISTS legacy_memory_reviews_memory_idx
  ON legacy_memory_reviews (memory_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_memory_reviews_one_pending_idx
  ON legacy_memory_reviews (memory_id) WHERE decision = 'pending';