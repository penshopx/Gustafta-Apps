import { prepareTestDatabase, testDbSkip } from "./test-database";
const ready = await prepareTestDatabase();
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { taxonomySlugMigrationSql } from "../server/taxonomy-slug-migration";

test("startup and versioned taxonomy migration stay identical", async () => {
  assert.equal(taxonomySlugMigrationSql.trim(),
    (await readFile("migrations/0031_taxonomy_slug_unique.sql", "utf8")).trim());
});

test("taxonomy slug migration preserves references, handles collisions, and rejects racing duplicates", {
  skip: ready ? false : testDbSkip,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 3 });
  const namespace = `taxonomy_slug_test_${process.pid}`;
  const client = await pool.connect();
  const other = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${namespace}`);
    for (const connection of [client, other]) await connection.query(`SET search_path TO ${namespace}`);
    await client.query(`
      CREATE TABLE knowledge_taxonomy (
        id SERIAL PRIMARY KEY, slug TEXT NOT NULL, name TEXT DEFAULT 'Fixture',
        parent_id INTEGER, level TEXT DEFAULT 'sektor', is_active BOOLEAN DEFAULT TRUE
      );
      CREATE TABLE knowledge_bases (id SERIAL PRIMARY KEY, taxonomy_id INTEGER, content TEXT);
      INSERT INTO knowledge_taxonomy (id, slug, parent_id, level, is_active) VALUES
        (1, 'alpha', NULL, 'sektor', TRUE),
        (2, ' Alpha ', NULL, 'sektor', FALSE),
        (3, 'alpha', 1, 'subsektor', TRUE),
        (4, 'alpha-dup-2', NULL, 'sektor', TRUE),
        (5, 'child', 2, 'subsektor', TRUE);
      INSERT INTO knowledge_bases (taxonomy_id, content) VALUES (2, 'Keep this document');
    `);
    const before = (await client.query("SELECT * FROM knowledge_taxonomy ORDER BY id")).rows;
    // Two startup instances must serialize their repair and index creation.
    await Promise.all([client.query(taxonomySlugMigrationSql), other.query(taxonomySlugMigrationSql)]);
    const after = (await client.query("SELECT * FROM knowledge_taxonomy ORDER BY id")).rows;
    assert.deepEqual(after.map(({ slug, ...row }) => row), before.map(({ slug, ...row }) => row));
    assert.deepEqual(after.map(row => row.slug), ["alpha", "alpha-dup-2-1", "alpha-dup-3", "alpha-dup-2", "child"]);
    assert.deepEqual((await client.query("SELECT taxonomy_id, content FROM knowledge_bases")).rows,
      [{ taxonomy_id: 2, content: "Keep this document" }]);
    const repairs = (await client.query("SELECT * FROM knowledge_taxonomy_slug_repairs ORDER BY taxonomy_id")).rows;
    assert.equal(repairs.length, 2);
    assert.equal(repairs[0].original_slug, " Alpha ");
    await client.query(taxonomySlugMigrationSql);
    assert.deepEqual((await client.query("SELECT * FROM knowledge_taxonomy_slug_repairs ORDER BY taxonomy_id")).rows, repairs);
    assert.deepEqual((await client.query("SELECT * FROM knowledge_taxonomy ORDER BY id")).rows, after);

    const conflict = (error: any) => error.code === "23505" && error.constraint === "knowledge_taxonomy_slug_unique";
    await assert.rejects(client.query("INSERT INTO knowledge_taxonomy (id, slug, parent_id, level, is_active) VALUES (6, ' ALPHA ', 5, 'topik', FALSE)"), conflict);
    await assert.rejects(client.query("UPDATE knowledge_taxonomy SET slug = 'alpha' WHERE id = 5"), conflict);
    await client.query("UPDATE knowledge_taxonomy SET slug = 'alpha', name = 'Renamed' WHERE id = 1");

    const results = await Promise.allSettled([
      client.query("INSERT INTO knowledge_taxonomy (id, slug) VALUES (10, 'racing')"),
      other.query("INSERT INTO knowledge_taxonomy (id, slug) VALUES (11, 'racing')"),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    assert.ok(conflict(rejected.reason));

    // A forced repair failure must undo earlier repairs and their evidence.
    await client.query("DROP INDEX knowledge_taxonomy_slug_unique");
    await client.query("INSERT INTO knowledge_taxonomy (id, slug) VALUES (20, 'alpha'), (21, 'alpha')");
    await client.query(`
      CREATE FUNCTION reject_repair() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN IF NEW.id = 21 THEN RAISE EXCEPTION 'repair unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_repair BEFORE UPDATE ON knowledge_taxonomy
        FOR EACH ROW EXECUTE FUNCTION reject_repair();
    `);
    await assert.rejects(client.query(taxonomySlugMigrationSql), /repair unavailable/);
    assert.deepEqual((await client.query("SELECT slug FROM knowledge_taxonomy WHERE id IN (20,21) ORDER BY id")).rows,
      [{ slug: "alpha" }, { slug: "alpha" }]);
    assert.equal((await client.query("SELECT * FROM knowledge_taxonomy_slug_repairs WHERE taxonomy_id IN (20,21)")).rowCount, 0);
    assert.equal((await client.query("SELECT to_regclass('knowledge_taxonomy_slug_unique') AS name")).rows[0].name, null);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    client.release();
    other.release();
    await pool.end();
  }
});
