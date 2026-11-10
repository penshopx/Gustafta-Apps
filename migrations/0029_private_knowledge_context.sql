ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'platform';
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS owner_user_id text;

-- Historical Ruang Simpan imports were embedded in agent-wide RAG. A missing
-- source file/owner stays private and inaccessible rather than becoming public.
UPDATE knowledge_bases kb
SET visibility = 'private',
    owner_user_id = CASE WHEN kb.file_name LIKE 'ruang_simpan_%'
      AND kb.description LIKE '%dokumen dari Ruang Simpan Anda'
      THEN (SELECT a.user_id FROM agents a WHERE a.id = kb.agent_id LIMIT 1)
      ELSE (SELECT f.user_id FROM ruang_simpan_files f
        WHERE f.id::text = substring(kb.file_url from '^/api/ruang-simpan/file/([^/]+)/download$') LIMIT 1)
    END
-- Only unlabeled historical imports need repair. Preserve deliberate publication
-- and the importer ownership stamped on new private copies on subsequent runs.
WHERE kb.visibility = 'platform' AND (
   kb.file_url ~ '^/api/ruang-simpan/file/[^/]+/download$'
   OR kb.description LIKE 'Diimpor dari Ruang Simpan (%'
   OR (kb.file_name LIKE 'ruang_simpan_%' AND kb.description LIKE '%dokumen dari Ruang Simpan Anda')
);