/**
 * Lease controller, not an application fixture. It only proves the DB and
 * launches guarded workers; taking a lease here would serialize the contenders
 * under one inherited group and invalidate this regression.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { proveTestDatabase, testDbSkip } from "./test-database";

const target = process.env.TEST_DATABASE_URL;
if (target) await proveTestDatabase(target);

type Message = { state: string; group?: string; blocked?: boolean; pooledAbsent?: boolean };
function worker(options: { group?: string; snapshot?: boolean; label?: string; table?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, LEASE_PROBE_LABEL: options.label,
    LEASE_PROBE_SNAPSHOT: options.snapshot ? "1" : "0", LEASE_PROBE_TABLE: options.table };
  delete env.TEST_DATABASE_LEASE_GROUP;
  if (options.group) env.TEST_DATABASE_LEASE_GROUP = options.group;
  const child = fork(new URL("./fixtures/test-database-lease-worker.ts", import.meta.url), {
    execArgv: ["--import", "tsx"], env, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const messages: Message[] = [];
  let stderr = "";
  child.stderr!.on("data", data => { stderr += data; });
  child.on("message", message => messages.push(message as Message));
  const exit = once(child, "exit");
  return {
    child, messages, exit,
    async state(state: string) {
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        const message = messages.find(value => value.state === state);
        if (message) return message;
        assert.equal(child.exitCode, null, `worker exited: ${stderr}`);
        assert.equal(child.signalCode, null, `worker killed: ${stderr}`);
        await delay(10);
      }
      assert.fail(`worker never reached ${state}: ${stderr}`);
    },
    async finish() {
      child.send("finish");
      assert.deepEqual(await exit, [0, null], stderr);
    },
  };
}
type Worker = ReturnType<typeof worker>;
async function kill(child: ChildProcess, exit: Promise<unknown>) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exit;
  }
}
async function waiting(pool: pg.Pool, contender: Worker) {
  await contender.state("attempting");
  // Observe the real competing DB connection, not just startup timing.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = $1`,
    [`integration-test-fixture-lease:${contender.child.pid}`]);
    if (rows[0].n === 1) break;
    await delay(10);
  }
  assert.ok(Date.now() < deadline, "contender must reach PostgreSQL");
  await delay(100);
  assert.ok(!contender.messages.some(value => value.state === "acquired"), "unrelated suite must wait");
}

test("parallel processes preserve catalog/config snapshots, release on exit and survive parent SIGKILL", {
  skip: !target ? testDbSkip : false, timeout: 600_000,
}, async () => {
  const pool = new pg.Pool({ connectionString: target, max: 1 });
  const table = `fixture_lease_probe_${randomUUID().replaceAll("-", "")}`;
  const workers: Worker[] = [];
  const start = (options?: Parameters<typeof worker>[0]) => {
    const value = worker(options); workers.push(value); return value;
  };
  try {
    // Dedicated regression table; never touch customer fixtures or read app DB.
    await pool.query(`CREATE TABLE public.${table} (kind text PRIMARY KEY, value text NOT NULL)`);
    await pool.query(`INSERT INTO public.${table} VALUES ('catalog','original'),('config','original')`);
    const a = start({ snapshot: true, label: "suite-a", table });
    const { group } = await a.state("acquired");
    const b = start({ snapshot: true, label: "suite-b", table });
    await waiting(pool, b);
    await a.finish();
    await b.state("acquired");
    await b.finish();
    assert.deepEqual((await pool.query(`SELECT DISTINCT value FROM public.${table}`)).rows,
      [{ value: "original" }], "both suites must restore the original snapshot");

    // A stale inherited capability fails closed instead of silently starting
    // another group and exposing the test URL to application imports.
    const stale = start({ group });
    const rejected = await stale.state("rejected");
    assert.equal(rejected.blocked, true);
    assert.equal(rejected.pooledAbsent, true);
    assert.deepEqual(await stale.exit, [1, null]);

    const parent = start();
    const parentGroup = (await parent.state("acquired")).group;
    const outsider = start();
    await waiting(pool, outsider);
    // Admission must not be held by the waiting outsider: two children still
    // join immediately, just like bootstrap-superadmin-db-concurrent.
    const children = [start({ group: parentGroup }), start({ group: parentGroup })];
    await Promise.all(children.map(child => child.state("acquired")));
    await kill(parent.child, parent.exit);
    assert.ok(!outsider.messages.some(message => message.state === "acquired"));
    await children[0].finish();
    assert.ok(!outsider.messages.some(message => message.state === "acquired"));
    await kill(children[1].child, children[1].exit);
    await outsider.state("acquired");
    await outsider.finish();
    const disconnected = start();
    await disconnected.state("acquired");
    await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = $1`,
    [`integration-test-fixture-lease:${disconnected.child.pid}`]);
    assert.deepEqual(await disconnected.exit, [1, null], "lost lease must stop the worker, not allow uncoordinated writes");
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = ANY($1::text[])`,
    [workers.map(value => `integration-test-fixture-lease:${value.child.pid}`)]);
    assert.equal(rows[0].n, 0, "all lease sessions must close");
  } finally {
    await Promise.all(workers.map(value => kill(value.child, value.exit)));
    try { await pool.query(`DROP TABLE IF EXISTS public.${table}`); }
    finally { await pool.end(); }
  }
});
