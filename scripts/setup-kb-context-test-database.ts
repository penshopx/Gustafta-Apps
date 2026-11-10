// Provision only a fresh, dedicated disposable database, never the app DB.
import assert from "node:assert/strict";
import pg from "pg";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../shared/schema";
import { checkTestDatabaseUrl } from "../tests/test-database";

const url = process.env.TEST_DATABASE_URL;
assert.ok(url, "TEST_DATABASE_URL wajib diset");
const name = checkTestDatabaseUrl(url);
const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, name);
  assert.equal((await pool.query(
    "SELECT 1 FROM pg_tables WHERE schemaname = 'public' LIMIT 1",
  )).rowCount, 0, "Provisioning hanya boleh pada database kosong");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) await client.query(statement);
    await client.query("CREATE TABLE public.integration_test_isolation_guard (marker text PRIMARY KEY)");
    await client.query("INSERT INTO public.integration_test_isolation_guard VALUES ('dedicated-disposable-integration-database')");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
} finally { await pool.end(); }
