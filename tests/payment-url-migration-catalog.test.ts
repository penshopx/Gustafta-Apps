import { prepareTestDatabase, testDbSkip } from "./test-database";
const ready = await prepareTestDatabase();

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  startPaymentMigrationFixture, oldOrigin, targetOrigin, confirmation,
} from "./fixtures/payment-url-migration";

const options = { skip: ready ? false : testDbSkip, timeout: 15_000 };
type Fixture = Awaited<ReturnType<typeof startPaymentMigrationFixture>>;

async function catalog(fixture: Fixture, query = "") {
  const response = await fixture.catalog(query);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  const body = await response.json();
  assert.equal(body.total, 6);
  assert.equal(body.items.length, 6);
  return body.items as { type: string; id: number; paymentUrl: string | null }[];
}

async function preview(fixture: Fixture) {
  const response = await fixture.request("preview", "admin");
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.count, 2);
  return { oldOrigin, confirmation, fingerprint: plan.fingerprint };
}

function migrated(items: Awaited<ReturnType<typeof catalog>>) {
  return items.map(item => ({
    ...item,
    paymentUrl: item.paymentUrl?.startsWith(`${oldOrigin}/`)
      ? targetOrigin + item.paymentUrl.slice(oldOrigin.length) : item.paymentUrl,
  }));
}

test("real admin preview/apply refreshes warmed public catalog variants immediately after COMMIT", options, async () => {
  const fixture = await startPaymentMigrationFixture();
  try {
    const started = Date.now();
    // Exercise separate cache keys through the production HTTP query parser.
    const queries = ["", "?category=fixture", "?search=fixture", "?module=fixture"];
    const before = await catalog(fixture);
    for (const query of queries) {
      assert.deepEqual(await catalog(fixture, query), before);
      assert.deepEqual(await catalog(fixture, query), before);
    }
    assert.equal(fixture.catalogBuilds, queries.length, "Repeated GETs really use warm cache entries");
    const body = await preview(fixture);
    assert.deepEqual(await catalog(fixture), before, "Preview does not rewrite catalog URLs");
    assert.equal(fixture.catalogBuilds, queries.length);
    assert.equal(fixture.invalidations, 0);

    const response = await fixture.request("apply", "admin", body);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      updated: { agents: 1, store_products: 1 }, targetOrigin,
    });
    // Snapshot uses another pooled lease: successful HTTP must mean committed.
    const rows = await fixture.snapshot();
    assert.equal(rows.agents[0].payment_url, `${targetOrigin}/c/checkout?variant=2`);
    assert.equal(rows.store_products[0].payment_url, `${targetOrigin}/p/produk?ref=a%2Fb#opsi`);
    for (const query of queries) {
      assert.deepEqual(await catalog(fixture, query), migrated(before),
        "First post-apply GET must rebuild, preserving suffixes, unrelated URLs, null and empty values");
      assert.deepEqual(await catalog(fixture, query), migrated(before));
    }
    assert.equal(fixture.invalidations, 1);
    assert.equal(fixture.catalogBuilds, queries.length * 2);
    assert.ok(Date.now() - started < 30_000, "Observe new URLs before the production cache TTL expires");
  } finally { await fixture.close(); }
});

test("real partial-update failures roll back both tables and leave the warmed catalog untouched", options, async () => {
  const fixture = await startPaymentMigrationFixture();
  try {
    for (const mode of ["exception", "zero-row"] as const) {
      await fixture.reset();
      const started = Date.now();
      const rows = await fixture.snapshot();
      const before = await catalog(fixture);
      assert.deepEqual(await catalog(fixture), before);
      const builds = fixture.catalogBuilds;
      const invalidations = fixture.invalidations;
      const notices = fixture.notices.length;
      const body = await preview(fixture);
      // Fail the second table only after verifying the first table's write.
      await fixture.pool.query(`
        CREATE OR REPLACE FUNCTION fail_payment_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF (SELECT payment_url FROM agents WHERE id = 1) <> '${targetOrigin}/c/checkout?variant=2' THEN
            RAISE EXCEPTION 'Fixture did not reach a partial update';
          END IF;
          RAISE NOTICE 'Fixture observed first-table update';
          ${mode === "exception" ? "RAISE EXCEPTION 'Injected second-table failure';" : "RETURN NULL;"}
        END $$;
        CREATE TRIGGER fail_payment_update BEFORE UPDATE ON store_products
          FOR EACH ROW EXECUTE FUNCTION fail_payment_update();
      `);
      const response = await fixture.request("apply", "admin", body);
      assert.equal(response.status, mode === "exception" ? 500 : 409);
      assert.ok(fixture.notices.slice(notices).includes("Fixture observed first-table update"));
      assert.deepEqual(await fixture.snapshot(), rows);
      assert.deepEqual(await catalog(fixture), before, "First GET after ROLLBACK keeps the old URLs");
      assert.equal(fixture.invalidations, invalidations, "ROLLBACK must not invalidate warm entries");
      assert.equal(fixture.catalogBuilds, builds, "Failed apply retains the same cached result");
      assert.ok(Date.now() - started < 30_000);

      // Also prove an actual DB rebuild cannot expose the aborted partial write.
      fixture.invalidateCatalog();
      assert.deepEqual(await catalog(fixture), before);
      assert.equal(fixture.catalogBuilds, builds + 1);
    }
  } finally { await fixture.close(); }
});

test("a pre-COMMIT PostgreSQL catalog read cannot overwrite the new cache after migration", options, async () => {
  let pauseNextBuild = false;
  let releaseOldBuild!: () => void;
  let beganBuild!: () => void;
  const started = new Promise<void>(resolve => { beganBuild = resolve; });
  const held = new Promise<void>(resolve => { releaseOldBuild = resolve; });
  const fixture = await startPaymentMigrationFixture({
    async afterCatalogRead() {
      if (pauseNextBuild) {
        pauseNextBuild = false;
        beganBuild();
        await held;
      }
    },
  });
  let oldRequest: ReturnType<typeof catalog> | undefined;
  try {
    const before = await catalog(fixture);
    assert.deepEqual(await catalog(fixture), before);
    assert.equal(fixture.catalogBuilds, 1);
    const body = await preview(fixture);
    fixture.invalidateCatalog();
    pauseNextBuild = true;
    oldRequest = catalog(fixture);
    void oldRequest.catch(() => {});
    await started;
    const response = await fixture.request("apply", "admin", body);
    assert.equal(response.status, 200);
    assert.deepEqual(await catalog(fixture), migrated(before));
    assert.equal(fixture.catalogBuilds, 3);
    releaseOldBuild();
    assert.deepEqual(await oldRequest, before, "The held request captured committed pre-migration rows");
    assert.deepEqual(await catalog(fixture), migrated(before),
      "Late completion must not publish its old URL over the new cached links");
    assert.equal(fixture.catalogBuilds, 3, "The new cache survives the older build's cleanup");
  } finally {
    releaseOldBuild();
    await oldRequest?.catch(() => {});
    await fixture.close();
  }
});
