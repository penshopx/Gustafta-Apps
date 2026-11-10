import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ISO_ECOSYSTEM_APPS, PROJECT_ECOSYSTEM_APPS } from "../client/src/data/ecosystem-apps";
import { runPageCheck } from "../scripts/check-ecosystem-pages";
import { cleanupOwnedBrowser } from "../scripts/lib/owned-browser-cleanup";

for (const owned of [true, false]) {
  test(`cleanup macet menjaga laporan dan batas kepemilikan (owned=${owned})`, { timeout: 2_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ecosystem-cleanup-ownership-"));
    const report = join(dir, "report.json");
    const marker = join(dir, "browser-unavailable");
    const complete = join(dir, "pages-complete");
    const network = join(dir, "network-unavailable");
    const original = JSON.stringify(["Sistem Informasi Proyek: HTTP 503"]);
    writeFileSync(report, original);
    const env = [
      ["ECOSYSTEM_HEALTH_REPORT", report],
      ["ECOSYSTEM_BROWSER_UNAVAILABLE", marker],
      ["ECOSYSTEM_PAGES_COMPLETE", complete],
      ["ECOSYSTEM_NETWORK_UNAVAILABLE", network],
    ] as const;
    const previousEnv = env.map(([key]) => [key, process.env[key]] as const);
    const previousExit = process.exitCode;
    const previousError = console.error;
    const errors: string[] = [];
    const signals: NodeJS.Signals[] = [];
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      // Even SIGKILL produces no exit event: cleanup must still return.
      kill: (signal: NodeJS.Signals) => { signals.push(signal); return true; },
    });
    let otherKills = 0;
    const unrelated = { kill: () => { otherKills++; } };
    let processReads = 0;
    let disconnects = 0;
    let opened = 0;
    const lateRejections: Array<(error: Error) => void> = [];
    const pending = () => new Promise<void>((_resolve, reject) => { lateRejections.push(reject); });
    const browser = {
      isConnected: () => true,
      process: () => {
        processReads++;
        if (!owned) throw new Error("external process must never be inspected");
        return child as unknown as ChildProcess;
      },
      // An unrelated object is deliberately visible, but not owned.
      unrelated,
      newPage: async () => {
        const index = ++opened;
        return {
          goto: async () => ({ status: () => 503 }),
          close: async () => { if (index === 2) await pending(); },
        };
      },
      close: pending,
      disconnect: async () => { disconnects++; await pending(); },
    } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;
    try {
      for (const [key, value] of env) process.env[key] = value;
      process.exitCode = 0;
      console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
      const started = performance.now();
      await runPageCheck(owned ? undefined : browser, {
        launchBrowser: async () => {
          assert.ok(owned, "override must not launch a browser");
          return browser;
        },
        closeTimeoutMs: 10,
        cleanupTimeoutMs: 30,
      });
      assert.ok(performance.now() - started < 1_000, "all cleanup paths must remain bounded");
      assert.equal(opened, 2);
      assert.equal(processReads, owned ? 1 : 0);
      assert.equal(disconnects, owned ? 1 : 0);
      assert.deepEqual(signals, owned ? ["SIGTERM", "SIGKILL"] : []);
      assert.equal(otherKills, 0);
      assert.equal(child.listenerCount("exit"), 0);
      assert.equal(child.listenerCount("error"), 0);
      assert.equal(readFileSync(report, "utf8"), original);
      assert.equal(readFileSync(marker, "utf8"), "unavailable");
      assert.equal(existsSync(complete), false);
      assert.equal(existsSync(network), false);
      assert.equal(process.exitCode, 1);
      assert.match(errors.join("\n"), /browser pemeriksa tidak tersedia/);
      assert.doesNotMatch(errors.join("\n"), /external|https?:\/\//);
      for (const reject of lateRejections) reject(new Error("private late cleanup failure"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(readFileSync(report, "utf8"), original);
      assert.equal(existsSync(complete), false);
      assert.equal(otherKills, 0);
    } finally {
      console.error = previousError;
      process.exitCode = previousExit;
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("SIGTERM, SIGKILL, dan disconnect berbagi satu anggaran cleanup", { timeout: 2_000 }, async (t) => {
  // Virtual time verifies the budget exactly, without wall-clock CI jitter.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const signals: NodeJS.Signals[] = [];
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    kill: (signal: NodeJS.Signals) => { signals.push(signal); return true; },
  });
  let disconnects = 0;
  let completed = false;
  const cleanup = cleanupOwnedBrowser({
    disconnect: async () => { disconnects++; await new Promise<void>(() => {}); },
  }, child as unknown as ChildProcess, 90).then((result) => { completed = true; return result; });
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  now = 30;
  t.mock.timers.tick(30);
  await flush();
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  now = 60;
  t.mock.timers.tick(30);
  await flush();
  assert.equal(disconnects, 1);
  assert.equal(completed, false);
  now = 90;
  t.mock.timers.tick(30);
  await flush();
  assert.equal(completed, true, "cleanup must finish within 90ms, not three 90ms deadlines");
  assert.equal(await cleanup, false);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("Chrome tidak tersedia tidak menandai aplikasi gagal atau menyelesaikan pemeriksaan halaman", () => {
  const dir = mkdtempSync(join(tmpdir(), "ecosystem-browser-"));
  const report = join(dir, "report.json");
  const marker = join(dir, "browser-unavailable");
  const complete = join(dir, "pages-complete");
  writeFileSync(report, JSON.stringify(["ISO Hub: HTTP 503"]));
  try {
    let output = "";
    try {
      execFileSync("npx", ["tsx", "scripts/check-ecosystem-pages.ts"], {
        env: {
          ...process.env,
          CHROME_PATH: join(dir, "no-such-chrome"),
          ECOSYSTEM_HEALTH_REPORT: report,
          ECOSYSTEM_BROWSER_UNAVAILABLE: marker,
          ECOSYSTEM_PAGES_COMPLETE: complete,
        },
        encoding: "utf8",
        stdio: "pipe",
      });
      assert.fail("Browser yang hilang harus menggagalkan pemeriksaan");
    } catch (error) {
      const result = error as { status?: number; stderr?: string; stdout?: string };
      assert.equal(result.status, 1);
      output = `${result.stderr || ""}${result.stdout || ""}`;
    }
    assert.equal(readFileSync(report, "utf8"), JSON.stringify(["ISO Hub: HTTP 503"]));
    assert.equal(readFileSync(marker, "utf8"), "unavailable");
    assert.equal(existsSync(complete), false);
    assert.match(output, /browser pemeriksa tidak tersedia/);
    assert.doesNotMatch(output, /ISO Hub|https?:\/\/|no-such-chrome/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browser terputus setelah hasil parsial tidak mengirim laporan atau menandai selesai", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecosystem-browser-disconnect-"));
  const report = join(dir, "report.json");
  const marker = join(dir, "browser-unavailable");
  const complete = join(dir, "pages-complete");
  // A different app is already in the link report, so writing the partial
  // ISO Hub result would change the file and fail this assertion.
  const originalReport = JSON.stringify(["Sistem Informasi Proyek: HTTP 503"]);
  writeFileSync(report, originalReport);

  const previous = {
    report: process.env.ECOSYSTEM_HEALTH_REPORT,
    marker: process.env.ECOSYSTEM_BROWSER_UNAVAILABLE,
    complete: process.env.ECOSYSTEM_PAGES_COMPLETE,
    exitCode: process.exitCode,
    consoleError: console.error,
  };
  let connected = true;
  let pagesOpened = 0;
  let pagesClosed = 0;
  const errors: string[] = [];
  // First page yields an app failure; the browser then disconnects while
  // loading the second page. Neither result may be published as a page check.
  const browser = {
    isConnected: () => connected,
    newPage: async () => {
      pagesOpened++;
      const currentPage = pagesOpened;
      return {
        goto: async () => {
          if (currentPage === 2) {
            connected = false;
            throw new Error("Target closed");
          }
          return { status: () => 503 };
        },
        close: async () => { pagesClosed++; },
      };
    },
    close: async () => { throw new Error("disconnected browser must not be closed"); },
  } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;

  try {
    process.env.ECOSYSTEM_HEALTH_REPORT = report;
    process.env.ECOSYSTEM_BROWSER_UNAVAILABLE = marker;
    process.env.ECOSYSTEM_PAGES_COMPLETE = complete;
    process.exitCode = 0;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };

    await runPageCheck(browser);

    assert.equal(pagesOpened, 2);
    assert.equal(pagesClosed, 1);
    assert.equal(readFileSync(report, "utf8"), originalReport);
    assert.equal(readFileSync(marker, "utf8"), "unavailable");
    assert.equal(existsSync(complete), false);
    assert.equal(process.exitCode, 1);
    assert.match(errors.join("\n"), /browser pemeriksa tidak tersedia/);
    assert.doesNotMatch(errors.join("\n"), /ISO Hub|Target closed/);
  } finally {
    console.error = previous.consoleError;
    process.exitCode = previous.exitCode;
    for (const [key, value] of [
      ["ECOSYSTEM_HEALTH_REPORT", previous.report],
      ["ECOSYSTEM_BROWSER_UNAVAILABLE", previous.marker],
      ["ECOSYSTEM_PAGES_COMPLETE", previous.complete],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browser putus di antara pemeriksaan akhir dan penutupan tidak menerbitkan hasil", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecosystem-browser-finally-"));
  const report = join(dir, "report.json");
  const marker = join(dir, "browser-unavailable");
  const complete = join(dir, "pages-complete");
  const originalReport = JSON.stringify(["Sistem Informasi Proyek: HTTP 503"]);
  writeFileSync(report, originalReport);
  const previous = {
    report: process.env.ECOSYSTEM_HEALTH_REPORT,
    marker: process.env.ECOSYSTEM_BROWSER_UNAVAILABLE,
    complete: process.env.ECOSYSTEM_PAGES_COMPLETE,
    exitCode: process.exitCode,
    consoleError: console.error,
  };
  const totalApps = ISO_ECOSYSTEM_APPS.length + PROJECT_ECOSYSTEM_APPS.length;
  let opened = 0;
  let closed = 0;
  let checksAfterLastPage = 0;
  let browserCloseCalls = 0;
  const errors: string[] = [];
  const browser = {
    isConnected: () => {
      if (closed === totalApps) {
        // The loop's final check succeeds; the first check in finally sees
        // the browser disconnect. No partial result should escape.
        return ++checksAfterLastPage === 1;
      }
      return true;
    },
    newPage: async () => {
      opened++;
      return {
        goto: async () => ({ status: () => 503 }),
        close: async () => { closed++; },
      };
    },
    close: async () => { browserCloseCalls++; },
  } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;

  try {
    process.env.ECOSYSTEM_HEALTH_REPORT = report;
    process.env.ECOSYSTEM_BROWSER_UNAVAILABLE = marker;
    process.env.ECOSYSTEM_PAGES_COMPLETE = complete;
    process.exitCode = 0;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };

    await runPageCheck(browser);

    assert.equal(opened, totalApps);
    assert.equal(closed, totalApps);
    assert.equal(checksAfterLastPage, 2);
    assert.equal(browserCloseCalls, 0);
    assert.equal(readFileSync(report, "utf8"), originalReport);
    assert.equal(readFileSync(marker, "utf8"), "unavailable");
    assert.equal(existsSync(complete), false);
    assert.equal(process.exitCode, 1);
    assert.match(errors.join("\n"), /browser pemeriksa tidak tersedia/);
    assert.doesNotMatch(errors.join("\n"), /ISO Hub/);
  } finally {
    console.error = previous.consoleError;
    process.exitCode = previous.exitCode;
    for (const [key, value] of [
      ["ECOSYSTEM_HEALTH_REPORT", previous.report],
      ["ECOSYSTEM_BROWSER_UNAVAILABLE", previous.marker],
      ["ECOSYSTEM_PAGES_COMPLETE", previous.complete],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gagal menutup tab setelah hasil parsial tidak menerbitkan laporan atau penanda selesai", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecosystem-page-close-"));
  const report = join(dir, "report.json");
  const marker = join(dir, "browser-unavailable");
  const network = join(dir, "network-unavailable");
  const complete = join(dir, "pages-complete");
  const originalReport = JSON.stringify(["Sistem Informasi Proyek: HTTP 503"]);
  writeFileSync(report, originalReport);
  const previous = {
    report: process.env.ECOSYSTEM_HEALTH_REPORT,
    marker: process.env.ECOSYSTEM_BROWSER_UNAVAILABLE,
    network: process.env.ECOSYSTEM_NETWORK_UNAVAILABLE,
    complete: process.env.ECOSYSTEM_PAGES_COMPLETE,
    exitCode: process.exitCode,
    consoleError: console.error,
  };
  let opened = 0;
  let closeAttempts = 0;
  let browserCloseCalls = 0;
  const errors: string[] = [];
  // Both pages return a proven app failure without touching the network.
  // Closing the second tab fails while the browser is still connected.
  const browser = {
    isConnected: () => true,
    newPage: async () => {
      opened++;
      const index = opened;
      return {
        goto: async () => ({ status: () => 503 }),
        close: async () => {
          closeAttempts++;
          if (index === 2) throw new Error("Target closed while closing tab");
        },
      };
    },
    close: async () => { browserCloseCalls++; },
  } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;

  try {
    process.env.ECOSYSTEM_HEALTH_REPORT = report;
    process.env.ECOSYSTEM_BROWSER_UNAVAILABLE = marker;
    process.env.ECOSYSTEM_NETWORK_UNAVAILABLE = network;
    process.env.ECOSYSTEM_PAGES_COMPLETE = complete;
    process.exitCode = 0;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };

    await runPageCheck(browser);

    assert.equal(opened, 2);
    assert.equal(closeAttempts, 2);
    assert.equal(browserCloseCalls, 1);
    assert.equal(readFileSync(report, "utf8"), originalReport);
    assert.equal(readFileSync(marker, "utf8"), "unavailable");
    assert.equal(existsSync(network), false);
    assert.equal(existsSync(complete), false);
    assert.equal(process.exitCode, 1);
    assert.match(errors.join("\n"), /browser pemeriksa tidak tersedia/);
    assert.doesNotMatch(errors.join("\n"), /ISO Hub|Target closed/);
  } finally {
    console.error = previous.consoleError;
    process.exitCode = previous.exitCode;
    for (const [key, value] of [
      ["ECOSYSTEM_HEALTH_REPORT", previous.report],
      ["ECOSYSTEM_BROWSER_UNAVAILABLE", previous.marker],
      ["ECOSYSTEM_NETWORK_UNAVAILABLE", previous.network],
      ["ECOSYSTEM_PAGES_COMPLETE", previous.complete],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const stuckAt of ["page", "browser", "both"] as const) {
  test(`penutupan ${stuckAt} yang tidak selesai dibatasi tanpa menerbitkan hasil parsial`, { timeout: 2_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), `ecosystem-close-timeout-${stuckAt}-`));
    const report = join(dir, "report.json");
    const marker = join(dir, "browser-unavailable");
    const network = join(dir, "network-unavailable");
    const complete = join(dir, "pages-complete");
    const originalReport = JSON.stringify(["Sistem Informasi Proyek: HTTP 503"]);
    writeFileSync(report, originalReport);
    const previous = {
      report: process.env.ECOSYSTEM_HEALTH_REPORT,
      marker: process.env.ECOSYSTEM_BROWSER_UNAVAILABLE,
      network: process.env.ECOSYSTEM_NETWORK_UNAVAILABLE,
      complete: process.env.ECOSYSTEM_PAGES_COMPLETE,
      exitCode: process.exitCode,
      consoleError: console.error,
    };
    let opened = 0;
    let pageCloseCalls = 0;
    let browserCloseCalls = 0;
    const errors: string[] = [];
    const lateRejections: Array<(error: Error) => void> = [];
    // No HTTP or real browser: every page produces a proven failure, then
    // the second tab and/or browser cleanup remain pending indefinitely.
    const neverCloses = () => new Promise<void>((_resolve, reject) => {
      lateRejections.push(reject);
    });
    const browser = {
      isConnected: () => true,
      newPage: async () => {
        const index = ++opened;
        return {
          goto: async () => ({ status: () => 503 }),
          close: async () => {
            pageCloseCalls++;
            if (index === 2 && stuckAt !== "browser") await neverCloses();
          },
        };
      },
      close: async () => {
        browserCloseCalls++;
        if (stuckAt !== "page") await neverCloses();
      },
    } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;
    try {
      process.env.ECOSYSTEM_HEALTH_REPORT = report;
      process.env.ECOSYSTEM_BROWSER_UNAVAILABLE = marker;
      process.env.ECOSYSTEM_NETWORK_UNAVAILABLE = network;
      process.env.ECOSYSTEM_PAGES_COMPLETE = complete;
      process.exitCode = 0;
      console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
      const started = performance.now();

      await runPageCheck(browser, { closeTimeoutMs: 20 });

      assert.ok(performance.now() - started < 1_000, "close deadline must bound the entire cleanup");
      const expectedPages = stuckAt === "browser"
        ? ISO_ECOSYSTEM_APPS.length + PROJECT_ECOSYSTEM_APPS.length
        : 2;
      assert.equal(opened, expectedPages);
      assert.equal(pageCloseCalls, expectedPages);
      assert.equal(browserCloseCalls, 1);
      assert.equal(readFileSync(report, "utf8"), originalReport);
      assert.equal(readFileSync(marker, "utf8"), "unavailable");
      assert.equal(existsSync(network), false);
      assert.equal(existsSync(complete), false);
      assert.equal(process.exitCode, 1);
      assert.match(errors.join("\n"), /browser pemeriksa tidak tersedia/);
      assert.doesNotMatch(errors.join("\n"), /ISO Hub|https?:\/\//);
      // A late rejection after the deadline must stay handled, without
      // unhandledRejection or delayed writes to the report/completion marker.
      for (const reject of lateRejections) reject(new Error("late close rejection"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(readFileSync(report, "utf8"), originalReport);
      assert.equal(existsSync(complete), false);
    } finally {
      console.error = previous.consoleError;
      process.exitCode = previous.exitCode;
      for (const [key, value] of [
        ["ECOSYSTEM_HEALTH_REPORT", previous.report],
        ["ECOSYSTEM_BROWSER_UNAVAILABLE", previous.marker],
        ["ECOSYSTEM_NETWORK_UNAVAILABLE", previous.network],
        ["ECOSYSTEM_PAGES_COMPLETE", previous.complete],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const stuckAt of [1, 2] as const)
for (const outcome of ["never", "late-page", "late-page-close-hangs", "late-page-close-rejects", "late-rejection"] as const) {
  test(`pembukaan tab ke-${stuckAt} macet (${outcome}) tidak menerbitkan hasil awal atau hasil terlambat`, { timeout: 2_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), `ecosystem-open-timeout-${stuckAt}-${outcome}-`));
    const report = join(dir, "report.json");
    const marker = join(dir, "browser-unavailable");
    const network = join(dir, "network-unavailable");
    const complete = join(dir, "pages-complete");
    const originalReport = JSON.stringify(["Sistem Informasi Proyek: HTTP 503"]);
    writeFileSync(report, originalReport);
    const previous = {
      report: process.env.ECOSYSTEM_HEALTH_REPORT,
      marker: process.env.ECOSYSTEM_BROWSER_UNAVAILABLE,
      network: process.env.ECOSYSTEM_NETWORK_UNAVAILABLE,
      complete: process.env.ECOSYSTEM_PAGES_COMPLETE,
      exitCode: process.exitCode,
      consoleError: console.error,
    };
    let opened = 0;
    let navigations = 0;
    let pageCloseCalls = 0;
    let browserCloseCalls = 0;
    const errors: string[] = [];
    const latePage = {
      goto: async () => { navigations++; return { status: () => 503 }; },
      close: async () => {
        pageCloseCalls++;
        if (outcome === "late-page-close-hangs") await new Promise<void>(() => {});
        if (outcome === "late-page-close-rejects") throw new Error("late private close failure");
      },
    };
    let resolveOpening!: (page: typeof latePage) => void;
    let rejectOpening!: (error: Error) => void;
    const opening = new Promise<typeof latePage>((resolve, reject) => {
      resolveOpening = resolve;
      rejectOpening = reject;
    });
    const browser = {
      isConnected: () => true,
      newPage: async () => {
        if (++opened === stuckAt) return opening;
        return {
          goto: async () => { navigations++; return { status: () => 503 }; },
          close: async () => { pageCloseCalls++; },
        };
      },
      close: async () => { browserCloseCalls++; },
    } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;
    try {
      process.env.ECOSYSTEM_HEALTH_REPORT = report;
      process.env.ECOSYSTEM_BROWSER_UNAVAILABLE = marker;
      process.env.ECOSYSTEM_NETWORK_UNAVAILABLE = network;
      process.env.ECOSYSTEM_PAGES_COMPLETE = complete;
      process.exitCode = 0;
      console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
      const started = performance.now();

      await runPageCheck(browser, { openTimeoutMs: 20, closeTimeoutMs: 20 });

      assert.ok(performance.now() - started < 1_000, "opening must not hang the checker");
      assert.equal(opened, stuckAt);
      assert.equal(navigations, stuckAt - 1);
      assert.equal(pageCloseCalls, stuckAt - 1);
      assert.equal(browserCloseCalls, 1);
      assert.equal(readFileSync(report, "utf8"), originalReport);
      assert.equal(readFileSync(marker, "utf8"), "unavailable");
      assert.equal(existsSync(network), false);
      assert.equal(existsSync(complete), false);
      assert.equal(process.exitCode, 1);
      assert.match(errors.join("\n"), /browser pemeriksa tidak tersedia/);
      assert.doesNotMatch(errors.join("\n"), /ISO Hub|https?:\/\//);

      if (outcome === "late-rejection") rejectOpening(new Error("late private opening failure"));
      else if (outcome !== "never") resolveOpening(latePage);
      // Allow bounded cleanup of late pages, including a stuck/rejected close.
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      assert.equal(opened, stuckAt, "no further tabs may be opened after the deadline");
      assert.equal(navigations, stuckAt - 1, "late page must never be navigated");
      assert.equal(pageCloseCalls, stuckAt - 1 + (outcome.startsWith("late-page") ? 1 : 0));
      assert.equal(browserCloseCalls, 1);
      assert.equal(readFileSync(report, "utf8"), originalReport);
      assert.equal(readFileSync(marker, "utf8"), "unavailable");
      assert.equal(existsSync(network), false);
      assert.equal(existsSync(complete), false);
      assert.equal(process.exitCode, 1);
      assert.doesNotMatch(errors.join("\n"), /private|https?:\/\//);
    } finally {
      console.error = previous.consoleError;
      process.exitCode = previous.exitCode;
      for (const [key, value] of [
        ["ECOSYSTEM_HEALTH_REPORT", previous.report],
        ["ECOSYSTEM_BROWSER_UNAVAILABLE", previous.marker],
        ["ECOSYSTEM_NETWORK_UNAVAILABLE", previous.network],
        ["ECOSYSTEM_PAGES_COMPLETE", previous.complete],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const failureAt of ["newPage", "close", "close-resolves-disconnected"] as const) {
  test(`browser gagal saat ${failureAt} tidak mengirim laporan parsial atau penanda selesai`, async () => {
    const dir = mkdtempSync(join(tmpdir(), `ecosystem-browser-${failureAt}-`));
    const report = join(dir, "report.json");
    const marker = join(dir, "browser-unavailable");
    const complete = join(dir, "pages-complete");
    const originalReport = JSON.stringify(["Sistem Informasi Proyek: HTTP 503"]);
    writeFileSync(report, originalReport);
    const previous = {
      report: process.env.ECOSYSTEM_HEALTH_REPORT,
      marker: process.env.ECOSYSTEM_BROWSER_UNAVAILABLE,
      complete: process.env.ECOSYSTEM_PAGES_COMPLETE,
      exitCode: process.exitCode,
      consoleError: console.error,
    };
    let connected = true;
    let opened = 0;
    let pageClosed = 0;
    let browserCloseCalls = 0;
    const errors: string[] = [];
    const browser = {
      isConnected: () => connected,
      newPage: async () => {
        opened++;
        if (failureAt === "newPage" && opened === 2) {
          connected = false;
          throw new Error("Target closed while opening tab");
        }
        return {
          goto: async () => ({ status: () => 503 }),
          close: async () => { pageClosed++; },
        };
      },
      close: async () => {
        browserCloseCalls++;
        assert.equal(connected, true, "browser must still be connected before close");
        if (failureAt !== "newPage") {
          connected = false;
          if (failureAt === "close") throw new Error("Target closed while shutting down");
        }
      },
    } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;

    try {
      process.env.ECOSYSTEM_HEALTH_REPORT = report;
      process.env.ECOSYSTEM_BROWSER_UNAVAILABLE = marker;
      process.env.ECOSYSTEM_PAGES_COMPLETE = complete;
      process.exitCode = 0;
      console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };

      await runPageCheck(browser);

      const totalApps = ISO_ECOSYSTEM_APPS.length + PROJECT_ECOSYSTEM_APPS.length;
      assert.equal(opened, failureAt === "newPage" ? 2 : totalApps);
      assert.equal(pageClosed, failureAt === "newPage" ? 1 : totalApps);
      assert.equal(browserCloseCalls, failureAt === "newPage" ? 0 : 1);
      assert.equal(readFileSync(report, "utf8"), originalReport);
      assert.equal(readFileSync(marker, "utf8"), "unavailable");
      assert.equal(existsSync(complete), false);
      assert.equal(process.exitCode, 1);
      assert.match(errors.join("\n"), /browser pemeriksa tidak tersedia/);
      assert.doesNotMatch(errors.join("\n"), /ISO Hub|Target closed/);
    } finally {
      console.error = previous.consoleError;
      process.exitCode = previous.exitCode;
      for (const [key, value] of [
        ["ECOSYSTEM_HEALTH_REPORT", previous.report],
        ["ECOSYSTEM_BROWSER_UNAVAILABLE", previous.marker],
        ["ECOSYSTEM_PAGES_COMPLETE", previous.complete],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("jaringan browser putus setelah hasil HTTP terbukti: laporkan hanya kegagalan terbukti, tanpa pemulihan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecosystem-page-network-"));
  const report = join(dir, "report.json");
  const network = join(dir, "network-unavailable");
  const complete = join(dir, "pages-complete");
  const browserMarker = join(dir, "browser-unavailable");
  writeFileSync(report, JSON.stringify(["Sistem Informasi Proyek: HTTP 503"]));
  const previous = {
    report: process.env.ECOSYSTEM_HEALTH_REPORT,
    network: process.env.ECOSYSTEM_NETWORK_UNAVAILABLE,
    complete: process.env.ECOSYSTEM_PAGES_COMPLETE,
    browser: process.env.ECOSYSTEM_BROWSER_UNAVAILABLE,
    exitCode: process.exitCode,
    consoleError: console.error,
  };
  const errors: string[] = [];
  let opened = 0;
  let closed = 0;
  let probes = 0;
  const browser = {
    isConnected: () => true,
    newPage: async () => {
      const index = ++opened;
      return {
        goto: async (address: string) => {
          if (address.includes("google.com") || address.includes("cloudflare.com")) {
            probes++;
            throw new Error(`net::ERR_INTERNET_DISCONNECTED ${address}`);
          }
          if (index === 1) return { status: () => 503 };
          throw new Error(`net::ERR_INTERNET_DISCONNECTED ${address}`);
        },
        close: async () => { closed++; },
      };
    },
    close: async () => {},
  } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;
  try {
    process.env.ECOSYSTEM_HEALTH_REPORT = report;
    process.env.ECOSYSTEM_NETWORK_UNAVAILABLE = network;
    process.env.ECOSYSTEM_PAGES_COMPLETE = complete;
    process.env.ECOSYSTEM_BROWSER_UNAVAILABLE = browserMarker;
    process.exitCode = 0;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
    await runPageCheck(browser);
    assert.equal(opened, 2);
    assert.equal(closed, 2);
    assert.equal(probes, 2);
    assert.deepEqual(JSON.parse(readFileSync(report, "utf8")), [
      "Sistem Informasi Proyek: HTTP 503",
      "ISO Hub: halaman HTTP 503",
    ]);
    assert.equal(readFileSync(network, "utf8"), "unavailable");
    assert.equal(existsSync(complete), false);
    assert.equal(existsSync(browserMarker), false);
    assert.equal(process.exitCode, 1);
    assert.doesNotMatch(errors.join("\n"), /https?:\/\/|ERR_INTERNET|cloudflare|google|gagal dimuat/);
  } finally {
    console.error = previous.consoleError;
    process.exitCode = previous.exitCode;
    for (const [key, value] of [
      ["ECOSYSTEM_HEALTH_REPORT", previous.report],
      ["ECOSYSTEM_NETWORK_UNAVAILABLE", previous.network],
      ["ECOSYSTEM_PAGES_COMPLETE", previous.complete],
      ["ECOSYSTEM_BROWSER_UNAVAILABLE", previous.browser],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kegagalan muat dengan browser yang tetap terhubung ke internet dilaporkan sebagai kegagalan halaman", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecosystem-page-failure-"));
  const report = join(dir, "report.json");
  const network = join(dir, "network-unavailable");
  const complete = join(dir, "pages-complete");
  const previous = {
    report: process.env.ECOSYSTEM_HEALTH_REPORT,
    network: process.env.ECOSYSTEM_NETWORK_UNAVAILABLE,
    complete: process.env.ECOSYSTEM_PAGES_COMPLETE,
    exitCode: process.exitCode,
    consoleError: console.error,
  };
  const errors: string[] = [];
  let opened = 0;
  const browser = {
    isConnected: () => true,
    newPage: async () => {
      const index = ++opened;
      return {
        goto: async (address: string) => {
          if (address.includes("google.com")) return { status: () => 204 };
          if (index === 1) throw new Error(`net::ERR_CONNECTION_REFUSED ${address}`);
          return { status: () => 503 };
        },
        close: async () => {},
      };
    },
    close: async () => {},
  } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;
  try {
    process.env.ECOSYSTEM_HEALTH_REPORT = report;
    process.env.ECOSYSTEM_NETWORK_UNAVAILABLE = network;
    process.env.ECOSYSTEM_PAGES_COMPLETE = complete;
    process.exitCode = 0;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
    await runPageCheck(browser);
    const failures = JSON.parse(readFileSync(report, "utf8")) as string[];
    assert.equal(failures.length, opened);
    assert.ok(failures.includes("ISO Hub: halaman kosong, salah, atau gagal dimuat"));
    assert.equal(existsSync(network), false);
    assert.equal(readFileSync(complete, "utf8"), "ok");
    assert.equal(process.exitCode, 1);
    assert.doesNotMatch(errors.join("\n"), /https?:\/\/|ERR_CONNECTION_REFUSED/);
  } finally {
    console.error = previous.consoleError;
    process.exitCode = previous.exitCode;
    for (const [key, value] of [
      ["ECOSYSTEM_HEALTH_REPORT", previous.report],
      ["ECOSYSTEM_NETWORK_UNAVAILABLE", previous.network],
      ["ECOSYSTEM_PAGES_COMPLETE", previous.complete],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("jaringan terputus sebelum kegagalan aplikasi terbukti tidak membuat laporan atau penanda selesai", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecosystem-page-network-only-"));
  const report = join(dir, "report.json");
  const network = join(dir, "network-unavailable");
  const complete = join(dir, "pages-complete");
  writeFileSync(report, "[]");
  const previous = {
    report: process.env.ECOSYSTEM_HEALTH_REPORT,
    network: process.env.ECOSYSTEM_NETWORK_UNAVAILABLE,
    complete: process.env.ECOSYSTEM_PAGES_COMPLETE,
    exitCode: process.exitCode,
    consoleError: console.error,
  };
  const errors: string[] = [];
  let opened = 0;
  const browser = {
    isConnected: () => true,
    newPage: async () => {
      opened++;
      return {
        goto: async () => { throw new Error("private connection string or URL must not be printed"); },
        close: async () => {},
      };
    },
    close: async () => {},
  } as unknown as NonNullable<Parameters<typeof runPageCheck>[0]>;
  try {
    process.env.ECOSYSTEM_HEALTH_REPORT = report;
    process.env.ECOSYSTEM_NETWORK_UNAVAILABLE = network;
    process.env.ECOSYSTEM_PAGES_COMPLETE = complete;
    process.exitCode = 0;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
    await runPageCheck(browser);
    assert.equal(opened, 1);
    assert.equal(readFileSync(report, "utf8"), "[]");
    assert.equal(readFileSync(network, "utf8"), "unavailable");
    assert.equal(existsSync(complete), false);
    assert.equal(process.exitCode, 1);
    assert.doesNotMatch(errors.join("\n"), /ISO Hub|private connection|https?:\/\//);
  } finally {
    console.error = previous.consoleError;
    process.exitCode = previous.exitCode;
    for (const [key, value] of [
      ["ECOSYSTEM_HEALTH_REPORT", previous.report],
      ["ECOSYSTEM_NETWORK_UNAVAILABLE", previous.network],
      ["ECOSYSTEM_PAGES_COMPLETE", previous.complete],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});