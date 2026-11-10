/**
 * Provision only a fresh disposable database; never read DATABASE_URL.
 * The CI PostgreSQL service creates the database before this script runs.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import {
  users, userProfiles, lmsCourses, lmsLessons, lmsEnrollments,
  lmsLessonProgress, lmsCertificates,
} from "../shared/schema";

const url = process.env.LMS_TEST_DATABASE_URL;
assert.ok(url, "LMS_TEST_DATABASE_URL wajib diset");
const name = decodeURIComponent(new URL(url).pathname.slice(1));
assert.match(name, /_lms_test$/);
const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, name);
  assert.equal((await pool.query(
    "SELECT 1 FROM pg_tables WHERE schemaname = 'public' LIMIT 1",
  )).rowCount, 0, "Provisioning hanya boleh pada database kosong");
  const empty = generateDrizzleJson({});
  const schema = generateDrizzleJson({
    users, userProfiles, lmsCourses, lmsLessons, lmsEnrollments,
    lmsLessonProgress, lmsCertificates,
  });
  const statements = await generateMigration(empty, schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) await client.query(statement);
    await client.query("CREATE TABLE public.lms_test_isolation_guard (marker text PRIMARY KEY)");
    await client.query(
      "INSERT INTO public.lms_test_isolation_guard VALUES ('dedicated-lms-test-database')",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log("Database LMS uji kosong berhasil disiapkan dari skema aplikasi.");
} finally {
  await pool.end();
}
