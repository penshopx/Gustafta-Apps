import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// Standalone Node module: production workflow needs no package installation.
// @ts-expect-error JavaScript test entry has no separate declaration file.
import { runReceiptTest } from "../scripts/test-ecosystem-alert-receipt.mjs";

const url = "https://hc-ping.com/00000000-0000-4000-8000-000000000000";
const options = { action: "arm", confirmed: true, pingUrl: url, readOnlyKey: "fixture-key" };
const metadata = {
  unique_key: "fixture-only", name: "Gustafta isolated alarm receipt",
  tags: "gustafta-isolated-receipt", schedule: "* * * * *", tz: "UTC", grace: 90,
  started: false, filter_http_body: false, filter_default_fail: false, methods: "POST", status: "new",
};

test("dry-run tidak membaca penyedia atau memerlukan secret", async () => {
  assert.deepEqual(await runReceiptTest({ action: "dry-run" }, () => {
    throw new Error("must not request");
  }), { status: "dry_run", networkRequests: 0 });
});

for (const [name, override, expected] of [
  ["aksi asing", { action: "fail" }, "invalid_action"],
  ["tanpa persetujuan", { confirmed: false }, "confirmation_required"],
  ["secret hilang", { readOnlyKey: "" }, "missing_test_secrets"],
  ["host asing", { pingUrl: "https://example.test/secret" }, "invalid_test_url"],
  ["fail URL", { pingUrl: `${url}/fail` }, "invalid_test_url"],
  ["query atau fragment", { pingUrl: `${url}?secret=value` }, "invalid_test_url"],
] as const) {
  test(`${name} ditolak sebelum jaringan`, async () => {
    const result = await runReceiptTest({ ...options, ...override }, () => {
      throw new Error("must not request");
    });
    assert.equal(result.status, expected);
  });
}

for (const change of [
  { name: "Production check" }, { tags: "production" }, { schedule: "31 10,18 * * *" },
  { grace: 75600 }, { tz: "Asia/Bangkok" }, { channels: "private" },
  { ping_url: url }, { uuid: "private" }, { unique_key: null }, { status: "paused" },
  { started: true }, { methods: "GET" }, { filter_default_fail: true },
  { filter_http_body: true },
]) {
  test(`metadata tidak aman (${Object.keys(change)[0]}) tidak pernah diping`, async () => {
    let calls = 0;
    const result = await runReceiptTest(options, async () => {
      calls++;
      return Response.json({ ...metadata, ...change });
    });
    assert.equal(result.status, "fixture_not_isolated");
    assert.equal(calls, 1);
  });
}

test("arm mengirim satu POST kosong; kunci hanya dipakai membaca metadata", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const result = await runReceiptTest(options, async (address: string, init: RequestInit) => {
    calls.push({ url: address, init });
    return calls.length === 1 ? Response.json(metadata) : new Response("OK");
  });
  assert.equal(result.status, "armed");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "GET");
  assert.equal((calls[0].init.headers as Record<string, string>)["X-Api-Key"], "fixture-key");
  assert.equal(calls[1].url, url);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.body, "");
  assert.equal(calls[1].init.headers, undefined);
  assert.ok(calls.every((call) => call.init.redirect === "error" && call.init.signal));
  assert.doesNotMatch(JSON.stringify(result), /fixture-key|hc-ping/);
});

test("inspect hanya membaca; arm ulang dan recovery sebelum down ditolak", async () => {
  for (const action of ["inspect", "arm", "recover"]) {
    let calls = 0;
    const result = await runReceiptTest({ ...options, action }, async () => {
      calls++;
      return Response.json({ ...metadata, status: "up" });
    });
    assert.equal(calls, 1);
    assert.equal(result.status, action === "inspect" ? "inspected"
      : action === "arm" ? "arm_requires_new_check" : "recovery_requires_down");
  }
});

test("recovery setelah down memakai satu ping; bukan bukti penerimaan manusia", async () => {
  let calls = 0;
  const result = await runReceiptTest({ ...options, action: "recover" }, async () => {
    calls++;
    return calls === 1 ? Response.json({ ...metadata, status: "down" }) : new Response("OK");
  });
  assert.equal(result.status, "recovery_ping_accepted");
  assert.equal(calls, 2);
});

test("kegagalan metadata atau ping tidak membocorkan respons, dan tidak diulang", async () => {
  for (const failure of ["read-denied", "read-throws", "invalid-json", "ping-throws", "ping-503"]) {
    let calls = 0;
    const result = await runReceiptTest(options, async () => {
      calls++;
      if (failure === "read-denied") return new Response("sensitive provider text", { status: 403 });
      if (failure === "read-throws" || (failure === "ping-throws" && calls === 2)) {
        throw new Error(`${url} fixture-key sensitive provider text`);
      }
      if (failure === "invalid-json") return new Response("not json");
      if (calls === 1) return Response.json(metadata);
      return new Response("sensitive provider text", { status: 503 });
    });
    assert.equal(calls, failure.startsWith("ping-") ? 2 : 1);
    assert.equal(result.status, failure.startsWith("ping-") ? "ping_delivery_uncertain" : "metadata_unavailable");
    assert.doesNotMatch(JSON.stringify(result), /fixture-key|hc-ping|sensitive/);
  }
});

test("workflow hanya manual, berizin baca, dan tanpa secret heartbeat produksi", () => {
  const workflow = readFileSync(".github/workflows/ecosystem-alert-receipt-test.yml", "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: monitoring-receipt-test/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /^\s+(schedule|push|workflow_run|pull_request_target):/m);
  assert.doesNotMatch(workflow, /secrets\.(ECOSYSTEM_(CHECK|WATCHDOG|ALERT_STATE)|BREVO|CRONITOR)/);
  assert.doesNotMatch(workflow, /npm ci|\/fail|issues: write/);
});
