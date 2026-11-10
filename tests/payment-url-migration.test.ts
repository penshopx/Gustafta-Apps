import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import {
  paymentOrigin, planPaymentLinkMigration, applyPaymentLinkMigration,
  PaymentLinksChangedError, type PaymentLinkRows,
} from "../server/lib/payment-url-migration";

const old = "https://bayar.gustafta.my.id";
const target = "https://bayar.dokumenproyek.com";
const rows: PaymentLinkRows = {
  store_products: [
    { id: 1, payment_url: `${old}/p/produk?ref=a%2Fb#opsi` },
    { id: 2, payment_url: "https://checkout.vendor.com/pay" },
    { id: 3, payment_url: "https://bayar.gustafta.my.id.evil.com/pay" },
    { id: 4, payment_url: "mailto:sales@example.com" },
    { id: 5, payment_url: "https://user@bayar.gustafta.my.id/p/private" },
    { id: 6, payment_url: "https://BAYAR.GUSTAFTA.MY.ID:443/p/port" },
  ],
  agents: [
    { id: 7, payment_url: `${old}/c/checkout?variant=2` },
    { id: 8, payment_url: target + "/p/baru" },
  ],
};

test("only the exact former HTTPS checkout origin is rewritten, preserving the rest of each URL", () => {
  const plan = planPaymentLinkMigration(rows, paymentOrigin(old), paymentOrigin(target));
  assert.deepEqual(plan.changes, [
    { table: "agents", id: 7, from: `${old}/c/checkout?variant=2`, to: `${target}/c/checkout?variant=2` },
    { table: "store_products", id: 1, from: `${old}/p/produk?ref=a%2Fb#opsi`, to: `${target}/p/produk?ref=a%2Fb#opsi` },
    { table: "store_products", id: 6, from: "https://BAYAR.GUSTAFTA.MY.ID:443/p/port", to: `${target}/p/port` },
  ]);
  assert.equal(plan.ignored, 5);
  assert.equal(planPaymentLinkMigration(rows, old, target).fingerprint, plan.fingerprint);
  assert.notEqual(planPaymentLinkMigration({ ...rows, agents: [...rows.agents, { id: 9, payment_url: `${old}/p/new` }] }, old, target).fingerprint, plan.fingerprint);
});

test("requires a whole HTTPS origin, never a path, credential or lookalike prefix", () => {
  for (const input of ["http://example.com", "https://example.com/p/checkout", "https://a:b@example.com", "https://example.com?x=1"]) {
    assert.throws(() => paymentOrigin(input));
  }
  assert.throws(() => planPaymentLinkMigration(rows, old, old));
});

test("apply rolls back if the reviewed snapshot is stale; otherwise updates only approved rows", async () => {
  const statements: string[] = [];
  let current = rows;
  const client = {
    query: async (sql: string, args?: unknown[]) => {
      statements.push(sql);
      if (sql.startsWith("SELECT")) {
        return { rows: sql.includes("store_products") ? current.store_products : current.agents };
      }
      if (sql.startsWith("UPDATE")) {
        assert.ok(args && args[0] && args[1] && args[2]);
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    },
  } as unknown as PoolClient;
  const fingerprint = planPaymentLinkMigration(rows, old, target).fingerprint;
  current = { ...rows, agents: [...rows.agents, { id: 10, payment_url: `${old}/p/other` }] };
  await assert.rejects(applyPaymentLinkMigration(client, old, target, fingerprint), PaymentLinksChangedError);
  assert.ok(statements.includes("ROLLBACK"));
  assert.equal(statements.filter(s => s.startsWith("UPDATE")).length, 0);

  statements.length = 0;
  current = rows;
  assert.deepEqual(await applyPaymentLinkMigration(client, old, target, fingerprint), { agents: 1, store_products: 2 });
  assert.equal(statements.filter(s => s.startsWith("UPDATE")).length, 3);
  assert.equal(statements.at(-1), "COMMIT");
});

test("a failed conditional update rolls the whole migration back", async () => {
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.startsWith("SELECT")) return { rows: sql.includes("store_products") ? rows.store_products : rows.agents };
      if (sql.startsWith("UPDATE")) return { rowCount: 0 };
      return {};
    },
  } as unknown as PoolClient;
  const fingerprint = planPaymentLinkMigration(rows, old, target).fingerprint;
  await assert.rejects(applyPaymentLinkMigration(client, old, target, fingerprint), PaymentLinksChangedError);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.ok(!statements.includes("COMMIT"));
});