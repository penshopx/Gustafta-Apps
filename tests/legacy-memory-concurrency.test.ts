import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import pg from "pg";

// Do not import the application pool, migrations, boot seeds, or live archive.
const { createLegacyMemoryRecovery, ensureLegacyMemoryRecoverySchema, RecoveryConflict } =
  await import("../server/lib/legacy-memory-recovery");

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(15);
  }
  assert.fail(`Timed out: ${description}`);
}

for (const [winnerApproves, loserApproves] of [[true, true], [true, false], [false, true]] as const) {
  test(`PostgreSQL: ${winnerApproves ? "approve" : "reject"} wins against concurrent ${loserApproves ? "approve" : "reject"}`, {
    skip: testDatabaseReady ? false : testDbSkip,
    timeout: 25000,
  }, async () => {
    const schema = `legacy_race_${randomUUID().replaceAll("-", "")}`;
    const options = {
      connectionString: process.env.TEST_DATABASE_URL!,
      connectionTimeoutMillis: 3000,
      statement_timeout: 8000,
      idle_in_transaction_session_timeout: 12000,
    };
    const observer = new pg.Pool({ ...options, max: 1 });
    // Independent backend connections, not a transaction shared by both calls.
    const winnerPool = new pg.Pool({ ...options, max: 1, options: `-c search_path=${schema}` });
    const loserPool = new pg.Pool({ ...options, max: 1, options: `-c search_path=${schema}` });
    const releaseWinner = gate();
    let winnerHasMemoryLock = false;
    const pids = { winner: 0, loser: 0 };
    const transactions = { winner: [] as string[], loser: [] as string[] };
    const archiveReads: string[] = [];
    let decisions: Promise<PromiseSettledResult<unknown>[]> | undefined;
    let schemaCreated = false;

    // Only scheduling/observation is instrumented. EVERY query (including
    // BEGIN/COMMIT/ROLLBACK and both FOR UPDATEs) executes on real PostgreSQL.
    function scheduledPool(pool: pg.Pool, side: "winner" | "loser") {
      return {
        query: pool.query.bind(pool),
        async connect() {
          const client = await pool.connect();
          const result = await client.query("SELECT pg_backend_pid() AS pid");
          pids[side] = result.rows[0].pid;
          const query = (async (sql: string, values?: unknown[]) => {
            const result = await client.query(sql, values);
            transactions[side].push(sql);
            // Pause the winner only AFTER its actual memory-row lock is held.
            // Match the SELECT independently of FOR UPDATE: removing that lock
            // must fail the blocking assertion, not accidentally bypass a gate.
            if (side === "winner" && sql.startsWith("SELECT id, agent_id FROM user_memories")) {
              winnerHasMemoryLock = true;
              await releaseWinner.promise;
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
      };
    }

    try {
      await observer.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await winnerPool.query(`
        CREATE TABLE users (id varchar(255) PRIMARY KEY);
        CREATE TABLE user_memories (
          id integer PRIMARY KEY, agent_id integer NOT NULL,
          user_id varchar(255) REFERENCES users(id)
        );
        INSERT INTO users VALUES ('synthetic-owner');
        INSERT INTO user_memories VALUES (3, 7, NULL);
      `);
      // Use the real recovery schema and constraints, not a review-table double.
      await ensureLegacyMemoryRecoverySchema(winnerPool);
      await winnerPool.query(`
        CREATE TABLE race_writes (
          kind text NOT NULL, old_value text, new_value text, reviewer text, reason text
        );
        CREATE FUNCTION record_race_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_TABLE_NAME = 'user_memories' THEN
            INSERT INTO race_writes VALUES ('owner', OLD.user_id, NEW.user_id, NULL, NULL);
          ELSE
            INSERT INTO race_writes VALUES ('decision', OLD.decision, NEW.decision, NEW.reviewed_by, NEW.reason_code);
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER owner_write AFTER UPDATE OF user_id ON user_memories
          FOR EACH ROW EXECUTE FUNCTION record_race_write();
        CREATE TRIGGER decision_write AFTER UPDATE ON legacy_memory_reviews
          FOR EACH ROW EXECUTE FUNCTION record_race_write();
      `);

      // Immutable bytes manufactured exclusively for this disposable fixture.
      // This archive says nothing about the availability of a production source.
      const evidenceRef = `archive:v1:${randomUUID()}`;
      const original = Buffer.from(JSON.stringify({
        type: "authenticated_memory_creation",
        memoryId: 3, agentId: 7, authenticatedUserId: "synthetic-owner",
      }));
      const archive = {
        async readOriginalRecord(ref: string) {
          archiveReads.push(ref);
          return ref === evidenceRef ? Uint8Array.from(original) : null;
        },
      };
      const submitter = createLegacyMemoryRecovery(winnerPool, archive);
      const reviewId = await submitter.submit({
        memoryId: 3, agentId: 7, proposedUserId: "synthetic-owner", evidenceRef,
        evidenceSha256: createHash("sha256").update(original).digest("hex"),
      }, "synthetic-submitter");
      const winner = createLegacyMemoryRecovery(scheduledPool(winnerPool, "winner"), archive);
      const loser = createLegacyMemoryRecovery(scheduledPool(loserPool, "loser"), archive);
      const reason = (approve: boolean) => approve ? "original_record_verified" : "record_mismatch";
      const first = winner.decide(reviewId, "synthetic-reviewer-a", winnerApproves, reason(winnerApproves));
      // Attach rejection handlers immediately, including on setup/assertion failure.
      decisions = Promise.allSettled([first]);
      await waitFor(async () => winnerHasMemoryLock, "first reviewer holds the memory row");
      const second = loser.decide(reviewId, "synthetic-reviewer-b", loserApproves, reason(loserApproves));
      decisions = Promise.allSettled([first, second]);
      await waitFor(async () => pids.loser !== 0, "second reviewer connected");
      assert.notEqual(pids.winner, pids.loser);

      // Prove genuine overlap/row-lock contention, not Promise.all over two
      // operations that happened to finish sequentially. Inspect server state
      // from a third connection while both decisions remain in flight.
      await waitFor(async () => {
        const result = await observer.query(`
          SELECT wait_event_type, pg_blocking_pids(pid) AS blockers, query
          FROM pg_stat_activity WHERE pid = $1
        `, [pids.loser]);
        const activity = result.rows[0];
        return activity?.wait_event_type === "Lock"
          && activity.blockers.includes(pids.winner)
          && activity.query.includes("FROM user_memories");
      }, "second reviewer is blocked by the first reviewer's PostgreSQL row lock");
      assert.deepEqual(archiveReads, [], "neither decision has reached archive verification yet");
      releaseWinner.resolve();

      const [won, lost] = await decisions;
      const terminal = winnerApproves ? "approved" : "rejected";
      assert.equal(won.status, "fulfilled");
      if (won.status === "fulfilled") assert.deepEqual(won.value, { memoryId: 3, decision: terminal });
      assert.equal(lost.status, "rejected");
      if (lost.status === "rejected") {
        assert.ok(lost.reason instanceof RecoveryConflict);
        assert.match(lost.reason.message, /no longer pending|already owned/);
      }
      assert.equal(transactions.winner.filter(sql => sql === "COMMIT").length, 1);
      assert.equal(transactions.loser.filter(sql => sql === "ROLLBACK").length, 1);
      assert.equal(transactions.loser.includes("COMMIT"), false);
      assert.deepEqual(archiveReads, winnerApproves ? [evidenceRef] : []);

      const audit = await winnerPool.query("SELECT * FROM legacy_memory_reviews");
      assert.equal(audit.rowCount, 1, "exactly one review/audit record");
      assert.equal(audit.rows[0].id, reviewId);
      assert.equal(audit.rows[0].decision, terminal);
      assert.equal(audit.rows[0].reviewed_by, "synthetic-reviewer-a");
      assert.equal(audit.rows[0].submitted_by, "synthetic-submitter");
      assert.equal(audit.rows[0].reason_code, reason(winnerApproves));
      assert.ok(audit.rows[0].reviewed_at instanceof Date);
      const memory = await winnerPool.query("SELECT * FROM user_memories");
      assert.deepEqual(memory.rows, [{ id: 3, agent_id: 7, user_id: winnerApproves ? "synthetic-owner" : null }]);
      const writes = await winnerPool.query("SELECT * FROM race_writes");
      assert.deepEqual(writes.rows.filter(row => row.kind === "decision"), [{
        kind: "decision", old_value: "pending", new_value: terminal,
        reviewer: "synthetic-reviewer-a", reason: reason(winnerApproves),
      }], "one terminal transition; losing reviewer cannot overwrite audit");
      assert.deepEqual(writes.rows.filter(row => row.kind === "owner"), winnerApproves ? [{
        kind: "owner", old_value: null, new_value: "synthetic-owner", reviewer: null, reason: null,
      }] : [], "ownership is written once on approval, never on rejection");
    } finally {
      releaseWinner.resolve();
      await decisions;
      await Promise.all([winnerPool.end(), loserPool.end()]);
      try {
        if (schemaCreated) await observer.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await observer.end();
      }
    }
  });
}
