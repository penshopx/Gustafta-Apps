-- Credential lifecycle CAS, independent of company-profile revisions.
ALTER TABLE ruang_simpan_app_connections
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
