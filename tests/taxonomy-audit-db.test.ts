import { prepareTestDatabase, testDbSkip } from "./test-database";
const ready = await prepareTestDatabase();
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { AddressInfo } from "node:net";
import express from "express";
import { registerTaxonomyAdminRoutes } from "../server/taxonomy-admin-routes";

after(async () => {
  if (ready) await (await import("../server/db")).pool.end();
});

test("taxonomy audit is atomic, locks before snapshots, and survives deletion", {
  skip: ready ? false : testDbSkip,
}, async () => {
  const { pool } = await import("../server/db");
  const { DatabaseStorage } = await import("../server/db-storage");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../shared/schema");
  const client = await pool.connect();
  try {
    await client.query(await readFile("migrations/0030_taxonomy_audit_log.sql", "utf8"));
    await client.query("BEGIN");
    // One dedicated connection: all fixture mutations and nested storage
    // transactions are rolled back even if an assertion fails.
    const dbModule = await import("../server/db");
    const original = dbModule.db.transaction.bind(dbModule.db);
    const isolated = drizzle(client, { schema });
    dbModule.db.transaction = (async (callback: any) => {
      await client.query("SAVEPOINT taxonomy_mutation");
      try {
        const value = await callback(isolated);
        await client.query("RELEASE SAVEPOINT taxonomy_mutation");
        return value;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT taxonomy_mutation");
        await client.query("RELEASE SAVEPOINT taxonomy_mutation");
        throw error;
      }
    }) as any;
    try {
      const storage = new DatabaseStorage();
      const node = await storage.createTaxonomyNode({
        name: "Audit fixture", slug: `audit-fixture-${process.pid}`, level: "sektor",
      }, "admin-create");
      await storage.updateTaxonomyNode(node.id, { name: "Changed" }, "admin-update");
      await storage.deleteTaxonomyNode(node.id, 0, "admin-delete");
      const { rows } = await client.query(
        "SELECT * FROM taxonomy_audit_log WHERE taxonomy_id = $1 ORDER BY id", [node.id],
      );
      assert.deepEqual(rows.map(row => row.action), ["create", "update", "delete"]);
      assert.deepEqual(rows.map(row => row.actor_id), ["admin-create", "admin-update", "admin-delete"]);
      assert.equal(rows[0].before, null);
      assert.equal(rows[1].before.name, "Audit fixture");
      assert.equal(rows[1].after.name, "Changed");
      assert.equal(rows[2].before.name, "Changed");
      assert.equal(rows[2].after, null);
      const retained = await storage.createTaxonomyNode({
        name: "Retained", slug: `audit-retained-${process.pid}`, level: "sektor",
      }, "admin");

      // A database-side audit failure must undo the associated mutation.
      await client.query(`CREATE FUNCTION pg_temp.reject_taxonomy_audit() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$`);
      await client.query(`CREATE TRIGGER reject_test_audit BEFORE INSERT ON taxonomy_audit_log
        FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_taxonomy_audit()`);
      const slug = `audit-rejected-${process.pid}`;
      await assert.rejects(storage.createTaxonomyNode({
        name: "Must roll back", slug, level: "sektor",
      }, "admin"), /audit unavailable/);
      assert.equal((await client.query("SELECT id FROM knowledge_taxonomy WHERE slug = $1", [slug])).rowCount, 0);
      await assert.rejects(storage.updateTaxonomyNode(retained.id, { name: "Must roll back" }, "admin"), /audit unavailable/);
      assert.equal((await client.query("SELECT name FROM knowledge_taxonomy WHERE id = $1", [retained.id])).rows[0].name, "Retained");
      await client.query(`INSERT INTO knowledge_bases (agent_id, name, type, content, taxonomy_id)
        VALUES (1, 'Private KB', 'text', 'secret KB content', $1)`, [retained.id]);
      await assert.rejects(storage.deleteTaxonomyNode(retained.id, 1, "admin"), /audit unavailable/);
      assert.equal((await client.query("SELECT id FROM knowledge_taxonomy WHERE id = $1", [retained.id])).rowCount, 1);
      assert.equal((await client.query("SELECT content FROM knowledge_bases WHERE taxonomy_id = $1", [retained.id])).rows[0].content, "secret KB content");
      assert.equal((await client.query("SELECT id FROM taxonomy_audit_log WHERE taxonomy_id = $1", [retained.id])).rowCount, 1);
    } finally {
      dbModule.db.transaction = original;
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("concurrent taxonomy HTTP mutations serialize audit snapshots on independent PostgreSQL sessions", {
  skip: ready ? false : testDbSkip,
  timeout: 90_000,
}, async t => {
  const dbModule = await import("../server/db");
  const { DatabaseStorage } = await import("../server/db-storage");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../shared/schema");
  const first = await dbModule.pool.connect();
  const second = await dbModule.pool.connect();
  const original = dbModule.db.transaction;
  const sessions = [drizzle(first, { schema }), drizzle(second, { schema })];
  const context = new AsyncLocalStorage<number>();
  const storage = new DatabaseStorage();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const index = Number(req.headers["x-test-admin"]);
    assert.ok(index === 0 || index === 1);
    req.user = { id: `concurrent-admin-${index}` } as Express.User;
    context.run(index, next);
  });
  registerTaxonomyAdminRoutes(app, storage, (_req, _res, next) => next(), (_req, _res, next) => next());
  const server = app.listen(0, "127.0.0.1");
  let pending: Promise<unknown>[] = [];
  let release = latch();
  let acquired = latch();
  let rollback = false;
  let nodeId: number | undefined;
  let kbId: string | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    await first.query("SET statement_timeout = '10s'");
    await second.query("SET statement_timeout = '10s'");
    const firstPid = (await first.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const secondPid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    assert.notEqual(firstPid, secondPid, "the two admins must use independent PostgreSQL connections");
    // Only dispatch transactions to dedicated sessions; all SQL inside the
    // callback, BEGIN/COMMIT/ROLLBACK and HTTP handlers remain the real code.
    dbModule.db.transaction = (async (callback: any) => {
      const index = context.getStore();
      if (index === undefined) return original.call(dbModule.db, callback);
      return sessions[index].transaction(async tx => {
        const result = await callback(tx);
        if (index === 0) {
          acquired.resolve();
          await bounded(release.promise, "release first transaction");
          if (rollback) throw new Error("forced concurrent rollback");
        }
        return result;
      });
    }) as typeof original;
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/taxonomy`;
    const request = async (index: number, method: "PATCH" | "DELETE", body: object) => {
      const response = await fetch(`${base}/${nodeId}`, {
        method,
        headers: { "Content-Type": "application/json", "x-test-admin": String(index) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      return { status: response.status, body: await response.json() };
    };
    for (const scenario of [
      { first: "PATCH", second: "PATCH", rollback: false },
      { first: "PATCH", second: "DELETE", rollback: false },
      { first: "DELETE", second: "PATCH", rollback: false },
      { first: "PATCH", second: "PATCH", rollback: true },
      { first: "DELETE", second: "PATCH", rollback: true },
    ] as const) {
      await t.test(`${scenario.first} then ${scenario.second}, first ${scenario.rollback ? "rolls back" : "commits"}`, async () => {
        release = latch();
        acquired = latch();
        rollback = scenario.rollback;
        pending = [];
        const initial = await storage.createTaxonomyNode({
          name: "Initial committed name",
          slug: `concurrent-audit-${process.pid}-${scenario.first.toLowerCase()}-${scenario.second.toLowerCase()}-${rollback}`,
          level: "sektor",
        }, "fixture-admin");
        nodeId = initial.id;
        const kb = await first.query(`INSERT INTO knowledge_bases (agent_id, name, type, content, taxonomy_id)
          VALUES (1, 'Concurrent KB', 'text', 'KB bytes must survive', $1) RETURNING *`, [nodeId]);
        kbId = kb.rows[0].id;
        const originalKb = kb.rows[0];
        const body = (method: string, name: string) => method === "PATCH" ? { name } : { confirmedUsageCount: 1 };
        try {
          const leading = request(0, scenario.first, body(scenario.first, "First admin name"));
          pending.push(leading);
          await bounded(acquired.promise, "first mutation holds its locks before commit");
          const following = request(1, scenario.second, body(scenario.second, "Second admin name"));
          pending.push(following);
          // Observe a real server-side lock wait, not an arbitrary sleep or
          // Promise.all that could accidentally execute requests sequentially.
          await (async () => {
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
              const result = await first.query(
                "SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked", [firstPid, secondPid],
              );
              if (result.rows[0].blocked) return;
              await delay(10);
            }
            assert.fail("second admin did not block on the first PostgreSQL transaction");
          })();
          const during = await dbModule.pool.query(
            "SELECT action FROM taxonomy_audit_log WHERE taxonomy_id = $1 ORDER BY id", [nodeId],
          );
          assert.deepEqual(during.rows, [{ action: "create" }], "uncommitted audit must not be visible");
          release.resolve();
          const [a, b] = await Promise.all([leading, following]);
          assert.equal(a.status, rollback ? 500 : 200);
          const deletedFirst = scenario.first === "DELETE" && !rollback;
          assert.equal(b.status, deletedFirst ? 404 : 200);
          if (deletedFirst) assert.deepEqual(b.body, { error: "Kategori tidak ditemukan." });
          const history = (await first.query(
            "SELECT * FROM taxonomy_audit_log WHERE taxonomy_id = $1 ORDER BY id", [nodeId],
          )).rows;
          const expectedActions = ["create"];
          if (!rollback) expectedActions.push(scenario.first === "PATCH" ? "update" : "delete");
          if (!deletedFirst) expectedActions.push(scenario.second === "PATCH" ? "update" : "delete");
          assert.deepEqual(history.map(row => row.action), expectedActions, "no audit for a 404 or rollback");
          assert.deepEqual(history.map(row => row.actor_id), [
            "fixture-admin", ...(!rollback ? ["concurrent-admin-0"] : []),
            ...(!deletedFirst ? ["concurrent-admin-1"] : []),
          ]);
          assert.equal(history[0].before, null);
          for (let index = 1; index < history.length; index++) {
            assert.deepEqual(history[index].before, history[index - 1].after,
              "before must be exactly the latest committed snapshot, never a stale or rolled-back value");
          }
          const last = history.at(-1)!;
          const deleted = deletedFirst || scenario.second === "DELETE";
          const current = await storage.getTaxonomyNode(nodeId);
          if (deleted) {
            assert.equal(last.after, null);
            assert.equal(current, undefined);
          } else {
            assert.equal(last.after.name, "Second admin name");
            assert.deepEqual(JSON.parse(JSON.stringify(current)), last.after);
          }
          const documents = await first.query("SELECT * FROM knowledge_bases WHERE id = $1", [kbId]);
          assert.deepEqual(documents.rows, [{ ...originalKb, taxonomy_id: deleted ? null : nodeId }],
            "deletion only detaches the category; rollback restores the reference and all KB data survives");
        } finally {
          release.resolve();
          await Promise.allSettled(pending);
          await first.query("DELETE FROM knowledge_bases WHERE id = $1", [kbId]);
          await first.query("DELETE FROM taxonomy_audit_log WHERE taxonomy_id = $1", [nodeId]);
          await first.query("DELETE FROM knowledge_taxonomy WHERE id = $1", [nodeId]);
        }
      });
    }
  } finally {
    release.resolve();
    await Promise.allSettled(pending);
    dbModule.db.transaction = original;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await first.query("RESET statement_timeout");
    await second.query("RESET statement_timeout");
    first.release();
    second.release();
  }
});
