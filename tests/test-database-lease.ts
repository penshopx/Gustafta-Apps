/**
 * Cross-process fixture lease. Unrelated suites serialize; deliberately forked
 * workers inherit a group and join it. Every member holds its own shared lock,
 * so killing the parent cannot admit another suite while its children work.
 *
 * The short admission gate is NEVER held while waiting for a running group.
 * Otherwise an unrelated waiter could deadlock a parent's joining child.
 */
import pg from "pg";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const namespace = 132_001;
const gate = 1;
const occupancy = 2;
const environmentKey = "TEST_DATABASE_LEASE_GROUP";
const waitMillis = 600_000;

export async function acquireTestDatabaseLease(url: string, blockDatabase: () => void) {
  const client = new pg.Client({
    connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 5000,
    application_name: `integration-test-fixture-lease:${process.pid}`,
  });
  let closing = false;
  let active = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await client.end();
  };
  const lost = () => {
    blockDatabase();
    if (active && !closing) {
      // Do not continue with DB modules that already captured the test URL.
      console.error("Database uji ditolak: koneksi lease fixture terputus");
      process.exit(1);
    }
  };
  client.on("error", lost);
  client.on("end", lost);
  const inherited = process.env[environmentKey];
  const token = inherited ?? randomBytes(8).readBigInt64BE().toString();
  try {
    if (!/^-?\d{1,20}$/.test(token) || BigInt(token) < -(1n << 63n) || BigInt(token) >= (1n << 63n)) {
      throw new Error("invalid group");
    }
    await client.connect();
    const deadline = Date.now() + waitMillis;
    while (true) {
      const admission = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [namespace, gate]);
      if (admission.rows[0].acquired) {
        try {
          if (inherited) {
            // Group locks use the bigint key space (objsubid=1), whereas the
            // gate and occupancy use the disjoint two-int space (objsubid=2).
            const owner = await client.query(`
              SELECT 1 FROM pg_locks g JOIN pg_locks r ON r.pid = g.pid AND r.database = g.database
              WHERE g.locktype = 'advisory' AND g.granted AND g.mode = 'ShareLock'
                AND g.database = (SELECT oid FROM pg_database WHERE datname = current_database())
                AND g.classid::bigint = (($1::bigint >> 32) & 4294967295)
                AND g.objid::bigint = ($1::bigint & 4294967295) AND g.objsubid = 1
                AND r.locktype = 'advisory' AND r.granted AND r.mode = 'ShareLock'
                AND r.classid::bigint = $2 AND r.objid::bigint = $3 AND r.objsubid = 2
              LIMIT 1`, [token, namespace, occupancy]);
            if (owner.rowCount !== 1) throw new Error("expired group");
            await client.query("SELECT pg_advisory_lock_shared($1, $2)", [namespace, occupancy]);
            await client.query("SELECT pg_advisory_lock_shared($1::bigint)", [token]);
            break;
          }
          const available = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [namespace, occupancy]);
          if (available.rows[0].acquired) {
            await client.query("SELECT pg_advisory_lock_shared($1, $2)", [namespace, occupancy]);
            await client.query("SELECT pg_advisory_lock_shared($1::bigint)", [token]);
            await client.query("SELECT pg_advisory_unlock($1, $2)", [namespace, occupancy]);
            break;
          }
        } finally {
          await client.query("SELECT pg_advisory_unlock($1, $2)", [namespace, gate]);
        }
      }
      if (Date.now() >= deadline) throw new Error("lease timeout");
      await delay(25);
    }
    process.env[environmentKey] = token;
    active = true;
    // Keep the lease through ALL fixture after hooks and DB pool shutdowns,
    // without keeping an otherwise finished test process alive.
    process.once("beforeExit", () => { void close().catch(lost); });
    const stream = (client as unknown as { connection: { stream: { unref(): void } } }).connection.stream;
    stream.unref();
  } catch {
    blockDatabase();
    await close().catch(() => {});
    throw new Error("Database uji ditolak: koordinasi fixture gagal");
  }
}
