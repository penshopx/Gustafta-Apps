DO $migration$
DECLARE
  duplicate RECORD;
  candidate TEXT;
  suffix INTEGER;
BEGIN
  -- Blocks old-version writers and concurrent startup repairs until commit.
  LOCK TABLE knowledge_taxonomy IN SHARE ROW EXCLUSIVE MODE;
  CREATE TABLE IF NOT EXISTS knowledge_taxonomy_slug_repairs (
    taxonomy_id INTEGER PRIMARY KEY,
    original_slug TEXT NOT NULL,
    repaired_slug TEXT NOT NULL,
    repaired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  FOR duplicate IN
    SELECT id, slug FROM (
      SELECT id, slug,
        row_number() OVER (PARTITION BY lower(btrim(slug)) ORDER BY id) AS position
      FROM knowledge_taxonomy
    ) ranked WHERE position > 1 ORDER BY id
  LOOP
    -- Preserve every category, hierarchy edge and KB reference by ID.
    candidate := left(lower(btrim(duplicate.slug)), 220) || '-dup-' || duplicate.id;
    suffix := 0;
    WHILE EXISTS (
      SELECT 1 FROM knowledge_taxonomy WHERE lower(btrim(slug)) = candidate
    ) LOOP
      suffix := suffix + 1;
      candidate := left(lower(btrim(duplicate.slug)), 220) || '-dup-' || duplicate.id || '-' || suffix;
    END LOOP;
    INSERT INTO knowledge_taxonomy_slug_repairs (taxonomy_id, original_slug, repaired_slug)
      VALUES (duplicate.id, duplicate.slug, candidate);
    UPDATE knowledge_taxonomy SET slug = candidate WHERE id = duplicate.id;
  END LOOP;

  -- Global: different parents, levels and inactive nodes share the namespace.
  CREATE UNIQUE INDEX IF NOT EXISTS knowledge_taxonomy_slug_unique
    ON knowledge_taxonomy (lower(btrim(slug)));
END
$migration$;
