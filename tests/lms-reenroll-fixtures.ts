import assert from "node:assert/strict";
import pg from "pg";
import { proveLmsTestDatabase } from "./lms-test-database";

export async function recoverReenrollFixtures(pool: pg.Pool, runId: string, userId: string) {
  assert.match(runId, /^lms_reenroll_\d+_[0-9a-f]{8}$/, "Journal LMS tidak valid; jangan hapus data");
  assert.equal(userId, `test-user-reenroll-${runId}`, "Pemilik journal LMS tidak valid");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const courseIds = (await client.query(
      "SELECT id FROM lms_courses WHERE starts_with(slug, $1)",
      [`reenroll-course-${runId}-`],
    )).rows.map((row) => row.id);
    if (courseIds.length) {
      for (const table of ["lms_lesson_progress", "lms_certificates", "lms_enrollments"]) {
        await client.query(`DELETE FROM ${table} WHERE course_id = ANY($1::int[])`, [courseIds]);
      }
      await client.query("DELETE FROM lms_lessons WHERE course_id = ANY($1::int[])", [courseIds]);
      await client.query("DELETE FROM lms_courses WHERE id = ANY($1::int[])", [courseIds]);
    }
    await client.query("DELETE FROM user_profiles WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("DELETE FROM lms_test_recovery WHERE run_id = $1", [runId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Same journal/lock path used by the real HTTP suite and SIGKILL worker. */
export async function beginReenrollFixtures(url: string, runId: string, userId: string) {
  const pool = await proveLmsTestDatabase(url);
  let lockClient: pg.PoolClient | undefined;
  try {
    lockClient = await pool.connect();
    const lock = await lockClient.query(
      "SELECT pg_try_advisory_lock(hashtext('lms_reenroll_test_recovery')) AS locked",
    );
    assert.equal(lock.rows[0]?.locked, true, "Database LMS uji sedang dipakai tes lain");
    await pool.query(
      "CREATE TABLE IF NOT EXISTS lms_test_recovery (run_id text PRIMARY KEY, user_id text NOT NULL)",
    );
    for (const row of (await pool.query("SELECT run_id, user_id FROM lms_test_recovery")).rows) {
      await recoverReenrollFixtures(pool, row.run_id, row.user_id);
    }
    assert.equal((await pool.query("SELECT 1 FROM users LIMIT 1")).rowCount, 0,
      "Database uji berisi pengguna di luar fixture; tolak mutasi");
    await pool.query("INSERT INTO lms_test_recovery (run_id, user_id) VALUES ($1, $2)", [runId, userId]);
    return { pool, lockClient };
  } catch (error) {
    lockClient?.release();
    await pool.end();
    throw error;
  }
}
