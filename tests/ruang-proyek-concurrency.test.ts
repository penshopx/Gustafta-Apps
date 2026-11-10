import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("UI sends the seen version and reloads the project list on a 409 conflict", async () => {
  const source = await readFile("client/src/pages/ruang-proyek.tsx", "utf8");
  assert.match(source, /expectedRevision:\s*project\.revision/);
  assert.match(source, /startsWith\("409:"\)/);
  assert.match(
    source,
    /await qc\.invalidateQueries\(\{ queryKey: \["\/api\/ruang-proyek\/projects"\] \}\)/
  );
});

test("near-simultaneous checklist and cost writes from one version cannot overwrite each other", async (t) => {
  if (!testDatabaseReady) {
    t.skip(testDbSkip);
    return;
  }

  const { pool } = await import("../server/db");
  const userId = `concurrency-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inserted = await pool.query(
    `INSERT INTO ruang_proyek_projects (user_id, name)
     VALUES ($1, 'Concurrency regression test')
     RETURNING id, revision`,
    [userId]
  );
  const { id, revision: baseline } = inserted.rows[0];

  try {
    const checklist = [{ id: "check-1", label: "Dokumen lengkap", done: true }];
    const costs = [{ id: "cost-1", label: "Material", type: "biaya", amount: 1000 }];
    const guardedWrite = (column: "checklist" | "cost_items", value: unknown) =>
      pool.query(
        `UPDATE ruang_proyek_projects
         SET ${column} = $1::jsonb, updated_at = clock_timestamp(), revision = revision + 1
         WHERE id = $2 AND user_id = $3 AND revision = $4::bigint
         RETURNING id`,
        [JSON.stringify(value), id, userId, baseline]
      );

    const [checkResult, costResult] = await Promise.all([
      guardedWrite("checklist", checklist),
      guardedWrite("cost_items", costs),
    ]);

    assert.equal(
      Number(checkResult.rowCount) + Number(costResult.rowCount),
      1,
      "tepat satu penulis dari versi yang sama harus berhasil; lainnya menjadi konflik"
    );
    const final = await pool.query(
      `SELECT checklist, cost_items FROM ruang_proyek_projects WHERE id = $1`,
      [id]
    );
    if (checkResult.rowCount === 1) {
      assert.deepEqual(final.rows[0].checklist, checklist);
      assert.deepEqual(final.rows[0].cost_items, []);
    } else {
      assert.deepEqual(final.rows[0].checklist, []);
      assert.deepEqual(final.rows[0].cost_items, costs);
    }
  } finally {
    await pool.query(`DELETE FROM ruang_proyek_projects WHERE id = $1`, [id]);
  }
});