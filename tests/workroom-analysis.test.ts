import assert from "node:assert/strict";
import test from "node:test";
import { boundedWorkroomModel, executeWorkroomAnalysis, parseWorkroomAnalysis } from "../server/lib/workroom-analysis";
import { analysisResponse } from "./workroom-analysis-fixture";
import { analysisLedger } from "../server/lib/workroom-execution-ledger";
import { estimateWorkroomAnalysis, minimumWorkroomReservation, readWorkroomBudget, workroomBudgetDay } from "../server/lib/workroom-analysis-budget";

test("analysis accepts only complete bounded structured output, never raw fallback", () => {
  assert.equal(parseWorkroomAnalysis(analysisResponse()).win_probability.skor, 55);
  const malformed = analysisResponse();
  malformed.choices[0].message.content = "not JSON";
  const wrongScore = analysisResponse();
  const content = JSON.parse(wrongScore.choices[0].message.content);
  content.win_probability.skor = 101;
  wrongScore.choices[0].message.content = JSON.stringify(content);
  const truncated = analysisResponse();
  truncated.choices[0].finish_reason = "length";
  const extra = analysisResponse();
  extra.choices[0].message.content = JSON.stringify({ ...content, unsafe_action: "execute" });
  const oversized = analysisResponse();
  oversized.choices[0].message.content = "x".repeat(24_001);
  for (const response of [null, {}, malformed, wrongScore, truncated, extra, oversized,
    { choices: [{ finish_reason: "stop", message: { ...analysisResponse().choices[0].message, refusal: "No" } }] },
    { choices: [{ finish_reason: "stop", message: { ...analysisResponse().choices[0].message, tool_calls: [{}] } }] }]) {
    assert.throws(() => parseWorkroomAnalysis(response), { statusCode: 502 });
  }
});

test("model deadline aborts a non-cooperative provider and rejects its late result", async () => {
  let resolve!: (value: string) => void;
  let signal!: AbortSignal;
  let calls = 0;
  const work = boundedWorkroomModel(child => {
    calls++; signal = child;
    return new Promise<string>(done => { resolve = done; });
  }, new AbortController().signal, 5);
  await assert.rejects(work, { statusCode: 504 });
  assert.equal(signal.aborted, true);
  resolve("late");
  assert.equal(calls, 1);
});

test("cancellation propagates and an already cancelled request never calls the provider", async () => {
  const parent = new AbortController();
  let child!: AbortSignal;
  const work = boundedWorkroomModel(signal => { child = signal; return new Promise(() => {}); }, parent.signal);
  parent.abort();
  await assert.rejects(work, { statusCode: 499 });
  assert.equal(child.aborted, true);
  await assert.rejects(boundedWorkroomModel(async () => assert.fail("must not run"), parent.signal), { statusCode: 499 });
});

test("unavailable sources never reach the provider or writer", async () => {
  await assert.rejects(executeWorkroomAnalysis({
    storage: {
      getWorkroomReviewSnapshot: async () => ({
        id: 1, userId: "owner", status: "active", context: {}, title: "Fixture", domain: "tender",
        reviewRevision: 0, reviewFingerprint: "a".repeat(64),
        sources: [{ fileId: "source", availability: "verification_failed", revision: "failed" }],
      } as any),
      createWorkroomLog: async () => assert.fail("must not write"),
      claimWorkroomAnalysis: async () => assert.fail("must not claim"),
      settleWorkroomAnalysis: async () => assert.fail("must not settle"),
    },
    id: 1, ownerId: "owner", executionId: "00000000-0000-4000-8000-000000000001",
    expected: { expectedReviewRevision: 0, expectedReviewFingerprint: "a".repeat(64) },
    signal: new AbortController().signal, domainConfig: () => assert.fail("must not prepare prompt"),
    contextLabels: {}, generate: async () => assert.fail("must not call provider"),
  }), { statusCode: 409 });
});

test("malformed durable execution records fail closed instead of silently allowing a new call", () => {
  assert.throws(() => analysisLedger([{ id: 1, type: "_workroom_ai_execution", meta: { status: "running" } }]),
    { statusCode: 503 });
});

test("budget reset uses midnight WIB rather than UTC or the process timezone", () => {
  assert.equal(workroomBudgetDay(new Date("2026-10-28T16:59:59.999Z")), "2026-10-28");
  assert.equal(workroomBudgetDay(new Date("2026-10-28T17:00:00.000Z")), "2026-10-29");
  assert.equal(workroomBudgetDay(new Date("2026-12-31T17:00:00.000Z")), "2027-01-01");
  assert.throws(() => workroomBudgetDay(new Date("invalid")), { statusCode: 503 });
});

test("reservation uses UTF-8 bytes, framing and maximum output, not a character/token guess", () => {
  assert.equal(minimumWorkroomReservation(), 17_560);
  assert.equal(estimateWorkroomAnalysis([{ content: "a" }, { content: "b" }]), 17_565);
  assert.equal(estimateWorkroomAnalysis([{ content: "漢" }, { content: "" }]), 17_568);
  assert.throws(() => estimateWorkroomAnalysis([{ content: "x".repeat(16001) }, { content: "" }]), { statusCode: 503 });
});

test("missing daily bucket is fresh but malformed, inconsistent or unreadable counters fail closed", async () => {
  const read = async (value?: string) => {
    let call = 0;
    return readWorkroomBudget(async () => ({ rows: ++call === 1 ?
      [{ budget_now: new Date("2026-10-28T17:00:00Z") }] : value === undefined ? [] : [{ value }] }), "fixture");
  };
  const fresh = await read();
  assert.equal(fresh.callsUsed, 0);
  assert.equal(fresh.nextResetAt, "2026-10-29T17:00:00.000Z");
  assert.equal(fresh.available, true);
  await assert.rejects(read("bad JSON"), { statusCode: 503 });
  await assert.rejects(read(JSON.stringify({ schemaVersion: 1, day: "2026-10-29", calls: 1, reservedMicroUsd: 10, accounts: {} })), { statusCode: 503 });
  await assert.rejects(readWorkroomBudget(async () => { throw new Error("private"); }, "fixture"), { statusCode: 503 });
});
