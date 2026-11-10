import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { startRecoveryBrowserFixture } from "./fixtures/legacy-memory-browser/server";

test("production keeps recovery without an archive until a custodian has verified a historical source", () => {
  // The HTTP fixture injects a synthetic recovery service and cannot prove
  // production composition. Inspect the actual call without booting customer DB.
  // Replace this guard only alongside a source integration backed by the
  // restricted operational sign-off described in legacy-memory-recovery.md.
  const source = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === "createLegacyMemoryRecovery") calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(calls.length, 1, "all production recovery instances must be accounted for");
  assert.equal(calls[0].arguments.length, 1, "no archive may be connected without verified provenance");
  assert.equal(calls[0].arguments[0].getText(ast), "pool");
});

test("production recovery routes deny every non-superadmin before touching the isolated store", async () => {
  const instance = await startRecoveryBrowserFixture(0, false);
  try {
    for (const actor of [null, "ordinary-user", "ordinary-admin"]) {
      for (const [method, route, body] of [
        ["GET", "", undefined],
        ["POST", "/reviews", instance.fixture.evidence(3)],
        ["POST", "/reviews/1/decision", {
          approve: true, rationale: "original_record_verified",
          attestation: "I independently verified the trusted original record",
        }],
      ] as const) {
        const response = await fetch(`${instance.url}/api/admin/legacy-memories${route}`, {
          method,
          headers: { "Content-Type": "application/json", ...(actor ? { Cookie: `fixture-actor=${actor}` } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        assert.equal(response.status, actor ? 403 : 401, `${actor} ${method} ${route}`);
        const payload = await response.json();
        assert.equal("unowned" in payload, false);
        assert.equal("reviews" in payload, false);
      }
    }
    assert.equal(instance.fixture.reviews.length, 102);
    assert.ok(instance.fixture.memories.every(m => m.user_id === null));
    assert.deepEqual(instance.fixture.archiveReads, []);
    const allowed = await fetch(`${instance.url}/api/admin/legacy-memories`, {
      headers: { Cookie: "fixture-actor=admin-b" },
    });
    assert.equal(allowed.status, 200);
    const payload = await allowed.json();
    assert.equal(payload.unowned.length, 100);
    assert.equal(payload.reviews.length, 100);
    assert.doesNotMatch(JSON.stringify(payload), /sessionId|session_id|"content"/);
    assert.ok(payload.reviews.every((r: any) => r.evidenceRef === null && r.rationale === null && r.requiresResubmission));
  } finally {
    await instance.close();
  }
});

test("production HTTP schemas reject pasted personal data and old reviews remain redacted and fail closed", async () => {
  const instance = await startRecoveryBrowserFixture(0, false);
  const base = `${instance.url}/api/admin/legacy-memories`;
  const headers = { "Content-Type": "application/json", Cookie: "fixture-actor=admin-b" };
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  try {
    const secret = "private-person@example.test session-secret original memory text";
    instance.fixture.reviews[0].evidence_ref = secret;
    instance.fixture.reviews[0].rationale = secret;
    instance.fixture.reviews[0].memory_id = 3;
    instance.fixture.reviews[0].decision = "pending";
    const list = await fetch(base, { headers });
    const text = await list.text();
    assert.equal(list.status, 200);
    assert.doesNotMatch(text, /private-person|session-secret|original memory text/);
    assert.equal(JSON.parse(text).reviews[0].requiresResubmission, true);

    for (const ref of [secret, "https://archive.test/file?token=private", instance.fixture.evidence(3).evidenceRef + "\n"]) {
      const response = await post("/reviews", { ...instance.fixture.evidence(3), evidenceRef: ref });
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), /private-person|session-secret|token=private/);
    }
    for (const [approve, rationale, extra] of [
      [true, secret, {}], [false, secret, {}],
      [true, "record_mismatch", {}], [false, "original_record_verified", {}],
      [true, "original_record_verified", { notes: secret }],
    ] as const) {
      const response = await post("/reviews/1/decision", {
        approve, rationale, ...extra,
        attestation: approve ? "I independently verified the trusted original record"
          : "I independently reviewed the evidence and found it insufficient",
      });
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), /private-person|session-secret/);
    }
    const approval = await post("/reviews/1/decision", {
      approve: true, rationale: "original_record_verified",
      attestation: "I independently verified the trusted original record",
    });
    assert.equal(approval.status, 409);
    assert.equal(instance.fixture.memories[0].user_id, null);
    assert.deepEqual(instance.fixture.archiveReads, []);
    const rejection = await post("/reviews/1/decision", {
      approve: false, rationale: "legacy_reference_requires_resubmission",
      attestation: "I independently reviewed the evidence and found it insufficient",
    });
    assert.equal(rejection.status, 200);
    const resubmission = await post("/reviews", instance.fixture.evidence(3));
    assert.equal(resubmission.status, 201);
    const after = await (await fetch(base, { headers })).json();
    assert.equal(after.reviews[0].rationale, "legacy_reference_requires_resubmission");
    assert.equal(after.reviews[0].evidenceRef, null);
    assert.equal(instance.fixture.reviews[0].rationale, secret, "old internal audit is retained, not rewritten");
  } finally {
    await instance.close();
  }
});
