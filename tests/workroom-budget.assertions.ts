import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { DatabaseStorage } from "../server/db-storage";
import { minimumWorkroomReservation, workroomBudgetKey } from "../server/lib/workroom-analysis-budget";
import { WORKROOM_BUDGET_POLICY as policy } from "../shared/workroom-budget-policy";
import type { FixtureAnalysisProvider } from "./workroom-analysis-fixture";
import { workroomRejectionKey } from "../server/lib/workroom-budget-monitor";

export async function assertWorkroomBudget(storage: DatabaseStorage, pool: Pool, baseUrl: string, provider: FixtureAnalysisProvider) {
  const ids: number[] = [];
  const owner = "budget-fixture-owner";
  const day = (await storage.getWorkroomAnalysisBudget(owner)).day;
  const key = workroomBudgetKey(day);
  const original = (await pool.query("SELECT value FROM system_config WHERE key=$1", [key])).rows[0]?.value;
  const rejectionKey = workroomRejectionKey(day);
  const originalRejections = (await pool.query("SELECT value FROM system_config WHERE key=$1", [rejectionKey])).rows[0]?.value;
  const monitor = (user: string | null = "effective-admin-fixture") => fetch(`${baseUrl}/api/admin/workroom-analysis-budget`,
    { headers: user ? { "x-fixture-owner": user } : {} });
  const beforeMonitoring = await storage.getWorkroomBudgetMonitor();
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const create = async (userId: string) => {
    const room = await storage.createWorkroom({ userId, title: "Budget fixture", stages: [{ key: "brief" }] });
    ids.push(room.id); return room;
  };
  const review = async (id: number, user: string) => {
    const snapshot = await storage.getWorkroomReviewSnapshot(id, user); assert.ok(snapshot);
    return { expectedReviewRevision: snapshot.reviewRevision, expectedReviewFingerprint: snapshot.reviewFingerprint };
  };
  const getBudget = (id: number, user: string | null = owner) => fetch(`${baseUrl}/api/workrooms/${id}/analysis-budget`,
    { headers: user ? { "x-fixture-owner": user } : {} });
  const request = async (id: number, user = owner, token?: any, executionId: string = randomUUID()) => fetch(
    `${baseUrl}/api/workrooms/${id}/analyze`, { method: "POST",
      headers: { "Content-Type": "application/json", "x-fixture-owner": user, "Idempotency-Key": executionId },
      body: JSON.stringify(token || await review(id, user)) });
  const readBucket = async () => JSON.parse((await pool.query("SELECT value FROM system_config WHERE key=$1", [key])).rows[0].value);
  const saveBucket = async (bucket: any) => pool.query("UPDATE system_config SET value=$1 WHERE key=$2", [JSON.stringify(bucket), key]);
  const previousProvider = provider.next;
  try {
    provider.next = undefined;
    assert.equal((await monitor(null)).status, 401);
    assert.equal((await monitor(owner)).status, 403, "ordinary authenticated owners cannot view global totals");
    const initialMonitoring = await monitor();
    assert.equal(initialMonitoring.status, 200, "effective admin with stored role=user is allowed");
    assert.match(initialMonitoring.headers.get("cache-control")!, /no-store/);
    assert.deepEqual(await initialMonitoring.json(), beforeMonitoring);
    const room = await create(owner);
    assert.equal((await getBudget(room.id, null)).status, 401);
    assert.equal((await getBudget(room.id, "foreign-fixture-owner")).status, 404);
    const initial = await getBudget(room.id);
    assert.equal(initial.status, 200);
    assert.match(initial.headers.get("cache-control")!, /no-store/);
    const dto = await initial.json() as any;
    assert.equal(dto.callsUsed, 0);
    assert.equal(dto.callsLimit, 10);
    assert.equal(dto.accountLimitMicroUsd, 1_000_000);
    assert.equal(dto.globalLimitMicroUsd, 10_000_000);
    assert.equal(dto.accounts, undefined, "never expose other accounts' counters/identities");
    const firstToken = await review(room.id, owner), firstKey = randomUUID();
    const callBase = provider.calls;
    for (let i = 0; i < 10; i++) {
      assert.equal((await request(room.id, owner, i === 0 ? firstToken : undefined, i === 0 ? firstKey : randomUUID())).status, 201);
    }
    assert.equal(provider.calls, callBase + 10);
    const full = await storage.getWorkroomAnalysisBudget(owner);
    assert.equal(full.callsUsed, 10);
    assert.equal(full.reason, "account_calls");
    assert.equal(full.available, false);
    assert.equal((await request(room.id)).status, 429);
    assert.equal((await request(room.id, owner, firstToken, firstKey)).status, 201, "successful replay remains available at the quota");
    assert.equal(provider.calls, callBase + 10, "neither quota rejection nor replay spends another call");
    assert.deepEqual(await storage.getWorkroomAnalysisBudget(owner), full);
    const cost = (await storage.getWorkroomReviewSnapshot(room.id, owner))!.analysisExecutions![0].budget!.estimatedMicroUsd;
    assert.equal(await storage.deleteWorkroom(room.id), true);
    const replacement = await create(owner);
    assert.deepEqual(await new (storage.constructor as typeof DatabaseStorage)().getWorkroomAnalysisBudget(owner), full);
    assert.equal((await request(replacement.id)).status, 429, "new Workroom does not reset account-wide quota");

    const moneyOwner = "budget-money-fixture", moneyRoom = await create(moneyOwner);
    const bucket = await readBucket();
    const reserved = policy.accountMicroUsd - minimumWorkroomReservation() + 1;
    bucket.accounts[hash(moneyOwner)] = { calls: 8, reservedMicroUsd: reserved };
    bucket.calls += 8; bucket.reservedMicroUsd += reserved;
    await saveBucket(bucket);
    assert.equal((await storage.getWorkroomAnalysisBudget(moneyOwner)).reason, "account_estimate");
    assert.equal((await request(moneyRoom.id, moneyOwner)).status, 429, "money budget stops before the call-count cap");
    assert.equal(provider.calls, callBase + 10);

    // Real global-lock contention: two different accounts compete for exactly one remaining reservation.
    const aOwner = "budget-race-a", bOwner = "budget-race-b";
    const a = await create(aOwner), b = await create(bOwner);
    // Same prompt/title/domain as the ten accepted requests, so this is their actual reservation size.
    const nearFull = { schemaVersion: 1, day, calls: 0, reservedMicroUsd: policy.globalMicroUsd - cost,
      accounts: {} as Record<string, { calls: number; reservedMicroUsd: number }> };
    let remaining = nearFull.reservedMicroUsd;
    for (let index = 0; remaining > 0; index++) {
      const amount = Math.min(policy.accountMicroUsd, remaining);
      nearFull.accounts[hash(`held-fixture-${index}`)] = { calls: 10, reservedMicroUsd: amount };
      nearFull.calls += 10; remaining -= amount;
    }
    await saveBucket(nearFull);
    const holder = await pool.connect();
    let contenders: Promise<Response>[] = [];
    const beforeRace = provider.calls;
    try {
      await holder.query("BEGIN");
      const pid = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await holder.query("SELECT pg_advisory_xact_lock(hashtext('gustafta:workroom-analysis-budget'), 1)");
      contenders = [request(a.id, aOwner), request(b.id, bOwner)];
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const waiting = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))", [pid]);
        if (waiting.rows[0].n >= 2) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(blocked, "both independent parents must wait on the actual shared budget lock");
      assert.equal(provider.calls, beforeRace, "no model call before reservation commits");
    } finally { await holder.query("COMMIT"); holder.release(); }
    const results = await Promise.all(contenders);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 429]);
    assert.equal(provider.calls, beforeRace + 1);
    assert.equal((await readBucket()).reservedMicroUsd, policy.globalMicroUsd);
    assert.equal((await storage.getWorkroomAnalysisBudget(aOwner)).reason, "platform_estimate");
    const tableBeforeRead = await pool.query("SELECT key,value,updated_at FROM system_config ORDER BY key");
    const adminResponse = await monitor();
    assert.equal(adminResponse.status, 200);
    const aggregate = await adminResponse.json() as any;
    assert.equal(aggregate.day, day);
    assert.equal(aggregate.reservedMicroUsd, policy.globalMicroUsd);
    assert.equal(aggregate.remainingMicroUsd, 0);
    assert.equal(aggregate.callsReserved, (await readBucket()).calls);
    assert.equal(aggregate.activeAccounts, Object.keys((await readBucket()).accounts).length);
    assert.equal(aggregate.rejections.accountCalls, beforeMonitoring.rejections.accountCalls + 2);
    assert.equal(aggregate.rejections.accountEstimate, beforeMonitoring.rejections.accountEstimate + 1);
    assert.equal(aggregate.rejections.platformEstimate, beforeMonitoring.rejections.platformEstimate + 1);
    assert.equal(aggregate.rejections.total, beforeMonitoring.rejections.total + 4);
    assert.ok(aggregate.rejections.firstRecordedAt && aggregate.rejections.lastRecordedAt);
    assert.ok(!JSON.stringify(aggregate).includes(owner) && !JSON.stringify(aggregate).includes(hash(owner)));
    assert.equal(aggregate.accounts, undefined, "aggregate endpoint does not expose account-level records");
    assert.deepEqual(await new (storage.constructor as typeof DatabaseStorage)().getWorkroomBudgetMonitor(), aggregate,
      "monitoring and rejected-request counters survive a fresh storage instance");
    assert.deepEqual((await pool.query("SELECT key,value,updated_at FROM system_config ORDER BY key")).rows, tableBeforeRead.rows,
      "monitor GET must not write counters, change policy or acknowledge executions");
    assert.equal(provider.calls, beforeRace + 1, "reading or refreshing monitoring never calls a model");

    // Independent denied requests update telemetry after rollback without losing concurrent increments.
    const previousDenials = aggregate.rejections.total;
    const denied = await Promise.all([request(a.id, aOwner), request(b.id, bOwner)]);
    assert.ok(denied.every(response => response.status === 429));
    assert.equal((await storage.getWorkroomBudgetMonitor()).rejections.total, previousDenials + 2);
    assert.equal(provider.calls, beforeRace + 1);

    const validRejections = (await pool.query("SELECT value FROM system_config WHERE key=$1", [rejectionKey])).rows[0].value;
    await pool.query("UPDATE system_config SET value=$1 WHERE key=$2", ["private-rejection-diagnostic", rejectionKey]);
    const unreadable = await monitor();
    assert.equal(unreadable.status, 503);
    assert.ok(!(await unreadable.text()).includes("private-rejection-diagnostic"));
    assert.equal((await request(a.id, aOwner)).status, 503, "denial telemetry write failure is explicit, never a silent zero");
    assert.equal(provider.calls, beforeRace + 1);
    await pool.query("UPDATE system_config SET value=$1 WHERE key=$2", [validRejections, rejectionKey]);

    // Invalid counters fail closed for model calls, not for reading existing Workroom data.
    await pool.query("UPDATE system_config SET value=$1 WHERE key=$2", ["private-quota-diagnostic", key]);
    const broken = await getBudget(a.id, aOwner);
    assert.equal(broken.status, 503);
    assert.ok(!(await broken.text()).includes("private-quota-diagnostic"));
    assert.equal((await request(a.id, aOwner)).status, 503);
    assert.equal((await monitor()).status, 503, "corrupt budget data must not render as a fresh zero-day");
    assert.equal(provider.calls, beforeRace + 1);
    assert.equal((await fetch(`${baseUrl}/api/workrooms/${a.id}`, { headers: { "x-fixture-owner": aOwner } })).status, 200);
    await saveBucket({ schemaVersion: 1, day, calls: 0, reservedMicroUsd: 0, accounts: {} });

    // Counter updates and execution intent must roll back together if the intent insert fails.
    await pool.query(`CREATE FUNCTION fixture_reject_budget_intent() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.type='_workroom_ai_execution' THEN RAISE EXCEPTION 'private-intent-diagnostic'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER fixture_reject_budget_intent BEFORE INSERT ON workroom_logs
      FOR EACH ROW EXECUTE FUNCTION fixture_reject_budget_intent();`);
    try {
      const before = await readBucket();
      assert.equal((await request(b.id, bOwner)).status, 502);
      assert.deepEqual(await readBucket(), before, "intent failure cannot consume a separate committed reservation");
      assert.equal(provider.calls, beforeRace + 1);
    } finally {
      await pool.query("DROP TRIGGER fixture_reject_budget_intent ON workroom_logs; DROP FUNCTION fixture_reject_budget_intent()");
    }
    await pool.query(`CREATE FUNCTION fixture_reject_budget_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'private-budget-write-diagnostic'; END $$;
      CREATE TRIGGER fixture_reject_budget_write BEFORE INSERT OR UPDATE ON system_config
      FOR EACH ROW EXECUTE FUNCTION fixture_reject_budget_write();`);
    try {
      const before = await readBucket();
      const response = await request(b.id, bOwner);
      assert.equal(response.status, 503);
      assert.ok(!(await response.text()).includes("private-budget-write-diagnostic"));
      assert.deepEqual(await readBucket(), before);
      assert.equal(provider.calls, beforeRace + 1, "storage-write failure must never fall through to the model");
    } finally {
      await pool.query("DROP TRIGGER fixture_reject_budget_write ON system_config; DROP FUNCTION fixture_reject_budget_write()");
    }
  } finally {
    provider.next = previousProvider;
    if (original === undefined) await pool.query("DELETE FROM system_config WHERE key=$1", [key]);
    else await pool.query("UPDATE system_config SET value=$1 WHERE key=$2", [original, key]);
    if (originalRejections === undefined) await pool.query("DELETE FROM system_config WHERE key=$1", [rejectionKey]);
    else await pool.query("UPDATE system_config SET value=$1 WHERE key=$2", [originalRejections, rejectionKey]);
    await pool.query("DELETE FROM workroom_logs WHERE workroom_id=ANY($1::int[])", [ids]);
    await pool.query("DELETE FROM workroom_gates WHERE workroom_id=ANY($1::int[])", [ids]);
    await pool.query("DELETE FROM workrooms WHERE id=ANY($1::int[])", [ids]);
  }
}
