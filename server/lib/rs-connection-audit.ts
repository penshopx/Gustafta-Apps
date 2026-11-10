// Deliberately no JSON metadata, application names, document IDs or credentials.
// Keep the audit independent of connection deletion so revocations stay visible.
export const rsConnectionAuditDDL = `
  CREATE TABLE IF NOT EXISTS ruang_simpan_connection_changes (
    id bigserial PRIMARY KEY,
    owner_user_id varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user_id varchar(255) NOT NULL,
    connection_id uuid NOT NULL,
    action text NOT NULL CHECK (action IN ('created','token_rotated','revoked','selections_changed')),
    changed_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS rs_connection_changes_owner_idx
    ON ruang_simpan_connection_changes(owner_user_id, changed_at DESC, id DESC);
`;
