import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createLegacyMemoryRecovery, ensureLegacyMemoryRecoverySchema, RecoveryConflict, type TrustedCreationArchive } from "../server/lib/legacy-memory-recovery";
import { createTrustedCreationArchive } from "../server/lib/trusted-creation-archive";
import { ARCHIVE_REFERENCE_PATTERN } from "../shared/legacy-memory-evidence";
import {
  CreationArchiveAccessDenied,
  createCreationArchiveTelemetry,
  type CreationArchiveFailureCounts,
} from "../server/lib/creation-archive-telemetry";

// An isolated SQL double deliberately has no DATABASE_URL or shared DB access.
function fixture(
  failAuditWrite = false,
  archive?: TrustedCreationArchive,
  telemetry = createCreationArchiveTelemetry(() => {}),
) {
  const memory = { id: 3, agent_id: 7, user_id: null as string | null };
  const reviews: Array<{ id: number; memory_id: number; proposed_user_id: string; submitted_by: string; evidence_ref: string; evidence_sha256: string; evidence_format_version: number; decision: string; reviewed_by?: string; rationale?: string }> = [];
  const queries: string[] = [];
  let snapshot: { owner: string | null; reviews: typeof reviews } | null = null;
  const query = async (sql: string, args: any[] = []): Promise<any> => {
    queries.push(sql);
    if (sql === "BEGIN") snapshot = { owner: memory.user_id, reviews: structuredClone(reviews) };
    else if (sql === "ROLLBACK" && snapshot) {
      memory.user_id = snapshot.owner;
      reviews.splice(0, reviews.length, ...snapshot.reviews);
    } else if (sql.includes("FROM user_memories WHERE id = $1 AND user_id IS NULL FOR UPDATE")) {
      return { rows: memory.user_id === null && args[0] === memory.id ? [{ id: memory.id, agent_id: memory.agent_id }] : [] };
    } else if (sql.includes("FROM users WHERE id = $1")) {
      return { rows: args[0] === "verified-owner" ? [{ id: args[0] }] : [] };
    } else if (sql.includes("FROM legacy_memory_reviews WHERE memory_id = $1 AND decision IN")) {
      return { rows: reviews.filter((r) => r.memory_id === args[0] && ["pending", "approved"].includes(r.decision)) };
    } else if (sql.includes("INSERT INTO legacy_memory_reviews")) {
      const id = reviews.length + 1;
      reviews.push({ id, memory_id: args[0], proposed_user_id: args[1], evidence_ref: args[2], evidence_sha256: args[3], submitted_by: args[4], evidence_format_version: 1, decision: "pending" });
      return { rows: [{ id }] };
    } else if (sql.includes("SELECT memory_id FROM legacy_memory_reviews WHERE id = $1")) {
      return { rows: reviews.filter((r) => r.id === args[0]).map((r) => ({ memory_id: r.memory_id })) };
    } else if (sql.includes("FROM legacy_memory_reviews WHERE id = $1 FOR UPDATE")) {
      return { rows: reviews.filter((r) => r.id === args[0]) };
    } else if (sql.includes("UPDATE user_memories SET user_id")) {
      if (memory.user_id !== null || memory.id !== args[1]) return { rows: [] };
      memory.user_id = args[0];
      return { rows: [{ id: memory.id }] };
    } else if (sql.includes("UPDATE legacy_memory_reviews")) {
      if (failAuditWrite) throw new Error("audit write failed");
      const review = reviews.find((r) => r.id === args[3]);
      if (review && review.decision === "pending") {
        Object.assign(review, { decision: args[0], reviewed_by: args[1], rationale: args[2] });
      }
    }
    return { rows: [] };
  };
  const recovery = createLegacyMemoryRecovery({
    connect: async () => ({ query, release() {} }),
    query,
   } as any, archive, telemetry);
  const input = {
    memoryId: 3, agentId: 7, proposedUserId: "verified-owner",
    evidenceRef: "archive:v1:65f43a20-d8b4-4a0c-9a25-ec1a1b71cc01",
    evidenceSha256: "a".repeat(64),
  };
  return { recovery, input, memory, reviews, queries };
}

const original = Buffer.from(JSON.stringify({
  type: "authenticated_memory_creation", memoryId: 3, agentId: 7,
  authenticatedUserId: "verified-owner",
}));
function withArchive(raw: Uint8Array | null = original) {
  const reads: string[] = [];
  const archive: TrustedCreationArchive = {
    async readOriginalRecord(ref) { reads.push(ref); return raw; },
  };
  const result = fixture(false, archive);
  result.input.evidenceSha256 = createHash("sha256").update(original).digest("hex");
  return { ...result, reads };
}

test("only independently approved rows receive an owner; same actor and duplicate are denied", async () => {
  const { recovery, input, memory, reviews, queries, reads } = withArchive();
  const id = await recovery.submit(input, "first-admin");
  assert.equal(id, 1);
  assert.equal(memory.user_id, null);
  await assert.rejects(recovery.submit(input, "first-admin"), RecoveryConflict);
  await assert.rejects(recovery.decide(id, "first-admin", true, "original_record_verified"), RecoveryConflict);
  assert.equal(memory.user_id, null);
   const result = await recovery.decide(id, "second-admin", true, "original_record_verified");
  assert.deepEqual(result, { memoryId: 3, decision: "approved" });
  assert.equal(memory.user_id, "verified-owner");
  assert.equal(reviews[0].reviewed_by, "second-admin");
  assert.deepEqual(reads, [input.evidenceRef]);
  assert.ok(queries.some((sql) => sql === "ROLLBACK"));
  await assert.rejects(recovery.decide(id, "third-admin", true, "original_record_verified"), RecoveryConflict);
});

test("mismatched agent, missing owner, and rejected evidence leave memory unowned", async () => {
  const { recovery, input, memory, reviews } = withArchive();
  await assert.rejects(recovery.submit({ ...input, agentId: 8 }, "first-admin"), RecoveryConflict);
  await assert.rejects(recovery.submit({ ...input, proposedUserId: "unknown" }, "first-admin"), RecoveryConflict);
  assert.equal(reviews.length, 0);
  const id = await recovery.submit(input, "first-admin");
  await recovery.decide(id, "second-admin", false, "record_incomplete");
  assert.equal(memory.user_id, null);
  assert.equal(reviews[0].decision, "rejected");
  assert.equal(await recovery.submit(input, "first-admin"), 2); // new evidence may be reviewed later
});

test("an audit failure rolls back ownership instead of exposing an unaudited memory", async () => {
  const archive: TrustedCreationArchive = { async readOriginalRecord() { return original; } };
  const { recovery, input, memory, reviews } = fixture(true, archive);
  input.evidenceSha256 = createHash("sha256").update(original).digest("hex");
  const id = await recovery.submit(input, "first-admin");
  await assert.rejects(
    recovery.decide(id, "second-admin", true, "original_record_verified"),
    /audit write failed/,
  );
  assert.equal(memory.user_id, null);
  assert.equal(reviews[0].decision, "pending");
});

test("without a configured trusted archive approval fails closed, but rejection is allowed", async () => {
  const { recovery, input, memory, reviews } = fixture();
  const id = await recovery.submit(input, "first-admin");
  await assert.rejects(recovery.decide(id, "second-admin", true, "original_record_verified"), RecoveryConflict);
  assert.equal(memory.user_id, null);
  assert.equal(reviews[0].decision, "pending");
  await recovery.decide(id, "second-admin", false, "record_unavailable");
  assert.equal(reviews[0].decision, "rejected");
});

test("missing, partial, changed, mismatched and inaccessible records never release ownership", async () => {
  const cases: Array<[string, Uint8Array | null | "throw", boolean]> = [
    ["missing", null, false],
    ["truncated", Buffer.from('{"type":"authenticated_memory_creation"'), true],
    ["session only", Buffer.from(JSON.stringify({ type: "authenticated_memory_creation", memoryId: 3, agentId: 7, sessionId: "verified-owner" })), true],
    ["wrong memory", Buffer.from(JSON.stringify({ type: "authenticated_memory_creation", memoryId: 4, agentId: 7, authenticatedUserId: "verified-owner" })), true],
    ["wrong agent", Buffer.from(JSON.stringify({ type: "authenticated_memory_creation", memoryId: 3, agentId: 8, authenticatedUserId: "verified-owner" })), true],
    ["wrong user", Buffer.from(JSON.stringify({ type: "authenticated_memory_creation", memoryId: 3, agentId: 7, authenticatedUserId: "stranger" })), true],
    ["wrong event", Buffer.from(JSON.stringify({ type: "chat_message", memoryId: 3, agentId: 7, authenticatedUserId: "verified-owner" })), true],
    ["outage", "throw", false],
  ];
  for (const [name, raw, useDigest] of cases) {
    const archive: TrustedCreationArchive = {
      async readOriginalRecord() { if (raw === "throw") throw new Error("archive offline"); return raw; },
    };
    const { recovery, input, memory, reviews } = fixture(false, archive);
    input.evidenceSha256 = createHash("sha256").update(useDigest ? raw as Uint8Array : original).digest("hex");
    const id = await recovery.submit(input, "first-admin");
    await assert.rejects(recovery.decide(id, "second-admin", true, "original_record_verified"), RecoveryConflict, name);
    assert.equal(memory.user_id, null, name);
    assert.equal(reviews[0].decision, "pending", name);
  }
});

test("digest is computed on original bytes and a changed record is denied", async () => {
  const { recovery, input, memory, reviews } = withArchive(Buffer.from(original.toString() + " "));
  const id = await recovery.submit(input, "first-admin");
  await assert.rejects(recovery.decide(id, "second-admin", true, "original_record_verified"), /does not match/);
  assert.equal(memory.user_id, null);
  assert.equal(reviews[0].decision, "pending");
});

test("server archive adapter resolves an opaque alias through a separate catalog and returns original bytes", async () => {
  const ref = "archive:v1:65f43a20-d8b4-4a0c-9a25-ec1a1b71cc01";
  const catalogReads: string[] = [];
  const byteReads: string[] = [];
  const locator = "custodian-internal-record";
  const archive = createTrustedCreationArchive({
    async lookupOriginal(alias) { catalogReads.push(alias); return alias === ref ? locator : null; },
  }, {
    async readOriginalBytes(key) { byteReads.push(key); return key === locator ? original : null; },
  });
  assert.deepEqual(await archive.readOriginalRecord(ref), original);
  assert.equal(await archive.readOriginalRecord("session-123"), null);
  assert.equal(await archive.readOriginalRecord(ref + "/../other"), null);
  assert.deepEqual(catalogReads, [ref]);
  assert.deepEqual(byteReads, [locator]);

  const { recovery, input, memory } = fixture(false, archive);
  input.evidenceSha256 = createHash("sha256").update(original).digest("hex");
  const id = await recovery.submit(input, "first-admin");
  await recovery.decide(id, "second-admin", true, "original_record_verified");
  assert.equal(memory.user_id, "verified-owner");
  assert.deepEqual(catalogReads, [ref, ref]);
  assert.deepEqual(byteReads, [locator, locator]);
});

test("adapter lookup/read failures, absent aliases and changed bytes keep approvals quarantined", async () => {
  for (const failure of ["catalog-denied", "reader-denied", "missing", "changed"] as const) {
    const catalogReads: string[] = [];
    const byteReads: string[] = [];
    const archive = createTrustedCreationArchive({
      async lookupOriginal(ref) {
        catalogReads.push(ref);
        if (failure === "catalog-denied") throw new Error("private catalog access denied");
        return failure === "missing" ? null : "fixed-original-locator";
      },
    }, {
      async readOriginalBytes(locator) {
        byteReads.push(locator);
        if (failure === "reader-denied") throw new Error("private archive access denied");
        return Buffer.from(original.toString() + " ");
      },
    });
    const { recovery, input, memory, reviews } = fixture(false, archive);
    input.evidenceSha256 = createHash("sha256").update(original).digest("hex");
    const id = await recovery.submit(input, "first-admin");
    await assert.rejects(
      recovery.decide(id, "second-admin", true, "original_record_verified"),
      (error: unknown) => error instanceof RecoveryConflict &&
        !/private|denied|locator/.test(error.message),
      failure,
    );
    assert.deepEqual(catalogReads, [input.evidenceRef], failure);
    assert.deepEqual(byteReads, failure === "catalog-denied" || failure === "missing" ? [] : ["fixed-original-locator"], failure);
    assert.equal(memory.user_id, null, failure);
    assert.equal(reviews[0].decision, "pending", failure);
  }
});

test("archive failures emit only aggregate counters, once per failed approval, even after rollback", async () => {
  const signals: CreationArchiveFailureCounts[] = [];
  const telemetry = createCreationArchiveTelemetry(counts => signals.push(counts));
  const privateMarker = "PRIVATE-evidence-locator-token-user-content";
  const failures = [
    ["catalog-missing", "lookup_missing"],
    ["reader-missing", "lookup_missing"],
    ["catalog-denied", "access_denied"],
    ["reader-denied", "access_denied"],
    ["catalog-offline", "service_unavailable"],
    ["reader-offline", "service_unavailable"],
    ["changed", "digest_changed"],
  ] as const;
  const totals = { lookup_missing: 0, access_denied: 0, service_unavailable: 0, digest_changed: 0 };
  for (const [failure, category] of failures) {
    const reads: string[] = [];
    const deny = () => {
      const error = new CreationArchiveAccessDenied();
      // Even a port accidentally attaching secrets must not leak them.
      error.message = privateMarker;
      error.cause = new Error(privateMarker);
      return error;
    };
    const archive = createTrustedCreationArchive({
      async lookupOriginal() {
        reads.push("catalog");
        if (failure === "catalog-denied") throw deny();
        if (failure === "catalog-offline") throw new Error(privateMarker);
        return failure === "catalog-missing" ? null : privateMarker;
      },
    }, {
      async readOriginalBytes() {
        reads.push("reader");
        if (failure === "reader-denied") throw deny();
        if (failure === "reader-offline") throw new Error(privateMarker);
        return failure === "reader-missing" ? null : Buffer.from(original.toString() + " ");
      },
    });
    const { recovery, input, memory, reviews, queries } = fixture(false, archive, telemetry);
    input.evidenceSha256 = createHash("sha256").update(original).digest("hex");
    const id = await recovery.submit(input, "first-admin");
    for (let retry = 0; retry < 2; retry++) {
      await assert.rejects(recovery.decide(id, "second-admin", true, "original_record_verified"),
        (error: unknown) => error instanceof RecoveryConflict &&
          !JSON.stringify({ message: error.message, stack: error.stack, cause: error.cause }).includes(privateMarker));
      totals[category]++;
      assert.deepEqual(telemetry.snapshot(), totals, failure);
      assert.deepEqual(signals.at(-1), totals, failure);
      assert.equal(signals.length, Object.values(totals).reduce((a, b) => a + b, 0));
      assert.equal(memory.user_id, null, failure);
      assert.equal(reviews[0].decision, "pending", failure);
      assert.equal(queries.at(-1), "ROLLBACK", failure);
      assert.ok(!queries.some(sql => sql.startsWith("UPDATE ")), failure);
    }
    assert.equal(reads.filter(step => step === "reader").length, failure.startsWith("catalog-") ? 0 : 2);
    const payload = JSON.stringify(signals);
    for (const secret of [privateMarker, input.evidenceRef, input.evidenceSha256, input.proposedUserId, original.toString()]) {
      assert.ok(!payload.includes(secret), failure);
    }
  }
  // Previously emitted snapshots cannot be mutated by later increments.
  assert.deepEqual(signals[0], { lookup_missing: 1, access_denied: 0, service_unavailable: 0, digest_changed: 0 });
  assert.ok(Object.isFrozen(signals[0]));
});

test("unconfigured archives, invalid submissions, rejections and verified approvals emit no failure signal", async () => {
  const signals: CreationArchiveFailureCounts[] = [];
  const telemetry = createCreationArchiveTelemetry(counts => signals.push(counts));
  const disabled = fixture(false, undefined, telemetry);
  const id = await disabled.recovery.submit(disabled.input, "first-admin");
  await assert.rejects(disabled.recovery.decide(id, "second-admin", true, "original_record_verified"), RecoveryConflict);
  await disabled.recovery.decide(id, "second-admin", false, "record_unavailable");
  const enabled = fixture(false, { async readOriginalRecord() { return original; } }, telemetry);
  await assert.rejects(enabled.recovery.submit({ ...enabled.input, evidenceRef: "private-invalid-input" }, "first-admin"), RecoveryConflict);
  enabled.input.evidenceSha256 = createHash("sha256").update(original).digest("hex");
  const validId = await enabled.recovery.submit(enabled.input, "first-admin");
  await enabled.recovery.decide(validId, "second-admin", true, "original_record_verified");
  assert.equal(enabled.memory.user_id, "verified-owner");
  assert.deepEqual(signals, []);
  assert.deepEqual(telemetry.snapshot(), { lookup_missing: 0, access_denied: 0, service_unavailable: 0, digest_changed: 0 });
});

test("default operator warning contains only the fixed aggregate payload", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const telemetry = createCreationArchiveTelemetry();
  telemetry.record("lookup_missing");
  telemetry.record("access_denied");
  telemetry.record("service_unavailable");
  telemetry.record("digest_changed");
  telemetry.record("private-untrusted-key" as any);
  assert.equal(warn.mock.callCount(), 4);
  assert.deepEqual(warn.mock.calls[3].arguments, [
    "[legacy-memory-recovery] archive_failure_totals",
    { lookup_missing: 1, access_denied: 1, service_unavailable: 1, digest_changed: 1 },
  ]);
});

test("a failed telemetry collector cannot open approval or leak its transport error", async () => {
  const telemetry = createCreationArchiveTelemetry(() => { throw new Error("private-collector-token"); });
  const archive = createTrustedCreationArchive({
    async lookupOriginal() { throw new CreationArchiveAccessDenied(); },
  }, { async readOriginalBytes() { throw new Error("must not read"); } });
  const { recovery, input, memory, reviews, queries } = fixture(false, archive, telemetry);
  const id = await recovery.submit(input, "first-admin");
  await assert.rejects(recovery.decide(id, "second-admin", true, "original_record_verified"),
    (error: unknown) => error instanceof RecoveryConflict && !error.message.includes("private"));
  assert.equal(telemetry.snapshot().access_denied, 1);
  assert.equal(memory.user_id, null);
  assert.equal(reviews[0].decision, "pending");
  assert.equal(queries.at(-1), "ROLLBACK");
});

test("review queue selects only metadata and current agent ID, never memory text or session ID", async () => {
  const sql: string[] = [];
  const recovery = createLegacyMemoryRecovery({
    connect: async () => { throw new Error("not used"); },
    query: async (statement: string) => {
      sql.push(statement);
      return { rows: [{ id: 1, memoryId: 3, agentId: 7, decision: "pending" }] };
    },
  } as any);
  assert.deepEqual(await recovery.listReviews(0), [{ id: 1, memoryId: 3, agentId: 7, decision: "pending", evidenceRef: null, requiresResubmission: true, rationale: null }]);
  assert.match(sql[0], /LEFT JOIN user_memories m ON m.id = r.memory_id/);
  assert.doesNotMatch(sql[0], /SELECT\s+\*|session_id|m\.content/i);
  assert.doesNotMatch(sql[0], /r\.rationale/);
  assert.match(sql[0], /CASE WHEN r.evidence_format_version = 1 THEN r.evidence_ref END/);
});

test("invalid references and free-text or contradictory reasons are rejected before any write", async () => {
  const { recovery, input, queries, memory, reviews } = withArchive();
  assert.equal(ARCHIVE_REFERENCE_PATTERN.test(input.evidenceRef), true);
  for (const ref of [
    "customer@example.test private text", "https://archive.test/record?token=secret",
    "session-123456", '{"content":"private memory"}',
    input.evidenceRef + "\n", input.evidenceRef + "\r\n", input.evidenceRef + "?user=someone",
    input.evidenceRef.toUpperCase(), "archive:v1:65f43a20-d8b4-1a0c-9a25-ec1a1b71cc01",
  ]) {
    assert.equal(ARCHIVE_REFERENCE_PATTERN.test(ref), false, ref);
    await assert.rejects(recovery.submit({ ...input, evidenceRef: ref }, "first-admin"), RecoveryConflict);
  }
  assert.deepEqual(queries, []);
  const id = await recovery.submit(input, "first-admin");
  for (const [approve, reason] of [[true, "record_mismatch"], [false, "original_record_verified"],
    [true, "private memory session ID"], [false, "customer@example.test"]] as const) {
    await assert.rejects(recovery.decide(id, "second-admin", approve, reason), RecoveryConflict);
  }
  assert.equal(reviews[0].decision, "pending");
  assert.equal(memory.user_id, null);
});

test("even syntactically valid legacy references cannot be approved; reject then resubmit", async () => {
  const { recovery, input, reviews, reads, memory } = withArchive();
  const id = await recovery.submit(input, "first-admin");
  reviews[0].evidence_format_version = 0;
  await assert.rejects(recovery.decide(id, "second-admin", true, "original_record_verified"), /resubmitted/);
  assert.deepEqual(reads, []);
  assert.equal(memory.user_id, null);
  await recovery.decide(id, "second-admin", false, "legacy_reference_requires_resubmission");
  assert.equal(await recovery.submit(input, "first-admin"), 2);
});

test("history redacts every legacy text including safe-looking references and malformed new rows", async () => {
  const ref = "archive:v1:65f43a20-d8b4-4a0c-9a25-ec1a1b71cc01";
  const recovery = createLegacyMemoryRecovery({
    connect: async () => { throw new Error("not used"); },
    query: async () => ({ rows: [
      { id: 1, decision: "approved", evidenceFormatVersion: 0, evidenceRef: ref, rationale: "private@example.test session-secret" },
      { id: 2, decision: "pending", evidenceFormatVersion: 1, evidenceRef: "private memory", rationale: null },
      { id: 3, decision: "approved", evidenceFormatVersion: 1, evidenceRef: ref, rationale: "original_record_verified" },
    ] }),
  } as any);
  const rows = await recovery.listReviews(0);
  assert.equal(rows[0].evidenceRef, null);
  assert.equal(rows[0].rationale, null);
  assert.equal(rows[1].evidenceRef, null);
  assert.equal(rows[2].evidenceRef, ref);
  assert.equal(rows[2].rationale, "original_record_verified");
  assert.doesNotMatch(JSON.stringify(rows), /private|session-secret/);
});

test("schema migration is additive and marks existing evidence untrusted, without rewriting history", async () => {
  const statements: string[] = [];
  await ensureLegacyMemoryRecoverySchema({
    query: async (sql: string) => { statements.push(sql); return { rows: [] }; },
  } as any);
  assert.match(statements.join("\n"), /evidence_format_version integer NOT NULL DEFAULT 0/);
  assert.match(statements.join("\n"), /ADD COLUMN IF NOT EXISTS reason_code/);
  assert.match(statements.join("\n"), /length\(evidence_ref\) = 47/);
  assert.doesNotMatch(statements.join("\n"), /\bDELETE\b|\bUPDATE\b|\bDROP\b/);
});