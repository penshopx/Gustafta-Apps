import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";
import ts from "typescript";
import { checkTestDatabaseUrl, proveTestDatabase } from "./test-database";

const directory = dirname(fileURLToPath(import.meta.url));
const url = "postgres://fixture:fixture@db.invalid/fixtures_integration_test";

test("test URL rejects app names (including pooler/aliases), unsafe names and URL options before connecting", () => {
  assert.equal(checkTestDatabaseUrl(url, []), "fixtures_integration_test");
  for (const candidate of [
    "postgres://fixture@db.invalid/customer",
    "postgres://fixture@db.invalid/customer_integration_test_backup",
    url + "?options=-csearch_path%3Dpublic",
    "https://db.invalid/fixtures_integration_test",
    "not-a-url",
  ]) assert.throws(() => checkTestDatabaseUrl(candidate, []), /Database uji ditolak/);
  assert.throws(() => checkTestDatabaseUrl(url, [
    "postgresql://another@pooler.invalid/fixtures_integration_test",
  ]), /nama sama/);
  assert.throws(() => checkTestDatabaseUrl(url, ["invalid"]), /URL aplikasi tidak valid/);
});

test("validation checks server identity and marker with read-only SQL, closes on every outcome, redacts errors", async () => {
  const original = pg.Pool;
  for (const scenario of ["valid", "identity", "marker", "connection"]) {
    const queries: string[] = [];
    let closed = 0;
    class ProbePool {
      async query(sql: string) {
        queries.push(sql);
        if (scenario === "connection") throw new Error("private-credential-do-not-print");
        if (sql.includes("current_database")) return { rows: [{ name: scenario === "identity" ? "customers" : "fixtures_integration_test" }] };
        return { rowCount: scenario === "marker" ? 0 : 1 };
      }
      async end() { closed++; }
    }
    (pg as any).Pool = ProbePool;
    try {
      if (scenario === "valid") await proveTestDatabase(url, []);
      else await assert.rejects(proveTestDatabase(url, []), error =>
        error instanceof Error && /pemeriksaan identitas\/penanda gagal/.test(error.message)
        && !error.message.includes("private-credential"));
      assert.ok(queries.every(sql => sql.startsWith("SELECT ")), "proof must never mutate DB");
      assert.equal(closed, 1);
    } finally {
      (pg as any).Pool = original;
    }
  }
});

test("every audited non-LMS DB suite awaits isolation before runtime server imports and fixtures", () => {
  const files = readdirSync(directory).filter(name => name.endsWith(".test.ts") && !name.startsWith("lms-")
    && !["test-database-isolation.test.ts", "test-database-lease.test.ts", "prod-url-validation.test.ts", "admin-email-test-no-email.test.ts",
      "legacy-memory-recovery.test.ts", "blueprint-configure-preview.test.ts"].includes(name));
  const audited: string[] = [];
  for (const name of files) {
    const source = readFileSync(join(directory, name), "utf8");
    // Covers direct app pools, raw pg fixtures, and dynamic DB imports. Pure
    // in-memory storage tests have no direct DB usage and are not opt-in suites.
    if (!/(?:prepareTestDatabase|from ["']\.\.\/server\/db["']|import\(["']\.\.\/server\/(?:db|db-storage)["']|process\.env\.DATABASE_URL|new (?:pg\.)?(?:Pool|Client)\()/.test(source)) continue;
    audited.push(name);
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    assert.ok(ast.statements.some(statement => ts.isVariableStatement(statement)
      && (statement.declarationList.flags & ts.NodeFlags.Const)
      && statement.declarationList.declarations.some(declaration => {
        const value = declaration.initializer;
        return value && ts.isAwaitExpression(value)
          && ts.isCallExpression(value.expression)
          && ts.isIdentifier(value.expression.expression)
          && value.expression.expression.text === "prepareTestDatabase"
          && value.expression.arguments.length === 0;
      })), `${name}: wajib await guard pada tingkat modul (nama variabel bebas)`);
    assert.doesNotMatch(source, /!!process\.env\.DATABASE_URL/, `${name}: app URL must not opt in`);
    // A client-side DB guard cannot protect a different, already-running
    // server. Apply this to *every* audited suite, not just known examples.
    assert.doesNotMatch(source, /process\.env\.(?:PORT|REPLIT_DEV_DOMAIN|TEST_BASE_URL|BASE_URL)/,
      `${name}: HTTP target must not come from workspace/server configuration`);
    assert.doesNotMatch(source, /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/,
      `${name}: HTTP target must not use a fixed application port`);
    for (const node of ast.statements) {
      if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
        assert.ok(!node.moduleSpecifier.getText(ast).includes("../server/"), `${name}: premature runtime server import`);
      }
    }
    assert.ok(source.indexOf("await prepareTestDatabase()") < source.indexOf('await import("../server/')
      || !source.includes('await import("../server/'), name);
  }
  assert.ok(audited.length >= 44, "audit must not silently lose mutating suites");
  for (const name of ["sbu-skk-ebook-delivery.test.ts", "sbu-skk-funnel.test.ts", "solution-promotion-engine.test.ts",
    "digital-delivery-webhook.test.ts"]) {
    const source = readFileSync(join(directory, name), "utf8");
    assert.doesNotMatch(source, /process\.env\.(?:PORT|REPLIT_DEV_DOMAIN)/, `${name}: cannot target live workflow`);
    assert.match(source, /startIsolatedTestApp/, name);
  }
});

test("successful validation redirects app pool and fixture writes away from both original URLs", () => {
  const script = `
    (async () => {
      const { default: pg } = await import("pg");
      const connections = [], queries = [];
      pg.Pool = class {
        constructor(options) { this.id = connections.length; connections.push(options.connectionString); }
        on() {}
        async query(sql) {
          queries.push({id:this.id,sql});
          if (sql.includes("current_database")) return {rows:[{name:"fixtures_integration_test"}]};
          return {rowCount:1};
        }
        async end() {}
      };
      pg.Client = class {
        connection = {stream:{unref(){}}};
        on() {}
        async connect() {}
        async query() { return {rows:[{acquired:true}],rowCount:1}; }
        async end() {}
      };
      const { prepareTestDatabase } = await import(${JSON.stringify(join(directory, "test-database.ts"))});
      const ready = await prepareTestDatabase();
      const { pool } = await import(${JSON.stringify(join(directory, "../server/db.ts"))});
      await pool.query("INSERT INTO fixture_probe VALUES (1)");
      console.log(JSON.stringify({ready,connections,queries}));
    })();
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--eval", script], {
    cwd: join(directory, ".."),
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      DATABASE_URL: "postgres://app@app.invalid/customers",
      DATABASE_URL_POOLED: "postgres://app@pooler.invalid/customers",
      TEST_DATABASE_URL: url,
    },
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(child.status, 0, "valid database must enable fixtures");
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.ready, true);
  assert.deepEqual(result.connections, [url, url]);
  assert.deepEqual(result.queries.filter((query: { sql: string }) => !query.sql.startsWith("SELECT ")),
    [{ id: 1, sql: "INSERT INTO fixture_probe VALUES (1)" }]);
});

test("lease refusal closes proof and lease connections, never re-enables app URLs, and stays rejected on retry", () => {
  for (const mode of ["connect", "query", "malformed-group", "missing-url"]) {
    const script = `
      (async () => {
        const { default: pg } = await import("pg");
        let proofsClosed = 0, leasesClosed = 0;
        pg.Pool = class {
          async query(sql) {
            return sql.includes("current_database")
              ? {rows:[{name:"fixtures_integration_test"}]} : {rowCount:1};
          }
          async end() { proofsClosed++; }
        };
        pg.Client = class {
          on() {}
          async connect() { if (${JSON.stringify(mode)} === "connect") throw new Error("private-credential"); }
          async query() { throw new Error("private-credential"); }
          async end() { leasesClosed++; }
        };
        const { prepareTestDatabase } = await import(${JSON.stringify(join(directory, "test-database.ts"))});
        const errors = [], results = [];
        for (let i=0; i<2; i++) {
          try { results.push(await prepareTestDatabase()); } catch(error) { errors.push(error.message); }
        }
        console.log(JSON.stringify({proofsClosed,leasesClosed,errors,results,
          blocked:process.env.DATABASE_URL.endsWith("/test_guard_blocked"),
          pooledAbsent:!process.env.DATABASE_URL_POOLED}));
      })();
    `;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--eval", script], {
      cwd: join(directory, ".."),
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME,
        DATABASE_URL: "postgres://app@app.invalid/customers",
        DATABASE_URL_POOLED: "postgres://app@pooler.invalid/customers",
        ...(mode !== "missing-url" ? { TEST_DATABASE_URL: url } : {}),
        ...(mode === "malformed-group" ? { TEST_DATABASE_LEASE_GROUP: "invalid" } : {}),
      },
      encoding: "utf8", timeout: 20_000,
    });
    assert.equal(child.status, 0, mode);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.blocked, true, mode);
    assert.equal(result.pooledAbsent, true, mode);
    assert.equal(result.proofsClosed, mode === "missing-url" ? 0 : 1, mode);
    assert.equal(result.leasesClosed, mode === "missing-url" ? 0 : 1, mode);
    assert.deepEqual(result.results, mode === "missing-url" ? [false, false] : [], mode);
    assert.equal(result.errors.length, mode === "missing-url" ? 0 : 2, mode);
    assert.ok(result.errors.every((message: string) => message === "Database uji ditolak: koordinasi fixture gagal"));
    assert.doesNotMatch(child.stdout + child.stderr, /private-credential/);
  }
});

test("direct invocation rejects unsafe DBs before app DB imports, setup AND cleanup hooks", () => {
  for (const name of ["scalev-webhook-subscription-activation.test.ts", "order-api-scalev.test.ts",
    "lexskripsi-patch-atomic.test.ts", "store-catalog-payment-url-update.test.ts", "digital-delivery-webhook.test.ts",
    "payment-url-migration-db-http.test.ts", "fixtures/payment-url-migration-kill-child.ts"]) {
    for (const mode of ["same-name", "missing-marker"]) {
      const script = `
        (async () => {
          const { default: pg } = await import("pg");
          const queries = []; let pools = 0;
          pg.Pool = class {
            constructor() { pools++; }
            async query(sql) {
              queries.push(sql);
              if (sql.includes("current_database")) return {rows:[{name:"fixtures_integration_test"}]};
              return {rowCount:0};
            }
            async end() {}
          };
          let rejected = false;
          try { await import(${JSON.stringify(join(directory, name))}); } catch { rejected = true; }
          console.log(JSON.stringify({rejected,pools,queries}));
        })();
      `;
      const child = spawnSync(process.execPath, ["--import", "tsx", "--eval", script], {
        cwd: join(directory, ".."),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DATABASE_URL: mode === "same-name" ? url : "postgres://app@app.invalid/customers",
          DATABASE_URL_POOLED: mode === "same-name" ? "postgres://app@pooler.invalid/fixtures_integration_test" : "",
          TEST_DATABASE_URL: url,
        },
        encoding: "utf8",
        timeout: 20_000,
      });
      assert.equal(child.status, 0, `${name} ${mode}: must reject and terminate`);
      const result = JSON.parse(child.stdout.trim());
      assert.equal(result.rejected, true, name);
      assert.equal(result.pools, mode === "same-name" ? 0 : 1, `${name}: app pool must not be constructed`);
      assert.ok(result.queries.every((sql: string) => sql.startsWith("SELECT ")), name);
    }
  }
});
