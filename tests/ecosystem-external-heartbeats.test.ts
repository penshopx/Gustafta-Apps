import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflows = [
  {
    path: ".github/workflows/ecosystem-link-health.yml",
    secret: "ECOSYSTEM_CHECK_HEARTBEAT_URL",
    cronitorSecret: "ECOSYSTEM_CHECK_CRONITOR_URL",
  },
  {
    path: ".github/workflows/ecosystem-monitor-watchdog.yml",
    secret: "ECOSYSTEM_WATCHDOG_HEARTBEAT_URL",
    cronitorSecret: "ECOSYSTEM_WATCHDOG_CRONITOR_URL",
  },
];

for (const { path, secret, cronitorSecret } of workflows) {
  test(`${path} pings both providers independently on schedule before any other work`, () => {
    const yaml = readFileSync(path, "utf8");
    const steps = [...yaml.matchAll(
      /      - name: Heartbeat scheduled [^\n]+\n        if: ([^\n]+)\n        continue-on-error: true\n        env:\n          HEARTBEAT_URL: ([^\n]+)\n        run: \|\n((?:          .*\n)+)/g,
    )];
    assert.equal(steps.length, 2, "each provider must have its own best-effort step");
    for (const [index, providerSecret] of [secret, cronitorSecret].entries()) {
      assert.equal(steps[index][1], "${{ github.event_name == 'schedule' }}");
      assert.equal(steps[index][2], `\${{ secrets.${providerSecret} }}`);
    }
    if (path.includes("link-health")) {
      assert.ok(yaml.indexOf(steps[1][0]) < yaml.indexOf("      - uses: actions/checkout@v4"));
    } else {
      assert.ok(yaml.indexOf(steps[1][0]) < yaml.indexOf("      - name: Decide whether the monitor needs an alert"),
        "watchdog heartbeat must precede API inspection");
    }

    const folder = mkdtempSync(join(tmpdir(), "ecosystem-heartbeat-"));
    const curl = join(folder, "curl");
    const capture = join(folder, "capture");
    const urls = [
      "https://heartbeat.example.test/secret-should-not-appear",
      "https://cronitor.example.test/other-secret-should-not-appear",
    ];
    try {
      writeFileSync(curl, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$CAPTURE\"\n[ \"$FAIL_CURL\" != 1 ]\n");
      chmodSync(curl, 0o755);
      for (const [index, step] of steps.entries()) {
        const script = step[3].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
        const env = { ...process.env, PATH: `${folder}:${process.env.PATH}`, CAPTURE: capture, HEARTBEAT_URL: urls[index] };
        const sent = spawnSync("bash", ["-c", script], { encoding: "utf8", env });
        assert.equal(sent.status, 0);
        const args = readFileSync(capture, "utf8");
        assert.match(args, /--request\nPOST\n--data\n\n/);
        assert.match(args, /--max-time\n10/);
        assert.ok(args.includes(urls[index]));
        const failed = spawnSync("bash", ["-c", script], {
          encoding: "utf8", env: { ...env, FAIL_CURL: "1" },
        });
        assert.equal(failed.status, 1);
        assert.doesNotMatch(failed.stdout + failed.stderr, /secret-should-not-appear/);
        const missing = spawnSync("bash", ["-c", script], {
          encoding: "utf8", env: { ...env, HEARTBEAT_URL: "" },
        });
        assert.equal(missing.status, 1);
        assert.doesNotMatch(missing.stdout + missing.stderr, /secret-should-not-appear/);
      }
      // GitHub executes the next continue-on-error step even if Healthchecks fails.
      const cronitor = steps[1][3].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
      const independent = spawnSync("bash", ["-c", cronitor], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${folder}:${process.env.PATH}`, CAPTURE: capture, HEARTBEAT_URL: urls[1] },
      });
      assert.equal(independent.status, 0);
      assert.ok(readFileSync(capture, "utf8").includes(urls[1]));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
}

test("alert-state heartbeat is separate, scheduled only, and gated on complete GitHub state inspection", () => {
  const yaml = readFileSync(".github/workflows/ecosystem-monitor-watchdog.yml", "utf8");
  const steps = [...yaml.matchAll(
    /      - name: Heartbeat successful alert state check to [^\n]+\n        if: ([^\n]+)\n        continue-on-error: true\n        env:\n          HEARTBEAT_URL: ([^\n]+)\n        run: \|\n((?:          .*\n)+)/g,
  )];
  assert.equal(steps.length, 2);
  for (const [index, secret] of [
    "ECOSYSTEM_ALERT_STATE_HEARTBEAT_URL", "ECOSYSTEM_ALERT_STATE_CRONITOR_URL",
  ].entries()) {
    const condition = steps[index][1];
    assert.match(condition, /always\(\)/);
    assert.match(condition, /github\.event_name == 'schedule'/);
    assert.match(condition, /steps\.detect\.outcome == 'success'/);
    assert.match(condition, /checker_state_blocked != 'true'/);
    assert.match(condition, /github_state_ok == 'true'/);
    assert.match(condition, /github_state_failed != 'true'/);
    assert.equal(steps[index][2], `\${{ secrets.${secret} }}`);
    assert.ok(yaml.indexOf(steps[index][0]) > yaml.indexOf("      - name: Notify operational email of monitor failure"));
    const script = steps[index][3].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
    assert.match(script, /--request POST --data '' "\$HEARTBEAT_URL"/);
    assert.match(script, /> \/dev\/null 2>&1/);
  }
  const guide = readFileSync("docs/ecosystem-external-heartbeats.md", "utf8");
  assert.match(guide, /grace \*\*21 jam\*\*/);
  for (const secret of ["ECOSYSTEM_ALERT_STATE_HEARTBEAT_URL", "ECOSYSTEM_ALERT_STATE_CRONITOR_URL"]) {
    assert.ok(guide.includes(secret));
  }
});

test("external setup specifies two distinct cron checks and a bounded alert rate", () => {
  const guide = readFileSync("docs/ecosystem-external-heartbeats.md", "utf8");
  assert.match(guide, /Healthchecks\.io/);
  assert.match(guide, /`17 2 \* \* \*` \| UTC \| 6 jam/);
  assert.match(guide, /`31 10,18 \* \* \*` \| UTC \| 5 jam/);
  assert.match(guide, /nonaktifkan \*\*hourly\/daily reminders\*\*/);
  for (const { secret } of workflows) assert.ok(guide.includes(secret));
  assert.match(guide, /Email\*\* dan \*\*Telegram\*\* sama-sama \*\*ON pada masing-masing dari dua/);
  assert.match(guide, /empat tanda ON/);
  assert.match(guide, /Uji ulang setiap bulan/);
  assert.match(guide, /benar-benar menerima \*\*dua\*\* pesan down/);
  assert.match(guide, /Hapus check uji setelah verifikasi/);
  assert.match(guide, /Jangan kirim hasil pemeriksaan, URL aplikasi, maupun secret/);
  assert.match(guide, /Cronitor/);
  assert.match(guide, /menerima\*\*\s+satu pesan/);
  assert.match(guide, /Segera hapus monitor uji/);
  for (const { path, cronitorSecret } of workflows) {
    const yaml = readFileSync(path, "utf8");
    assert.match(yaml, /both Email and Telegram|both Email and Telegram for this separate check/);
    assert.ok(guide.includes(cronitorSecret));
  }
});

test("production alert-state deadlines cover both UTC slots and calendar rollovers (offline model only)", async (t) => {
  const guide = readFileSync("docs/ecosystem-external-heartbeats.md", "utf8");
  const section = guide.split("## Check terpisah untuk jalur status peringatan GitHub")[1]
    ?.split("### Uji terkontrol:")[0];
  assert.ok(section, "read the alert-state policy, not the separate 5-hour schedule heartbeat");
  const policy = section.match(/`([^`]+)` UTC dengan grace \*\*(\d+) jam\*\*/);
  assert.ok(policy, "the documented production cron and grace must be explicit");
  const [, cron, graceHours] = policy;
  assert.equal(cron, "31 10,18 * * *");
  assert.equal(Number(graceHours), 21);

  const workflow = readFileSync(".github/workflows/ecosystem-monitor-watchdog.yml", "utf8");
  const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));
  const configuredCrons = [...triggers.matchAll(/^\s+- cron:\s*["']([^"']+)["']/gm)];
  if (/^\s{2}schedule:/m.test(triggers)) {
    assert.deepEqual(configuredCrons.map(match => match[1]), [cron],
      "an enabled watchdog schedule must match the documented production policy");
  } else {
    // Schedules are intentionally disabled in the current draft. Do not enable
    // them to run this model, or mistake the documented policy for a live check.
    assert.match(triggers, /Both scheduled and downstream workflow triggers intentionally disabled/);
    assert.match(triggers, /workflow_dispatch:/);
    assert.match(triggers, /allow_operational_run:[\s\S]*?default: false/);
    assert.equal(configuredCrons.length, 0);
  }

  const [minute, hours, day, month, weekday] = cron.split(" ");
  assert.deepEqual([day, month, weekday], ["*", "*", "*"]);
  const graceMs = Number(graceHours) * 60 * 60 * 1000;
  // Only model the documented daily UTC cron shape; no provider, wall clock,
  // network, timezone-dependent Date methods, or fixed 8/12/16-hour interval.
  function nextSlots(lastPing: number): number[] {
    const slots: number[] = [];
    const date = new Date(lastPing);
    for (let offset = 0; slots.length < 3; offset++) {
      for (const hour of hours.split(",").map(Number).sort((a, b) => a - b)) {
        const slot = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(),
          date.getUTCDate() + offset, hour, Number(minute));
        if (slot > lastPing) slots.push(slot);
      }
    }
    return slots.slice(0, 3);
  }

  const cases = [
    {
      lastPing: "2026-10-14T10:31:00.000Z",
      missed: ["2026-10-14T18:31:00.000Z", "2026-10-15T10:31:00.000Z", "2026-10-15T18:31:00.000Z"],
      deadline: "2026-10-15T15:31:00.000Z",
      elapsedHours: 29,
    },
    {
      lastPing: "2026-10-14T18:31:00.000Z",
      missed: ["2026-10-15T10:31:00.000Z", "2026-10-15T18:31:00.000Z", "2026-10-16T10:31:00.000Z"],
      deadline: "2026-10-16T07:31:00.000Z",
      elapsedHours: 37,
    },
    {
      lastPing: "2026-12-31T10:31:00.000Z",
      missed: ["2026-12-31T18:31:00.000Z", "2027-01-01T10:31:00.000Z", "2027-01-01T18:31:00.000Z"],
      deadline: "2027-01-01T15:31:00.000Z",
      elapsedHours: 29,
    },
    {
      lastPing: "2026-12-31T18:31:00.000Z",
      missed: ["2027-01-01T10:31:00.000Z", "2027-01-01T18:31:00.000Z", "2027-01-02T10:31:00.000Z"],
      deadline: "2027-01-02T07:31:00.000Z",
      elapsedHours: 37,
    },
  ];
  for (const scenario of cases) {
    await t.test(`last successful ping ${scenario.lastPing}`, () => {
      const lastPing = Date.parse(scenario.lastPing);
      const slots = nextSlots(lastPing);
      assert.deepEqual(slots.map(slot => new Date(slot).toISOString()), scenario.missed);
      const [firstMissed, secondMissed, thirdSlot] = slots;
      // Cron grace starts at the next expected ping, NOT at the last success.
      const downDeadline = firstMissed + graceMs;
      assert.equal(new Date(downDeadline).toISOString(), scenario.deadline);
      assert.equal((downDeadline - lastPing) / 3_600_000, scenario.elapsedHours);
      assert.ok(secondMissed < downDeadline, "two slots must be missed before expiry");
      assert.ok(downDeadline < thirdSlot, "expiry must not wait for a third missed slot");
      const isDown = (now: number) => now >= downDeadline;
      assert.equal(isDown(firstMissed + 1), false, "one missed slot is still within grace");
      assert.equal(isDown(secondMissed - 1), false, "one missed slot must stay up until the second");
      assert.equal(isDown(secondMissed + 1), false, "the second miss does not skip remaining grace");
      assert.equal(isDown(downDeadline - 1), false, "do not expire early");
      assert.equal(isDown(downDeadline), true, "local deadline boundary");
      assert.equal(isDown(downDeadline + 1), true);
      assert.equal(isDown(thirdSlot - 1), true, "already down before the third opportunity");
    });
  }
  // This proves schedule arithmetic only, not live configuration, provider
  // timer transitions, notification delivery, or human receipt.
});

test("accelerated alert-state drill expires after two missed slots, before the third", () => {
  // Model cron deadlines, not provider delivery: real receipt needs an operator.
  const intervalSeconds = 120;
  const graceSeconds = 180;
  const initialPingSeconds = 5; // just after an even UTC minute
  const firstMissedSlot = intervalSeconds;
  const secondMissedSlot = 2 * intervalSeconds;
  const thirdSlot = 3 * intervalSeconds;
  const downDeadline = firstMissedSlot + graceSeconds;
  assert.ok(initialPingSeconds < firstMissedSlot);
  assert.ok(downDeadline > secondMissedSlot);
  assert.ok(downDeadline < thirdSlot);

  const guide = readFileSync("docs/ecosystem-external-heartbeats.md", "utf8");
  const drill = guide.split("### Uji terkontrol: dua kesempatan gagal dan pemulihan")[1]
    ?.split("**28 September 2026")[0];
  assert.ok(drill, "a dedicated live drill is required");
  assert.match(drill, /`\*\/2 \* \* \* \*`, timezone UTC, grace \*\*3 menit\*\* \(180 detik\)/);
  assert.match(drill, /12:02[\s\S]*12:04[\s\S]*12:05[\s\S]*12:06/);
  assert.match(drill, /satu pesan down per kanal/);
  assert.match(drill, /satu ping kosong pemulihan/);
  assert.match(drill, /satu pesan pemulihan per kanal/);
  assert.match(drill, /Hapus check\/monitor sementara/);
  assert.match(drill, /Jangan mengubah atau mematikan check produksi/);
  assert.match(drill, /menghapus issue GitHub, atau mengirim ulang/);
  assert.match(drill, /Jangan catat URL ping, identitas\s+penerima/);
  assert.match(drill, /belum ada konfirmasi operator/);
});