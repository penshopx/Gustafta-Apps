/**
 * Guard shared by every DB-backed LMS test. Importing this module is safe for
 * static/adapter tests; the app DB is never imported before validation.
 *
 * Provision a fresh separate database with scripts/setup-lms-test-database.ts
 * (LMS tables derived from the app schema, plus the isolation marker).
 * Its name must end in _lms_test. Supply LMS_TEST_DATABASE_URL, not DATABASE_URL.
 * This database must contain no customer users. Interrupted fixtures are
 * cleared on the next invocation before new tests can write.
 */
import { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

export const hasLmsTestDb = !!process.env.LMS_TEST_DATABASE_URL;
export const lmsDbSkip = hasLmsTestDb ? false : "LMS_TEST_DATABASE_URL tidak diset — lewati integrasi DB";
export let lmsTestDatabaseReady = false;
const applicationUrls = [process.env.DATABASE_URL, process.env.DATABASE_URL_POOLED];
const unreachableUrl = "postgres://lms_test_guard:invalid@127.0.0.1:1/lms_guard_unreachable";

export async function proveLmsTestDatabase(url: string): Promise<pg.Pool> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  assert.match(name, /_lms_test$/, "Nama database uji harus berakhiran _lms_test");
  for (const appUrl of applicationUrls) {
    if (appUrl && new URL(appUrl).pathname === target.pathname) {
      throw new Error("Database LMS uji tidak boleh memakai nama database aplikasi");
    }
  }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 });
  try {
    const identity = await pool.query("SELECT current_database() AS name");
    assert.equal(identity.rows[0]?.name, name, "Identitas database berbeda dari URL");
    const marker = await pool.query(
      "SELECT marker FROM public.lms_test_isolation_guard WHERE marker = $1",
      ["dedicated-lms-test-database"],
    );
    assert.equal(marker.rowCount, 1, "Marker database LMS uji tidak ada");
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}

// All DB-backed test files call this at module scope. The hook runs before
// their own before() hooks (and before any server/db dynamic import).
export function installLmsTestDatabase() {
  if (hasLmsTestDb) {
    // after() hooks in the older suites run even if validation fails. Never
    // let those hooks see the shared application URL on a rejected run.
    process.env.DATABASE_URL = unreachableUrl;
    delete process.env.DATABASE_URL_POOLED;
  }
  let lockPool: pg.Pool | undefined;
  let lockClient: pg.PoolClient | undefined;
  before(async () => {
    if (!hasLmsTestDb) return;
    const url = process.env.LMS_TEST_DATABASE_URL!;
    const pool = await proveLmsTestDatabase(url);
    try {
      lockClient = await pool.connect();
      const lock = await lockClient.query(
        // Re-enroll uses the same lock for its own recovery journal.
        "SELECT pg_try_advisory_lock(hashtext('lms_reenroll_test_recovery')) AS locked",
      );
      assert.equal(lock.rows[0]?.locked, true, "Database LMS uji sedang dipakai tes lain");
      lockPool = pool;
      // No app pool or mutation exists yet. A left-behind journal authorizes
      // recovery only within this proven, dedicated DB.
      await pool.query("CREATE TABLE IF NOT EXISTS lms_suite_recovery (id integer PRIMARY KEY CHECK (id = 1))");
      const pending = await pool.query("SELECT id FROM lms_suite_recovery WHERE id = 1");
      const strangers = await pool.query(
        "SELECT id FROM users WHERE id !~ '^(test-|cert-sync-|lms_)' LIMIT 1",
      );
      assert.equal(strangers.rowCount, 0, "Database uji berisi pengguna bukan fixture; tolak mutasi");
      if (pending.rowCount) {
        // A prior process may have been killed before its after() hook. Reset
        // only the disposable LMS test database, not any application database.
        // Seed content is restored by seedLmsData where required by the tests.
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const table of ["lms_lesson_progress", "lms_certificates", "lms_enrollments", "lms_lessons", "lms_courses"]) {
            await client.query(`DELETE FROM ${table}`);
          }
          await client.query("DELETE FROM user_profiles WHERE user_id IN (SELECT id FROM users)");
          await client.query("DELETE FROM users");
          // Scratch index tests use fixed names or generated, reserved prefixes.
          const scratch = await client.query(
            `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
             AND (tablename IN ('lms_lessons_uidx_test_scratch',
                               'lms_progress_uidx_test_scratch',
                               'lms_enroll_uidx_test_scratch')
                  OR tablename ~ '^lms_certificates_test_[0-9]+_[a-z0-9]+$')`,
          );
          for (const { tablename } of scratch.rows) {
            await client.query(`DROP TABLE public."${tablename}" CASCADE`);
          }
          await client.query("DELETE FROM lms_suite_recovery WHERE id = 1");
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
      assert.equal((await pool.query("SELECT 1 FROM users LIMIT 1")).rowCount, 0,
        "Database uji harus bebas pengguna sebelum fixture ditulis");
      // Durable intent precedes every test's first write; next invocation
      // repairs interrupted work even after SIGKILL.
      await pool.query("INSERT INTO lms_suite_recovery (id) VALUES (1)");
      process.env.DATABASE_URL = url;
      delete process.env.DATABASE_URL_POOLED;
      if (pending.rowCount) {
        const { seedLmsData } = await import("../server/routes-lms");
        await seedLmsData();
      }
      lmsTestDatabaseReady = true;
    } catch (error) {
      if (lockClient) lockClient.release();
      await pool.end();
      lockClient = undefined;
      lockPool = undefined;
      throw error;
    }
  });
  after(async () => {
    if (!lockPool || !lockClient) return;
    try {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext('lms_reenroll_test_recovery'))");
    } finally {
      lockClient.release();
      await lockPool.end();
    }
  });
}