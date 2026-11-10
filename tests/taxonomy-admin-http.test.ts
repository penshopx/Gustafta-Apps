import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const hasDb = testDatabaseReady;
const recoveryKey = "test_recovery_taxonomy_admin_http";
const run = `taxonomy-auth-${process.pid}-${Date.now()}`;
const adminId = `${run}-admin`;
const userId = `${run}-user`;
const slug = `${run}-node`;

let db: any;
let pool: any;
let users: any;
let taxonomy: any;
let systemConfig: any;
let eq: any;
let lock: any;
let server: Server | undefined;
let baseUrl = "";

async function cleanup(record: { adminId: string; userId: string; slug: string } | undefined) {
  if (!record) return;
  await db.delete(taxonomy).where(eq(taxonomy.slug, record.slug));
  await db.delete(users).where(eq(users.id, record.adminId));
  await db.delete(users).where(eq(users.id, record.userId));
}

async function recoveryRecord() {
  const [row] = await db.select({ value: systemConfig.value })
    .from(systemConfig).where(eq(systemConfig.key, recoveryKey));
  if (!row) return undefined;
  return typeof row.value === "string" ? JSON.parse(row.value) : row.value;
}

async function request(method: string, path: string, account?: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(account ? { "x-test-user": account } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as any };
}

before(async () => {
  if (!testDatabaseReady) return;
  if (!hasDb) return;
  ({ db, pool } = await import("../server/db"));
  ({ users } = await import("../shared/models/auth"));
  ({ knowledgeTaxonomy: taxonomy, systemConfig } = await import("../shared/schema"));
  ({ eq } = await import("drizzle-orm"));

  lock = await pool.connect();
  await lock.query("SELECT pg_advisory_lock(hashtext($1))", [recoveryKey]);
  await cleanup(await recoveryRecord());
  await db.delete(systemConfig).where(eq(systemConfig.key, recoveryKey));

  // Persist the recovery trail before making any test rows; a killed test
  // is cleaned up on the next run without touching real taxonomy nodes.
  await db.insert(systemConfig).values({
    key: recoveryKey,
    value: { adminId, userId, slug },
  });
  await db.insert(users).values([
    { id: adminId, email: `${adminId}@example.test`, role: "admin", isActive: true },
    { id: userId, email: `${userId}@example.test`, role: "user", isActive: true },
  ]);

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const id = req.headers["x-test-user"];
    req.isAuthenticated = () => !!id;
    if (id) req.user = { id, claims: { sub: id } };
    next();
  });
  const httpServer = createServer(app);
  const { registerRoutes } = await import("../server/routes");
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  server = httpServer;
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (!testDatabaseReady) return;
  try {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (hasDb && db) {
      await cleanup(await recoveryRecord());
      await db.delete(systemConfig).where(eq(systemConfig.key, recoveryKey));
    }
  } finally {
    if (lock) {
      await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [recoveryKey]).catch(() => {});
      lock.release();
    }
    if (pool) await pool.end();
  }
});

test("taxonomy global: GET publik, mutasi hanya admin dan penolakan tidak mengubah data", {
  skip: hasDb ? false : testDbSkip,
}, async () => {
  const path = "/api/taxonomy";
  const payload = { name: run, slug, level: "sektor" };
  assert.equal((await request("GET", path)).status, 200);
  assert.equal((await request("POST", path, undefined, payload)).status, 401);
  assert.equal((await request("POST", path, userId, payload)).status, 403);

  const created = await request("POST", path, adminId, payload);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const nodeId = created.data.id;
  assert.ok(Number.isInteger(nodeId));
  const nodePath = `${path}/${nodeId}`;

  assert.equal((await request("PATCH", nodePath, undefined, { name: "hijacked" })).status, 401);
  assert.equal((await request("PATCH", nodePath, userId, { name: "hijacked" })).status, 403);
  const updated = await request("PATCH", nodePath, adminId, { name: `${run}-updated` });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.name, `${run}-updated`);

  assert.equal((await request("DELETE", nodePath)).status, 401);
  assert.equal((await request("DELETE", nodePath, userId)).status, 403);
  const tree = await request("GET", path);
  assert.equal(tree.status, 200);
  assert.equal(tree.data.find((node: any) => node.id === nodeId)?.name, `${run}-updated`);

  assert.equal((await request("DELETE", nodePath, adminId)).status, 200);
  const afterDelete = await request("GET", path);
  assert.equal(afterDelete.status, 200);
  assert.equal(afterDelete.data.some((node: any) => node.id === nodeId), false);
});