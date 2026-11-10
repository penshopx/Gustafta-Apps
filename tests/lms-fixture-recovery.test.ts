import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { hasLmsTestDb, lmsDbSkip, proveLmsTestDatabase } from "./lms-test-database";

const worker = fileURLToPath(new URL("./fixtures/lms-recovery-worker.ts", import.meta.url));
const newRun = () => `lms_reenroll_${Date.now()}_${randomUUID().slice(0, 8)}`;

async function invoke(kind: string, phase: string, run: string,
  appUrl: string, pooledUrl: string, kill = false) {
  const child = fork(worker, [kind, phase, run], {
    execArgv: ["--import", "tsx"],
    env: {
      // Deliberately exclude inherited credentials and application connection strings.
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test",
      LMS_TEST_DATABASE_URL: process.env.LMS_TEST_DATABASE_URL,
      DATABASE_URL: appUrl, DATABASE_URL_POOLED: pooledUrl,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  let acknowledged = false;
  let seedFailureChecked = false;
  child.stdout!.on("data", (chunk) => { output += chunk; });
  child.stderr!.on("data", (chunk) => { output += chunk; });
  return await new Promise<{
    code: number | null; signal: string | null; output: string; acknowledged: boolean;
    seedFailureChecked: boolean;
  }>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Worker ${kind}/${phase} timed out\n${output}`));
    }, 30_000);
    child.on("message", (message: any) => {
      if (message?.seedFailureChecked) seedFailureChecked = true;
      if (message?.ready) {
        acknowledged = true;
        if (kill) child.kill("SIGKILL");
      }
    });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (kill) {
        if (!acknowledged || signal !== "SIGKILL") {
          reject(new Error(`Worker did not reach committed journal: ${output}`));
          return;
        }
      } else if (phase !== "reject" && phase !== "seed-failure" && (code !== 0 || !acknowledged)) {
        reject(new Error(`Worker ${kind}/${phase} failed: ${output}`));
        return;
      }
      resolve({ code, signal, output, acknowledged, seedFailureChecked });
    });
  });
}

test("SIGKILL recovery restores fixtures and seed content without contacting application DB",
  { skip: lmsDbSkip, timeout: 180_000 }, async (t) => {
    assert.equal(hasLmsTestDb, true);
    const pool = await proveLmsTestDatabase(process.env.LMS_TEST_DATABASE_URL!);
    // Any attempt to contact either application URL increments this counter.
    let connections = 0;
    const canary = createServer((socket) => { connections++; socket.destroy(); });
    await new Promise<void>((resolve) => canary.listen(0, "127.0.0.1", resolve));
    const port = (canary.address() as { port: number }).port;
    const appUrl = `postgres://forbidden:invalid@127.0.0.1:${port}/application_canary`;
    const pooledUrl = `postgres://forbidden:invalid@127.0.0.1:${port}/pooled_canary`;
    const snapshot = async () => ({
      courses: (await pool.query(
        "SELECT to_jsonb(c) - 'id' - 'created_at' AS data FROM lms_courses c ORDER BY slug",
      )).rows,
      lessons: (await pool.query(
        `SELECT c.slug AS course, to_jsonb(l) - 'id' - 'course_id' - 'created_at' AS data
         FROM lms_lessons l JOIN lms_courses c ON c.id = l.course_id ORDER BY c.slug, l.slug`,
      )).rows,
    });
    try {
      await invoke("suite", "seed", newRun(), appUrl, pooledUrl);
      const baseline = await snapshot();
      assert.ok(baseline.courses.length > 0 && baseline.lessons.length > 0);
      for (const kind of ["suite", "reenroll"]) {
        for (const phase of ["journal", "mutated"]) {
          const run = newRun();
          await invoke(kind, phase, run, appUrl, pooledUrl, true);
          const journal = kind === "suite" ? "lms_suite_recovery" : "lms_test_recovery";
          assert.equal((await pool.query(`SELECT 1 FROM ${journal}`)).rowCount, 1,
            "SIGKILL must leave durable recovery evidence");
          if (phase === "mutated") {
            assert.equal((await pool.query("SELECT 1 FROM users WHERE id = $1",
              [`test-user-reenroll-${run}`])).rowCount, 1);
          }
          await invoke(kind, "recover", newRun(), appUrl, pooledUrl);
          assert.deepEqual(await snapshot(), baseline, `${kind}/${phase}: seed content must be restored`);
          assert.equal((await pool.query("SELECT 1 FROM users")).rowCount, 0);
          if (kind === "reenroll") {
            assert.equal((await pool.query("SELECT 1 FROM lms_test_recovery")).rowCount, 0);
          }
          assert.equal(connections, 0, "Neither application DB URL may be contacted");
        }
      }
      await t.test("failed seed retains its journal and releases the lock for complete, duplicate-free retries", async () => {
        const run = newRun();
        await invoke("suite", "mutated", run, appUrl, pooledUrl, true);
        // Fail on the second lesson insert, not on cleanup. One seed lesson
        // must commit first so retry has to handle partially restored content.
        await pool.query(`
          CREATE FUNCTION lms_recovery_fail_seed() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF EXISTS (SELECT 1 FROM lms_lessons) THEN
              RAISE EXCEPTION 'lms recovery injected seed failure';
            END IF;
            RETURN NEW;
          END $$`);
        try {
          await pool.query(`
            CREATE TRIGGER lms_recovery_fail_seed
            BEFORE INSERT ON lms_lessons FOR EACH ROW
            EXECUTE FUNCTION lms_recovery_fail_seed()`);
          const failed = await invoke("suite", "seed-failure", newRun(), appUrl, pooledUrl);
          assert.equal(failed.code, 1, failed.output);
          assert.equal(failed.signal, null, "Seed failure must exit normally, not via timeout or SIGKILL");
          assert.equal(failed.acknowledged, false, "Failed setup must not run the fixture body");
          assert.match(failed.output, /lms recovery injected seed failure/);
          assert.equal(failed.seedFailureChecked, true,
            "The failing worker must prove the lock is free before it exits");
          assert.deepEqual((await pool.query("SELECT id FROM lms_suite_recovery")).rows, [{ id: 1 }],
            "Failed seed must leave durable evidence for the next invocation");
          for (const table of [
            "users", "user_profiles", "lms_enrollments", "lms_lesson_progress", "lms_certificates",
          ]) {
            assert.equal((await pool.query(`SELECT 1 FROM ${table}`)).rowCount, 0,
              `${table}: fixture cleanup must have committed before seed failed`);
          }
          assert.equal((await pool.query(
            "SELECT 1 FROM pg_tables WHERE tablename = 'lms_lessons_uidx_test_scratch'",
          )).rowCount, 0, "Scratch cleanup must also have committed");
          const partial = await snapshot();
          assert.ok(partial.courses.length > 0, "Seed must have started restoring courses");
          assert.equal(partial.lessons.length, 1, "One seed lesson must commit before the injected failure");
          assert.ok(partial.lessons.length < baseline.lessons.length);
          assert.equal((await pool.query("SELECT 1 FROM lms_courses WHERE slug = $1",
            [`reenroll-course-${run}-fixture`])).rowCount, 0);
        } finally {
          await pool.query("DROP TRIGGER IF EXISTS lms_recovery_fail_seed ON lms_lessons");
          await pool.query("DROP FUNCTION lms_recovery_fail_seed()");
        }
        // The retained journal must drive startup recovery, not a direct call
        // to the seeder. Repeat once more to prove subsequent recovery is safe.
        for (let attempt = 0; attempt < 2; attempt++) {
          await invoke("suite", "recover", newRun(), appUrl, pooledUrl);
          assert.deepEqual(await snapshot(), baseline,
            `Retry ${attempt + 1} must restore every course and lesson with its original content`);
          assert.equal((await pool.query(
            "SELECT slug FROM lms_courses GROUP BY slug HAVING COUNT(*) > 1",
          )).rowCount, 0, "No duplicate courses");
          assert.equal((await pool.query(
            "SELECT course_id, slug FROM lms_lessons GROUP BY course_id, slug HAVING COUNT(*) > 1",
          )).rowCount, 0, "No duplicate lessons");
        }
        assert.equal(connections, 0, "Neither application DB URL may be contacted");
      });
      for (const field of ["run_id", "user_id"] as const) {
        await t.test(`invalid re-enrollment journal ${field} rejects recovery without changing data`, async () => {
          const run = newRun();
          const invalidRun = `${run}-invalid`;
          const fixtureRun = field === "run_id" ? invalidRun : run;
          const user = `test-user-reenroll-${fixtureRun}`;
          const protectedUser = `test-protected-${run}`;
          const nextRun = newRun();
          const courseSlug = `reenroll-course-${fixtureRun}-fixture`;
          // Leave a realistic interrupted fixture, including every dependent
          // LMS table. The failed recovery must not delete any of these rows.
          await invoke("reenroll", "mutated", fixtureRun, appUrl, pooledUrl, true);
          try {
            await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)",
              [protectedUser, `${protectedUser}@example.test`]);
            await pool.query(
              "INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Protected user')",
              [protectedUser],
            );
            if (field === "user_id") {
              // A valid run with a different existing user is not authorization
              // to delete that user's account/profile or the run's course.
              await pool.query("UPDATE lms_test_recovery SET user_id = $1 WHERE run_id = $2",
                [protectedUser, run]);
            }
            const completeSnapshot = async () => {
              const data: Record<string, unknown[]> = {};
              for (const table of [
                "users", "user_profiles", "lms_courses", "lms_lessons",
                "lms_enrollments", "lms_lesson_progress", "lms_certificates",
                "lms_test_recovery", "lms_suite_recovery",
              ]) {
                data[table] = (await pool.query(
                  `SELECT to_jsonb(r) AS data FROM ${table} r ORDER BY to_jsonb(r)::text`,
                )).rows;
              }
              return data;
            };
            const before = await completeSnapshot();
            assert.equal(before.lms_test_recovery.length, 1);
            for (const table of ["lms_enrollments", "lms_lesson_progress", "lms_certificates"]) {
              assert.equal(before[table].length, 1, `${table} must have a fixture to protect`);
            }
            // Exercise startup's journal reader in a separate process, not just
            // the validation function. No current-run journal may be inserted.
            const result = await invoke("reenroll", "reject", nextRun, appUrl, pooledUrl);
            assert.equal(result.code, 1, result.output);
            assert.equal(result.signal, null);
            assert.equal(result.acknowledged, false, "Rejected recovery must never report ready");
            assert.match(result.output, field === "run_id"
              ? /Journal LMS tidak valid; jangan hapus data/
              : /Pemilik journal LMS tidak valid/);
            assert.deepEqual(await completeSnapshot(), before,
              "Rejecting a corrupt journal must retain its evidence and every seed/user/fixture row");
            assert.equal(connections, 0, "Neither application DB URL may be contacted");
          } finally {
            // The assertions above must observe the corrupt record unchanged.
            // Teardown is explicit and limited to this test's exact identifiers;
            // do not pass an intentionally invalid journal to recovery again.
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              for (const table of [
                "lms_lesson_progress", "lms_certificates", "lms_enrollments", "lms_lessons",
              ]) {
                await client.query(
                  `DELETE FROM ${table} WHERE course_id IN (SELECT id FROM lms_courses WHERE slug = $1)`,
                  [courseSlug],
                );
              }
              await client.query("DELETE FROM lms_courses WHERE slug = $1", [courseSlug]);
              await client.query("DELETE FROM user_profiles WHERE user_id = ANY($1::text[])",
                [[user, protectedUser]]);
              await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [[user, protectedUser]]);
              await client.query("DELETE FROM lms_test_recovery WHERE run_id = $1", [fixtureRun]);
              await client.query("COMMIT");
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            } finally {
              client.release();
            }
          }
          assert.deepEqual(await snapshot(), baseline, "Seed content must remain unchanged after cleanup");
        });
      }
      // Alias uses a different host/credential but the application's database
      // name equals the test DB: reject before connecting to either destination.
      const name = new URL(process.env.LMS_TEST_DATABASE_URL!).pathname;
      for (const kind of ["suite", "reenroll"]) {
        for (const alias of ["direct", "pooled"]) {
          const before = await snapshot();
          const result = await invoke(kind, "reject", newRun(),
            alias === "direct" ? appUrl.replace("/application_canary", name) : appUrl,
            alias === "pooled" ? pooledUrl.replace("/pooled_canary", name) : pooledUrl);
          assert.notEqual(result.code, 0, "same-name application database must be rejected");
          assert.deepEqual(await snapshot(), before);
          assert.equal(connections, 0);
        }
      }
    } finally {
      await pool.end();
      await new Promise<void>((resolve, reject) => canary.close((error) => error ? reject(error) : resolve()));
    }
  });
