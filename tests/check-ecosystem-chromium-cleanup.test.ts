/**
 * Opt-in Linux integration test. Only local data pages and fresh browser
 * profiles are used. Run with RUN_CHROMIUM_CLEANUP_TESTS=1 CHROME_PATH=...
 * or CHROME_PATH=/absolute/path/to/chromium npm run test:ecosystem-chromium-cleanup.
 * Without opt-in these tests explicitly skip; opt-in without a working binary
 * fails with a prerequisite error, never a simulated Chromium success.
 */
import assert from "node:assert/strict";
import { readFile, access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { type Browser } from "puppeteer-core";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFixtureWatchdog, launchGuardedChromium } from "./helpers/guarded-chromium-fixture";
import { identity, tree, isLive, waitForExit, signalFixture, type ProcessIdentity } from "./helpers/chromium-fixture-processes";
import { cleanupOwnedBrowser } from "../scripts/lib/owned-browser-cleanup";
import { runPageCheck } from "../scripts/check-ecosystem-pages";
import { ISO_ECOSYSTEM_APPS, PROJECT_ECOSYSTEM_APPS } from "../client/src/data/ecosystem-apps";

async function checkWithIsolatedReport(browser: Browser) {
  const dir = await mkdtemp(join(tmpdir(), "chromium-cleanup-report-"));
  const paths = {
    ECOSYSTEM_HEALTH_REPORT: join(dir, "report.json"),
    ECOSYSTEM_BROWSER_UNAVAILABLE: join(dir, "browser-unavailable"),
    ECOSYSTEM_NETWORK_UNAVAILABLE: join(dir, "network-unavailable"),
    ECOSYSTEM_PAGES_COMPLETE: join(dir, "complete"),
  };
  const previous = Object.keys(paths).map((key) => [key, process.env[key]] as const);
  const previousExit = process.exitCode;
  const previousError = console.error;
  const errors: string[] = [];
  const original = JSON.stringify(["Prior report must survive stalled Chromium close"]);
  try {
    await writeFile(paths.ECOSYSTEM_HEALTH_REPORT, original);
    Object.assign(process.env, paths);
    process.exitCode = 0;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
    let launches = 0;
    await runPageCheck(undefined, {
      launchBrowser: async () => { launches++; return browser; },
      openTimeoutMs: 5_000,
      closeTimeoutMs: 50,
      cleanupTimeoutMs: 1_000,
    });
    assert.equal(launches, 1, "exercise checker-owned launch, not browserOverride");
    assert.equal(process.exitCode, 1);
    assert.equal(await readFile(paths.ECOSYSTEM_HEALTH_REPORT, "utf8"), original);
    assert.equal(await readFile(paths.ECOSYSTEM_BROWSER_UNAVAILABLE, "utf8"), "unavailable");
    for (const path of [paths.ECOSYSTEM_NETWORK_UNAVAILABLE, paths.ECOSYSTEM_PAGES_COMPLETE]) {
      await assert.rejects(access(path), { code: "ENOENT" });
    }
    assert.match(errors.join("\n"), /browser pemeriksa tidak tersedia/);
    assert.doesNotMatch(errors.join("\n"), /Pembersihan browser pemeriksa tidak dapat dipastikan selesai/);
  } finally {
    console.error = previousError;
    process.exitCode = previousExit;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

const enabled = process.env.RUN_CHROMIUM_CLEANUP_TESTS === "1";
test("Chromium nyata: close normal memutus browser tanpa alarm palsu dan menerbitkan laporan selesai", {
  skip: !enabled ? "Set RUN_CHROMIUM_CLEANUP_TESTS=1 for isolated Chromium verification"
    : process.platform !== "linux" ? "Requires Linux Chromium" : false,
  timeout: 60_000,
}, async () => {
  const executablePath = process.env.CHROME_PATH;
  assert.ok(executablePath, "CHROME_PATH required; no implicit download or installation");
  await access(executablePath);
  const dir = await mkdtemp(join(tmpdir(), "chromium-normal-close-"));
  const paths = {
    ECOSYSTEM_HEALTH_REPORT: join(dir, "report.json"),
    ECOSYSTEM_BROWSER_UNAVAILABLE: join(dir, "browser-unavailable"),
    ECOSYSTEM_NETWORK_UNAVAILABLE: join(dir, "network-unavailable"),
    ECOSYSTEM_PAGES_COMPLETE: join(dir, "complete"),
  };
  const previous = Object.keys(paths).map((key) => [key, process.env[key]] as const);
  const previousExit = process.exitCode;
  const previousError = console.error;
  const errors: string[] = [];
  const apps = [...ISO_ECOSYSTEM_APPS, ...PROJECT_ECOSYSTEM_APPS];
  const fixtures = new Map<string, string>(apps.map((app) => [new URL(app.href).href, app.healthHeading]));
  const navigations: string[] = [];
  const unexpectedRequests: string[] = [];
  let browser: Browser | undefined;
  const owned: { child: ReturnType<Browser["process"]> } = { child: null };
  let launches = 0;
  let closeCalls = 0;
  let disconnects = 0;
  let connectedBeforeClose: boolean | undefined;
  let connectedAfterClose: boolean | undefined;
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const watchdog = await createFixtureWatchdog();
  try {
    Object.assign(process.env, paths);
    process.exitCode = 0;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
    await runPageCheck(undefined, {
      launchBrowser: async () => {
        launches++;
        browser = await launchGuardedChromium(watchdog, executablePath);
        const child = owned.child = browser.process();
        assert.ok(child?.pid, "observe the real checker-owned Chromium child");
        child.once("exit", (code, signal) => { exit = { code, signal }; });
        browser.on("disconnected", () => { disconnects++; });
        const newPage = browser.newPage.bind(browser);
        browser.newPage = async () => {
          const page = await newPage();
          await page.setRequestInterception(true);
          page.on("request", (request) => {
            const heading = fixtures.get(request.url());
            // All response bytes originate in this test, not an application.
            // Keep the URL/HTTP/visible-heading checks real and unmodified.
            if (request.isNavigationRequest() && heading !== undefined) {
              navigations.push(request.url());
              void request.respond({
                status: 200,
                contentType: "text/html; charset=utf-8",
                body: `<!doctype html><title>Offline fixture</title><link rel="icon" href="data:,"><h1>${
                  heading.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!)
                }</h1>`,
              }).catch(() => {});
            } else {
              unexpectedRequests.push(request.url());
              void request.abort().catch(() => {});
            }
          });
          return page;
        };
        const close = browser.close.bind(browser);
        browser.close = async () => {
          closeCalls++;
          connectedBeforeClose = browser!.isConnected();
          await close(); // Real Puppeteer close; never simulate disconnection/exit.
          connectedAfterClose = browser!.isConnected();
        };
        return browser;
      },
    });
    assert.equal(launches, 1, "exercise checker ownership, not browserOverride");
    assert.deepEqual(navigations, apps.map((app) => new URL(app.href).href), "render every local fixture");
    assert.deepEqual(unexpectedRequests, [], "no external pages or connectivity probes");
    assert.equal(closeCalls, 1);
    assert.equal(connectedBeforeClose, true);
    assert.equal(connectedAfterClose, false);
    assert.equal(disconnects, 1, "normal close must emit a real transport disconnection");
    assert.deepEqual(exit, { code: 0, signal: null }, "observe a clean OS process exit");
    assert.equal(owned.child?.exitCode, 0);
    assert.equal(owned.child?.signalCode, null);
    assert.equal(process.exitCode, 0, "normal shutdown must not fail the checker");
    assert.deepEqual(JSON.parse(await readFile(paths.ECOSYSTEM_HEALTH_REPORT, "utf8")), []);
    assert.equal(await readFile(paths.ECOSYSTEM_PAGES_COMPLETE, "utf8"), "ok");
    for (const path of [paths.ECOSYSTEM_BROWSER_UNAVAILABLE, paths.ECOSYSTEM_NETWORK_UNAVAILABLE]) {
      await assert.rejects(access(path), { code: "ENOENT" });
    }
    assert.deepEqual(errors, [], "normal disconnection must not produce an operational alarm");
  } finally {
    console.error = previousError;
    process.exitCode = previousExit;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      // Failure teardown only, after the clean-exit assertions above.
      const child = owned.child;
      if (browser && (browser.isConnected() || (child && child.exitCode === null && child.signalCode === null))) {
        assert.equal(await cleanupOwnedBrowser(browser, child, 1_000), true);
      }
    } finally {
      try { await watchdog.release(); }
      finally { await rm(dir, { recursive: true, force: true }); }
    }
  }
});

for (const scenario of [
  "stalled-close", "stopped-root-forces-kill", "checker-browser-close", "checker-tab-and-browser-close",
] as const) {
  test(`Chromium nyata: ${scenario}; renderer berhenti dan browser lain tetap hidup`, {
    skip: !enabled ? "Set RUN_CHROMIUM_CLEANUP_TESTS=1 for isolated Chromium verification"
      : process.platform !== "linux" ? "Requires Linux /proc" : false,
    timeout: 60_000,
  }, async (t) => {
    const executablePath = process.env.CHROME_PATH;
    assert.ok(executablePath, "CHROME_PATH required; no implicit download or installation");
    await access(executablePath);
    const fixtures: { browser: Browser; root: ProcessIdentity; captured: ProcessIdentity[] }[] = [];
    const watchdogs: Awaited<ReturnType<typeof createFixtureWatchdog>>[] = [];
    const launch = async () => {
      const watchdog = await createFixtureWatchdog();
      watchdogs.push(watchdog);
      const browser = await launchGuardedChromium(watchdog, executablePath);
      const child = browser.process();
      assert.ok(child?.pid);
      const root = await identity(child.pid);
      assert.ok(root);
      const fixture = { browser, root, captured: [root] };
      fixtures.push(fixture);
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        void (request.url().startsWith("data:") ? request.continue() : request.abort()).catch(() => {});
      });
      await page.goto("data:text/html,<title>isolated-cleanup-fixture</title><h1>Local only</h1>", {
        timeout: 5_000,
      });
      fixture.captured = await tree(root);
      await watchdog.capture();
      return Object.assign(fixture, { page, child });
    };
    try {
      const owned = await launch();
      const neighbor = await launch();
      const types = await Promise.all(owned.captured.map(async (item) => {
        try {
          const command = await readFile(`/proc/${item.pid}/cmdline`, "utf8");
          return /--type=([^\0 ]+)/.exec(command)?.[1] ?? "browser";
        } catch { return "exited"; }
      }));
      assert.ok(types.includes("renderer"), "must exercise an actual renderer, not just a browser root");
      assert.ok(owned.captured.length > 1);
      assert.ok((await Promise.all(owned.captured.map(isLive))).every(Boolean),
        "all captured processes must be executing before cleanup");
      const neighborPids = new Set(neighbor.captured.map((item) => item.pid));
      assert.ok(owned.captured.every((item) => !neighborPids.has(item.pid)));
      if (scenario === "stopped-root-forces-kill") {
        assert.equal(owned.child.kill("SIGSTOP"), true);
      }
      // Stall only the close operation; transport and OS process are real.
      const closeStarted = performance.now();
      const originalClose = owned.browser.close;
      owned.browser.close = () => new Promise<void>(() => {});
      try {
        if (scenario.startsWith("checker-")) {
          const originalNewPage = owned.browser.newPage.bind(owned.browser);
          let navigations = 0;
          let tabCloseCalls = 0;
          let browserCloseCalls = 0;
          owned.browser.close = () => {
            browserCloseCalls++;
            return new Promise<void>(() => {});
          };
          owned.browser.newPage = async () => {
            const page = await originalNewPage();
            await page.setRequestInterception(true);
            page.on("request", (request) => {
              void (request.url().startsWith("data:") ? request.continue() : request.abort()).catch(() => {});
            });
            const goto = page.goto.bind(page);
            // Never forward an application/probe URL to Chromium. Exercise real
            // navigation/rendering but deliberately fail the origin check.
            page.goto = async () => {
              navigations++;
              const response = await goto("data:text/html,<h1>Offline checker fixture</h1>", { timeout: 3_000 });
              const observed = await tree(owned.root);
              for (const item of observed) {
                if (!owned.captured.some((known) => known.pid === item.pid && known.start === item.start)) {
                  owned.captured.push(item);
                }
              }
              return response;
            };
            if (scenario === "checker-tab-and-browser-close") {
              page.close = () => { tabCloseCalls++; return new Promise<void>(() => {}); };
            }
            return page;
          };
          try {
            await checkWithIsolatedReport(owned.browser);
            assert.ok(navigations > 0, "checker must render at least one real local page");
            assert.equal(browserCloseCalls, 1, "checker must encounter the stalled browser close");
            if (scenario === "checker-tab-and-browser-close") assert.equal(tabCloseCalls, 1);
          } finally {
            owned.browser.newPage = originalNewPage;
          }
        } else {
          const timedOut = await Promise.race([
            owned.browser.close().then(() => false),
            delay(50).then(() => true),
          ]);
          assert.equal(timedOut, true);
          assert.equal(await cleanupOwnedBrowser(owned.browser, owned.child, 250), true,
            "root cleanup should complete");
        }
      } finally {
        owned.browser.close = originalClose;
      }
      assert.ok(performance.now() - closeStarted < 10_000, "checker/cleanup must remain bounded");
      if (scenario === "stopped-root-forces-kill") assert.equal(owned.child.signalCode, "SIGKILL");
      const remaining = await waitForExit(owned.captured, 2_000);
      assert.equal(remaining.length, 0,
        `still-live owned fixture PIDs: ${remaining.map((item) => item.pid).join(", ")}`);
      assert.equal(await isLive(neighbor.root), true);
      assert.ok((await Promise.all(neighbor.captured.map(isLive))).every(Boolean),
        "the neighbor's captured subprocesses must also remain alive");
      assert.equal(await neighbor.page.title(), "isolated-cleanup-fixture");
      const exitedZombies = (await Promise.all(owned.captured.map((item) => identity(item.pid))))
        .filter((item) => item?.state === "Z").length;
      t.diagnostic(`Observed ${owned.captured.length} owned processes; types: ${[...new Set(types)].join(", ")}; live survivors: 0; exited zombies: ${exitedZombies}; neighbor responsive`);
    } finally {
      // Always recover stopped fixtures, even when an assertion fails.
      // allSettled ensures failure tearing down one fixture cannot strand the
      // other. No unbounded browser.close() call is used during recovery.
      const teardown = await Promise.allSettled(fixtures.map(async (fixture) => {
        try {
          if (await isLive(fixture.root)) {
            for (const item of await tree(fixture.root)) {
              if (!fixture.captured.some((known) => known.pid === item.pid && known.start === item.start)) {
                fixture.captured.push(item);
              }
            }
          }
        } finally {
          await signalFixture(fixture.root, "SIGCONT");
          try {
            await cleanupOwnedBrowser(fixture.browser, fixture.browser.process(), 250);
          } finally {
            for (const item of [...fixture.captured].reverse()) await signalFixture(item, "SIGKILL");
          }
        }
        assert.equal((await waitForExit(fixture.captured, 1_000)).length, 0,
          "fixture teardown must leave no executing process");
      }));
      const recovery = await Promise.allSettled(watchdogs.map((watchdog) => watchdog.release()));
      for (const result of [...teardown, ...recovery]) {
        if (result.status === "rejected") throw result.reason;
      }
    }
  });
}

for (const signal of ["SIGTERM", "SIGKILL"] as const) {
  test(`Penguji dihentikan ${signal}: pengawas memulihkan dua fixture tanpa menyentuh browser tetangga`, {
    skip: !enabled ? "Set RUN_CHROMIUM_CLEANUP_TESTS=1 for isolated Chromium verification"
      : process.platform !== "linux" ? "Requires Linux /proc" : false,
    timeout: 60_000,
  }, async () => {
    const executablePath = process.env.CHROME_PATH;
    assert.ok(executablePath, "CHROME_PATH required; no implicit download or installation");
    await access(executablePath);
    const neighborGuard = await createFixtureWatchdog();
    let neighbor: Browser | undefined;
    const worker = fork(fileURLToPath(new URL("./fixtures/chromium-tester-cancellation.ts", import.meta.url)), [], {
      execArgv: ["--import", "tsx"], detached: true,
      env: { PATH: process.env.PATH, CHROME_PATH: executablePath },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const workerExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", (code, signal) => resolve({ code, signal }));
    });
    type Evidence = {
      directory: string; root: ProcessIdentity; captured: ProcessIdentity[]; watchdog: ProcessIdentity;
    };
    let evidence: Evidence[] = [];
    try {
      const ready = new Promise<Evidence[]>((resolve, reject) => {
        const timer = setTimeout(() => done(new Error("Tester fixture startup timed out")), 25_000);
        const onMessage = (value: Evidence[]) => done(undefined, value);
        const onExit = () => done(new Error("Tester exited before fixture readiness"));
        function done(error?: Error, value?: Evidence[]) {
          clearTimeout(timer);
          worker.off("message", onMessage);
          worker.off("exit", onExit);
          worker.off("error", done);
          if (error) reject(error); else resolve(value!);
        }
        worker.once("message", onMessage);
        worker.once("exit", onExit);
        worker.once("error", done);
      });
      // Attach the readiness listener before awaiting the neighbor launch.
      const neighborPromise = launchGuardedChromium(neighborGuard, executablePath)
        .then((browser) => { neighbor = browser; });
      [evidence] = await Promise.all([ready, neighborPromise]);
      assert.equal(evidence.length, 2, "both fixtures must be armed before cancellation");
      const page = await neighbor!.newPage();
      await page.goto("data:text/html,<title>unrelated-live-fixture</title>");
      const neighborRoot = await identity(neighbor!.process()!.pid!);
      assert.ok(neighborRoot);
      const neighborTree = await tree(neighborRoot);
      for (const fixture of evidence) {
        assert.ok(fixture.captured.length > 1, "real browser descendants required");
        assert.ok((await Promise.all(fixture.captured.map(isLive))).every(Boolean));
        assert.ok(fixture.captured.every((item) => !neighborTree.some((other) => other.pid === item.pid)));
      }
      // The tester cannot run finally, and a stopped browser cannot cooperate.
      await signalFixture(evidence[0].root, "SIGSTOP");
      const started = performance.now();
      assert.equal(worker.kill(signal), true);
      assert.deepEqual(await workerExit, { code: null, signal }, "must kill the actual tester, not a wrapper");
      assert.deepEqual(await waitForExit(evidence.flatMap((item) => [...item.captured, item.watchdog]), 12_000), [],
        "watchdogs and all captured fixture processes must stop within budget");
      for (const fixture of evidence) {
        await assert.rejects(access(fixture.directory), { code: "ENOENT" });
      }
      assert.ok(performance.now() - started < 15_000);
      assert.ok((await Promise.all(neighborTree.map(isLive))).every(Boolean));
      assert.equal(await page.title(), "unrelated-live-fixture", "neighbor remains responsive");
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
      await workerExit;
      // Disconnect transport only: the independent guards perform recovery.
      neighbor?.disconnect();
      await neighborGuard.release();
    }
  });
}
