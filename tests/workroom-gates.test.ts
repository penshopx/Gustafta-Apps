import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import ts from "typescript";
import {
  blockingWorkroomGates, prepareWorkroomPatch, validateWorkroomGateStage,
  WorkroomTransitionError,
} from "../shared/workroom-transitions";
import { getOwnedWorkroom } from "../server/lib/workroom-access";
import { requireWorkroomReview, workroomReviewToken } from "../server/lib/workroom-review";
import { prepareTestDatabase } from "./test-database";
import { workroomSourceIds } from "../server/lib/workroom-sources";
import { assertWorkroomSources } from "./workroom-sources.assertions";
import { FixtureVersionStore } from "./workroom-version-store";
import { assertWorkroomSourceVersions } from "./workroom-versions.assertions";
import { executeWorkroomAnalysis } from "../server/lib/workroom-analysis";
import { WORKROOM_ANALYSIS_POLICY } from "../shared/workroom-analysis-policy";
import { analysisResponse, type FixtureAnalysisProvider } from "./workroom-analysis-fixture";
import { assertWorkroomAnalysis } from "./workroom-analysis.assertions";
import { assertWorkroomBudget } from "./workroom-budget.assertions";

const stages = ["brief", "review", "submit"].map((key, i) => ({
  key, label: key, status: i === 0 ? "active" : "pending",
}));
const room = { stages, currentStage: 0, status: "active" };
const gate = { id: 1, stageKey: "review", status: "pending" };

test("pending, rejected and legacy gates protect entry, departure, skips and completion", () => {
  for (const status of ["pending", "rejected", "unknown"]) {
    for (const stageKey of ["", "brief", "review", "legacy-missing"]) {
      const gates = [{ ...gate, status, stageKey }];
      for (const data of [{ currentStage: 1 }, { currentStage: 2 }, { status: "done" }]) {
        assert.throws(() => prepareWorkroomPatch(room, gates, data), WorkroomTransitionError);
      }
    }
  }
  assert.equal(blockingWorkroomGates(stages, 1, [gate], 2).length, 1);
  assert.equal(blockingWorkroomGates(stages, 0, [{ ...gate, stageKey: "submit" }], 1).length, 0);
});

test("approved gates unlock progress; backwards, current-stage and archive remain available", () => {
  const approved = [{ ...gate, status: "approved" }];
  assert.equal(prepareWorkroomPatch(room, approved, { currentStage: 2 }).stages[0].status, "done");
  assert.equal(prepareWorkroomPatch(room, approved, { status: "done" }).status, "done");
  assert.equal(prepareWorkroomPatch({ ...room, currentStage: 1 }, [gate], { currentStage: 0 }).currentStage, 0);
  assert.equal(prepareWorkroomPatch(room, [gate], { currentStage: 0 }).currentStage, 0);
  assert.equal(prepareWorkroomPatch(room, [gate], { status: "archived" }).status, "archived");
  assert.equal(prepareWorkroomPatch({ ...room, status: "done", currentStage: 2 }, approved, { currentStage: 0 }).status, "active");
  assert.throws(() => prepareWorkroomPatch(room, [gate], { status: "archived", currentStage: 2 }));
});

test("invalid indices/status/stage keys are rejected and stale derived stages are discarded", () => {
  for (const currentStage of [-1, 3, 0.5, "1", null, NaN]) {
    assert.throws(() => prepareWorkroomPatch(room, [], { currentStage }), { statusCode: 400 });
  }
  assert.throws(() => prepareWorkroomPatch(room, [], { status: "completed" }), { statusCode: 400 });
  assert.throws(() => validateWorkroomGateStage(stages, "missing"), { statusCode: 400 });
  assert.throws(() => validateWorkroomGateStage(stages, 0), { statusCode: 400 });
  validateWorkroomGateStage(stages, "");
  validateWorkroomGateStage(stages, "review");
  const patch = prepareWorkroomPatch(room, [], { currentStage: 1, stages: [{ key: "stale" }] });
  assert.deepEqual(patch.stages.map((s: any) => s.key), ["brief", "review", "submit"]);
});

test("review tokens use stable content identity and integer material revisions, never timestamps", () => {
  const source = { userId: "owner", title: "Draft", domain: "tender", context: { a: 1, b: 2 }, stages };
  const first = workroomReviewToken(source, []);
  const reordered = workroomReviewToken({ ...source, context: { b: 2, a: 1 } }, [
    { id: 9, type: "note", content: "No material change", meta: {} },
  ]);
  assert.deepEqual(reordered, first);
  const changedBack = workroomReviewToken(source, [
    { id: 11, type: "change", content: "Changed then restored", meta: {} },
  ]);
  assert.equal(changedBack.reviewFingerprint, first.reviewFingerprint);
  assert.equal(changedBack.reviewRevision, 11);
  assert.throws(() => requireWorkroomReview(changedBack, {
    expectedReviewRevision: first.reviewRevision, expectedReviewFingerprint: first.reviewFingerprint,
  }), { statusCode: 409 });
  const alteredResult = workroomReviewToken(source, [
    { id: 12, type: "deliverable", content: "Report", meta: { result: "new" } },
  ]);
  assert.notEqual(alteredResult.reviewFingerprint, first.reviewFingerprint);
});

const ready = await prepareTestDatabase();
test("production HTTP routes and PostgreSQL serialize gate decisions, progress and audit", {
  skip: !ready && "Jalankan scripts/test-workroom-gates.sh untuk database disposable.",
}, async () => {
  const { pool } = await import("../server/db");
  const { DatabaseStorage } = await import("../server/db-storage");
  const versionStore = new FixtureVersionStore();
  const storage = new DatabaseStorage(versionStore);
  const ids: number[] = [];
  const app = express();
  const provider: FixtureAnalysisProvider = { calls: 0 };
  class FixtureOpenAI {
    constructor(options: any) {
      assert.equal(options.maxRetries, 0);
      assert.equal(options.timeout, WORKROOM_ANALYSIS_POLICY.timeoutMs);
    }
    chat = { completions: { create: async (request: any, options: any) => {
      provider.calls++;
      assert.equal(request.max_tokens, WORKROOM_ANALYSIS_POLICY.maxOutputTokens);
      assert.equal(request.model, WORKROOM_ANALYSIS_POLICY.model);
      assert.ok(!request.tools, "no tool execution capability");
      return provider.next ? provider.next(options.signal) : analysisResponse();
    } } };
  }
  app.use(express.json());
  // Synthetic identity exists only in this isolated fixture, not production code.
  app.use((req: any, _res, next) => {
    req.user = req.get("x-fixture-owner") ? { id: req.get("x-fixture-owner"), role: "user" } : undefined;
    next();
  });
  const source = ts.createSourceFile("routes.ts", readFileSync("server/routes.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const paths = new Set([
    "get /api/workrooms/:id", "patch /api/workrooms/:id", "post /api/workrooms/:id/log", "post /api/workrooms/:id/gate",
    "post /api/workrooms/:id/gate/:gateId/decide",
    "get /api/workrooms/:id/source-options", "post /api/workrooms/:id/sources",
    "get /api/workrooms/:id/source-versions", "post /api/workrooms/:id/source-versions",
    "get /api/workrooms/:id/source-versions/:versionId/files/:fileId", "delete /api/workrooms/:id",
    "post /api/workrooms/:id/analyze",
    "post /api/workrooms/:id/analysis-executions/:executionId/acknowledge",
    "get /api/workrooms/:id/analysis-budget",
    "get /api/admin/workroom-analysis-budget",
  ]);
  const selected: string[] = [];
  let adminMiddleware = "";
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "requireAdmin") adminMiddleware = node.getText(source);
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (ts.isPropertyAccessExpression(call.expression) &&
          call.expression.expression.getText(source) === "app" &&
          call.arguments[0] && ts.isStringLiteral(call.arguments[0]) &&
          paths.has(`${call.expression.name.text} ${call.arguments[0].text}`)) selected.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(selected.length, 15, "fixture must execute the actual production routes");
  assert.ok(adminMiddleware, "execute actual effective-admin middleware, not a replacement profile-role gate");
  const compiled = ts.transpileModule(adminMiddleware + "\n" + selected.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  new Function("app", "isAuthenticated", "getOwnedWorkroom", "storage", "WorkroomTransitionError", "workroomSourceIds",
    "executeWorkroomAnalysis", "workroomDomainCfg", "WORKROOM_CTX_LABELS", "OpenAI", "WORKROOM_ANALYSIS_POLICY",
    "checkIsAdmin", "getClientIp", compiled)(
    app, (req: any, res: any, next: any) => req.user ? next() : res.sendStatus(401),
    (req: any) => getOwnedWorkroom(req, id => storage.getWorkroom(id)), storage, WorkroomTransitionError, workroomSourceIds,
    executeWorkroomAnalysis, () => ({ label: "Fixture", systemPrompt: "Fixture instructions", analyzeContent: "Fixture analysis" }),
    {}, FixtureOpenAI, WORKROOM_ANALYSIS_POLICY,
    async (req: any) => req.user?.id === "effective-admin-fixture", () => "fixture",
  );
  const server = createServer(app);
  try {
    // Only the guard-proven disposable DB is reachable at this point.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        key text PRIMARY KEY, value text NOT NULL, updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS workrooms (
        id serial PRIMARY KEY, user_id varchar(255) NOT NULL, title text NOT NULL,
        domain text NOT NULL DEFAULT 'tender', status text NOT NULL DEFAULT 'active',
        current_stage integer NOT NULL DEFAULT 0, stages jsonb NOT NULL DEFAULT '[]',
        context jsonb NOT NULL DEFAULT '{}', created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS workroom_gates (
        id serial PRIMARY KEY, workroom_id integer NOT NULL, stage_key text NOT NULL DEFAULT '',
        question text NOT NULL, status text NOT NULL DEFAULT 'pending', note text NOT NULL DEFAULT '',
        created_at timestamp NOT NULL DEFAULT now(), decided_at timestamp);
      CREATE TABLE IF NOT EXISTS workroom_logs (
        id serial PRIMARY KEY, workroom_id integer NOT NULL, type text NOT NULL DEFAULT 'note',
        content text NOT NULL, meta jsonb NOT NULL DEFAULT '{}', created_at timestamp NOT NULL DEFAULT now());`);
    const created = await storage.createWorkroom({ userId: "fixture-owner", title: "Fixture review", stages });
    ids.push(created.id);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    async function expectation() {
      const snapshot = await storage.getWorkroomReviewSnapshot(created.id, "fixture-owner");
      assert.ok(snapshot);
      return { expectedReviewRevision: snapshot.reviewRevision, expectedReviewFingerprint: snapshot.reviewFingerprint };
    }
    async function request(path: string, body: any, method = "POST", owner: string | null = "fixture-owner", withReview = true) {
      const review = withReview && (path.endsWith("/decide") || path === "/log" ||
        path === "/sources" || method === "PATCH") ? await expectation() : {};
      return fetch(`http://127.0.0.1:${(address as any).port}/api/workrooms/${created.id}${path}`, {
        method, headers: { "Content-Type": "application/json", ...(owner ? { "x-fixture-owner": owner } : {}) },
        ...(method === "GET" ? {} : { body: JSON.stringify({ ...review, ...body }) }),
      });
    }
    assert.equal((await request("", { currentStage: 1 }, "PATCH", null)).status, 401);
    assert.equal((await request("/gate", { question: "Approve?", stageKey: "brief" }, "POST", "other-owner")).status, 404);
    assert.equal((await request("/gate", { question: "Approve?", stageKey: "missing" })).status, 400);
    const create = await request("/gate", { question: "Approve?", stageKey: "brief" });
    assert.equal(create.status, 201);
    const humanGate = await create.json() as { id: number };
    const before = await storage.getWorkroom(created.id);
    for (const body of [{ currentStage: "1" }, { currentStage: -1 }, { status: null }, { status: "completed" }]) {
      assert.equal((await request("", body, "PATCH")).status, 400);
    }
    for (const body of [{ currentStage: 2 }, { status: "done" }]) {
      assert.equal((await request("", body, "PATCH")).status, 409);
    }
    assert.deepEqual(await storage.getWorkroom(created.id), before, "rejection must not mutate progress");
    assert.equal((await request(`/gate/${humanGate.id}/decide`, { status: "approved" }, "POST", "other-owner")).status, 404);
    assert.equal((await request(`/gate/${humanGate.id}/decide`, { status: "approved" })).status, 200);
    assert.equal((await request("", { currentStage: 1 }, "PATCH")).status, 200);
    assert.equal((await request("", { status: "done" }, "PATCH")).status, 200);
    assert.equal((await request(`/gate/${humanGate.id}/decide`, { status: "pending" })).status, 200);
    assert.equal((await storage.getWorkroom(created.id))?.status, "active");
    assert.equal((await request("", { currentStage: 2 }, "PATCH")).status, 409);
    assert.equal((await request(`/gate/${humanGate.id}/decide`, { status: "rejected" })).status, 200);
    assert.equal((await request("", { status: "done" }, "PATCH")).status, 409);

    // A log insert failure must roll back the approval, not merely its audit.
    await pool.query(`CREATE OR REPLACE FUNCTION fixture_reject_gate_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected audit failure'; END $$;
      CREATE TRIGGER fixture_reject_gate_audit BEFORE INSERT ON workroom_logs
      FOR EACH ROW EXECUTE FUNCTION fixture_reject_gate_audit();`);
    await assert.rejects(storage.decideWorkroomGate(humanGate.id, "approved", "", "fixture-owner", await expectation()));
    assert.equal((await storage.getWorkroomGates(created.id))[0].status, "rejected");
    await pool.query("DROP TRIGGER fixture_reject_gate_audit ON workroom_logs; DROP FUNCTION fixture_reject_gate_audit()");
    const logs = await storage.getWorkroomLogs(created.id);
    assert.equal(logs.length, 3);
    assert.ok(logs.every(log => (log.meta as any).actorUserId === "fixture-owner"));

    // Prove real PostgreSQL contention, not a timing-only Promise.all assertion.
    const captured = await expectation();
    const lock = await pool.connect();
    try {
      await lock.query("BEGIN");
      const holder = await lock.query("SELECT pg_backend_pid() AS pid");
      await lock.query("SELECT id FROM workrooms WHERE id=$1 FOR UPDATE", [created.id]);
      const approval = storage.decideWorkroomGate(humanGate.id, "approved", "", "fixture-owner", captured);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const check = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))", [holder.rows[0].pid]);
        if (check.rowCount) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      // Always release the owned lock before assertions/cleanup.
      await lock.query("COMMIT");
      await approval;
      assert.ok(waiting, "gate decision must contend on the parent Workroom lock");
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
    assert.equal((await request("", { currentStage: 2 }, "PATCH")).status, 200);
    assert.equal((await request("", { status: "done" }, "PATCH")).status, 200);
    assert.equal((await request("/gate", { question: "Review tambahan?", stageKey: "submit" })).status, 201);
    assert.equal((await storage.getWorkroom(created.id))?.status, "active");
    assert.equal((await request("", { status: "done" }, "PATCH")).status, 409);

    // Bind actual HTTP decisions to the snapshot the human read, not fresh
    // values silently supplied by the server at decision time.
    const initial = await (await request("", {}, "GET")).json() as any;
    assert.equal(initial.reviewRevision, 0);
    assert.equal((await request("", {}, "GET", "other-owner")).status, 404);
    assert.equal((await request(`/gate/${humanGate.id}/decide`, { status: "approved" }, "POST", "fixture-owner", false)).status, 409);
    const allGates = await storage.getWorkroomGates(created.id);
    for (const g of allGates) assert.equal((await request(`/gate/${g.id}/decide`, { status: "approved" })).status, 200);
    const bound = await expectation();
    assert.equal((await request("", { status: "done" }, "PATCH")).status, 200);
    assert.equal((await request("/log", { type: "note", content: "Ordinary note" })).status, 201);
    assert.deepEqual(await expectation(), bound, "ordinary notes must not revoke consent");
    assert.equal((await request("", {
      title: "Changed while advancing", currentStage: 2, status: "done",
    }, "PATCH")).status, 409);
    assert.equal((await storage.getWorkroom(created.id))?.title, "Fixture review");
    assert.equal((await request("", { context: { notes: "new", details: { a: 1, b: 2 } } }, "PATCH")).status, 200);
    const changed = await storage.getWorkroomReviewSnapshot(created.id, "fixture-owner");
    assert.ok(changed && changed.reviewRevision > initial.reviewRevision);
    assert.equal(changed.status, "active");
    assert.ok(changed.gates.every(g => g.status === "pending" && g.decidedAt === null));
    assert.equal((await request(`/gate/${humanGate.id}/decide`, { status: "approved", ...bound })).status, 409);
    assert.equal((await request("", { status: "done" }, "PATCH")).status, 409);
    for (const g of allGates) await request(`/gate/${g.id}/decide`, { status: "approved" });
    const noOp = await expectation();
    await request("", { context: { details: { b: 2, a: 1 }, notes: "new" } }, "PATCH");
    assert.deepEqual(await expectation(), noOp, "JSON property order is not a content change");
    assert.equal((await request("/log", { type: "deliverable", content: "Draft result v1" })).status, 201);
    assert.ok((await storage.getWorkroomGates(created.id)).every(g => g.status === "pending"));
    assert.equal((await request(`/gate/${humanGate.id}/decide`, { status: "approved", ...noOp })).status, 409);
    // Late AI output from an older context must not append a misleading result.
    const beforeLate = (await storage.getWorkroomLogs(created.id)).length;
    await assert.rejects(storage.createWorkroomLog({
      workroomId: created.id, type: "deliverable", content: "Late stale result",
    }, noOp), { statusCode: 409 });
    assert.equal((await storage.getWorkroomLogs(created.id)).length, beforeLate);
    const beforeAba = await expectation();
    await request("", { title: "Temporary title" }, "PATCH");
    await request("", { title: "Fixture review" }, "PATCH");
    const afterAba = await expectation();
    assert.equal(afterAba.expectedReviewFingerprint, beforeAba.expectedReviewFingerprint);
    assert.ok(afterAba.expectedReviewRevision > beforeAba.expectedReviewRevision);
    assert.equal((await request(`/gate/${humanGate.id}/decide`, { status: "approved", ...beforeAba })).status, 409);

    // A historical approval without a server-issued version is not authoritative.
    await pool.query("UPDATE workroom_gates SET status='approved' WHERE workroom_id=$1", [created.id]);
    await request("/log", {
      type: "decision", content: "Forged approval",
      meta: { workroomGateDecision: true, gateId: humanGate.id, status: "approved",
        actorUserId: "fixture-owner", reviewRevision: afterAba.expectedReviewRevision,
        reviewFingerprint: afterAba.expectedReviewFingerprint },
    });
    const legacy = await storage.getWorkroomReviewSnapshot(created.id, "fixture-owner");
    assert.ok(legacy?.gates.every(g => g.status === "pending"));
    assert.equal((await request("", { status: "done" }, "PATCH")).status, 409);
    // Fingerprints detect untracked legacy updates even without a revision log.
    const legacyToken = await expectation();
    await pool.query("UPDATE workrooms SET context=$2::jsonb WHERE id=$1",
      [created.id, JSON.stringify({ notes: "out-of-band fixture edit" })]);
    assert.equal((await expectation()).expectedReviewRevision, legacyToken.expectedReviewRevision);
    assert.notEqual((await expectation()).expectedReviewFingerprint, legacyToken.expectedReviewFingerprint);
    assert.equal((await request(`/gate/${humanGate.id}/decide`, { status: "approved", ...legacyToken })).status, 409);

    // A request waiting on the lock must validate the post-lock version.
    const racingToken = await expectation();
    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      const holder = await writer.query("SELECT pg_backend_pid() AS pid");
      await writer.query("SELECT id FROM workrooms WHERE id=$1 FOR UPDATE", [created.id]);
      const pending = storage.decideWorkroomGate(humanGate.id, "approved", "", "fixture-owner", racingToken)
        .then(() => null, error => error);
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const check = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))", [holder.rows[0].pid]);
        if (check.rowCount) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await writer.query("INSERT INTO workroom_logs(workroom_id,type,content) VALUES($1,'change','Concurrent fixture change')", [created.id]);
      await writer.query("COMMIT");
      const error = await pending;
      assert.ok(blocked, "approval must wait for the concurrent material writer");
      assert.ok(error instanceof WorkroomTransitionError && error.statusCode === 409);
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
    await assertWorkroomSources(storage, pool, created.id, request);
    await assertWorkroomAnalysis(storage, pool, `http://127.0.0.1:${(address as any).port}`, provider);
    await assertWorkroomBudget(storage, pool, `http://127.0.0.1:${(address as any).port}`, provider);
    await assertWorkroomSourceVersions(storage, pool, versionStore, created.id, request);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    // The temporary cluster stays alive until this owned-row cleanup has ended.
    try {
      await pool.query("DROP TRIGGER IF EXISTS fixture_reject_gate_audit ON workroom_logs");
      await pool.query("DROP FUNCTION IF EXISTS fixture_reject_gate_audit()");
      for (const id of ids) await storage.deleteWorkroom(id);
    } finally { await pool.end(); }
  }
});
