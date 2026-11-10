import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runPageCheck } from "../scripts/check-ecosystem-pages";
import { cleanupOwnedBrowser } from "../scripts/lib/owned-browser-cleanup";

type SignalBehavior = "term-exits" | "kill-exits" | "refused" | "throws" | "error" | "already-exited";
function fakeChild(behavior: SignalBehavior) {
  const emitter = new EventEmitter();
  const signals: NodeJS.Signals[] = [];
  const child = Object.assign(emitter, {
    exitCode: behavior === "already-exited" ? 0 as number | null : null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill(signal: NodeJS.Signals) {
      signals.push(signal);
      if (behavior === "throws") throw new Error("private process arguments");
      if (behavior === "refused") return false;
      if (behavior === "error") {
        queueMicrotask(() => emitter.emit("error", new Error("private process error")));
        return true;
      }
      if (behavior === "term-exits" || signal === "SIGKILL") {
        child.signalCode = signal;
        emitter.emit("exit", null, signal);
      }
      return true;
    },
  });
  return { child, handle: child as unknown as ChildProcess, signals };
}

for (const behavior of ["term-exits", "kill-exits", "refused", "throws", "error", "already-exited"] as const) {
  test(`cleanup proses palsu: ${behavior}, sinyal terbatas dan listener dibersihkan`, { timeout: 2_000 }, async () => {
    const { handle, child, signals } = fakeChild(behavior);
    let disconnects = 0;
    const completed = await cleanupOwnedBrowser({
      disconnect: async () => { disconnects++; },
    }, handle, 10);
    assert.equal(completed, ["term-exits", "kill-exits", "already-exited"].includes(behavior));
    assert.deepEqual(signals, behavior === "already-exited" ? []
      : behavior === "term-exits" ? ["SIGTERM"] : ["SIGTERM", "SIGKILL"]);
    assert.equal(disconnects, 1);
    assert.equal(child.listenerCount("exit"), 0);
    assert.equal(child.listenerCount("error"), 0);
  });
}

test("tanpa handle proses tidak menebak PID atau menghentikan proses lain", async () => {
  let disconnects = 0;
  assert.equal(await cleanupOwnedBrowser({
    disconnect: async () => { disconnects++; },
  }, null, 10), false);
  assert.equal(disconnects, 1);
});

for (const outcome of ["pending", "rejected"] as const) {
  test(`disconnect ${outcome} dibatasi, proses tetap dihentikan dahulu`, { timeout: 2_000 }, async () => {
    const { handle, signals, child } = fakeChild("term-exits");
    let rejectLate!: (error: Error) => void;
    const started = performance.now();
    const completed = await cleanupOwnedBrowser({
      disconnect: () => outcome === "rejected"
        ? Promise.reject(new Error("private transport error"))
        : new Promise<void>((_resolve, reject) => { rejectLate = reject; }),
    }, handle, 10);
    assert.equal(completed, false);
    assert.ok(performance.now() - started < 1_000);
    assert.deepEqual(signals, ["SIGTERM"]);
    assert.equal(child.listenerCount("exit"), 0);
    if (outcome === "pending") {
      rejectLate(new Error("private late transport error"));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
}

async function withReportFixture(
  run: (paths: { report: string; marker: string; network: string; complete: string; original: string; errors: string[] }) => Promise<void>,
) {
  const dir = mkdtempSync(join(tmpdir(), "ecosystem-owned-cleanup-"));
  const paths = {
    report: join(dir, "report.json"),
    marker: join(dir, "browser-unavailable"),
    network: join(dir, "network-unavailable"),
    complete: join(dir, "pages-complete"),
    original: JSON.stringify(["Sistem Informasi Proyek: HTTP 503"]),
    errors: [] as string[],
  };
  writeFileSync(paths.report, paths.original);
  const env = [
    ["ECOSYSTEM_HEALTH_REPORT", paths.report],
    ["ECOSYSTEM_BROWSER_UNAVAILABLE", paths.marker],
    ["ECOSYSTEM_NETWORK_UNAVAILABLE", paths.network],
    ["ECOSYSTEM_PAGES_COMPLETE", paths.complete],
  ] as const;
  const previousEnv = env.map(([key]) => [key, process.env[key]] as const);
  const previousExit = process.exitCode;
  const previousError = console.error;
  try {
    for (const [key, value] of env) process.env[key] = value;
    process.exitCode = 0;
    console.error = (...args: unknown[]) => { paths.errors.push(args.join(" ")); };
    await run(paths);
  } finally {
    console.error = previousError;
    process.exitCode = previousExit;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const scenario of [
  "tab-close-stuck", "browser-close-stuck", "both-close-stuck", "disconnected",
  "returned-but-alive", "already-exited", "cannot-signal", "missing-process",
  "disconnect-stuck", "disconnect-rejects", "healthy", "healthy-disconnected",
  "crashed-disconnected", "sigterm-disconnected", "sigkill-disconnected",
  "missing-process-disconnected",
] as const) {
  test(`checker hanya membersihkan child miliknya: ${scenario}`, { timeout: 2_000 }, async (t) => {
    const pidKill = t.mock.method(process, "kill", () => {
      throw new Error("must not signal a guessed PID");
    });
    await withReportFixture(async ({ report, marker, network, complete, original, errors }) => {
      const { child, handle, signals } = fakeChild(scenario === "already-exited"
        ? "already-exited" : scenario === "cannot-signal" ? "refused" : "kill-exits");
      let connected = true;
      let opened = 0;
      let processReads = 0;
      let pidReads = 0;
      let disconnects = 0;
      let browserCloseCalls = 0;
      Object.defineProperty(child, "pid", { get: () => { pidReads++; return 12345; } });
      const browser = {
        isConnected: () => connected,
        process: () => {
          processReads++;
          return ["missing-process", "missing-process-disconnected"].includes(scenario) ? null : handle;
        },
        newPage: async () => {
          const index = ++opened;
          if (scenario === "disconnected" && index === 2) {
            connected = false;
            throw new Error("private disconnected transport");
          }
          return {
            goto: async () => ({ status: () => 503 }),
            close: async () => {
              if (index === 2 && ["tab-close-stuck", "both-close-stuck"].includes(scenario)) {
                await new Promise<void>(() => {});
              }
            },
          };
        },
        close: async () => {
          browserCloseCalls++;
          if (scenario === "healthy") { child.exitCode = 0; return; }
          if (scenario === "healthy-disconnected" || scenario === "crashed-disconnected") {
            assert.equal(connected, true);
            connected = false;
            child.exitCode = scenario === "healthy-disconnected" ? 0 : 1;
            return;
          }
          if (["sigterm-disconnected", "sigkill-disconnected", "missing-process-disconnected"].includes(scenario)) {
            assert.equal(connected, true, "transport must be connected before close");
            connected = false;
            child.signalCode = scenario === "sigterm-disconnected" ? "SIGTERM"
              : scenario === "sigkill-disconnected" ? "SIGKILL" : null;
            assert.equal(child.exitCode, null, "no clean exit evidence despite resolved close");
            return;
          }
          if (["tab-close-stuck", "returned-but-alive"].includes(scenario)) return;
          await new Promise<void>(() => {});
        },
        disconnect: async () => {
          disconnects++;
          if (scenario === "disconnect-stuck") await new Promise<void>(() => {});
          if (scenario === "disconnect-rejects") throw new Error("private disconnect failure");
          connected = false;
        },
      } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;
      let launches = 0;
      const started = performance.now();
      await runPageCheck(undefined, {
        launchBrowser: async () => { launches++; return browser; },
        openTimeoutMs: 20, closeTimeoutMs: 20, cleanupTimeoutMs: 10,
      });
      assert.ok(performance.now() - started < 1_000, "emergency cleanup must not hang");
      assert.equal(launches, 1);
      assert.equal(processReads, 1, "capture the exact child only once");
      assert.equal(pidReads, 0, "never discover a PID instead of using the owned handle");
      assert.equal(pidKill.mock.callCount(), 0, "never send a signal by PID");
      assert.ok(opened > 1, "page failures must exist before shutdown rejects their publication");
      assert.equal(browserCloseCalls, scenario === "disconnected" ? 0 : 1);
      assert.equal(disconnects, ["healthy", "healthy-disconnected"].includes(scenario) ? 0 : 1);
      assert.deepEqual(signals, [
        "healthy", "healthy-disconnected", "crashed-disconnected", "already-exited",
        "missing-process", "sigterm-disconnected", "sigkill-disconnected", "missing-process-disconnected",
      ].includes(scenario)
        ? [] : ["SIGTERM", "SIGKILL"]);
      assert.equal(child.listenerCount("exit"), 0);
      assert.equal(child.listenerCount("error"), 0);
      assert.equal(existsSync(network), false);
      assert.equal(process.exitCode, 1); // Even the healthy browser observed HTTP 503.
      if (scenario === "healthy" || scenario === "healthy-disconnected") {
        assert.equal(existsSync(marker), false);
        assert.equal(readFileSync(complete, "utf8"), "ok");
      } else {
        assert.equal(readFileSync(report, "utf8"), original);
        assert.equal(readFileSync(marker, "utf8"), "unavailable");
        assert.equal(existsSync(complete), false);
        assert.match(errors.join("\n"), /browser pemeriksa tidak tersedia/);
        assert.doesNotMatch(errors.join("\n"), /private|https?:\/\//);
        if (["cannot-signal", "missing-process", "missing-process-disconnected", "disconnect-stuck", "disconnect-rejects"].includes(scenario)) {
          assert.match(errors.join("\n"), /Pembersihan browser pemeriksa tidak dapat dipastikan selesai/);
        }
      }
    });
  });
}

for (const failure of ["close-timeout", "disconnected", "close-sigterm", "close-sigkill", "close-missing-process"] as const) {
  test(`browser override (${failure}) tidak dicari prosesnya, disinyal atau diputus paksa`, { timeout: 2_000 }, async (t) => {
    const pidKill = t.mock.method(process, "kill", () => {
      throw new Error("must not signal an external PID");
    });
    await withReportFixture(async ({ report, marker, network, complete, original }) => {
      const { child, handle, signals } = fakeChild("term-exits");
      let connected = true;
      let opened = 0;
      let processReads = 0;
      let pidReads = 0;
      let disconnects = 0;
      let launches = 0;
      let browserCloseCalls = 0;
      Object.defineProperty(child, "pid", { get: () => { pidReads++; return 12345; } });
      const browser = {
        isConnected: () => connected,
        process: () => { processReads++; return failure === "close-missing-process" ? null : handle; },
        newPage: async () => {
          if (++opened === 2 && failure === "disconnected") {
            connected = false;
            throw new Error("private external transport");
          }
          return {
            goto: async () => ({ status: () => 503 }),
            close: async () => {},
          };
        },
        close: async () => {
          browserCloseCalls++;
          assert.equal(connected, true, "override must still be connected before close");
          if (failure === "close-timeout") await new Promise<void>(() => {});
          connected = false;
          child.signalCode = failure === "close-sigterm" ? "SIGTERM"
            : failure === "close-sigkill" ? "SIGKILL" : null;
          assert.equal(child.exitCode, null);
        },
        disconnect: async () => { disconnects++; },
      } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;
      await runPageCheck(browser, {
        launchBrowser: async () => { launches++; throw new Error("must not launch"); },
        closeTimeoutMs: 20, cleanupTimeoutMs: 10,
      });
      assert.equal(launches, 0);
      assert.equal(processReads, 0);
      assert.equal(pidReads, 0);
      assert.equal(pidKill.mock.callCount(), 0);
      assert.equal(browserCloseCalls, failure === "disconnected" ? 0 : 1);
      assert.ok(opened > 1, "partial page failures must not replace the previous report");
      assert.equal(disconnects, 0);
      assert.deepEqual(signals, []);
      assert.equal(readFileSync(report, "utf8"), original);
      assert.equal(readFileSync(marker, "utf8"), "unavailable");
      assert.equal(existsSync(network), false);
      assert.equal(existsSync(complete), false);
      assert.equal(process.exitCode, 1);
    });
  });
}

test("sinyal OS hanya menghentikan child fixture milik pemeriksa, bukan proses tetangga", {
  timeout: 5_000,
  skip: process.platform === "win32",
}, async () => {
  const children: ChildProcess[] = [];
  const launchFixture = async () => {
    const child = spawn(process.execPath, ["-e", `
      process.on("SIGTERM", () => {});
      process.stdout.write("ready\\n");
      setInterval(() => {}, 1000);
    `], { stdio: ["ignore", "pipe", "ignore"] });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("fixture startup timed out")), 2_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        child.stdout!.removeListener("data", onData);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        if (error) reject(error);
        else resolve();
      };
      const onData = (data: Buffer) => {
        if (data.toString().includes("ready")) finish();
      };
      const onError = (error: Error) => finish(error);
      const onExit = () => finish(new Error("fixture exited before ready"));
      child.stdout!.on("data", onData);
      child.once("error", onError);
      child.once("exit", onExit);
    });
    return child;
  };
  try {
    const owned = await launchFixture();
    const other = await launchFixture();
    let disconnects = 0;
    assert.equal(await cleanupOwnedBrowser({
      disconnect: async () => { disconnects++; },
    }, owned, 100), true);
    assert.equal(owned.signalCode, "SIGKILL", "fixture ignores SIGTERM and needs escalation");
    assert.equal(disconnects, 1);
    assert.equal(other.exitCode, null);
    assert.equal(other.signalCode, null, "unrelated fixture must remain alive");
  } finally {
    // These handles belong only to this test; no PID/name/group discovery.
    for (const child of children) {
      await cleanupOwnedBrowser({ disconnect: async () => {} }, child, 100);
    }
  }
});
