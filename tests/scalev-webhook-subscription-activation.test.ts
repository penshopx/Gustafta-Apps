import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

/**
 * Task #208 — Webhook pembayaran Scalev tetap mengaktifkan langganan dengan
 * benar setelah rename kolom (scalev_order_id → order_id, scalev_payment_url
 * → payment_url) di tabel subscriptions_new.
 *
 * Integrasi end-to-end nyata (HTTP → route handler → DB):
 * 1. Seed user dengan email unik.
 * 2. POST payload webhook Scalev realistis (payment_status=paid) untuk paket
 *    1/3/6/12 bulan ke /api/webhooks/scalev.
 * 3. Mengirim webhook paid yang sama dua kali tetap menghasilkan tepat satu
 *    baris subscriptions_new: status='active', order_id terisi
 *    `scalev_plan_<orderId>`, user_id benar, plan sesuai, dan end_date tepat
 *    30/90/180/365 hari setelah start_date.
 * 4. storage.getSubscriptionByOrderId menemukan baris via kolom order_id yang
 *    sudah di-rename (regresi rename tertangkap di sini).
 * 5. Negatif: payment_status != "paid" TIDAK membuat baris langganan.
 *
 * Dilewati otomatis bila TEST_DATABASE_URL tidak ada (CI tanpa DB).
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const hasDb = testDatabaseReady;
const SKIP = hasDb ? false : testDbSkip;

const RUN = `scalev_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL = `${RUN}@example.test`;
const TEST_USER_ID = `test-user-${RUN}`;
const ORDER_ID = `ORD-${RUN}`;
const ORDER_ID_UNPAID = `ORD-unpaid-${RUN}`;
const UNKNOWN_EMAIL = `unknown-${RUN}@example.test`;
const MAPPED_PRODUCT = `Mapped Subscription ${RUN}`;
const EXPECTED_STORED_ORDER_ID = `scalev_plan_${ORDER_ID}`;

let server: Server;
let baseUrl: string;
let db: any, pool: any, users: any, subscriptionsTable: any, scalevMappings: any, eq: any, like: any;
let storageDb: any;
const adminAlerts: any[] = [];
const originalFetch = globalThis.fetch;

before(async () => {
  if (!testDatabaseReady) return;
  if (!hasDb) return;

  // Jangan pernah kirim event Purchase sungguhan ke Meta dari test.
  delete process.env.META_CAPI_ACCESS_TOKEN;
  delete process.env.META_PIXEL_ID;
  process.env.BREVO_API_KEY = "test-only-key";
  process.env.BREVO_ALERT_EMAIL = "admin@example.test";
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.brevo.com")) {
      adminAlerts.push(JSON.parse(String(init?.body)));
      return new Response("", { status: 201 });
    }
    return originalFetch(url, init);
  };

  ({ db, pool } = await import("../server/db"));
  ({ users } = await import("../shared/models/auth"));
  ({ subscriptionsTable, scalevMappings } = await import("../shared/schema"));
  ({ eq, like } = await import("drizzle-orm"));
  ({ storage: storageDb } = await import("../server/storage"));
  const { registerRoutes } = await import("../server/routes");

  await db.insert(users).values({
    id: TEST_USER_ID,
    email: TEST_EMAIL,
    firstName: "Scalev",
    lastName: "Tester",
    emailVerified: true,
  } as any);
  await db.insert(scalevMappings).values({
    scalevProductName: MAPPED_PRODUCT,
    type: "subscription",
    label: MAPPED_PRODUCT,
    meta: { plan: "starter", durationDays: 30 },
  });

  const app = express();
  // Tangkap raw body persis seperti server/index.ts supaya verifikasi
  // signature webhook menerima input yang sama dengan produksi.
  app.use(express.json({
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  }));

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  server = httpServer;
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (!testDatabaseReady) return;
  if (!hasDb) return;
  try {
    await db.delete(subscriptionsTable).where(eq(subscriptionsTable.userId, TEST_USER_ID));
    await db.delete(scalevMappings).where(eq(scalevMappings.scalevProductName, MAPPED_PRODUCT));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  } finally {
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.end().catch(() => {});
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Payload webhook Scalev realistis (format payment_status_changed). */
function buildPayload(opts: {
  orderId: string;
  paymentStatus: string;
  productName?: string;
  email?: string;
}): object {
  const productName = opts.productName ?? "Gustafta Paket 1 Bulan";
  return {
    event: "payment_status_changed",
    data: {
      order_id: opts.orderId,
      payment_status: opts.paymentStatus,
      gross_revenue: "299000",
      product_name: productName,
      final_variants: { [productName]: 1 },
      customer: {
        email: opts.email ?? TEST_EMAIL,
        name: "Scalev Tester",
        phone: "081234567890",
      },
    },
  };
}

/**
 * POST ke /api/webhooks/scalev. Auth lolos via shared secret
 * (SCALEV_WEBHOOK_SECRET → header x-scalev-secret); bila tidak dikonfigurasi,
 * handler menerima tanpa secret (mode legacy).
 */
async function postWebhook(payload: object): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.SCALEV_WEBHOOK_SECRET) {
    headers["x-scalev-secret"] = process.env.SCALEV_WEBHOOK_SECRET;
  }
  const res = await fetch(`${baseUrl}/api/webhooks/scalev`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("retry webhook paid → tepat satu subscriptions_new active dengan order_id benar", { skip: SKIP }, async () => {
  const payload = buildPayload({ orderId: ORDER_ID, paymentStatus: "paid" });
  const { status, body } = await postWebhook(payload);
  assert.equal(status, 200, `webhook harus 200, dapat ${status}: ${JSON.stringify(body)}`);
  assert.equal(body?.type, "platform_subscription", "harus diproses sebagai platform subscription");

  const retry = await postWebhook(payload);
  assert.equal(retry.status, 200, `retry webhook harus 200, dapat ${retry.status}: ${JSON.stringify(retry.body)}`);
  assert.equal(retry.body?.type, "platform_subscription", "retry harus dikenali sebagai platform subscription");
  assert.equal(retry.body?.note, "Duplicate, already processed", "retry harus dilaporkan sebagai duplikat");

  const rows = await db.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.orderId, EXPECTED_STORED_ORDER_ID));
  assert.equal(rows.length, 1, "harus ada tepat 1 baris subscriptions_new untuk order ini");
  const sub = rows[0];
  assert.equal(sub.status, "active", "status harus 'active'");
  assert.equal(sub.userId, TEST_USER_ID, "user_id harus milik pembeli");
  assert.equal(sub.plan, "monthly_1", "plan harus monthly_1 (Gustafta Paket 1 Bulan)");
  assert.ok(sub.orderId === EXPECTED_STORED_ORDER_ID, "order_id (kolom hasil rename) harus terisi");
  assert.ok(sub.startDate instanceof Date && sub.endDate instanceof Date, "start/end date harus terisi");
  const days = (sub.endDate.getTime() - sub.startDate.getTime()) / 86_400_000;
  assert.ok(days > 29 && days < 31, `durasi harus ~30 hari, dapat ${days}`);
});

const LONGER_PLAN_CASES = [
  { months: 3, plan: "monthly_3", durationDays: 90 },
  { months: 6, plan: "monthly_6", durationDays: 180 },
  { months: 12, plan: "monthly_12", durationDays: 365 },
] as const;

for (const { months, plan, durationDays } of LONGER_PLAN_CASES) {
  test(`webhook paid paket ${months} bulan → plan ${plan} aktif selama ${durationDays} hari`, { skip: SKIP }, async () => {
    const orderId = `ORD-${months}m-${RUN}`;
    const storedOrderId = `scalev_plan_${orderId}`;
    const productName = `Gustafta Paket ${months} Bulan`;

    const { status, body } = await postWebhook(buildPayload({
      orderId,
      paymentStatus: "paid",
      productName,
    }));
    assert.equal(status, 200, `webhook harus 200, dapat ${status}: ${JSON.stringify(body)}`);
    assert.equal(body?.type, "platform_subscription", "harus diproses sebagai platform subscription");

    const rows = await db.select().from(subscriptionsTable)
      .where(eq(subscriptionsTable.orderId, storedOrderId));
    assert.equal(rows.length, 1, `harus ada tepat 1 langganan untuk paket ${months} bulan`);

    const sub = rows[0];
    assert.equal(sub.status, "active", "status harus 'active'");
    assert.equal(sub.userId, TEST_USER_ID, "user_id harus milik pembeli");
    assert.equal(sub.plan, plan, `paket ${months} bulan harus memakai plan ${plan}`);
    assert.ok(sub.startDate instanceof Date && sub.endDate instanceof Date, "start/end date harus terisi");

    const durationMs = sub.endDate.getTime() - sub.startDate.getTime();
    assert.equal(
      durationMs,
      durationDays * 86_400_000,
      `paket ${months} bulan harus aktif tepat ${durationDays} hari`,
    );
  });
}

test("storage.getSubscriptionByOrderId menemukan baris via kolom order_id", { skip: SKIP }, async () => {
  const sub = await storageDb.getSubscriptionByOrderId(EXPECTED_STORED_ORDER_ID);
  assert.ok(sub, "getSubscriptionByOrderId harus menemukan langganan");
  assert.equal(sub.status, "active");
  assert.equal(sub.orderId, EXPECTED_STORED_ORDER_ID);
  assert.equal(sub.userId, TEST_USER_ID);
});

test("webhook non-paid TIDAK membuat baris langganan", { skip: SKIP }, async () => {
  const { status } = await postWebhook(buildPayload({ orderId: ORDER_ID_UNPAID, paymentStatus: "pending" }));
  assert.equal(status, 200, "webhook non-paid tetap 200 (acknowledged)");
  const rows = await db.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.orderId, `scalev_plan_${ORDER_ID_UNPAID}`));
  assert.equal(rows.length, 0, "tidak boleh ada baris langganan untuk order non-paid");
});

test("webhook paket platform berbayar tanpa akun mengirim alert admin", { skip: SKIP }, async () => {
  const orderId = `ORD-unknown-platform-${RUN}`;
  const before = adminAlerts.length;
  const { status, body } = await postWebhook(buildPayload({
    orderId,
    paymentStatus: "paid",
    email: UNKNOWN_EMAIL,
  }));
  assert.equal(status, 200);
  assert.equal(body?.type, "platform_subscription");
  assert.equal(adminAlerts.length, before + 1);
  assert.match(adminAlerts.at(-1).textContent, new RegExp(UNKNOWN_EMAIL.replace(".", "\\.")));
  assert.match(adminAlerts.at(-1).textContent, new RegExp(orderId));
});

test("webhook mapped subscription berbayar tanpa akun mengirim alert admin", { skip: SKIP }, async () => {
  const orderId = `ORD-unknown-mapped-${RUN}`;
  const before = adminAlerts.length;
  const { status } = await postWebhook(buildPayload({
    orderId,
    paymentStatus: "paid",
    productName: MAPPED_PRODUCT,
    email: UNKNOWN_EMAIL,
  }));
  assert.equal(status, 200);
  assert.equal(adminAlerts.length, before + 1);
  assert.match(adminAlerts.at(-1).textContent, /starter \(30 hari\)/);
  assert.match(adminAlerts.at(-1).textContent, new RegExp(orderId));
});
