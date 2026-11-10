import { prepareTestDatabase, checkTestDatabaseUrl, proveTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { manageTestDatabase } from "../scripts/integration-test-database";

test("PostgreSQL nyata: setup kosong, pengaman teardown, dan recreate tanpa pelanggan", {
  // Creating sibling DBs is allowed only in the local cluster owned by the runner.
  skip: !testDatabaseReady ? testDbSkip : process.env.TEST_LIFECYCLE_ALLOW_CREATEDB !== "1",
}, async () => {
  const source = process.env.TEST_DATABASE_URL!;
  const name = `lifecycle_${randomUUID().replaceAll("-", "")}_integration_test`;
  const target = new URL(source);
  target.pathname = `/${name}`;
  const url = target.toString();
  checkTestDatabaseUrl(url);
  const admin = new pg.Pool({ connectionString: source, max: 1 });
  let created = false;
  let targetPool: pg.Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    targetPool = new pg.Pool({ connectionString: url, max: 1 });
    const q = (sql: string) => targetPool!.query(sql);
    await q("CREATE TABLE public.must_survive (value text)");
    await q("INSERT INTO public.must_survive VALUES ('synthetic fixture, never customer data')");
    await assert.rejects(manageTestDatabase("setup", url), /database kosong/);
    await assert.rejects(manageTestDatabase("teardown", url));
    assert.equal((await q("SELECT * FROM public.must_survive")).rowCount, 1);
    await q("DROP TABLE public.must_survive");
    await q("CREATE VIEW public.must_survive AS SELECT 1 AS n");
    await assert.rejects(manageTestDatabase("setup", url), /database kosong/);
    await q("DROP VIEW public.must_survive");
    await q("CREATE SCHEMA unexpected");
    await assert.rejects(manageTestDatabase("setup", url), /non-public/);
    await q("DROP SCHEMA unexpected");

    await manageTestDatabase("setup", url);
    await proveTestDatabase(url);
    assert.equal((await q("SELECT * FROM public.users")).rowCount, 0);
    await assert.rejects(manageTestDatabase("setup", url), /database kosong/);
    await q("DELETE FROM public.integration_test_isolation_guard");
    await assert.rejects(manageTestDatabase("teardown", url), /Penanda/);
    assert.equal((await q("SELECT * FROM public.users")).rowCount, 0);
    await q(`INSERT INTO public.integration_test_isolation_guard
      VALUES ('dedicated-disposable-integration-database')`);

    // Application/pooled identities must reject even an otherwise valid marker.
    for (const key of ["DATABASE_URL", "DATABASE_URL_POOLED", "LMS_TEST_DATABASE_URL"]) {
      const previous = process.env[key];
      process.env[key] = url;
      try {
        await assert.rejects(manageTestDatabase("teardown", url), /nama sama/);
      } finally {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
    }
    await manageTestDatabase("teardown", url);
    assert.equal((await q("SELECT * FROM pg_tables WHERE schemaname='public'")).rowCount, 0);
    await assert.rejects(proveTestDatabase(url), /penanda gagal/);
    await manageTestDatabase("setup", url);
    await proveTestDatabase(url);
    await manageTestDatabase("teardown", url);
  } finally {
    await targetPool?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
