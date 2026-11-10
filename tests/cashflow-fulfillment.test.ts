import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
const { pool } = await import("../server/db");
const { fulfillCanonicalOrder } = await import("../server/order-fulfillment");

const SKIP = !testDatabaseReady;

test("paid Mandor package grants exactly two agent subscriptions and replay is idempotent", { skip: SKIP }, async () => {
  const run = randomUUID().replace(/-/g, "").slice(0, 12);
  const email = `cashflow-${run}@example.test`;
  const providerRef = `CF338${run}`.toUpperCase();
  const orderRef = `ORD-CF338-${run}`.toUpperCase();
  let orderId = 0;
  try {
    const pkg = await pool.query<{ version: number; price: number }>(
      `SELECT version, price
         FROM package_registry
        WHERE package_id='CASHFLOW-PBJ-MANDOR-3M'
          AND status='ACTIVE'
        LIMIT 1`,
    );
    assert.equal(pkg.rowCount, 1, "seed paket CASHFLOW-PBJ harus tersedia");
    const order = await pool.query<{ id: number }>(
      `INSERT INTO store_orders (
         product_id, customer_name, customer_email, customer_phone, amount,
         midtrans_order_id, access_token, status, source, item_name,
         package_id, package_version, scalev_order_id, fulfillment_status
       ) VALUES (
         0,'Cashflow Test',$1,'081111111111',$2,
         $3,$4,'paid','api_v1','CASHFLOW-PBJ Mandor',
         'CASHFLOW-PBJ-MANDOR-3M',$5,$6,'pending'
       )
       RETURNING id`,
      [email, pkg.rows[0].price, orderRef, randomUUID(), pkg.rows[0].version, providerRef],
    );
    orderId = order.rows[0].id;

    const first = await fulfillCanonicalOrder({ orderId, providerOrderRef: providerRef });
    assert.equal(first.status, "fulfilled");
    const second = await fulfillCanonicalOrder({ orderId, providerOrderRef: providerRef });
    assert.equal(second.status, "existing");

    const subscriptions = await pool.query<{ slug: string; status: string; end_date: Date }>(
      `SELECT a.slug, cs.status, cs.end_date
         FROM client_subscriptions cs
         JOIN agents a ON a.id::text=cs.agent_id::text
        WHERE cs.order_id LIKE $1
        ORDER BY a.slug`,
      [`canonical:${providerRef}:%`],
    );
    assert.deepEqual(
      subscriptions.rows.map((row) => row.slug),
      ["si-berkas-claw", "si-kas-claw"],
    );
    assert.ok(subscriptions.rows.every((row) => row.status === "active"));
    assert.ok(
      subscriptions.rows.every(
        (row) => new Date(row.end_date).getTime() > Date.now() + 80 * 86400_000,
      ),
    );

    const entitlements = await pool.query<{ slug: string }>(
      `SELECT pr.slug
         FROM product_entitlements pe
         JOIN product_registry pr ON pr.product_id=pe.product_registry_id
        WHERE pe.provider_order_ref=$1
        ORDER BY pr.slug`,
      [providerRef],
    );
    assert.deepEqual(
      entitlements.rows.map((row) => row.slug),
      ["si-berkas-claw", "si-kas-claw"],
    );
  } finally {
    await pool.query(`DELETE FROM client_subscriptions WHERE order_id LIKE $1`, [
      `canonical:${providerRef}:%`,
    ]);
    await pool.query(`DELETE FROM product_entitlements WHERE provider_order_ref=$1`, [
      providerRef,
    ]);
    if (orderId) await pool.query(`DELETE FROM store_orders WHERE id=$1`, [orderId]);
  }
});