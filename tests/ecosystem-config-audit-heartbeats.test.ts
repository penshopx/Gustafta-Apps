import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const workflow = readFileSync(".github/workflows/ecosystem-cronitor-config-audit.yml", "utf8");
const guide = readFileSync("docs/ecosystem-external-heartbeats.md", "utf8");
const heartbeatSteps = [...workflow.matchAll(
  /      - name: Heartbeat scheduled configuration audit to ([^\n]+)\n        if: ([^\n]+)\n        continue-on-error: true\n        env:\n          HEARTBEAT_URL: ([^\n]+)\n        run: \|\n((?:          .*\n)+)/g,
)];
const secrets = ["ECOSYSTEM_CONFIG_AUDIT_HEARTBEAT_URL", "ECOSYSTEM_CONFIG_AUDIT_CRONITOR_URL"];
const gate = "${{ github.event_name == 'schedule' && vars.ECOSYSTEM_CONFIG_AUDIT_HEARTBEATS_ENABLED == 'true' }}";

function enabled(condition: string, event: string, approval?: string): boolean {
  assert.ok(condition.startsWith("${{ ") && condition.endsWith(" }}"));
  return runInNewContext(condition.slice(4, -3), {
    github: { event_name: event },
    vars: { ECOSYSTEM_CONFIG_AUDIT_HEARTBEATS_ENABLED: approval },
  }) === true;
}

test("audit uses two dedicated entry heartbeats and never reuses other workflow timers", () => {
  assert.equal(heartbeatSteps.length, 2);
  for (const [index, step] of heartbeatSteps.entries()) {
    assert.equal(step[1], index === 0 ? "Healthchecks" : "Cronitor");
    assert.equal(step[2], gate);
    assert.equal(step[3], `\${{ secrets.${secrets[index]} }}`);
    assert.ok(workflow.indexOf(step[0]) < workflow.indexOf("      - uses: actions/checkout@v4"));
    assert.ok(guide.includes(secrets[index]));
  }
  assert.doesNotMatch(workflow, /secrets\.ECOSYSTEM_(CHECK|WATCHDOG|ALERT_STATE)_(HEARTBEAT|CRONITOR)_URL/);
  for (const path of ["ecosystem-link-health", "ecosystem-monitor-watchdog"]) {
    const other = readFileSync(`.github/workflows/${path}.yml`, "utf8");
    for (const secret of secrets) assert.ok(!other.includes(secret));
  }
  // No additional untested ping entry point or fail telemetry.
  assert.equal((workflow.match(/--request POST/g) || []).length, 2);
  assert.doesNotMatch(workflow, /state=fail|\/fail\b/);
});

test("event and explicit approval gates prevent manual, downstream and unapproved pings", () => {
  assert.equal(heartbeatSteps.length, 2);
  const alertCondition = workflow.match(/- name: Notify operator[^\n]+\n        if: ([^\n]+)/)?.[1];
  assert.ok(alertCondition);
  for (const event of ["schedule", "workflow_dispatch", "workflow_run", "push", "pull_request", ""]) {
    for (const approval of [undefined, "", "false", "TRUE", "true"]) {
      for (const step of heartbeatSteps) {
        assert.equal(enabled(step[2], event, approval), event === "schedule" && approval === "true");
      }
    }
    // Exercise the actual alert expression with both a healthy and failed audit.
    for (const outcome of ["success", "failure", "skipped"]) {
      const result = runInNewContext(alertCondition.slice(4, -3), {
        always: () => true,
        github: { event_name: event },
        steps: { audit: { outcome }, healthchecks: { outcome } },
      });
      assert.equal(result, event === "schedule" && outcome !== "success");
    }
  }
});

test("real workflow shell sends empty bounded POSTs privately and provider failures are independent", () => {
  assert.equal(heartbeatSteps.length, 2);
  const folder = mkdtempSync(join(tmpdir(), "audit-heartbeat-"));
  const capture = join(folder, "capture");
  try {
    const curl = join(folder, "curl");
    // Capture fake credentials locally only; malicious error output must be hidden.
    writeFileSync(curl, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$CAPTURE"\necho "private-provider-response" >&2\n[ "$FAIL_CURL" != 1 ]\n');
    chmodSync(curl, 0o755);
    const run = (step: RegExpMatchArray, url: string, fail = false) =>
      spawnSync("bash", ["-e", "-c", step[4].replace(/^ {10}/gm, "")], {
        encoding: "utf8",
        // Do not inherit credentials, NODE_OPTIONS or live service settings.
        env: { PATH: `${folder}:${process.env.PATH}`, CAPTURE: capture, HEARTBEAT_URL: url, FAIL_CURL: fail ? "1" : "0" },
      });
    for (const [index, step] of heartbeatSteps.entries()) {
      const url = `https://provider-${index}.example.test/private-token`;
      for (const fail of [false, true]) {
        rmSync(capture, { force: true });
        const result = run(step, url, fail);
        assert.equal(result.status, fail ? 1 : 0);
        assert.doesNotMatch(result.stdout + result.stderr, /private-|https:/);
        const args = readFileSync(capture, "utf8");
        assert.match(args, /--request\nPOST\n--data\n\n/);
        assert.match(args, /--max-time\n10\n--retry\n2/);
        assert.ok(args.endsWith(`${url}\n`));
        assert.doesNotMatch(args, /--location|--verbose|--trace/);
      }
      rmSync(capture, { force: true });
      assert.equal(run(step, "").status, 1);
      assert.equal(existsSync(capture), false, "missing secret must not invoke curl");
    }
    // Test either provider failing while the other still sends.
    for (const failed of [0, 1]) {
      for (const [index, step] of heartbeatSteps.entries()) {
        assert.equal(run(step, `https://provider-${index}.example.test/private-token`, index === failed).status,
          index === failed ? 1 : 0);
      }
    }
    // Apply the real event gate before the real shell, including approved manual runs.
    for (const event of ["workflow_dispatch", "workflow_run"]) {
      rmSync(capture, { force: true });
      for (const step of heartbeatSteps) {
        if (enabled(step[2], event, "true")) run(step, "https://example.test/private-token");
      }
      assert.equal(existsSync(capture), false);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

const hour = 3600000;
const week = 7 * 24 * hour;
const grace = 24 * hour;
function nextAuditSlot(after: number): number {
  const date = new Date(after);
  date.setUTCHours(7, 13, 0, 0);
  date.setUTCDate(date.getUTCDate() + (1 - date.getUTCDay() + 7) % 7);
  if (date.getTime() <= after) date.setUTCDate(date.getUTCDate() + 7);
  return date.getTime();
}

test("offline external timers expire audit-only and total outages across missed weeks and UTC rollovers", () => {
  assert.match(workflow, /Planned cron: 13 7 \* \* 1 \(UTC\)/);
  for (const provider of ["Healthchecks.io", "Cronitor"]) {
    const row = guide.split("\n").find(line => line.startsWith(`| ${provider} |`) && line.includes("`13 7 * * 1`"));
    assert.ok(row);
    assert.match(row, /UTC \| 24 jam \(86400 detik\)/);
  }
  // Monday before month/year rollover and a leap day, no provider calls.
  for (const firstSlot of ["2026-10-26T07:13:00Z", "2026-12-28T07:13:00Z", "2028-02-28T07:13:00Z"]) {
    const initial = Date.parse(firstSlot) + 1000;
    const missed = nextAuditSlot(initial);
    assert.equal(missed, Date.parse(firstSlot) + week);
    const deadline = missed + grace; // Tuesday 07:13 UTC, not time-since-last-other-ping.
    for (const allStopped of [false, true]) {
      for (const step of heartbeatSteps) {
        // Independent provider clock model keyed by actual workflow secret.
        const timers = new Map<string, number>([[step[3], initial], ["checker", initial], ["watchdog", initial]]);
        const pingAudit = (event: string, at: number) => {
          if (enabled(step[2], event, "true")) timers.set(step[3], at);
        };
        const down = (at: number) => at >= nextAuditSlot(timers.get(step[3])!) + grace;
        for (let now = initial; now < missed + 2 * week; now += hour) {
          if (!allStopped) {
            timers.set("checker", now);
            timers.set("watchdog", now);
          }
          pingAudit("workflow_dispatch", now);
          pingAudit("workflow_run", now);
          assert.equal(down(now), now >= deadline);
        }
        assert.equal(timers.get(step[3]), initial, "other checks and manual events must never reset audit");
        assert.equal(down(deadline - 1), false);
        assert.equal(down(deadline), true);
        assert.equal(down(missed + week + grace), true, "second missed slot remains down");
        const recovery = missed + 2 * week + 1000;
        pingAudit("schedule", recovery);
        assert.equal(down(recovery), false, "only a scheduled audit restores its timer");
        assert.equal(nextAuditSlot(recovery), missed + 3 * week);
      }
    }
  }
});
