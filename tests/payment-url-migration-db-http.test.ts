import { prepareTestDatabase, testDbSkip } from "./test-database";
const ready = await prepareTestDatabase();

import assert from "node:assert/strict";
import { test } from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import {
  startPaymentMigrationFixture, oldOrigin, targetOrigin, confirmation, schema,
} from "./fixtures/payment-url-migration";

const options = { skip: ready ? false : testDbSkip, timeout: 30_000 };

async function waitFor(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(15);
  }
  assert.fail(`Timed out: ${description}`);
}

test("real HTTP auth: anonymous, ordinary, blocked and inactive accounts cannot preview or apply", options, async () => {
  const fixture = await startPaymentMigrationFixture();
  try {
    const before = await fixture.snapshot();
    for (const actor of [undefined, "ordinary", "blocked", "inactive"]) {
      for (const path of ["preview", "apply"] as const) {
        const response = await fixture.request(path, actor, {
          oldOrigin, confirmation, fingerprint: "a".repeat(64),
        });
        assert.equal(response.status, actor ? 403 : 401, `${actor} ${path}: ${await response.text()}`);
      }
    }
    assert.equal(fixture.linkReads, 0, "Denied requests cannot read checkout links");
    assert.equal(fixture.invalidations, 0);
    assert.deepEqual(await fixture.snapshot(), before);
    for (const actor of ["admin", "superadmin"]) {
      const response = await fixture.request("preview", actor);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const plan = await response.json();
      assert.equal(plan.count, 2);
      assert.equal(plan.targetOrigin, targetOrigin);
    }
    assert.deepEqual(await fixture.snapshot(), before, "Preview is read-only");
  } finally { await fixture.close(); }
});

test("real HTTP apply rejects missing, malformed and mismatched approval without writes", options, async () => {
  const fixture = await startPaymentMigrationFixture();
  try {
    const before = await fixture.snapshot();
    const plan = await (await fixture.request("preview", "admin")).json();
    for (const [body, status] of [
      [{ oldOrigin, fingerprint: plan.fingerprint }, 400],
      [{ oldOrigin, fingerprint: plan.fingerprint, confirmation: confirmation.toLowerCase() }, 400],
      [{ oldOrigin, confirmation }, 400],
      [{ oldOrigin, confirmation, fingerprint: "not-a-hash" }, 400],
      [{ oldOrigin, confirmation, fingerprint: "0".repeat(64) }, 409],
      [{ oldOrigin: "https://other.example.test", confirmation, fingerprint: plan.fingerprint }, 409],
      [{ oldOrigin: "https://old-checkout.example.test/path", confirmation, fingerprint: plan.fingerprint }, 400],
      [{ oldOrigin: targetOrigin, confirmation, fingerprint: plan.fingerprint }, 400],
    ] as const) {
      const response = await fixture.request("apply", "admin", body);
      assert.equal(response.status, status, await response.text());
      assert.deepEqual(await fixture.snapshot(), before);
      assert.equal(fixture.invalidations, 0);
    }
  } finally { await fixture.close(); }
});

test("committed migration changes both real tables, preserves other links, and cannot replay its preview", options, async () => {
  const fixture = await startPaymentMigrationFixture();
  try {
    for (const actor of ["admin", "superadmin"]) {
      await fixture.reset();
      const before = await fixture.snapshot();
      const preview = await fixture.request("preview", actor);
      const plan = await preview.json();
      assert.deepEqual(plan.changes.map((change: any) => change.table), ["agents", "store_products"]);
      const body = { oldOrigin, confirmation, fingerprint: plan.fingerprint };
      const applied = await fixture.request("apply", actor, body);
      assert.equal(applied.status, 200);
      assert.equal(applied.headers.get("cache-control"), "no-store");
      assert.deepEqual(await applied.json(), { updated: { agents: 1, store_products: 1 }, targetOrigin });
      // Separate pooled connection observes COMMIT, not uncommitted fixture state.
      const after = await fixture.snapshot();
      assert.equal(after.agents[0].payment_url, `${targetOrigin}/c/checkout?variant=2`);
      assert.equal(after.store_products[0].payment_url, `${targetOrigin}/p/produk?ref=a%2Fb#opsi`);
      assert.deepEqual(after.agents.slice(1), before.agents.slice(1));
      assert.deepEqual(after.store_products.slice(1), before.store_products.slice(1));
      const invalidations = fixture.invalidations;
      assert.equal((await fixture.request("apply", actor, body)).status, 409);
      assert.equal(fixture.invalidations, invalidations);
      assert.deepEqual(await fixture.snapshot(), after);
    }
    assert.equal(fixture.invalidations, 2);
  } finally { await fixture.close(); }
});

test("a stale real preview never rewrites either table or overwrites an intervening edit", options, async () => {
  const fixture = await startPaymentMigrationFixture();
  try {
    for (const table of ["agents", "store_products"]) {
      await fixture.reset();
      const plan = await (await fixture.request("preview", "admin")).json();
      await fixture.pool.query(`UPDATE ${table} SET payment_url = $1 WHERE id = 1`, [`${oldOrigin}/edited`]);
      const edited = await fixture.snapshot();
      const response = await fixture.request("apply", "admin", { oldOrigin, confirmation, fingerprint: plan.fingerprint });
      assert.equal(response.status, 409);
      assert.deepEqual(await fixture.snapshot(), edited);
      assert.equal(fixture.invalidations, 0);
    }
  } finally { await fixture.close(); }
});

test("parallel HTTP approvals of one preview contend on PostgreSQL locks: one commits, one returns 409", options, async () => {
  let releaseWinner!: () => void;
  const held = new Promise<void>(resolve => { releaseWinner = resolve; });
  let winnerHasLocks = false;
  const transactions: { pid: number; statements: string[] }[] = [];
  const fixture = await startPaymentMigrationFixture({
    async wrapApplyClient(client) {
      const { rows } = await client.query("SELECT pg_backend_pid() AS pid");
      const transaction = { pid: rows[0].pid as number, statements: [] as string[] };
      transactions.push(transaction);
      // Instrument only the migration's lease, not pool.connect/query or auth.
      // Every SQL statement still executes against real PostgreSQL.
      const query = (async (sql: string, values?: unknown[]) => {
        const result = await client.query(sql, values);
        transaction.statements.push(sql);
        // Schedule independently of the FOR UPDATE suffix so removing the lock
        // cannot bypass the gate and accidentally turn this into a replay test.
        if (transactions[0] === transaction && sql.startsWith("SELECT id, payment_url FROM agents")) {
          winnerHasLocks = true;
          await held;
        }
        return result;
      }) as typeof client.query;
      return new Proxy(client, {
        get(target, key) {
          if (key === "query") return query;
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  });
  const pending: Promise<Response>[] = [];
  try {
    const before = await fixture.snapshot();
    const preview = await fixture.request("preview", "admin");
    assert.equal(preview.status, 200);
    const plan = await preview.json();
    assert.equal(plan.count, 2);
    const body = { oldOrigin, confirmation, fingerprint: plan.fingerprint };
    const startApply = (actor: string) => {
      const request = fixture.request("apply", actor, body);
      pending.push(request);
      // Attach a rejection handler immediately, even if an assertion fails.
      void request.catch(() => {});
      return request;
    };
    const first = startApply("admin");
    await waitFor(async () => winnerHasLocks, "first approval holds both table locks");
    const second = startApply("superadmin");
    await waitFor(async () => transactions.length === 2, "second approval uses its own connection");
    const [winner, loser] = transactions;
    assert.notEqual(winner.pid, loser.pid);
    await waitFor(async () => {
      const { rows } = await fixture.pool.query(`
        SELECT wait_event_type, pg_blocking_pids(pid) AS blockers, query
        FROM pg_stat_activity WHERE pid = $1
      `, [loser.pid]);
      return rows[0]?.wait_event_type === "Lock" &&
        rows[0].blockers.includes(winner.pid) &&
        rows[0].query.startsWith("SELECT id, payment_url FROM store_products");
    }, "PostgreSQL reports second approval blocked by first approval's row locks");
    assert.equal(fixture.invalidations, 0, "Neither in-flight request has committed");
    assert.deepEqual(await fixture.snapshot(), before, "Uncommitted work is not externally visible");
    releaseWinner();

    const [applied, conflict] = await Promise.all([first, second]);
    assert.equal(applied.status, 200);
    assert.deepEqual(await applied.json(), { updated: { agents: 1, store_products: 1 }, targetOrigin });
    assert.equal(conflict.status, 409);
    assert.match((await conflict.json()).error, /Tautan berubah sejak pratinjau/);
    assert.equal(fixture.invalidations, 1, "Only the committed approval invalidates the catalog");
    assert.equal(winner.statements.at(-1), "COMMIT");
    assert.equal(winner.statements.filter(sql => sql.startsWith("UPDATE ")).length, 2);
    assert.equal(loser.statements.at(-1), "ROLLBACK");
    assert.equal(loser.statements.filter(sql => sql.startsWith("UPDATE ")).length, 0,
      "The waiting approval rechecks the fingerprint before writing either table");
    const after = await fixture.snapshot();
    assert.deepEqual(after, {
      agents: [
        { ...before.agents[0], payment_url: `${targetOrigin}/c/checkout?variant=2` },
        ...before.agents.slice(1),
      ],
      store_products: [
        { ...before.store_products[0], payment_url: `${targetOrigin}/p/produk?ref=a%2Fb#opsi` },
        ...before.store_products.slice(1),
      ],
    }, "Both tables commit together; unrelated, null, empty and lookalike links stay unchanged");
  } finally {
    releaseWinner();
    await Promise.allSettled(pending);
    await fixture.close();
  }
});

test("real PostgreSQL error and zero-row update roll back the earlier table update", options, async () => {
  const fixture = await startPaymentMigrationFixture();
  try {
    for (const mode of ["exception", "zero-row"]) {
      await fixture.reset();
      const before = await fixture.snapshot();
      const plan = await (await fixture.request("preview", "admin")).json();
      const invalidations = fixture.invalidations;
      const notices = fixture.notices.length;
      // The plan updates agents first. The trigger verifies that update really
      // happened inside the same transaction before breaking store_products.
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
      const response = await fixture.request("apply", "admin", { oldOrigin, confirmation, fingerprint: plan.fingerprint });
      assert.equal(response.status, mode === "exception" ? 500 : 409);
      assert.ok(fixture.notices.slice(notices).includes("Fixture observed first-table update"));
      assert.deepEqual(await fixture.snapshot(), before, "The first table update must be rolled back too");
      assert.equal(fixture.invalidations, invalidations);
      // Same pool remains usable after ROLLBACK; a fresh reviewed retry works.
      await fixture.pool.query("DROP TRIGGER fail_payment_update ON store_products");
      assert.equal((await fixture.request("apply", "admin", { oldOrigin, confirmation, fingerprint: plan.fingerprint })).status, 200);
      assert.equal(fixture.invalidations, invalidations + 1);
    }
  } finally { await fixture.close(); }
});

test("SIGKILL leaves a durable fixture claim; the next run recovers committed changes and cleans up", options, async () => {
  const probe = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const child = fork(fileURLToPath(new URL("./fixtures/payment-url-migration-kill-child.ts", import.meta.url)), {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let fixture: Awaited<ReturnType<typeof startPaymentMigrationFixture>> | undefined;
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr += chunk; });
  try {
    const message = await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(20_000) }).then(([value]) => value),
      once(child, "exit").then(() => { throw new Error(`Abort worker exited before ready: ${stderr}`); }),
    ]);
    assert.deepEqual(message, { committed: true });
    assert.equal((await probe.query("SELECT count(*)::int AS n FROM public.payment_url_test_recovery")).rows[0].n, 1);
    assert.equal((await probe.query(`SELECT payment_url FROM ${schema}.agents WHERE id = 1`)).rows[0].payment_url,
      `${targetOrigin}/c/checkout?variant=2`);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    assert.equal((await exited)[1], "SIGKILL");
    fixture = await startPaymentMigrationFixture();
    const recovered = await fixture.snapshot();
    assert.equal(recovered.agents[0].payment_url, `${oldOrigin}/c/checkout?variant=2`);
    assert.equal(recovered.store_products[0].payment_url, `${oldOrigin}/p/produk?ref=a%2Fb#opsi`);
    await fixture.close();
    fixture = undefined;
    assert.equal((await probe.query("SELECT to_regnamespace($1) AS name", [schema])).rows[0].name, null);
    assert.equal((await probe.query("SELECT count(*)::int AS n FROM public.payment_url_test_recovery")).rows[0].n, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    if (fixture) await fixture.close();
    await probe.end();
  }
});
