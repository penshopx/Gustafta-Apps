-- Must outlive failed upload metadata; intentionally no foreign key.
CREATE TABLE IF NOT EXISTS ruang_simpan_upload_cleanup (
  storage_key TEXT PRIMARY KEY,
  file_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rs_upload_cleanup_due
  ON ruang_simpan_upload_cleanup (next_attempt_at);
CREATE INDEX IF NOT EXISTS rs_files_storage_key
  ON ruang_simpan_files (storage_key) WHERE storage_key IS NOT NULL;
