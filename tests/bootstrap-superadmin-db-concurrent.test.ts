import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

// Concurrency regression for tests/bootstrap-superadmin-db.test.ts (Task #203).
//
// Spawns TWO real child processes running the bootstrap DB test at the same
// time and proves the global advisory run-lock serializes them safely:
//   • both processes exit 0 (neither restores/prunes the other's live rows
//     or recovery record mid-run),
//   • afterwards the DB is invariant: the pre-existing superadmin set is
//     intact, no recovery records remain, no test users linger.
//
// Skipped automatically when TEST_DATABASE_URL is absent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

if (!testDatabaseReady) {
  console.log(
    "[bootstrap-superadmin-db-concurrent] TEST_DATABASE_URL not set — skipping"
  );
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_FILE = resolve(__dirname, "bootstrap-superadmin-db.test.ts");

function runChild(label: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const env = { ...process.env };
    // A fresh test runner must not inherit its parent's worker context: Node
    // otherwise skips all requested files and exits 0 without testing anything.
    delete env.NODE_TEST_CONTEXT;
    // Direct child ownership: no npx wrapper/environment dependency and a
    // timeout kills the actual worker (which holds its own inherited lease).
    const child = spawn(process.execPath, ["--import", "tsx", "--test", TEST_FILE], {
      cwd: resolve(__dirname, ".."),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const killer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    child.on("error", () => {
      clearTimeout(killer);
      rejectPromise(new Error(`Could not start bootstrap worker ${label}`));
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      resolvePromise({ code, out });
    });
  });
}

test("two concurrent bootstrap DB test processes both pass and leave the DB invariant", async () => {
  const { db } = await import("../server/db");
  const { users: usersTable } = await import("../shared/models/auth");
  const { systemConfig } = await import("../shared/schema");
  const { eq, like } = await import("drizzle-orm");

  // Snapshot the superadmin set before.
  const supersBefore = (
    await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "superadmin"))
  )
    .map((r: any) => String(r.id))
    .sort();

  // Launch both children at once — the advisory run-lock must serialize them.
  const [a, b] = await Promise.all([runChild("A"), runChild("B")]);

  assert.equal(
    a.code,
    0,
    `child A must pass; output tail:\n${a.out.slice(-2000)}`
  );
  assert.equal(
    b.code,
    0,
    `child B must pass; output tail:\n${b.out.slice(-2000)}`
  );
  for (const [label, child] of [["A", a], ["B", b]] as const) {
    assert.match(child.out, /first handler instance promotes test user/,
      `child ${label} must actually execute DB tests, not exit 0 with an empty recursive run`);
    assert.match(child.out, /self-heal sweep restores it/,
      `child ${label} must execute the recovery regression too`);
  }

  // DB invariants after both complete.
  const supersAfter = (
    await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "superadmin"))
  )
    .map((r: any) => String(r.id))
    .sort();
  assert.deepEqual(
    supersAfter,
    supersBefore,
    "superadmin set must be identical after both concurrent runs"
  );

  const records = await db
    .select({ key: systemConfig.key })
    .from(systemConfig)
    .where(like(systemConfig.key, "bootstrap-db-test:recovery%"));
  assert.equal(records.length, 0, "no recovery records may remain");

  const orphans = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(like(usersTable.email, "bootstrap%@example-test.invalid"));
  assert.equal(
    orphans.length,
    0,
    `no test users may linger, found: ${orphans.map((o: any) => o.email).join(", ")}`
  );
});
