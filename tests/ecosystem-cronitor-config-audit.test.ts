import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { auditCronitor } from "../scripts/audit-cronitor-config";
import { auditHealthchecks, auditHealthchecksOperatorVerification } from "../scripts/audit-healthchecks-config";
import { notifyMonitorConfigAudit } from "../scripts/notify-monitor-config-audit";

const expected = {
  checker: { key: "check-key", list: "oncall", notifications: { telegram: ["private-recipient"], emails: ["private-email"] } },
  watchdog: { key: "watch-key", list: "oncall", notifications: { telegram: ["private-recipient"], emails: ["private-email"] } },
};
const monitor = (name: "checker" | "watchdog") => ({
  key: expected[name].key, type: "heartbeat",
  schedule: name === "checker" ? "17 2 * * *" : "31 10,18 * * *",
  timezone: "UTC", grace_seconds: name === "checker" ? 21600 : 18000,
  schedule_tolerance: 0, paused: false, notify: ["oncall"],
});

function provider(change: Record<string, unknown> = {}, listChange: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetcher = (async (url: string, options: RequestInit) => {
    calls.push(url);
    assert.equal(options.method, "GET");
    assert.match(url, /^https:\/\/cronitor\.io\/api\/(?:monitors|notifications)\//);
    const body = url.includes("/notifications/")
      ? { key: "oncall", status: "active", notifications: expected.checker.notifications, ...listChange }
      : { ...monitor(url.endsWith("/check-key") ? "checker" : "watchdog"), ...change };
    return { ok: true, json: async () => body } as Response;
  }) as typeof fetch;
  return { fetcher, calls };
}

test("read-only audit accepts both exact schedules and attached destinations", async () => {
  const { fetcher, calls } = provider();
  assert.equal(await auditCronitor("fake-api-key", JSON.stringify(expected), fetcher), "ok");
  assert.equal(calls.length, 4);
});

test("audit detects changed schedule, grace, pause, attachment and recipient identity", async () => {
  for (const change of [
    { schedule: "every 1 min" }, { grace_seconds: 0 }, { timezone: "Asia/Jakarta" },
    { schedule_tolerance: 1 }, { paused: true }, { notify: ["other-list"] },
  ]) {
    assert.equal(await auditCronitor("fake-api-key", JSON.stringify(expected), provider(change).fetcher), "drift");
  }
  for (const listChange of [
    { notifications: { emails: ["private-email"] } },
    { notifications: { ...expected.checker.notifications, telegram: ["different-person"] } },
    { status: "disabled" },
  ]) {
    assert.equal(await auditCronitor("fake-api-key", JSON.stringify(expected), provider({}, listChange).fetcher), "drift");
  }
});

test("missing baseline, API denial, timeout and malformed provider payload fail closed", async () => {
  assert.equal(await auditCronitor(undefined, JSON.stringify(expected), provider().fetcher), "config_error");
  assert.equal(await auditCronitor("fake-api-key", "invalid-json", provider().fetcher), "config_error");
  assert.equal(await auditCronitor("fake-api-key", JSON.stringify({ ...expected, checker: { ...expected.checker, notifications: {} } }), provider().fetcher), "config_error");
  const denied = (async () => new Response(null, { status: 403 })) as typeof fetch;
  const timeout = (async () => { throw new Error("secret private-recipient https://cronitor.link/p/private"); }) as typeof fetch;
  const invalid = (async () => new Response("private-email")) as typeof fetch;
  for (const fetcher of [denied, timeout, invalid]) {
    assert.equal(await auditCronitor("fake-api-key", JSON.stringify(expected), fetcher), "provider_error");
  }
});

test("scheduled audit warns via Brevo; manual audit cannot alert or ping production", () => {
  const workflow = readFileSync(".github/workflows/ecosystem-cronitor-config-audit.yml", "utf8");
  assert.match(workflow, /always\(\) && github\.event_name == 'schedule' && \(steps\.audit\.outcome != 'success' \|\| steps\.healthchecks\.outcome != 'success'\)/);
  assert.match(workflow, /npx tsx scripts\/notify-monitor-config-audit\.ts/);
  assert.doesNotMatch(workflow, /cronitor\.link|state=fail|ECOSYSTEM_CHECK_CRONITOR_URL/);
  assert.match(workflow, /CRONITOR_AUDIT_BASELINE/);
  assert.match(workflow, /HEALTHCHECKS_AUDIT_BASELINE/);
  assert.match(workflow, /HEALTHCHECKS_DESTINATION_BASELINE: \$\{\{ secrets\.HEALTHCHECKS_DESTINATION_BASELINE \}\}/);
  assert.match(workflow, /HEALTHCHECKS_OPERATOR_VERIFICATION: \$\{\{ secrets\.HEALTHCHECKS_OPERATOR_VERIFICATION \}\}/);
  assert.match(workflow, /id: audit\n\s+continue-on-error: true/);
  assert.match(workflow, /id: healthchecks[\s\S]*?continue-on-error: true/);
  assert.match(workflow, /Keep unverifiable configuration visible as a failed job[\s\S]*?exit 1/);
  assert.doesNotMatch(workflow, /hc-ping\.com|\/fail\b/);
  assert.doesNotMatch(workflow, /secrets\.ECOSYSTEM_(?:CHECK|WATCHDOG|ALERT_STATE)_(?:HEARTBEAT|CRONITOR)_URL/);
});

test("audit warnings use independent Brevo with generic content and no retry on failed delivery", async () => {
  let calls = 0;
  const config = { apiKey: "fake-brevo-key", recipient: "operator@example.test" };
  const fetcher = (async (url: string, options: RequestInit) => {
    calls++;
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body as string);
    assert.match(body.textContent, /Healthchecks atau Cronitor/);
    assert.match(body.textContent, /bukan laporan gangguan aplikasi/);
    assert.doesNotMatch(body.textContent, /private-|hc-ping|https:|UUID/);
    assert.deepEqual(body.to, [{ email: config.recipient }]);
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  assert.equal(await notifyMonitorConfigAudit(config, fetcher), "sent");
  assert.equal(calls, 1);
  assert.equal(await notifyMonitorConfigAudit({}, fetcher), "config_error");
  assert.equal(calls, 1);
  for (const failure of [
    (async () => { calls++; return new Response("private provider error", { status: 503 }); }) as typeof fetch,
    (async () => { calls++; throw new Error("private-recipient https://hc-ping.com/private"); }) as typeof fetch,
  ]) {
    const before = calls;
    assert.equal(await notifyMonitorConfigAudit(config, failure), "delivery_error");
    assert.equal(calls, before + 1);
  }
});

// Fake identifiers only. Never use production UUIDs or names in test fixtures.
const hcExpected = {
  checker: {
    uuid: "00000000-0000-0000-0000-000000000001",
    channels: [
      { id: "00000000-0000-0000-0000-000000000003", kind: "email", name: "Private email alias" },
      { id: "00000000-0000-0000-0000-000000000004", kind: "telegram", name: "Private Telegram alias" },
    ],
  },
  watchdog: {
    uuid: "00000000-0000-0000-0000-000000000002",
    channels: [
      { id: "00000000-0000-0000-0000-000000000003", kind: "email", name: "Private email alias" },
      { id: "00000000-0000-0000-0000-000000000004", kind: "telegram", name: "Private Telegram alias" },
    ],
  },
};
type HcName = "checker" | "watchdog";
function hcProvider(
  changes: Partial<Record<HcName, Record<string, unknown>>> = {},
  channels: unknown = hcExpected.checker.channels,
  failTarget?: string,
) {
  const calls: string[] = [];
  const fetcher = (async (url: string, options: RequestInit) => {
    calls.push(url);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
    assert.ok(options.signal);
    assert.deepEqual(options.headers, { "X-Api-Key": "fake-key" });
    assert.match(url, /^https:\/\/healthchecks\.io\/api\/v3\/(channels\/|checks\/[a-f0-9-]+)$/);
    if (failTarget && url.endsWith(failTarget)) return { ok: false, status: 503 } as Response;
    const name: HcName = url.endsWith(hcExpected.checker.uuid) ? "checker" : "watchdog";
    const body = url.endsWith("channels/") ? { channels } : {
      uuid: hcExpected[name].uuid,
      schedule: name === "checker" ? "17 2 * * *" : "31 10,18 * * *",
      tz: "UTC", grace: name === "checker" ? 21600 : 18000,
      status: "up", channels: hcExpected[name].channels.map(ch => ch.id).join(","),
      // Malicious or private provider data is ignored, never followed.
      ping_url: "https://hc-ping.com/private", desc: "private recipient",
      ...changes[name],
    };
    return { ok: true, json: async () => body } as Response;
  }) as typeof fetch;
  return { fetcher, calls };
}
const hcAudit = (p: ReturnType<typeof hcProvider>) =>
  auditHealthchecks("fake-key", JSON.stringify(hcExpected), p.fetcher);

test("Healthchecks: both schedules and four ON attachments verified using GET only", async () => {
  const p = hcProvider();
  assert.deepEqual(await hcAudit(p), { checker: "ok", watchdog: "ok" });
  assert.equal(p.calls.length, 3);
  // Attachment order is not significant; a down check is not config drift.
  assert.deepEqual(await hcAudit(hcProvider({
    checker: { status: "down", channels: hcExpected.checker.channels.map(ch => ch.id).reverse().join(",") },
  })), { checker: "ok", watchdog: "ok" });
});

test("Healthchecks: schedule, grace, paused state and OFF channel drift isolated per check", async () => {
  for (const name of ["checker", "watchdog"] as const) {
    for (const change of [
      { schedule: "* * * * *" }, { grace: 60 }, { tz: "Asia/Jakarta" },
      { status: "paused" }, { uuid: hcExpected[name === "checker" ? "watchdog" : "checker"].uuid },
      { channels: "" },
      ...hcExpected[name].channels.map(ch => ({ channels: ch.id })),
      { channels: `${hcExpected[name].channels.map(ch => ch.id).join(",")},00000000-0000-0000-0000-000000000005` },
    ]) {
      const result = await hcAudit(hcProvider({ [name]: change }));
      assert.equal(result[name], "drift");
      assert.equal(result[name === "checker" ? "watchdog" : "checker"], "ok");
    }
  }
});

test("Healthchecks: removed, replaced, renamed and wrong-kind integrations fail", async () => {
  for (const channels of [
    [], hcExpected.checker.channels.slice(0, 1),
    hcExpected.checker.channels.map(ch => ({ ...ch, name: "Changed alias" })),
    hcExpected.checker.channels.map(ch => ({ ...ch, kind: "webhook" })),
  ]) {
    assert.deepEqual(await hcAudit(hcProvider({}, channels)), { checker: "drift", watchdog: "drift" });
  }
});

const verifiedAt = "2026-10-18T10:00:00.000Z";
const verificationNow = Date.parse(verifiedAt);
const destinationBaseline = {
  version: 1,
  channels: hcExpected.checker.channels.map(ch => ({
    id: ch.id, kind: ch.kind,
    destination: ch.kind === "email" ? "private@example.test" : "private-chat-identity",
  })),
};
const operatorObservation = {
  version: 1, source: "dashboard", status: "available", checkedAt: verifiedAt,
  channels: destinationBaseline.channels.map(ch => ({
    ...ch, enabled: true, emailVerified: ch.kind === "email" ? true : null, receiptConfirmed: true,
  })),
};
function operatorAudit(observation: unknown = operatorObservation, baseline: unknown = destinationBaseline, now = verificationNow) {
  return auditHealthchecksOperatorVerification(
    JSON.stringify(hcExpected), JSON.stringify(baseline), JSON.stringify(observation), now,
  );
}

test("Healthchecks operator: exact private destinations and explicit receipt verification pass", () => {
  assert.equal(operatorAudit(), "ok");
  assert.equal(operatorAudit({ ...operatorObservation, channels: [...operatorObservation.channels].reverse() }), "ok");
});

test("Healthchecks operator: unchanged API identity cannot hide recipient, activation or verification drift", async () => {
  // API remains green in every case: these properties are deliberately absent.
  assert.deepEqual(await hcAudit(hcProvider()), { checker: "ok", watchdog: "ok" });
  for (let i = 0; i < 2; i++) {
    for (const change of [
      { destination: "changed-private-recipient" }, { enabled: false }, { receiptConfirmed: false },
      ...(i === 0 ? [{ emailVerified: false }] : []),
    ]) {
      assert.equal(operatorAudit({
        ...operatorObservation,
        channels: operatorObservation.channels.map((ch, j) => j === i ? { ...ch, ...change } : ch),
      }), "drift");
    }
  }
  assert.equal(operatorAudit({ ...operatorObservation, channels: [] }), "drift");
});

test("Healthchecks operator: inaccessible dashboard and stale or missing observation never pass", () => {
  assert.equal(operatorAudit({ ...operatorObservation, status: "inaccessible", channels: [] }), "source_unavailable");
  assert.equal(operatorAudit(operatorObservation, destinationBaseline, verificationNow + 31 * 86400000), "verification_due");
  assert.equal(operatorAudit(operatorObservation, destinationBaseline, verificationNow + 31 * 86400000 - 1), "ok");
  assert.equal(operatorAudit(operatorObservation, destinationBaseline, verificationNow - 1), "config_error");
  assert.equal(auditHealthchecksOperatorVerification(JSON.stringify(hcExpected), JSON.stringify(destinationBaseline), undefined), "verification_due");
});

test("Healthchecks operator: malformed, duplicate, mismatched and extra-field evidence fails closed", () => {
  for (const observation of [
    null, [], {}, { ...operatorObservation, version: 2 },
    { ...operatorObservation, status: "unknown" }, { ...operatorObservation, source: "api" },
    { ...operatorObservation, checkedAt: "not-a-date" },
    { ...operatorObservation, checkedAt: "2026-02-30T10:00:00.000Z" },
    { ...operatorObservation, channels: [null] },
    { ...operatorObservation, channels: [operatorObservation.channels[0], operatorObservation.channels[0]] },
    { ...operatorObservation, secretProviderError: "private response" },
    ...[{ enabled: "true" }, { emailVerified: null }, { receiptConfirmed: undefined }].map(change => ({
      ...operatorObservation, channels: [{ ...operatorObservation.channels[0], ...change }, operatorObservation.channels[1]],
    })),
  ]) assert.equal(operatorAudit(observation), "config_error");
  for (const baseline of [
    {}, { ...destinationBaseline, channels: [] },
    { ...destinationBaseline, channels: [destinationBaseline.channels[0], destinationBaseline.channels[0]] },
    { ...destinationBaseline, channels: destinationBaseline.channels.map(ch => ({ ...ch, id: "different-id" })) },
    { ...destinationBaseline, channels: destinationBaseline.channels.map(ch => ({ ...ch, destination: "" })) },
  ]) assert.equal(operatorAudit(operatorObservation, baseline), "config_error");
  assert.equal(auditHealthchecksOperatorVerification("invalid", "private", "private"), "config_error");
  assert.equal(auditHealthchecksOperatorVerification(JSON.stringify(hcExpected), JSON.stringify(destinationBaseline), "private-error"), "config_error");
});

test("Healthchecks CLI: operator failure exits nonzero and emits only fixed status codes", () => {
  // Stub all network and isolate credentials/context. API is green so only
  // operator verification can determine the child's exit status.
  const code = `
    const baseline = JSON.parse(process.env.HEALTHCHECKS_AUDIT_BASELINE);
    globalThis.fetch = async (url, options) => {
      if (options.method !== "GET" || options.redirect !== "error" ||
          !/^https:\\/\\/healthchecks\\.io\\/api\\/v3\\/(channels\\/|checks\\/[a-f0-9-]+)$/.test(url)) {
        throw new Error("Unexpected request");
      }
      if (url.endsWith("channels/")) return Response.json({ channels: baseline.checker.channels });
      const checker = url.endsWith(baseline.checker.uuid);
      const target = checker ? baseline.checker : baseline.watchdog;
      return Response.json({
        uuid: target.uuid, channels: target.channels.map(ch => ch.id).join(","),
        schedule: checker ? "17 2 * * *" : "31 10,18 * * *",
        grace: checker ? 21600 : 18000, tz: "UTC", status: "up",
      });
    };
    process.argv[1] = new URL("./scripts/audit-healthchecks-config.ts", "file://" + process.cwd() + "/").pathname;
    await import("./scripts/audit-healthchecks-config.ts");
  `;
  for (const [status, observation] of [
    ["ok", { ...operatorObservation, checkedAt: new Date().toISOString() }],
    ["source_unavailable", { ...operatorObservation, status: "inaccessible" }],
    ["drift", { ...operatorObservation, checkedAt: new Date().toISOString(), channels: [] }],
    ["verification_due", { ...operatorObservation, checkedAt: "2000-01-01T00:00:00.000Z" }],
    ["config_error", "private-provider-error"],
  ] as const) {
    const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HEALTHCHECKS_AUDIT_API_KEY: "fake-key",
        HEALTHCHECKS_AUDIT_BASELINE: JSON.stringify(hcExpected),
        HEALTHCHECKS_DESTINATION_BASELINE: JSON.stringify(destinationBaseline),
        HEALTHCHECKS_OPERATOR_VERIFICATION: JSON.stringify(observation),
      },
    });
    assert.equal(run.stderr, "");
    assert.equal(run.stdout, `Healthchecks configuration audit checker: ok\nHealthchecks configuration audit watchdog: ok\nHealthchecks operator verification: ${status}\n`);
    assert.equal(run.status, status === "ok" ? 0 : 1);
    assert.doesNotMatch(run.stdout, /private@|private-chat|00000000|Private email/);
  }
});

test("Healthchecks: invalid secrets make no requests", async () => {
  const p = hcProvider();
  for (const raw of [
    undefined, "invalid", "[]",
    JSON.stringify({ ...hcExpected, watchdog: hcExpected.checker }),
    JSON.stringify({ ...hcExpected, checker: { ...hcExpected.checker, channels: [] } }),
    JSON.stringify({ ...hcExpected, checker: { ...hcExpected.checker, channels: [hcExpected.checker.channels[0], hcExpected.checker.channels[0]] } }),
    JSON.stringify({ ...hcExpected, checker: { ...hcExpected.checker, uuid: "https://hc-ping.com/private" } }),
  ]) {
    assert.deepEqual(await auditHealthchecks("fake-key", raw, p.fetcher),
      { checker: "config_error", watchdog: "config_error" });
  }
  assert.deepEqual(await auditHealthchecks(undefined, JSON.stringify(hcExpected), p.fetcher),
    { checker: "config_error", watchdog: "config_error" });
  assert.equal(p.calls.length, 0);
});

test("Healthchecks: API failures, read-only omissions and unknown shapes fail closed", async () => {
  assert.deepEqual(await hcAudit(hcProvider({}, undefined, "channels/")),
    { checker: "provider_error", watchdog: "provider_error" });
  assert.deepEqual(await hcAudit(hcProvider({}, undefined, hcExpected.checker.uuid)),
    { checker: "provider_error", watchdog: "ok" });
  for (const change of [
    { channels: undefined }, { uuid: undefined }, { status: "unknown" },
    { channels: ["email"] }, { channels: "*" }, { schedule: undefined },
  ]) {
    assert.deepEqual(await hcAudit(hcProvider({ checker: change })),
      { checker: "provider_error", watchdog: "ok" });
  }
  for (const payload of [null, {}, { channels: null }, { channels: [null] },
    { channels: [...hcExpected.checker.channels, hcExpected.checker.channels[0]] }]) {
    const fetcher = (async () => Response.json(payload)) as typeof fetch;
    assert.deepEqual(await auditHealthchecks("fake-key", JSON.stringify(hcExpected), fetcher),
      { checker: "provider_error", watchdog: "provider_error" });
  }
  for (const fetcher of [
    (async () => new Response(null, { status: 403 })) as typeof fetch,
    (async () => { throw new Error("private-identity https://hc-ping.com/private"); }) as typeof fetch,
    (async () => new Response("private-json")) as typeof fetch,
  ]) {
    assert.deepEqual(await auditHealthchecks("fake-key", JSON.stringify(hcExpected), fetcher),
      { checker: "provider_error", watchdog: "provider_error" });
  }
});