/** Subprocess only: the parent kills this process after an IPC acknowledgement. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  installLmsTestDatabase, lmsTestDatabaseReady, proveLmsTestDatabase,
} from "../lms-test-database";
import { beginReenrollFixtures, recoverReenrollFixtures } from "../lms-reenroll-fixtures";

const [kind, phase, runId] = process.argv.slice(2);
const userId = `test-user-reenroll-${runId}`;
let pool: pg.Pool | undefined;
let lockClient: pg.PoolClient | undefined;
let appPool: pg.Pool | undefined;

if (kind === "suite") installLmsTestDatabase();

test("fixture worker", async () => {
  if (kind === "suite") {
    assert.equal(lmsTestDatabaseReady, true);
    const app = await import("../../server/db");
    appPool = app.pool;
    pool = appPool;
  } else {
    const session = await beginReenrollFixtures(process.env.LMS_TEST_DATABASE_URL!, runId, userId);
    pool = session.pool;
    lockClient = session.lockClient;
  }
  if (phase === "seed") {
    const { seedLmsData } = await import("../../server/routes-lms");
    await seedLmsData();
  } else if (phase === "mutated") {
    if (kind === "suite") {
      await pool.query("DELETE FROM lms_lessons");
      await pool.query("DELETE FROM lms_courses");
      await pool.query("CREATE TABLE lms_lessons_uidx_test_scratch (id integer)");
    }
    await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)",
      [userId, `${runId}@example.test`]);
    await pool.query("INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Fixture')", [userId]);
    const course = (await pool.query(
      "INSERT INTO lms_courses (title, slug) VALUES ('Interrupted fixture', $1) RETURNING id",
      [`reenroll-course-${runId}-fixture`],
    )).rows[0].id;
    const lesson = (await pool.query(
      "INSERT INTO lms_lessons (course_id, title, slug) VALUES ($1, 'Fixture', 'fixture') RETURNING id",
      [course],
    )).rows[0].id;
    await pool.query("INSERT INTO lms_enrollments (user_id, course_id) VALUES ($1, $2)", [userId, course]);
    await pool.query(
      "INSERT INTO lms_lesson_progress (user_id, course_id, lesson_id) VALUES ($1, $2, $3)",
      [userId, course, lesson],
    );
    await pool.query(
      "INSERT INTO lms_certificates (user_id, course_id, certificate_code) VALUES ($1, $2, $3)",
      [userId, course, runId],
    );
  } else if (phase === "recover") {
    assert.equal((await pool.query("SELECT 1 FROM users")).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM user_profiles")).rowCount, 0);
    for (const table of ["lms_enrollments", "lms_lesson_progress", "lms_certificates"]) {
      assert.equal((await pool.query(`SELECT 1 FROM ${table}`)).rowCount, 0);
    }
    assert.equal((await pool.query(
      "SELECT 1 FROM lms_courses WHERE starts_with(slug, 'reenroll-course-')",
    )).rowCount, 0);
    assert.equal((await pool.query(
      "SELECT 1 FROM pg_tables WHERE tablename = 'lms_lessons_uidx_test_scratch'",
    )).rowCount, 0);
    if (kind === "reenroll") {
      assert.deepEqual((await pool.query("SELECT run_id FROM lms_test_recovery")).rows, [{ run_id: runId }]);
    }
  }
  process.send?.({ ready: true });
  if (phase === "journal" || phase === "mutated") {
    // SIGKILL is sent only after journal/mutations have committed. No after()
    // or signal handler can run; IPC keeps the child alive until then.
    await new Promise<void>(() => {});
  }
});

after(async () => {
  if (kind === "suite") {
    if (phase === "seed-failure") {
      // The setup hook failed before the test body could capture appPool.
      // Verify release while this process is still alive: process termination
      // itself would otherwise hide a leaked session-level advisory lock.
      assert.equal(lmsTestDatabaseReady, false);
      assert.equal(process.env.DATABASE_URL, process.env.LMS_TEST_DATABASE_URL);
      const app = await import("../../server/db");
      appPool = app.pool;
      const probe = await proveLmsTestDatabase(process.env.LMS_TEST_DATABASE_URL!);
      const client = await probe.connect();
      try {
        assert.equal((await client.query(
          "SELECT pg_try_advisory_lock(hashtext('lms_reenroll_test_recovery')) AS locked",
        )).rows[0].locked, true, "Failed setup must release its advisory lock before exit");
        process.send?.({ seedFailureChecked: true });
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('lms_reenroll_test_recovery'))");
        client.release();
        await probe.end();
        await appPool.end();
        appPool = undefined;
      }
    }
    await appPool?.end();
  } else if (pool && lockClient) {
    try {
      await recoverReenrollFixtures(pool, runId, userId);
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext('lms_reenroll_test_recovery'))");
      lockClient.release();
      await pool.end();
    }
  }
  process.disconnect?.();
});
