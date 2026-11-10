-- An owner's canonical company profile and revocable, scoped integrations.
-- Only hashes of bearer credentials are stored. No legacy vault files are changed.
CREATE TABLE IF NOT EXISTS ruang_simpan_company_profiles (
  owner_user_id varchar(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  nib varchar(32) NOT NULL DEFAULT '',
  address varchar(500) NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ruang_simpan_app_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  CONSTRAINT ruang_simpan_app_scopes CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 2
    AND scopes <@ ARRAY['profile:read','profile:write']::text[]
  )
);
CREATE INDEX IF NOT EXISTS ruang_simpan_app_connections_owner_idx
  ON ruang_simpan_app_connections(owner_user_id);

CREATE TABLE IF NOT EXISTS ruang_simpan_profile_changes (
  id bigserial PRIMARY KEY,
  owner_user_id varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  actor_connection_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ruang_simpan_profile_changes_owner_idx
  ON ruang_simpan_profile_changes(owner_user_id, changed_at DESC);