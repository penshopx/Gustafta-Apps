import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const hasDb = testDatabaseReady;
const SKIP = hasDb ? false : testDbSkip;
const RUN = `scalev-save-${process.pid}-${Date.now()}`;
const ADMIN_ID = `it-${RUN}`;
const ADMIN_EMAIL = `${ADMIN_ID}@example.test`;
const RECOVERY_KEY = "test_recovery_scalev_variant_admin_save";
const realFetch = globalThis.fetch;
const oldApiKey = process.env.SCALEV_API_KEY;
const oldAdminIds = process.env.ADMIN_USER_IDS;

let db: any;
let pool: any;
let users: any;
let storeProducts: any;
let systemConfig: any;
let eq: any;
let server: Server;
let baseUrl = "";
let productId = 0;
let recoveryLockClient: any;
let scalevMode: "valid" | "deleted" | "unavailable" = "valid";

async function cleanupRecovery(record: { userId?: string; productId?: number } | undefined) {
  if (record?.productId) await db.delete(storeProducts).where(eq(storeProducts.id, record.productId));
  if (record?.userId) await db.delete(users).where(eq(users.id, record.userId));
}

async function readRecovery() {
  const [row] = await db.select({ value: systemConfig.value })
    .from(systemConfig).where(eq(systemConfig.key, RECOVERY_KEY));
  if (!row) return undefined;
  return typeof row.value === "string" ? JSON.parse(row.value) : row.value;
}

async function patch(body: Record<string, unknown>, authenticated = true) {
  const res = await realFetch(`${baseUrl}/api/store/admin/products/${productId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { "x-test-user": ADMIN_ID } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() as any };
}

async function savedVariantId() {
  const [row] = await db.select({ value: storeProducts.scalevVariantId })
    .from(storeProducts).where(eq(storeProducts.id, productId));
  return row?.value ?? null;
}

before(async () => {
  if (!testDatabaseReady) return;
  if (!hasDb) return;
  process.env.SCALEV_API_KEY = "test-only-scalev-key";
  process.env.ADMIN_USER_IDS = [oldAdminIds, ADMIN_ID].filter(Boolean).join(",");

  ({ db, pool } = await import("../server/db"));
  ({ users } = await import("../shared/models/auth"));
  ({ storeProducts, systemConfig } = await import("../shared/schema"));
  ({ eq } = await import("drizzle-orm"));

  recoveryLockClient = await pool.connect();
  await recoveryLockClient.query("SELECT pg_advisory_lock(hashtext($1))", [RECOVERY_KEY]);
  await cleanupRecovery(await readRecovery());
  await db.delete(systemConfig).where(eq(systemConfig.key, RECOVERY_KEY));

  await db.insert(systemConfig).values({
    key: RECOVERY_KEY,
    value: { userId: ADMIN_ID },
  });
  await db.insert(users).values({ id: ADMIN_ID, email: ADMIN_EMAIL, role: "admin", isActive: true });
  const [product] = await db.insert(storeProducts).values({
    name: `${RUN} Product`,
    description: "Scalev variant admin save integration",
    price: 199_000,
    isActive: true,
    isGustafta: false,
    sortOrder: 999,
    scalevVariantId: 11111,
  } as any).returning({ id: storeProducts.id });
  productId = product.id;
  await db.update(systemConfig)
    .set({ value: { userId: ADMIN_ID, productId } })
    .where(eq(systemConfig.key, RECOVERY_KEY));

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (!url.startsWith("https://api.scalev.id/v2/variants/")) {
      return realFetch(input, init);
    }
    const requestedId = Number(url.split("/").pop());
    if (scalevMode === "deleted") {
      return new Response(JSON.stringify({ code: 404, error: "not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }
    if (scalevMode === "unavailable") {
      return new Response(JSON.stringify({ error: "maintenance" }), {
        status: 503, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ code: 200, data: { id: requestedId, name: "Live variant" } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const uid = req.headers["x-test-user"];
    if (uid) {
      req.user = { claims: { sub: uid } };
      req.isAuthenticated = () => true;
    } else {
      req.isAuthenticated = () => false;
    }
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
  globalThis.fetch = realFetch;
  if (oldApiKey === undefined) delete process.env.SCALEV_API_KEY;
  else process.env.SCALEV_API_KEY = oldApiKey;
  if (oldAdminIds === undefined) delete process.env.ADMIN_USER_IDS;
  else process.env.ADMIN_USER_IDS = oldAdminIds;
  if (!hasDb) return;
  try {
    await cleanupRecovery(await readRecovery());
    await db.delete(systemConfig).where(eq(systemConfig.key, RECOVERY_KEY));
  } finally {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (recoveryLockClient) {
      await recoveryLockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [RECOVERY_KEY]).catch(() => undefined);
      recoveryLockClient.release();
    }
    await pool.end().catch(() => undefined);
  }
});

test("PATCH asli tetap memerlukan autentikasi admin", { skip: SKIP }, async () => {
  const result = await patch({ scalevVariantId: 22222 }, false);
  assert.equal(result.status, 401);
  assert.equal(await savedVariantId(), 11111);
});

test("admin dapat menyimpan varian yang benar-benar ada di Scalev", { skip: SKIP }, async () => {
  scalevMode = "valid";
  const result = await patch({ scalevVariantId: 22222 });
  assert.equal(result.status, 200);
  assert.equal(await savedVariantId(), 22222);
});

test("varian yang dihapus ditolak dan ID lama tidak tertimpa", { skip: SKIP }, async () => {
  scalevMode = "deleted";
  const result = await patch({ scalevVariantId: 33333 });
  assert.equal(result.status, 422);
  assert.match(String(result.json.error), /tidak ditemukan|sudah dihapus/i);
  assert.equal(await savedVariantId(), 22222);
});

test("Scalev unavailable ditolak dan ID lama tidak tertimpa", { skip: SKIP }, async () => {
  scalevMode = "unavailable";
  const result = await patch({ scalevVariantId: 44444 });
  assert.equal(result.status, 502);
  assert.match(String(result.json.error), /belum disimpan|gagal memverifikasi/i);
  assert.equal(await savedVariantId(), 22222);
});