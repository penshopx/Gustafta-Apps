import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import ts from "typescript";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import {
  paymentOrigin, readPaymentLinks, planPaymentLinkMigration,
  applyPaymentLinkMigration, PaymentLinksChangedError,
} from "../../server/lib/payment-url-migration";
import { proveTestDatabase } from "../test-database";

export const oldOrigin = "https://old-checkout.example.test";
export const targetOrigin = "https://new-checkout.example.test";
export const confirmation = "MIGRASI TAUTAN PEMBAYARAN";
export const schema = "payment_url_migration_fixture";
const recoveryKey = "payment-url-migration-fixture";
const lockKey = 970013;

// Mount the production AST, not a copy of its authorization/handler logic.
// This avoids unrelated boot seeds, providers and background jobs. SQL, role
// resolution, active-account checks, handlers and transactions remain real.
function compile(nodes: ts.Node[], source: ts.SourceFile): string {
  assert.ok(nodes.length);
  return ts.transpileModule(nodes.map(node => node.getText(source)).join("\n").replace(/^export /gm, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

function declarations(source: ts.SourceFile, names: string[]) {
  const found = new Map<string, ts.Node>();
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      found.set(node.name.text, node);
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
          found.set(declaration.name.text, node);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const name of names) assert.ok(found.has(name), `Production helper missing: ${name}`);
  return names.map(name => found.get(name)!);
}

export async function startPaymentMigrationFixture(options: {
  wrapApplyClient?: (client: pg.PoolClient) => Promise<pg.PoolClient>;
  afterCatalogRead?: () => Promise<void>;
} = {}) {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, "Dedicated TEST_DATABASE_URL is required");
  const appNames = JSON.parse(process.env.TEST_DATABASE_APP_NAMES || "[]") as string[];
  await proveTestDatabase(url, appNames.map(path => `postgres://app.invalid${path}`));
  const control = new pg.Pool({ connectionString: url, max: 1 });
  const owner = await control.connect();
  let pool: pg.Pool | undefined;
  let server: Server | undefined;
  let claimed = false;
  const recover = async () => {
    await owner.query("BEGIN");
    try {
      const record = await owner.query(
        "SELECT fixture_key FROM public.payment_url_test_recovery WHERE fixture_key = $1 FOR UPDATE",
        [recoveryKey],
      );
      if (record.rowCount) {
        // Never execute a schema/table name supplied by a recovery record.
        await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await owner.query("DELETE FROM public.payment_url_test_recovery WHERE fixture_key = $1", [recoveryKey]);
      }
      await owner.query("COMMIT");
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    }
  };
  const close = async () => {
    try {
      if (server) {
        const stopping = new Promise<void>((resolve, reject) =>
          server!.close(error => error ? reject(error) : resolve()));
        server.closeAllConnections();
        await stopping;
      }
      await pool?.end();
      // Only the run holding the advisory lock may clean up its claimed record.
      if (claimed) await recover();
    } finally {
      await owner.query("SELECT pg_advisory_unlock($1)", [lockKey]);
      owner.release();
      await control.end();
    }
  };
  try {
    await owner.query("SELECT pg_advisory_lock($1)", [lockKey]);
    await owner.query(`CREATE TABLE IF NOT EXISTS public.payment_url_test_recovery
      (fixture_key text PRIMARY KEY)`);
    await recover();
    assert.equal((await owner.query("SELECT to_regnamespace($1) AS name", [schema])).rows[0].name, null,
      "Refuse to destroy an unclaimed schema");
    // Durable record is committed BEFORE creating or mutating any fixture row.
    await owner.query("INSERT INTO public.payment_url_test_recovery VALUES ($1)", [recoveryKey]);
    claimed = true;
    await owner.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 4 });
    const notices: string[] = [];
    pool.on("connect", client => client.on("notice", notice => { notices.push(notice.message ?? ""); }));
    await pool.query(`
      CREATE TABLE agents (id integer PRIMARY KEY, payment_url text);
      CREATE TABLE store_products (id integer PRIMARY KEY, payment_url text);
      CREATE TABLE users (id text PRIMARY KEY, email text, role text, is_active boolean);
      INSERT INTO users VALUES
        ('ordinary', 'ordinary@example.test', 'user', true),
        ('admin', 'admin@example.test', 'admin', true),
        ('superadmin', 'superadmin@example.test', 'superadmin', true),
        ('blocked', 'blocked@example.test', 'blocked', true),
        ('inactive', 'inactive@example.test', 'admin', false);
    `);
    const reset = async () => {
      await pool!.query(`
        DROP TRIGGER IF EXISTS fail_payment_update ON store_products;
        TRUNCATE agents, store_products;
        INSERT INTO agents VALUES
          (1, '${oldOrigin}/c/checkout?variant=2'),
          (2, 'https://vendor.example.test/p/untouched');
        INSERT INTO store_products VALUES
          (1, '${oldOrigin}/p/produk?ref=a%2Fb#opsi'),
          (2, 'https://old-checkout.example.test.evil.test/pay'),
          (3, NULL), (4, '');
      `);
    };
    await reset();
    const snapshot = async () => ({
      agents: (await pool!.query("SELECT * FROM agents ORDER BY id")).rows,
      store_products: (await pool!.query("SELECT * FROM store_products ORDER BY id")).rows,
    });
    const app = express();
    app.use(express.json());
    // Test-owned server-side sessions only. Header input never supplies a role.
    app.use((req: any, _res, next) => {
      const actor = req.headers.cookie?.match(/(?:^|;\s*)fixture-actor=([^;]+)/)?.[1];
      if (actor) req.session = { emailUser: { id: actor } };
      next();
    });
    const authFile = ts.createSourceFile("auth.ts",
      readFileSync(new URL("../../server/replit_integrations/auth/replitAuth.ts", import.meta.url), "utf8"),
      ts.ScriptTarget.Latest, true);
    const authCode = compile(declarations(authFile,
      ["activeStatusCache", "checkUserIsActive", "authenticateRequest", "isAuthenticated"]), authFile);
    const authStorage = {
      async getUser(id: string) {
        const row = (await pool!.query("SELECT role, is_active FROM users WHERE id = $1", [id])).rows[0];
        return row ? { role: row.role, isActive: row.is_active } : undefined;
      },
    };
    const isAuthenticated = new Function("authStorage", "performTokenRefresh",
      `${authCode}\nreturn isAuthenticated;`)(authStorage, () => {
      throw new Error("Fixture must not refresh external OAuth tokens");
    });
    const routes = ts.createSourceFile("routes.ts",
      readFileSync(new URL("../../server/routes.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const helpers = declarations(routes, [
      "getSessionUserId", "getDbRole", "checkIsAdmin", "getClientIp", "requireAdmin",
      "applyPaymentLinksAndRefreshCatalog",
      "STORE_CATALOG_TTL_MS", "STORE_CATALOG_STALE_MS", "STORE_CATALOG_MAX_KEYS",
      "storeCatalogCache", "storeCatalogInflight", "storeCatalogGeneration",
      "invalidateStoreCatalog", "refreshStoreCatalog", "getStoreCatalogItems",
    ]);
    const registrations: ts.Node[] = [];
    function visit(node: ts.Node) {
      if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
        const call = node.expression;
        if (ts.isPropertyAccessExpression(call.expression) &&
            ["app.post", "app.get"].includes(call.expression.getText(routes)) &&
            ts.isStringLiteral(call.arguments[0]) &&
            ["/api/admin/payment-links/preview", "/api/admin/payment-links/apply", "/api/store/catalog"].includes(call.arguments[0].text)) {
          registrations.push(node);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(routes);
    assert.equal(registrations.length, 3, "Production admin and public catalog routes must be mounted");
    const users = pgTable("users", { id: text("id"), email: text("email"), role: text("role") });
    let invalidations = 0;
    let linkReads = 0;
    let catalogBuilds = 0;
    // Only the enrichment seam is replaced: use real committed rows from both
    // tables, without needing unrelated product metadata, seeds or providers.
    const buildStoreCatalogItems = async () => {
      const result = await pool!.query(`
        SELECT 'agent' AS type, id, payment_url AS "paymentUrl" FROM agents
        UNION ALL
        SELECT 'product' AS type, id, payment_url AS "paymentUrl" FROM store_products
        ORDER BY type, id
      `);
      catalogBuilds++;
      await options.afterCatalogRead?.();
      return result.rows;
    };
    let invalidateCatalog!: () => void;
    const envKeys = ["ADMIN_EMAILS", "SUPERADMIN_EMAILS", "ADMIN_USER_IDS"];
    const savedEnv = envKeys.map(key => process.env[key]);
    envKeys.forEach(key => { process.env[key] = ""; });
    try {
      const controls = new Function("app", "isAuthenticated", "pool", "db", "users", "eq", "PAYMENT_BASE_URL",
        "paymentOrigin", "readPaymentLinks", "planPaymentLinkMigration",
        "applyPaymentLinkMigration", "PaymentLinksChangedError", "buildStoreCatalogItems", "onInvalidate",
        `${compile(helpers, routes)}
        const productionInvalidate = invalidateStoreCatalog;
        invalidateStoreCatalog = () => { onInvalidate(); productionInvalidate(); };
        ${compile(registrations, routes)}
        return { invalidateStoreCatalog };`)(
        app, isAuthenticated, pool, drizzle(pool), users, eq, targetOrigin,
        paymentOrigin, async (...args: Parameters<typeof readPaymentLinks>) => {
          linkReads++;
          return readPaymentLinks(...args);
        }, planPaymentLinkMigration,
        async (...args: Parameters<typeof applyPaymentLinkMigration>) => {
          if (options.wrapApplyClient) args[0] = await options.wrapApplyClient(args[0]);
          return applyPaymentLinkMigration(...args);
        },
        PaymentLinksChangedError,
        buildStoreCatalogItems,
        () => { invalidations++; },
      );
      invalidateCatalog = controls.invalidateStoreCatalog;
      server = await new Promise<Server>(resolve => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      });
    } catch (error) {
      envKeys.forEach((key, index) => {
        if (savedEnv[index] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[index];
      });
      throw error;
    }
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return {
      pool, reset, snapshot, notices,
      invalidateCatalog,
      get catalogBuilds() { return catalogBuilds; },
      get invalidations() { return invalidations; },
      get linkReads() { return linkReads; },
      catalog: (query = "") => fetch(`${base}/api/store/catalog${query}`),
      request: (path: "preview" | "apply", actor?: string, body: unknown = { oldOrigin }) =>
        fetch(`${base}/api/admin/payment-links/${path}`, {
          method: "POST", headers: {
            "Content-Type": "application/json", ...(actor ? { Cookie: `fixture-actor=${actor}` } : {}),
          }, body: JSON.stringify(body),
        }),
      async close() {
        try { await close(); }
        finally {
          envKeys.forEach((key, index) => {
            if (savedEnv[index] === undefined) delete process.env[key];
            else process.env[key] = savedEnv[index];
          });
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
