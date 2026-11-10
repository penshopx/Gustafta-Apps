import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { minimumWorkroomReservation } from "../server/lib/workroom-analysis-budget";
import type { Pool } from "pg";
import type { DatabaseStorage } from "../server/db-storage";
import { analysisResponse, type FixtureAnalysisProvider } from "./workroom-analysis-fixture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
export async function assertWorkroomAnalysis(
  storage: DatabaseStorage, pool: Pool, baseUrl: string, provider: FixtureAnalysisProvider,
) {
  const owner = "analysis-fixture-owner";
  const room = await storage.createWorkroom({ userId: owner, title: "Analysis fixture",
    stages: [{ key: "brief" }, { key: "review" }] });
  const snapshot = (id = room.id, user = owner) => storage.getWorkroomReviewSnapshot(id, user);
  const expectation = async (id = room.id, user = owner) => {
    const current = await snapshot(id, user); assert.ok(current);
    return { expectedReviewRevision: current.reviewRevision, expectedReviewFingerprint: current.reviewFingerprint };
  };
  const request = (body: any, user: string | null = owner, signal?: AbortSignal, key: string = randomUUID(), id = room.id) => fetch(
    `${baseUrl}/api/workrooms/${id}/analyze`, { method: "POST", signal,
      headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...(user ? { "x-fixture-owner": user } : {}) },
      body: JSON.stringify(body) },
  );
  const deliverables = async () => (await snapshot())!.logs.filter(log => log.type === "deliverable");
  const acknowledge = (executionId: string, user: string | null = owner, confirm = true) => fetch(
    `${baseUrl}/api/workrooms/${room.id}/analysis-executions/${executionId}/acknowledge`,
    { method: "POST", headers: { "Content-Type": "application/json", ...(user ? { "x-fixture-owner": user } : {}) },
      body: JSON.stringify({ acknowledgeUncertain: confirm }) },
  );
  async function acknowledgeUncertain() {
    const before = await storage.getWorkroomAnalysisBudget(owner);
    for (const execution of (await snapshot())!.analysisExecutions || []) {
      if (execution.status === "uncertain") assert.equal((await acknowledge(execution.id)).status, 200);
    }
    assert.deepEqual(await storage.getWorkroomAnalysisBudget(owner), before, "acknowledgment never refunds a reservation");
  }
  try {
    assert.equal((await request({}, null)).status, 401);
    assert.equal((await request({}, "foreign-owner")).status, 404);
    assert.equal((await request({})).status, 409);
    await storage.updateWorkroom(room.id, { status: "archived" });
    assert.equal((await request(await expectation())).status, 409);
    await storage.updateWorkroom(room.id, { status: "active", context: { brief: "x".repeat(16_000) } }, await expectation());
    assert.equal((await request(await expectation())).status, 400);
    await storage.updateWorkroom(room.id, { context: {} }, await expectation());
    await pool.query("INSERT INTO workroom_logs(workroom_id,type,content) VALUES($1,'_workroom_versions_deleting','fixture')", [room.id]);
    assert.equal((await request(await expectation())).status, 409);
    await pool.query("DELETE FROM workroom_logs WHERE workroom_id=$1 AND type='_workroom_versions_deleting'", [room.id]);
    assert.equal(provider.calls, 0, "preflight rejects before spending on any model call");
    assert.equal((await request(await expectation(), owner, undefined, "invalid-key")).status, 400);

    const before = await expectation();
    const successKey = randomUUID();
    const success = await request(before, owner, undefined, successKey);
    assert.equal(success.status, 201);
    const saved = await success.json() as any;
    assert.equal(saved.result.win_probability.skor, 55);
    assert.equal(saved.log.meta.workroomAnalysisExecution, true);
    assert.equal(saved.log.meta.execution.actorUserId, owner);
    assert.equal(saved.log.meta.execution.model, "gpt-4o");
    assert.equal(saved.log.meta.execution.reviewRevision, before.expectedReviewRevision);
    assert.equal((await request(before)).status, 409, "old input must not run the model again");
    assert.equal(provider.calls, 1);
    const replay = await request(before, owner, undefined, successKey);
    assert.equal(replay.status, 201);
    const replayed = await replay.json() as any;
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.log.id, saved.log.id);
    assert.equal(provider.calls, 1, "committed result is replayed, not regenerated");
    assert.equal((await request({ ...before, expectedReviewRevision: 999 }, owner, undefined, successKey)).status, 409);

    await pool.query(`CREATE FUNCTION fixture_reject_ai_result() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.type='deliverable' THEN RAISE EXCEPTION 'private-database-diagnostic'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER fixture_reject_ai_result BEFORE INSERT ON workroom_logs
      FOR EACH ROW EXECUTE FUNCTION fixture_reject_ai_result();`);
    try {
      const failedSave = await request(await expectation());
      assert.equal(failedSave.status, 502);
      assert.ok(!(await failedSave.text()).includes("private-database-diagnostic"));
      assert.equal((await deliverables()).length, 1);
    } finally {
      await pool.query("DROP TRIGGER fixture_reject_ai_result ON workroom_logs; DROP FUNCTION fixture_reject_ai_result()");
    }

    for (const failure of [
      async () => { throw new Error("private-provider-diagnostic"); },
      async () => ({ choices: [{ finish_reason: "stop", message: { content: "broken" } }] }),
    ]) {
      provider.next = failure;
      const beforeFailure = await storage.getWorkroomAnalysisBudget(owner);
      const response = await request(await expectation());
      assert.equal(response.status, 502);
      assert.ok(!(await response.text()).includes("private-provider-diagnostic"));
      assert.equal((await deliverables()).length, 1, "failed output must never become a deliverable");
      const afterFailure = await storage.getWorkroomAnalysisBudget(owner);
      assert.equal(afterFailure.callsUsed, beforeFailure.callsUsed + 1, "failed accepted attempts remain counted");
      assert.ok(afterFailure.reservedMicroUsd > beforeFailure.reservedMicroUsd, "failed/ambiguous calls are not automatically refunded");
      await acknowledgeUncertain();
    }

    let lateCase = 0;
    async function lateResult(change: (id: number, user: string) => Promise<unknown>, status: number) {
      // Independent scenarios need independent accounts; never disable/reset production quota in this fixture.
      const user = `${owner}-late-${++lateCase}`;
      const scenario = await storage.createWorkroom({ userId: user, title: "Late result fixture",
        stages: [{ key: "brief" }, { key: "review" }] });
      const started = deferred<void>(), release = deferred<any>();
      provider.next = async () => { started.resolve(); return release.promise; };
      const pending = request(await expectation(scenario.id, user), user, undefined, randomUUID(), scenario.id);
      try {
        await Promise.race([started.promise, pending.then(response => assert.fail(`provider was not reached: ${response.status}`))]);
        try { await change(scenario.id, user); } finally { release.resolve(analysisResponse()); }
        assert.equal((await pending).status, status);
        assert.equal((await snapshot(scenario.id, user))!.logs.filter(log => log.type === "deliverable").length, 0);
      } finally {
        release.resolve(analysisResponse());
        await pending;
        await storage.deleteWorkroom(scenario.id);
      }
    }
    await lateResult(async (id, user) => storage.updateWorkroom(id, { title: "Changed during analysis" }, await expectation(id, user)), 409);
    await lateResult(async (id, user) => storage.updateWorkroom(id, { currentStage: 1 }, await expectation(id, user)), 409);
    await lateResult(id => storage.updateWorkroom(id, { status: "archived" }), 409);
    await lateResult(async (id, user) => storage.updateWorkroom(id, { status: "done" }, await expectation(id, user)), 409);

    // Ownership can change without altering the content fingerprint: check it under the write lock.
    const started = deferred<void>(), release = deferred<any>();
    provider.next = async () => { started.resolve(); return release.promise; };
    const transferred = request(await expectation());
    await started.promise;
    await pool.query("UPDATE workrooms SET user_id='analysis-new-owner' WHERE id=$1", [room.id]);
    release.resolve(analysisResponse());
    assert.equal((await transferred).status, 404);
    await pool.query("UPDATE workrooms SET user_id=$1 WHERE id=$2", [owner, room.id]);
    assert.equal((await deliverables()).length, 1);

    const entered = deferred<void>(), aborted = deferred<void>(), late = deferred<any>();
    provider.next = async signal => {
      signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      entered.resolve(); return late.promise;
    };
    const controller = new AbortController();
    const disconnected = request(await expectation(), owner, controller.signal);
    await entered.promise;
    controller.abort();
    await assert.rejects(disconnected, { name: "AbortError" });
    await aborted.promise;
    late.resolve(analysisResponse());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await deliverables()).length, 1, "disconnected request cannot save late provider output");
    for (let i = 0; i < 100 && (await snapshot())!.analysisExecutions?.some(execution => execution.status === "running"); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok((await snapshot())!.analysisExecutions?.some(execution => execution.status === "uncertain"));
    await acknowledgeUncertain();

    const bothStarted = deferred<void>(), parallelRelease = deferred<any>();
    const beforeParallel = provider.calls;
    const budgetBeforeParallel = await storage.getWorkroomAnalysisBudget(owner);
    provider.next = async () => {
      bothStarted.resolve();
      return parallelRelease.promise;
    };
    const sameReview = await expectation();
    const parallelKey = randomUUID();
    const first = request(sameReview, owner, undefined, parallelKey);
    await bothStarted.promise;
    assert.equal((await request(sameReview, owner, undefined, parallelKey)).status, 409);
    const second = await request(sameReview);
    assert.equal(second.status, 409);
    assert.equal(provider.calls, beforeParallel + 1, "parent-locked reservation prevents duplicate provider calls");
    assert.equal((await storage.getWorkroomAnalysisBudget(owner)).callsUsed, budgetBeforeParallel.callsUsed + 1);
    assert.equal((await acknowledge(parallelKey)).status, 409, "cannot release a live claim early");
    parallelRelease.resolve(analysisResponse());
    assert.equal((await first).status, 201);
    assert.equal((await deliverables()).length, 2);

    // Durable reservation survives a fresh storage instance; expired work is never restarted.
    const orphanKey = randomUUID(), orphanReview = await expectation();
    const currentStage = (await snapshot())!.currentStage;
    await storage.claimWorkroomAnalysis(room.id, owner, orphanKey, currentStage, orphanReview, minimumWorkroomReservation());
    const freshStorage = new (storage.constructor as typeof DatabaseStorage)();
    assert.ok((await freshStorage.getWorkroomReviewSnapshot(room.id, owner))?.analysisExecutions?.some(e => e.id === orphanKey && e.status === "running"));
    await pool.query(`UPDATE workroom_logs SET meta=jsonb_set(meta,'{expiresAt}',$1::jsonb)
      WHERE workroom_id=$2 AND type='_workroom_ai_execution' AND meta->>'id'=$3`,
    [JSON.stringify(new Date(Date.now() - 1000).toISOString()), room.id, orphanKey]);
    const beforeRecovery = provider.calls;
    assert.equal((await request(orphanReview, owner, undefined, orphanKey)).status, 409);
    assert.equal((await request(orphanReview)).status, 409);
    assert.equal(provider.calls, beforeRecovery);
    assert.equal((await acknowledge(orphanKey, null)).status, 401);
    assert.equal((await acknowledge(orphanKey, "foreign-owner")).status, 404);
    assert.equal((await acknowledge(orphanKey, owner, false)).status, 400);
    assert.equal((await acknowledge(orphanKey)).status, 200);
    await assert.rejects(storage.createWorkroomLog({
      workroomId: room.id, type: "deliverable", content: "Late stale worker", meta: {},
    }, orphanReview, { actorUserId: owner, currentStage, signal: new AbortController().signal,
      execution: { id: orphanKey, startedAt: new Date().toISOString(), provider: "openai", model: "gpt-4o", policyVersion: "workroom-analysis-v1" } }),
    { statusCode: 409 });
    await storage.settleWorkroomAnalysis(room.id, owner, orphanKey, "failed");
    assert.equal((await snapshot())!.analysisExecutions!.find(e => e.id === orphanKey)!.status, "acknowledged",
      "old failure handler cannot overwrite manual acknowledgment");

    // Replay remains historical even after the input has changed; it does not replace current content.
    assert.equal((await request(before, owner, undefined, successKey)).status, 201);
    assert.equal(provider.calls, beforeRecovery);
    assert.ok((await snapshot())!.logs.every(log => !log.type.startsWith("_workroom_")));

    // Simulate losing the acknowledgment after the success transaction already committed.
    const lostResponseKey = randomUUID(), lostResponseReview = await expectation();
    const originalCreate = storage.createWorkroomLog;
    const callsBeforeLostResponse = provider.calls;
    storage.createWorkroomLog = async (...args: Parameters<DatabaseStorage["createWorkroomLog"]>) => {
      await originalCreate.apply(storage, args);
      throw new Error("private-commit-acknowledgment-lost");
    };
    try {
      assert.equal((await request(lostResponseReview, owner, undefined, lostResponseKey)).status, 502);
    } finally { storage.createWorkroomLog = originalCreate; }
    assert.equal((await snapshot())!.analysisExecutions!.find(e => e.id === lostResponseKey)!.status, "succeeded",
      "failure settlement must not overwrite a committed success");
    const recoveredResult = await request(lostResponseReview, owner, undefined, lostResponseKey);
    assert.equal(recoveredResult.status, 201);
    assert.equal((await recoveredResult.json() as any).replayed, true);
    assert.equal(provider.calls, callsBeforeLostResponse + 1, "lost acknowledgment never regenerates a paid result");
    assert.equal((await deliverables()).length, 3);

    const forged = await storage.createWorkroomLog({ workroomId: room.id, type: "note", content: "ordinary note",
      meta: { workroomAnalysisExecution: true, execution: { id: "forged" } } });
    assert.equal((forged.meta as any).workroomAnalysisExecution, undefined);
    assert.equal((forged.meta as any).execution, undefined);
  } finally {
    provider.next = undefined;
    await storage.deleteWorkroom(room.id);
  }
}
