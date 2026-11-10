import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer, { type CDPSession } from "puppeteer-core";
import { cleanupOwnedBrowser } from "./lib/owned-browser-cleanup";
import { transferReport, type JsTransfer } from "./lib/initial-js-transfer";
import { workerWireTransfers } from "./lib/worker-wire-transfer";
import { evaluateTransferBudget, parseTransferBudget } from "./lib/initial-js-transfer-budget";

export interface TransferOptions {
  url: string;
  executablePath?: string;
  /** Finite observation window after load; no scrolling, clicks or navigation. */
  observationMs?: number;
  timeoutMs?: number;
}

async function deadline<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Browser operation timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fail closed when a migrated body cannot be tied to exactly one wire request. */
export function reconcileWorkerTransfers(
  assets: JsTransfer[], wire: ReturnType<typeof workerWireTransfers>,
): string[] {
  const problems: string[] = [];
  for (const asset of assets) {
    if (!asset.complete || asset.error || asset.fromCache || asset.decodedBodyBytes === 0 || asset.encodedBodyBytes !== 0) continue;
    const matches = wire.filter((record) => record.url === asset.url);
    // NetLog can redact header values. Use its HTTP/1 serialization only to
    // confirm CDP's header-only finish, never as a standalone byte measurement.
    const confirmedHeaderOnlyFinish = matches.length === 1 &&
      matches[0].responseHeaderBytes === asset.transferBytes ? asset.transferBytes : undefined;
    const headerBytes = asset.responseHeaderBytes ?? confirmedHeaderOnlyFinish;
    if (typeof headerBytes !== "number" || !Number.isFinite(headerBytes) || headerBytes < 0 ||
        matches.length !== 1 || matches[0].decodedBodyBytes !== asset.decodedBodyBytes || matches[0].bodyTransferBytes <= 0) {
      problems.push("No complete wire-size evidence for migrated JavaScript");
      continue;
    }
    const match = matches[0];
    // Migrated loadingFinished can omit the body OR include HTTP/2 body/frame
    // bytes. Use responseReceived headers rather than adding to that total.
    asset.transferBytes = headerBytes + match.bodyTransferBytes;
    asset.status = match.status ?? asset.status;
    asset.mimeType = match.mimeType || asset.mimeType;
    asset.transferSource = "cdp-headers-plus-chromium-netlog-body";
  }
  // loadingFinished alone is not proof that response metadata was observed.
  // A migrated worker can finish with header-only bytes and no body events.
  // Check after reconciliation so independently matched metadata may recover it.
  if (assets.some((asset) => asset.complete && !asset.error && !asset.fromCache &&
      (asset.status === null || !Number.isFinite(asset.status)))) {
    problems.push("Missing HTTP response metadata for JavaScript");
  }
  return problems;
}

export async function measureInitialJsTransfer(options: TransferOptions) {
  const url = new URL(options.url);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("Target must be an HTTP(S) URL without credentials");
  }
  const observationMs = options.observationMs ?? 5_000;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(observationMs) || observationMs < 0 || observationMs > 60_000 ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error("Invalid observation or timeout duration");
  }
  const netlogDir = await mkdtemp(join(tmpdir(), "initial-js-network-"));
  const netlogPath = join(netlogDir, "netlog.json");
  const browser = await puppeteer.launch({
    executablePath: options.executablePath ?? process.env.CHROME_PATH ??
      execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    headless: true,
    timeout: timeoutMs,
    protocolTimeout: timeoutMs,
    args: ["--no-sandbox", "--disable-dev-shm-usage", `--log-net-log=${netlogPath}`],
  }).catch(async (error) => {
    await rm(netlogDir, { recursive: true, force: true });
    throw error;
  });
  const child = browser.process();
  let finalize: (() => Promise<void>) | undefined;
  try {
    // A new browser/context ensures no cookies, HTTP cache or previous storage.
    const page = await deadline(browser.newPage(), timeoutMs);
    await page.setViewport({ width: 1440, height: 900 });
    await page.setCacheEnabled(false);
    await page.setBypassServiceWorker(true);
    const session = await page.createCDPSession();
    const requests = new Map<string, JsTransfer>();
    const redirects: JsTransfer[] = [];
    const pageErrors: string[] = [];
    const instrumentationErrors: string[] = [];
    const setupTasks = new Set<Promise<void>>();
    let mainNavigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) mainNavigations++;
    });
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    const observeSession = async (networkSession: CDPSession, targetType = "page") => {
      const key = (requestId: string) => `${networkSession.id()}:${requestId}`;
      // Entry-worker requests can start in the parent but finish in the child.
      // Only join an ID across sessions when the parent record is unambiguous.
      const findRequest = (requestId: string) => {
        const own = requests.get(key(requestId));
        if (own) return own;
        const matches = [...requests].filter(([id]) => id.endsWith(`:${requestId}`));
        return matches.length === 1 ? matches[0][1] : undefined;
      };
      networkSession.on("Network.requestWillBeSent", (event) => {
        const previous = requests.get(key(event.requestId));
        if (previous && event.redirectResponse) {
          previous.status = event.redirectResponse.status;
          previous.mimeType = event.redirectResponse.mimeType;
          previous.transferBytes = event.redirectResponse.encodedDataLength;
          previous.complete = true;
          redirects.push({ ...previous });
        }
        requests.set(key(event.requestId), {
          url: event.request.url,
          requestedUrl: previous?.requestedUrl ?? event.request.url,
          resourceType: event.type ?? "Other",
          mimeType: "",
          status: null,
          transferBytes: 0,
          decodedBodyBytes: 0,
          encodedBodyBytes: 0,
          complete: false,
          fromCache: false,
          error: null,
        });
      });
      networkSession.on("Network.responseReceived", (event) => {
        const asset = findRequest(event.requestId);
        if (!asset) return;
        asset.url = event.response.url;
        asset.resourceType = event.type;
        asset.mimeType = event.response.mimeType;
        asset.status = event.response.status;
        asset.transferBytes = event.response.encodedDataLength;
        asset.responseHeaderBytes = event.response.encodedDataLength;
        asset.fromCache = !!(event.response.fromDiskCache || event.response.fromServiceWorker);
      });
      networkSession.on("Network.requestServedFromCache", (event) => {
        const asset = findRequest(event.requestId);
        if (asset) asset.fromCache = true;
      });
      networkSession.on("Network.dataReceived", (event) => {
        const asset = findRequest(event.requestId);
        if (asset) {
          asset.decodedBodyBytes += event.dataLength;
          asset.encodedBodyBytes = (asset.encodedBodyBytes ?? 0) + event.encodedDataLength;
          asset.transferBytes += event.encodedDataLength;
        }
      });
      networkSession.on("Network.loadingFinished", (event) => {
        const asset = findRequest(event.requestId);
        if (asset) {
          // Authoritative compressed wire bytes, including response headers.
          // Do not sum dataReceived again, or count uncompressed response bodies.
          asset.transferBytes = event.encodedDataLength;
          asset.transferSource = "cdp-loading-finished";
          asset.complete = true;
        }
      });
      networkSession.on("Network.loadingFailed", (event) => {
        const asset = findRequest(event.requestId);
        if (asset) {
          asset.error = event.errorText;
          asset.complete = true;
        }
      });
      // Pause child targets before their code executes so imports/fetches inside
      // workers and out-of-process frames are observed, not just their entry URL.
      networkSession.on("Target.attachedToTarget", (event) => {
        const childSession = networkSession.connection()?.session(event.sessionId);
        const setup = (async () => {
          if (!childSession) throw new Error("Child network session unavailable");
          try {
            await observeSession(childSession, event.targetInfo.type);
          } finally {
            await childSession.send("Runtime.runIfWaitingForDebugger");
          }
        })().catch(() => {
          instrumentationErrors.push(`Child target (${event.targetInfo.type}) network observation failed`);
        });
        setupTasks.add(setup);
        void setup.finally(() => setupTasks.delete(setup));
      });
      const enablingNetwork = networkSession.send("Network.enable");
      // Service-worker initialization cannot acknowledge Network.enable while
      // paused at startup. Register listeners first, send enable, then resume.
      if (targetType === "service_worker") await networkSession.send("Runtime.runIfWaitingForDebugger");
      await enablingNetwork;
      await networkSession.send("Network.setCacheDisabled", { cacheDisabled: true });
      await networkSession.send("Target.setAutoAttach", {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      });
    };
    await observeSession(session);
    const started = Date.now();
    const response = await page.goto(url.href, { waitUntil: "load", timeout: timeoutMs });
    if (!response || !response.ok()) throw new Error(`Document failed: HTTP ${response?.status() ?? "unknown"}`);
    const documentUrl = response.url();
    const html = await response.text();
    if (!/text\/html/i.test(response.headers()["content-type"] ?? "") || !/<script\b/i.test(html)) {
      throw new Error("Target is not an HTML application with scripts");
    }
    if (/@vite\/client|\/src\/main\.[jt]sx?/.test(html)) {
      throw new Error("Vite development server is not a production transfer baseline");
    }
    await delay(observationMs);
    // Flush already queued protocol events before freezing the measurement.
    await session.send("Runtime.evaluate", { expression: "0" });
    await deadline(Promise.all([...setupTasks]), timeoutMs);
    const report = transferReport([...redirects, ...requests.values()], html, documentUrl);
    const problems: string[] = [];
    problems.push(...instrumentationErrors);
    if (mainNavigations !== 1 || page.url() !== documentUrl) problems.push("Page navigated away during observation");
    if (!report.assets.length) problems.push("No JavaScript transfers recorded");
    if (report.assets.some((asset) => !asset.complete)) problems.push("JavaScript requests still pending at cutoff");
    if (report.assets.some((asset) => asset.error || (asset.status ?? 0) >= 400)) problems.push("JavaScript request failed");
    if (report.assets.some((asset) => asset.fromCache)) problems.push("Unexpected cached JavaScript in cold visit");
    if (pageErrors.length) problems.push("Page JavaScript errors occurred");
    const result = {
      schemaVersion: 1,
      targetUrl: url.href,
      documentUrl,
      measuredAt: new Date().toISOString(),
      browserVersion: await browser.version(),
      viewport: { width: 1440, height: 900 },
      observationMs,
      elapsedMs: Date.now() - started,
      cacheDisabled: true,
      serviceWorkersBypassed: true,
      serverProfile: response.headers()["x-transfer-profile"] ?? null,
      metric: "Compressed response plus headers: CDP loadingFinished; migrated worker bodies reconciled with Chromium NetLog",
      valid: problems.length === 0,
      problems,
      pageErrors,
      ...report,
    };
    finalize = async () => {
      const wire = workerWireTransfers(await readFile(netlogPath, "utf8"));
      result.problems.push(...reconcileWorkerTransfers(result.assets, wire));
      Object.assign(result, transferReport(result.assets, html, documentUrl));
      if (result.assets.some((asset) => asset.error || (asset.status ?? 0) >= 400) &&
          !result.problems.includes("JavaScript request failed")) {
        result.problems.push("JavaScript request failed");
      }
      result.valid = result.problems.length === 0;
    };
    return result;
  } finally {
    try {
      try {
        await deadline(browser.close(), 5_000);
      } finally {
        if (child?.exitCode === null && child.signalCode === null) {
          if (!await cleanupOwnedBrowser(browser, child, 1_000)) {
            throw new Error("Owned measurement browser could not be cleaned up");
          }
        }
      }
      await finalize?.();
    } finally {
      // Raw logs can contain URL/header metadata. Never keep them as artifacts.
      await rm(netlogDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  let target = "";
  let output = "generated-artifacts/initial-js-transfer.json";
  let observationMs = 5_000;
  let budgetPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--url" && args[i + 1]) target = args[++i];
    else if (arg === "--output" && args[i + 1]) output = args[++i];
    else if (arg === "--observe-ms" && args[i + 1]) observationMs = Number(args[++i]);
    else if (arg === "--budget" && args[i + 1]) budgetPath = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!target) throw new Error("Usage: npm run check:initial-js-transfer -- --url https://HOST/ [--output PATH] [--observe-ms 5000]");
  await mkdir(dirname(resolve(output)), { recursive: true });
  try {
    const budget = budgetPath ? parseTransferBudget(JSON.parse(await readFile(budgetPath, "utf8"))) : undefined;
    const report = await measureInitialJsTransfer({ url: target, observationMs });
    const result = budget ? evaluateTransferBudget(report, budget, report.serverProfile ?? undefined) :
      { outcome: report.valid ? "measured" : "measurement-error", exitCode: report.valid ? 0 : 2 };
    await writeFile(output, JSON.stringify({ ...report, ...result, budget }, null, 2) + "\n");
    console.table(report.groups);
    console.log(`Total JS transferred: ${report.total.transferBytes} B (${report.total.requests} requests)`);
    console.log(`${result.outcome}; report: ${output}`);
    process.exitCode = result.exitCode;
  } catch (error) {
    await writeFile(output, JSON.stringify({
      schemaVersion: 1, valid: false, outcome: "measurement-error", exitCode: 2,
      problems: [error instanceof Error ? error.message : String(error)],
    }, null, 2) + "\n");
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
