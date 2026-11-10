import { prepareTestDatabase, testDbSkip } from "./test-database";
const ready = await prepareTestDatabase();
import { test } from "node:test";
import assert from "node:assert/strict";

test("PostgreSQL history filters both snapshots, literal search and descending cursors", {
  skip: ready ? false : testDbSkip,
}, async () => {
  const { db, pool } = await import("../server/db");
  const { DatabaseStorage } = await import("../server/db-storage");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../shared/schema");
  const client = await pool.connect();
  const originalSelect = db.select;
  try {
    await client.query("BEGIN");
    // A temporary table shadows real audits; the fixture never touches app rows.
    await client.query("CREATE TEMP TABLE taxonomy_audit_log (LIKE public.taxonomy_audit_log INCLUDING ALL) ON COMMIT DROP");
    const isolated = drizzle(client, { schema });
    db.select = isolated.select.bind(isolated) as typeof db.select;
    const before = { name: "Lama dengan %_", slug: "slug-asli" };
    const after = { name: "Nama Baru", slug: "slug-baru" };
    for (let index = 1; index <= 54; index++) {
      await client.query(
        `INSERT INTO taxonomy_audit_log (id, taxonomy_id, actor_id, action, before, after)
         VALUES ($1, 42, 'deleted-account', $2, $3, $4)`,
        [index, index === 1 ? "create" : index === 54 ? "delete" : "update",
          index === 1 ? null : JSON.stringify(before), index === 54 ? null : JSON.stringify(after)],
      );
    }
    const storage = new DatabaseStorage();
    const all = await storage.getTaxonomyAuditHistory();
    assert.equal(all.length, 50);
    assert.equal(all[0].id, 54);
    const older = await storage.getTaxonomyAuditHistory(undefined, all.at(-1)!.id);
    assert.deepEqual(older.map(entry => entry.id), [4, 3, 2, 1]);
    assert.equal((await storage.getTaxonomyAuditHistory(42)).length, 50);
    assert.equal((await storage.getTaxonomyAuditHistory(43)).length, 0);
    for (const search of ["42", "nama baru", "SLUG-ASLI", "%_"]) {
      assert.equal((await storage.getTaxonomyAuditHistory(undefined, undefined, search)).length, 50, search);
    }
    const originalName = await storage.getTaxonomyAuditHistory(undefined, 5, "%_");
    assert.deepEqual(originalName.map(entry => entry.id), [4, 3, 2]);
    assert.deepEqual(await storage.getTaxonomyAuditHistory(undefined, undefined, "unmatched"), []);
  } finally {
    db.select = originalSelect;
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
