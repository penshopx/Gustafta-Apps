import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { findIssueByTitle } from "../scripts/ecosystem-issue-lookup";

const workflow = readFileSync(".github/workflows/ecosystem-monitor-watchdog.yml", "utf8");
const primaryWorkflow = readFileSync(".github/workflows/ecosystem-link-health.yml", "utf8");
// The primary flow below runs these real CLIs with the same output gate as Actions.
assert.match(primaryWorkflow, /id: network-claim[\s\S]*?run: npx tsx scripts\/ecosystem-alert-state\.ts claim/);
assert.match(primaryWorkflow, /- name: Notify operational email of checker network trouble\n\s+if: \$\{\{ always\(\) && steps\.network-claim\.outputs\.send == 'true' \}\}[\s\S]*?run: npx tsx scripts\/notify-ecosystem-links\.ts network/);
const scripts = [...workflow.matchAll(/run: \|\n\s+node <<'NODE'\n([\s\S]*?)\n\s+NODE/g)]
  .map(match => match[1].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n"));
assert.equal(scripts.length, 2, "Watchdog scripts must be standalone, without checkout or npm");
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /^  workflow_run:/m);
assert.doesNotMatch(workflow, /^  schedule:/m);
assert.match(workflow, /inputs\.allow_operational_run == true/);
assert.doesNotMatch(workflow, /^\s*(?:uses: actions\/(?:checkout|setup-node)|run: npm ci)/m);

// Compare the actual inlined lookup against the primary monitor's helper in CI.
// The watchdog itself must not load files from the repository: checkout can fail.
const lookupStart = scripts[1].indexOf("async function find() {");
const lookupEnd = scripts[1].indexOf("\nconst description =", lookupStart);
assert.ok(lookupStart >= 0 && lookupEnd > lookupStart, "Standalone watchdog lookup must be identifiable");
const watchdogLookup = scripts[1].slice(lookupStart, lookupEnd).trim();

type Issue = { number: number; title: string; body?: string; pull_request?: object };
const repository = "example/project";
const alertTitle = "Ecosystem alert delivery: ecosystem-watchdog-missed-2026-09-21";
const marker = (number: number): Issue => ({ number, title: alertTitle, body: "sent" });
const search = (items: unknown[], total_count = items.length, incomplete_results = false) =>
  ({ items, total_count, incomplete_results });
const recentPath = "/issues?state=all&sort=created&direction=desc&per_page=100&page=1";

async function compareLookups(pages: Record<string, unknown>) {
  const paths = [[], []] as string[][];
  const api = (index: number) => async (path: string) => {
    paths[index].push(path);
    const page = path === recentPath ? "recent" : new URLSearchParams(path.split("?")[1]).get("page");
    if (!page || !(page in pages)) throw new Error("Unmocked request");
    if (pages[page] instanceof Error) throw pages[page];
    return pages[page];
  };
  const outcome = async (fn: () => Promise<Issue | undefined>) => {
    try {
      const issue = await fn();
      return issue ? { kind: "found", number: issue.number } : { kind: "absent" };
    } catch {
      return { kind: "failed" };
    }
  };
  const primary = await outcome(() =>
    findIssueByTitle<Issue>(repository, alertTitle, api(0), "Duplicate alert state"));
  // Evaluate only the function from the real workflow, without its email/claim
  // side effects. Its lexical api/title/process dependencies are injected here.
  const watchdog = runInNewContext(`(${watchdogLookup})`, {
    api: api(1), title: alertTitle, process: { env: { REPOSITORY: repository } },
  }) as () => Promise<Issue | undefined>;
  const standalone = await outcome(watchdog);
  assert.deepEqual(standalone, primary, "Watchdog lookup outcome diverged from primary monitor");
  assert.deepEqual(paths[1], paths[0], "Watchdog lookup queries diverged from primary monitor");
}

test("CI: standalone watchdog lookup follows the primary issue lookup rules", async (t) => {
  const unrelated = { ...marker(3), title: "Other alert" };
  const pull = { ...marker(4), pull_request: {} };
  const fullPage = Array.from({ length: 100 }, (_, i) => ({ ...unrelated, number: i + 10 }));
  const scenarios: Record<string, Record<string, unknown>> = {
    absent: { 1: search([]), recent: [] },
    "exact match in search": { 1: search([unrelated, pull, marker(1)]), recent: [] },
    "recent claim not indexed": { 1: search([]), recent: [marker(1)] },
    "same marker from both sources": { 1: search([marker(1)]), recent: [marker(1)] },
    "duplicate search matches": { 1: search([marker(1), marker(2)]) },
    "duplicate recent match": { 1: search([marker(1)]), recent: [marker(2)] },
    "second search page": { 1: search(fullPage, 101), 2: search([marker(1)], 101), recent: [] },
    "short page before count": { 1: search([unrelated], 2) },
    "empty page before count": { 1: search([], 1) },
    "incomplete search": { 1: search([], 0, true) },
    "capped search": { 1: search([], 1000) },
    "missing search items": { 1: { total_count: 0, incomplete_results: false } },
    "malformed search issue": { 1: search([null]) },
    "malformed recent issue": { 1: search([]), recent: [null] },
    "invalid recent response": { 1: search([]), recent: null },
    "search API failure": { 1: new Error("API unavailable") },
    "recent API failure": { 1: search([]), recent: new Error("API unavailable") },
  };
  for (const [name, pages] of Object.entries(scenarios)) {
    await t.test(name, () => compareLookups(pages));
  }
});

function execute(
  script: "detect" | "notify" | "primary",
  responses: Record<string, { ok?: boolean; data?: unknown; throwAfterPersist?: boolean; throwAfterReceive?: boolean }> = {},
  env: Record<string, string> = {},
  session?: { issue?: Issue },
) {
  const folder = mkdtempSync(join(tmpdir(), "ecosystem-watchdog-"));
  const output = join(folder, "output");
  const prelude = `
    let issue = ${JSON.stringify(session?.issue ?? null)};
    if (issue) require("node:fs").writeFileSync(process.env.GITHUB_OUTPUT + ".state", JSON.stringify(issue));
    global.fetch = async (url, options) => {
      require("node:fs").appendFileSync(process.env.GITHUB_OUTPUT + ".requests",
        JSON.stringify({ url: String(url), method: options?.method || "GET" }) + "\\n");
      const key = String(url).includes("/search/issues") ? "search" :
        String(url).includes("/issues") ? "issues" :
        String(url).includes("/jobs?") ? "jobs" :
        String(url).includes("/workflows/") ? "runs" :
        String(url).includes("api.brevo.com") ? "email" : "run";
      const configured = ${JSON.stringify(responses)};
      const response = (key === "issues" ? configured["issues" + (options?.method || "GET")] : undefined) ||
        (key === "issues" && options?.method === "POST" ? configured.claim : undefined) ||
        configured[key] || (key === "search" ? configured.issues : undefined);
      if (!response) throw new Error("Unmocked request");
      if (key === "email") {
        require("node:fs").writeFileSync(process.env.GITHUB_OUTPUT + ".mail", options.body);
        // Brevo received the request, but fetch rejects without an HTTP response.
        if (response.throwAfterReceive) throw new TypeError(
          "Connection reset after receipt: " + process.env.BREVO_ALERT_EMAIL + " " + process.env.BREVO_API_KEY);
      }
      if (key === "issues" && response.ok !== false && ["POST", "PATCH"].includes(options?.method)) {
        if (options.method === "POST") issue = { number: 8, ...JSON.parse(options.body) };
        if (options.method === "PATCH") issue.body = JSON.parse(options.body).body;
        require("node:fs").writeFileSync(process.env.GITHUB_OUTPUT + ".state", JSON.stringify(issue || null));
        // The server committed the write, but the client never received its response.
        if (response.throwAfterPersist) throw new Error("Lost response after commit: test-token api.github.com");
      }
      return { ok: response.ok !== false, json: async () => key === "search"
        ? response.data?.items ? response.data :
          { total_count: issue ? 1 : (response.data || []).length, incomplete_results: false,
            items: response.data || (issue ? [issue] : []) }
        : key === "issues"
          ? (!options.method || options.method === "GET") ? (configured.recent?.data || (issue ? [issue] : []))
            : options.method === "POST" && Object.hasOwn(response, "data") ? response.data : issue
          : response.data };
    };
  `;
  const primary = `
    (async () => {
      const path = require("node:path");
      const { pathToFileURL } = require("node:url");
      process.argv = [process.execPath, path.resolve("scripts/ecosystem-alert-state.ts"), "claim"];
      await import(pathToFileURL(process.argv[1]).href);
      const fs = require("node:fs");
      const output = fs.existsSync(process.env.GITHUB_OUTPUT)
        ? fs.readFileSync(process.env.GITHUB_OUTPUT, "utf8") : "";
      // A failed claim must not emit send=true, even under Actions' always().
      if (/^send=true$/m.test(output)) {
        process.argv = [process.execPath, path.resolve("scripts/notify-ecosystem-links.ts"), "network"];
        await import(pathToFileURL(process.argv[1]).href);
      }
    })().catch(() => { process.exitCode = 1; });
  `;
  try {
    const result = spawnSync(process.execPath, [
      ...(script === "primary" ? ["--import", "tsx"] : []),
      "-e", prelude + (script === "primary" ? primary : scripts[script === "detect" ? 0 : 1]),
    ], {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        PATH: process.env.PATH,
        GH_TOKEN: "test-token",
        EVENT_NAME: "workflow_run",
        RUN_ID: "123",
        REPOSITORY: "example/project",
        GITHUB_REPOSITORY: "example/project",
        GITHUB_OUTPUT: output,
        ...env,
      },
    });
    const state = existsSync(output + ".state") ? JSON.parse(readFileSync(output + ".state", "utf8")) : undefined;
    if (session) session.issue = state;
    return {
      status: result.status,
      output: existsSync(output) ? readFileSync(output, "utf8") : "",
      mail: existsSync(output + ".mail") ? JSON.parse(readFileSync(output + ".mail", "utf8")) : undefined,
      state,
      requests: existsSync(output + ".requests")
        ? readFileSync(output + ".requests", "utf8").trim().split("\n")
          .map(line => JSON.parse(line) as { url: string; method: string }) : [],
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const steps = (conclusions: Record<string, string>) => ({
  jobs: [{
    steps: Object.entries(conclusions).map(([name, conclusion]) => ({ name, conclusion })),
  }],
});

test("penanda rusak menghentikan alur email watchdog dan utama tanpa klaim atau perubahan", async (t) => {
  const invalidFields: Record<string, Record<string, unknown>> = {
    "number hilang": { number: undefined },
    "number null": { number: null },
    "number string": { number: "8" },
    "number nol": { number: 0 },
    "number negatif": { number: -1 },
    "number pecahan": { number: 1.5 },
    "number tidak aman": { number: Number.MAX_SAFE_INTEGER + 1 },
    "body hilang": { body: undefined },
    "body null": { body: null },
    "body kosong": { body: "" },
    "body status asing": { body: "pending" },
    "body beda kapital": { body: "Sent" },
    "body spasi tambahan": { body: "sent\n" },
    "body bukan string": { body: { phase: "sent" } },
  };
  for (const flow of ["notify", "primary"] as const) {
    const env = {
      REASON: "missed",
      ALERT_KEY: flow === "notify" ? "ecosystem-watchdog-missed-2026-09-21" : "ecosystem-network-alert-2026-W39",
      BREVO_API_KEY: "test-token", BREVO_ALERT_EMAIL: "admin@example.test",
    };
    for (const source of ["search", "recent"] as const) {
      for (const [name, fields] of Object.entries(invalidFields)) {
        await t.test(`${flow}: ${source}: ${name}`, () => {
          const issue = { number: 8, title: "Ecosystem alert delivery: " + env.ALERT_KEY, body: "sent", ...fields };
          const result = execute(flow, {
            search: { data: search(source === "search" ? [issue] : []) },
            issues: {}, recent: { data: source === "recent" ? [issue] : [] }, email: {},
          }, env);
          assert.equal(result.status, 1, result.stderr);
          assert.ok(result.requests.some(request => request.url.includes("/search/issues")));
          assert.ok(result.requests.some(request => request.url.includes("/issues?state=all")));
          assert.equal(result.mail, undefined);
          assert.equal(result.state, undefined);
          assert.deepEqual(result.requests.filter(request => request.method !== "GET"), [],
            "Penanda rusak tidak boleh memicu POST email/klaim atau PATCH status");
          assert.doesNotMatch(result.output, /send=true|github_state_ok=true/);
          assert.doesNotMatch(result.stderr, /test-token|admin@example\.test|api\.github\.com/);
        });
      }
    }
  }
});

test("respons klaim watchdog rusak menghentikan email dan PATCH setelah lookup kosong", async (t) => {
  const env = {
    REASON: "missed", ALERT_KEY: "ecosystem-watchdog-missed-2026-09-21",
    BREVO_API_KEY: "test-token", BREVO_ALERT_EMAIL: "admin@example.test",
  };
  const validClaim = { number: 8, title: "Ecosystem alert delivery: " + env.ALERT_KEY, body: "sending" };
  const invalidFields: Record<string, Record<string, unknown>> = {
    "number hilang": { number: undefined },
    "number null": { number: null },
    "number string": { number: "8" },
    "number nol": { number: 0 },
    "number negatif": { number: -1 },
    "number pecahan": { number: 1.5 },
    "number tidak aman": { number: Number.MAX_SAFE_INTEGER + 1 },
    "title hilang": { title: undefined },
    "title null": { title: null },
    "title bukan string": { title: 8 },
    "title kosong": { title: "" },
    "title klaim lain": { title: validClaim.title.replace("missed", "failed") },
    "title spasi tambahan": { title: validClaim.title + "\n" },
    "body hilang": { body: undefined },
    "body null": { body: null },
    "body kosong": { body: "" },
    "body sudah sent": { body: "sent" },
    "body status asing": { body: "pending" },
    "body beda kapital": { body: "Sending" },
    "body spasi tambahan": { body: "sending\n" },
    "body bukan string": { body: { phase: "sending" } },
  };
  const invalidClaims: Record<string, unknown> = {
    "respons null": null,
    "respons kosong": {},
    "respons array": [],
    "respons string": "sending",
    ...Object.fromEntries(Object.entries(invalidFields).map(([name, fields]) =>
      [name, { ...validClaim, ...fields }])),
  };
  const lookupRequests = [
    { url: `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:example/project in:title "${validClaim.title}"`)}&per_page=100&page=1`, method: "GET" },
    { url: "https://api.github.com/repos/example/project" + recentPath, method: "GET" },
    { url: "https://api.github.com/repos/example/project/issues", method: "POST" },
  ];
  const responses = { search: { data: search([]) }, recent: { data: [] }, issues: {}, email: {} };
  for (const [name, data] of Object.entries(invalidClaims)) {
    await t.test(name, () => {
      const result = execute("notify", { ...responses, claim: { data } }, env);
      assert.equal(result.status, 1, result.stderr);
      assert.deepEqual(result.requests, lookupRequests,
        "Klaim rusak harus berhenti setelah POST, tanpa permintaan Brevo atau PATCH");
      assert.equal(result.mail, undefined);
      // The server may have created the claim despite its invalid acknowledgement.
      assert.deepEqual(result.state, validClaim);
      assert.doesNotMatch(result.output, /github_state_ok=true/);
      assert.match(result.stderr, /Monitor alert email could not be sent/);
      assert.doesNotMatch(result.stderr, /test-token|admin@example\.test|api\.github\.com/);
    });
  }
  await t.test("respons valid mengirim satu email lalu mencatat sent", () => {
    const result = execute("notify", { ...responses, claim: { data: validClaim } }, env);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.requests, [
      ...lookupRequests,
      { url: "https://api.brevo.com/v3/smtp/email", method: "POST" },
      { url: "https://api.github.com/repos/example/project/issues/8", method: "PATCH" },
    ]);
    assert.ok(result.mail);
    assert.deepEqual(result.state, { ...validClaim, body: "sent" });
    assert.match(result.output, /^github_state_ok=true$/m);
    assert.doesNotMatch(result.output, /github_state_failed=true/);
  });
});

test("alur utama hanya mengirim email saat klaim baru berhasil; sending dan sent memblokir duplikasi", async (t) => {
  const env = {
    ALERT_KEY: "ecosystem-network-alert-2026-W39",
    BREVO_API_KEY: "test-token", BREVO_ALERT_EMAIL: "admin@example.test",
  };
  for (const body of ["sending", "sent"]) {
    await t.test(body, () => {
      const issue = { number: 8, title: "Ecosystem alert delivery: " + env.ALERT_KEY, body };
      const result = execute("primary", {
        search: { data: search([issue]) }, issues: {}, email: {},
      }, env);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.output, /^send=false$/m);
      assert.equal(result.mail, undefined);
      assert.equal(result.state, undefined);
      assert.deepEqual(result.requests.filter(request => request.method !== "GET"), []);
    });
  }
  const absent = execute("primary", {
    search: { data: search([]) }, issues: {}, email: {},
  }, env);
  assert.equal(absent.status, 0, absent.stderr);
  assert.match(absent.output, /^send=true$/m);
  assert.equal(absent.state.body, "sending");
  assert.match(absent.mail.textContent, /Konektivitas jaringan/);
  assert.equal(absent.requests.filter(request => request.method === "POST" && request.url.endsWith("/issues")).length, 1);
  assert.equal(absent.requests.filter(request => request.url.includes("api.brevo.com")).length, 1);
});
const check = "Check external app URLs and rendered pages";
const key = "Prepare alert deduplication key";
const notify = "Notify operational email";
const claim = "Claim weekly failure alert";

test("warns when checkout or install fails before a report exists", () => {
  const result = execute("detect", {
    run: { data: { conclusion: "failure" } },
    jobs: { data: steps({ "Checkout": "failure", [check]: "skipped" }) },
  });
  assert.equal(result.status, 0);
  assert.match(result.output, /^reason=failed/m);
  assert.match(result.output, /key=ecosystem-watchdog-failed-\d{4}-\d{2}-\d{2}/);
});

test("does not duplicate a normal failure report already handled by the checker", () => {
  const result = execute("detect", {
    run: { data: { conclusion: "failure" } },
    jobs: { data: steps({ [check]: "failure", [key]: "success", [notify]: "success" }) },
  });
  assert.equal(result.status, 0);
  assert.equal(result.output, "");
});

test("warns if a failed check could not create a report or deliver its alert", () => {
  for (const conclusions of [
    { [check]: "failure", [key]: "failure" },
    { [check]: "failure", [key]: "success", [notify]: "failure" },
  ]) {
    const result = execute("detect", {
      run: { data: { conclusion: "failure" } },
      jobs: { data: steps(conclusions) },
    });
    assert.equal(result.status, 0);
    assert.match(result.output, /^reason=failed/m);
  }
});

test("accepts an already claimed checker alert", () => {
  const result = execute("detect", {
    run: { data: { conclusion: "failure" } },
    jobs: { data: steps({ [check]: "failure", [key]: "success", [claim]: "success", [notify]: "skipped" }) },
  });
  assert.equal(result.output, "");
});

test("another alert's success does not hide a failed GitHub state step", () => {
  const result = execute("detect", {
    run: { data: { conclusion: "failure" } },
    jobs: { data: steps({
      [check]: "failure", [key]: "success", [notify]: "success",
      "Claim weekly network alert": "failure",
    }) },
  });
  assert.equal(result.status, 0);
  assert.match(result.output, /checker_state_blocked=true/);
  assert.match(result.output, /reason=failed/);
});

test("warns when the scheduled check is absent or still stuck", () => {
  const probe = {
    search: { data: { total_count: 0, incomplete_results: false, items: [] } },
    issues: {},
  };
  const absent = execute("detect", { ...probe, runs: { data: { workflow_runs: [] } } }, { EVENT_NAME: "schedule" });
  assert.match(absent.output, /^reason=missed/m, absent.stderr);
  const stuck = execute("detect", {
    ...probe,
    runs: { data: { workflow_runs: [{ created_at: new Date().toISOString(), conclusion: null }] } },
  }, { EVENT_NAME: "schedule" });
  assert.match(stuck.output, /^reason=failed/m);
});

test("scheduled success requires both GitHub Search and Issues APIs", () => {
  for (const responses of [
    { search: { ok: false }, issues: {} },
    { search: { data: { total_count: 1, incomplete_results: true, items: [] } }, issues: {} },
    { search: { data: { total_count: 0, incomplete_results: false, items: [] } }, issues: { ok: false } },
  ]) {
    const result = execute("detect", responses, { EVENT_NAME: "schedule" });
    assert.equal(result.status, 1);
    assert.equal(result.output, "");
    assert.doesNotMatch(result.stderr, /test-token|api.github.com/);
  }
});

test("GitHub API failure blocks state heartbeat; mail failure leaves sending claim", () => {
  const env = {
    REASON: "missed", ALERT_KEY: "ecosystem-watchdog-missed-2026-09-21",
    BREVO_API_KEY: "test-token", BREVO_ALERT_EMAIL: "admin@example.test",
  };
  const failed = execute("notify", { search: { ok: false }, issues: {} }, env);
  assert.equal(failed.status, 1);
  assert.match(failed.output, /github_state_failed=true/);
  assert.equal(failed.mail, undefined);
  assert.doesNotMatch(failed.stderr, /test-token|api.github.com/);
  const mailFailed = execute("notify", { issues: {}, email: { ok: false } }, env);
  assert.equal(mailFailed.status, 1);
  assert.match(mailFailed.output, /github_state_ok=true/);
  assert.doesNotMatch(mailFailed.output, /github_state_failed/);
  assert.equal(mailFailed.state.body, "sending");
});

test("email watchdog tidak dikirim ulang bila koneksi Brevo terputus setelah permintaan diterima", async (t) => {
  for (const reason of ["missed", "failed"]) {
    await t.test(reason, () => {
      const env = {
        REASON: reason, ALERT_KEY: `ecosystem-watchdog-${reason}-2026-09-21`,
        BREVO_API_KEY: "transport-test-token", BREVO_ALERT_EMAIL: "transport-admin@example.test",
      };
      const session: { issue?: Issue } = {};
      const responses = {
        search: {}, issuesGET: {}, issuesPOST: {}, issuesPATCH: {},
        email: { throwAfterReceive: true },
      };
      const title = "Ecosystem alert delivery: " + env.ALERT_KEY;
      const lookupRequests = [
        { url: `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:example/project in:title "${title}"`)}&per_page=100&page=1`, method: "GET" },
        { url: "https://api.github.com/repos/example/project" + recentPath, method: "GET" },
      ];
      const persisted = { number: 8, title, body: "sending" };
      const first = execute("notify", responses, env, session);
      assert.equal(first.status, 1, first.stderr);
      assert.deepEqual(first.requests, [
        ...lookupRequests,
        { url: "https://api.github.com/repos/example/project/issues", method: "POST" },
        { url: "https://api.brevo.com/v3/smtp/email", method: "POST" },
      ]);
      assert.deepEqual(first.mail.to, [{ email: env.BREVO_ALERT_EMAIL }],
        "Mock harus merekam penerimaan permintaan sebelum melempar error transport");
      assert.deepEqual(first.state, persisted);
      assert.deepEqual(session.issue, persisted);
      assert.equal(first.stderr.trim(), "Monitor alert email could not be sent.");
      assert.match(first.output, /^github_state_ok=true$/m);
      assert.doesNotMatch(first.output, /github_state_failed=true/);

      const second = execute("notify", responses, env, session);
      assert.equal(second.status, 0, second.stderr);
      assert.deepEqual(second.requests, lookupRequests,
        "Klaim sending harus memblokir pengiriman ulang setelah hasil transport ambigu");
      assert.equal(second.mail, undefined);
      assert.deepEqual(second.state, persisted);
      assert.deepEqual(session.issue, persisted);
      assert.match(second.stdout, /Monitor warning already claimed; no duplicate email/);
      assert.equal(second.stderr, "");
      assert.match(second.output, /^github_state_ok=true$/m);
      assert.doesNotMatch(second.output, /github_state_failed=true/);

      const requests = [...first.requests, ...second.requests];
      assert.equal(requests.filter(request => request.url === "https://api.brevo.com/v3/smtp/email").length, 1);
      assert.equal(requests.filter(request => request.method === "POST" && request.url.endsWith("/issues")).length, 1);
      assert.equal(requests.filter(request => request.method === "PATCH").length, 0);
      const logs = [first, second].map(result => result.stdout + result.stderr + result.output).join("\n");
      assert.doesNotMatch(logs, /Monitor alert email sent\./);
      assert.doesNotMatch(logs, /transport-test-token|test-token|transport-admin@example\.test|Connection reset after receipt/);
    });
  }
});

test("email watchdog tidak dikirim ulang bila PATCH sent gagal setelah Brevo menerima email", async (t) => {
  const scenarios = [
    { name: "PATCH ditolak", patch: { ok: false }, savedBody: "sending" },
    { name: "PATCH tersimpan lalu respons terputus", patch: { throwAfterPersist: true }, savedBody: "sent" },
  ];
  for (const { reason, scenario } of ["missed", "failed"].flatMap(reason =>
    scenarios.map(scenario => ({ reason, scenario })))) {
    await t.test(`${reason}: ${scenario.name}`, () => {
      const env = {
        REASON: reason, ALERT_KEY: `ecosystem-watchdog-${reason}-2026-09-21`,
        BREVO_API_KEY: "test-token", BREVO_ALERT_EMAIL: "admin@example.test",
      };
      const session: { issue?: Issue } = {};
      const responses = {
        search: {},
        issuesGET: {},
        issuesPOST: {},
        issuesPATCH: scenario.patch,
        email: { data: { messageId: "accepted-test-message" } },
      };
      const title = "Ecosystem alert delivery: " + env.ALERT_KEY;
      const lookupRequests = [
        { url: `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:example/project in:title "${title}"`)}&per_page=100&page=1`, method: "GET" },
        { url: "https://api.github.com/repos/example/project" + recentPath, method: "GET" },
      ];
      const first = execute("notify", responses, env, session);
      assert.equal(first.status, 1, first.stderr);
      assert.deepEqual(first.requests, [
        ...lookupRequests,
        { url: "https://api.github.com/repos/example/project/issues", method: "POST" },
        { url: "https://api.brevo.com/v3/smtp/email", method: "POST" },
        { url: "https://api.github.com/repos/example/project/issues/8", method: "PATCH" },
      ]);
      assert.ok(first.mail, "Brevo harus menerima email sebelum PATCH gagal");
      const persisted = { number: 8, title, body: scenario.savedBody };
      assert.deepEqual(first.state, persisted);
      assert.deepEqual(session.issue, persisted);
      // github_state_ok is emitted for the successful claim, not for delivery.
      // The later failure must override it for the workflow heartbeat gate.
      assert.match(first.output, /^github_state_failed=true$/m);
      assert.match(first.stderr, /Monitor alert email could not be sent/);
      assert.doesNotMatch(first.stdout, /Monitor alert email sent\./);
      assert.doesNotMatch(first.stderr, /test-token|admin@example\.test|api\.github\.com|accepted-test-message|Lost response after commit/);

      const second = execute("notify", responses, env, session);
      assert.equal(second.status, 0, second.stderr);
      assert.deepEqual(second.requests, lookupRequests,
        "Eksekusi ulang hanya boleh membaca penanda, tanpa klaim, email, atau PATCH baru");
      assert.equal(second.mail, undefined);
      assert.deepEqual(second.state, persisted);
      assert.deepEqual(session.issue, persisted);
      assert.match(second.stdout, /Monitor warning already claimed; no duplicate email/);
      assert.doesNotMatch(second.stdout, /Monitor alert email sent\./);
      assert.match(second.output, /^github_state_ok=true$/m);
      assert.doesNotMatch(second.output, /github_state_failed=true/);

      const requests = [...first.requests, ...second.requests];
      assert.equal(requests.filter(request => request.url === "https://api.brevo.com/v3/smtp/email").length, 1);
      assert.equal(requests.filter(request => request.method === "POST" && request.url.endsWith("/issues")).length, 1);
      assert.equal(requests.filter(request => request.method === "PATCH").length, 1);
    });
  }
});

test("never claims a missed schedule when GitHub API cannot be queried", () => {
  const result = execute("detect", { runs: { ok: false } }, { EVENT_NAME: "schedule" });
  assert.equal(result.status, 1);
  assert.equal(result.output, "");
  assert.doesNotMatch(result.stderr, /test-token/);
});

test("persists a safe claim, confirms only successful delivery, and fails closed", () => {
  const env = {
    REASON: "missed", ALERT_KEY: "ecosystem-watchdog-missed-2026-09-21",
    BREVO_API_KEY: "test-token", BREVO_ALERT_EMAIL: "admin@example.test",
  };
  const result = execute("notify", { issues: {}, email: {} }, env);
  assert.equal(result.status, 0);
  assert.equal(result.state.body, "sent");
  assert.doesNotMatch(JSON.stringify(result.state), /https?:|test-token|admin@example/);
  assert.match(result.mail.textContent, /belum berjalan sesuai jadwal/);
  assert.doesNotMatch(JSON.stringify(result.mail), /test-token/);
  const failed = execute("notify", { issues: {}, email: { ok: false } }, {
    ...env, REASON: "failed", ALERT_KEY: "ecosystem-watchdog-failed-2026-09-21",
  });
  assert.equal(failed.status, 1);
  assert.equal(failed.state.body, "sending");
  assert.doesNotMatch(failed.stderr, /test-token/);
  const unavailable = execute("notify", { issues: { ok: false }, email: {} }, env);
  assert.equal(unavailable.status, 1);
  assert.equal(unavailable.mail, undefined);
  const existing = execute("notify", {
    issues: { data: [{ number: 8, title: "Ecosystem alert delivery: " + env.ALERT_KEY, body: "sent" }] },
    email: {},
  }, env);
  assert.equal(existing.status, 0);
  assert.equal(existing.mail, undefined);
});

test("watchdog menemukan penanda lama walau daftar issue terkini kosong", () => {
  const env = {
    REASON: "missed", ALERT_KEY: "ecosystem-watchdog-missed-2026-09-21",
    BREVO_API_KEY: "test-token", BREVO_ALERT_EMAIL: "admin@example.test",
  };
  const marker = { number: 4, title: "Ecosystem alert delivery: " + env.ALERT_KEY, body: "sent" };
  const found = execute("notify", {
    search: { data: { total_count: 1, incomplete_results: false, items: [marker] } },
    issues: {}, recent: { data: [] }, email: {},
  }, env);
  assert.equal(found.status, 0);
  assert.equal(found.mail, undefined);
  for (const data of [
    { total_count: 1, incomplete_results: true, items: [] },
    { total_count: 1000, incomplete_results: false, items: [] },
  ]) {
    const failure = execute("notify", { search: { data }, issues: {}, email: {} }, env);
    assert.equal(failure.status, 1);
    assert.equal(failure.mail, undefined);
  }
  const lag = execute("notify", {
    search: { data: { total_count: 0, incomplete_results: false, items: [] } },
    issues: {}, recent: { data: [marker] }, email: {},
  }, env);
  assert.equal(lag.status, 0);
  assert.equal(lag.mail, undefined);
});