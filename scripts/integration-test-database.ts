/**
 * Explicit lifecycle for an EMPTY disposable PostgreSQL database.
 * Does not connect to, dump, or copy the application database.
 */
import pg from "pg";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../shared/schema";
import { checkTestDatabaseUrl } from "../tests/test-database";

const marker = "dedicated-disposable-integration-database";

async function assertIdentity(client: pg.PoolClient, name: string) {
  const result = await client.query("SELECT current_database() AS name");
  if (result.rows[0]?.name !== name) throw new Error("Identitas database tidak cocok");
  const namespaces = await client.query(`
    SELECT 1 FROM pg_namespace
    WHERE nspname NOT IN ('public', 'information_schema') AND nspname !~ '^pg_'`);
  if (namespaces.rowCount) throw new Error("Schema non-public tidak diizinkan");
}

export async function manageTestDatabase(action: "setup" | "teardown", url: string) {
  // Includes original application identities even in a guarded child process.
  const inherited: string[] = JSON.parse(process.env.TEST_DATABASE_APP_NAMES ?? "[]");
  const name = checkTestDatabaseUrl(url, [
    process.env.DATABASE_URL, process.env.DATABASE_URL_POOLED,
    ...inherited.map(path => `postgres://app.invalid${path}`),
    process.env.LMS_TEST_DATABASE_URL,
  ]);
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('integration-test-database-lifecycle'))");
      await assertIdentity(client, name);
      if (action === "setup") {
        // Tables alone are not sufficient: reject views, routines, custom types,
        // sequences and extensions too. Never stamp a pre-existing database.
        const objects = await client.query(`
          SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace
          UNION ALL SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
          UNION ALL SELECT 1 FROM pg_type WHERE typnamespace='public'::regnamespace
          UNION ALL SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql'`);
        if (objects.rowCount) throw new Error("Setup hanya boleh pada database kosong");
        const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
        for (const statement of statements) await client.query(statement);
        await client.query("CREATE TABLE public.integration_test_isolation_guard (marker text PRIMARY KEY)");
        await client.query("INSERT INTO public.integration_test_isolation_guard VALUES ($1)", [marker]);
      } else {
        // Prove on the SAME connection/transaction used for destruction.
        const proof = await client.query(
          "SELECT marker FROM public.integration_test_isolation_guard WHERE marker=$1 FOR UPDATE", [marker],
        );
        if (proof.rowCount !== 1) throw new Error("Penanda disposable tidak ada");
        await client.query("DROP SCHEMA public CASCADE");
        await client.query("CREATE SCHEMA public");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
