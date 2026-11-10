import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { measureInitialJsTransfer, reconcileWorkerTransfers } from "../scripts/check-initial-js-transfer";
import { workerWireTransfers } from "../scripts/lib/worker-wire-transfer";
import { initialScriptUrls, transferReport, type JsTransfer } from "../scripts/lib/initial-js-transfer";
import { evaluateTransferBudget, parseTransferBudget } from "../scripts/lib/initial-js-transfer-budget";
import { PRODUCTION_TRANSFER_PROFILE, serveProductionTransfer } from "../scripts/lib/initial-js-production-server";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createSecureServer } from "node:http2";
import { networkBrowserFixture, networkEvidence } from "./fixtures/initial-js-network";

const budget = parseTransferBudget({
  schemaVersion: 1, profile: PRODUCTION_TRANSFER_PROFILE, browserVersion: "138.0.7204.100",
  observationMs: 5000,
  limits: { total: 300, localInitial: 100, localRuntime: 100, thirdParty: 100 },
});
const sample = {
  valid: true, problems: [], browserVersion: "Chrome/138.0.7204.100", observationMs: 5000,
  total: { transferBytes: 300 },
  groups: { localInitial: { transferBytes: 100 }, localRuntime: { transferBytes: 100 }, thirdParty: { transferBytes: 100 } },
};

test("inclusive total/group limits; invalid measurements never become budget violations", () => {
  assert.equal(evaluateTransferBudget(sample, budget, budget.profile).outcome, "passed");
  for (const key of ["total", "localInitial", "localRuntime", "thirdParty"] as const) {
    const result = evaluateTransferBudget(sample, {
      ...budget, limits: { ...budget.limits, [key]: budget.limits[key] - 1 },
    }, budget.profile);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.violations, [{ group: key, actual: key === "total" ? 300 : 100, limit: key === "total" ? 299 : 99 }]);
  }
  for (const changed of [
    { ...sample, valid: false, problems: ["JavaScript request failed"] },
    { ...sample, observationMs: 1000 },
    { ...sample, browserVersion: "Chrome/139.0.0.0" },
  ]) {
    const result = evaluateTransferBudget(changed, budget, budget.profile);
    assert.equal(result.exitCode, 2);
    assert.deepEqual(result.violations, []);
  }
  assert.equal(evaluateTransferBudget(sample, budget, "vite").exitCode, 2);
  for (const value of [-1, NaN, Infinity, "100", 0.5]) {
    assert.throws(() => parseTransferBudget({ ...budget, limits: { ...budget.limits, total: value } }));
  }
});

async function cli(args: string[]) {
  return new Promise<number | null>((done, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/check-initial-js-transfer.ts", ...args], {
      stdio: "pipe", env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    child.stdout.resume();
    child.stderr.resume();
    child.once("error", reject);
    child.once("exit", done);
  });
}

test("production fixture and CLI enforce byte limits and preserve environment failure JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "production-transfer-test-"));
  let server: Awaited<ReturnType<typeof serveProductionTransfer>> | undefined;
  try {
    await writeFile(join(directory, "index.html"), '<script type="module" src="/src/main.tsx"></script>');
    await assert.rejects(serveProductionTransfer(directory), /production/);
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), '<script type="module" src="/assets/entry.js"></script>');
    const body = "window.entry=true;" + "/* gzip me */".repeat(500);
    await writeFile(join(directory, "assets/entry.js"), body);
    server = await serveProductionTransfer(directory);
    const response = await fetch(server.url + "assets/entry.js");
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("date"), null);
    assert.equal(await response.text(), body);
    assert.equal((await fetch(server.url + "api/auth/user")).status, 401);
    assert.equal((await fetch(server.url + "assets/missing.js")).status, 404);
    assert.equal((await fetch(server.url + "a-route")).status, 200);
    const output = join(directory, "report.json");
    const budgetFile = join(directory, "budget.json");
    await writeFile(budgetFile, JSON.stringify({ ...budget, observationMs: 150, limits: { total: 0, localInitial: 0, localRuntime: 0, thirdParty: 0 } }));
    const args = ["--url", server.url, "--observe-ms", "150", "--output", output, "--budget", budgetFile];
    assert.equal(await cli(args), 1);
    const exceeded = JSON.parse(await readFile(output, "utf8"));
    assert.equal(exceeded.valid, true);
    assert.equal(exceeded.outcome, "budget-exceeded");
    assert.equal(exceeded.violations.length, 2);
    // Same server and payload; only the reviewed limits change.
    await writeFile(budgetFile, JSON.stringify({ ...budget, observationMs: 150, limits: { total: 10000, localInitial: 10000, localRuntime: 0, thirdParty: 0 } }));
    assert.equal(await cli(args), 0);
    assert.equal(JSON.parse(await readFile(output, "utf8")).outcome, "passed");
    await server.close();
    server = undefined;
    assert.equal(await cli(args), 2);
    const failed = JSON.parse(await readFile(output, "utf8"));
    assert.equal(failed.valid, false);
    assert.equal(failed.outcome, "measurement-error");
    assert.equal(failed.total, undefined, "must not reuse stale successful byte evidence");
  } finally {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("CI always saves JSON and uses production build rather than Vite serve", async () => {
  const workflow = await readFile(resolve(".github/workflows/initial-js-transfer.yml"), "utf8");
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /initial-js-production\/\*\.json/);
  assert.match(workflow, /npm run check:initial-js-production/);
  assert.match(workflow, /npm run test:initial-js-transfer/);
  const runner = await readFile(resolve("scripts/check-initial-js-production.ts"), "utf8");
  assert.match(runner, /vite\.js", "build"/);
  assert.match(runner, /checkInitialJsBudget\(buildDir\)/);
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void, host = "127.0.0.1") {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `http://${host}:${address.port}` };
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function asset(url: string, overrides: Partial<JsTransfer> = {}): JsTransfer {
  return {
    url, requestedUrl: url, resourceType: "Script", mimeType: "text/javascript",
    status: 200, transferBytes: 101, decodedBodyBytes: 200, complete: true,
    fromCache: false, error: null, ...overrides,
  };
}

test("classifies served HTML references, runtime fetches and external JS without deduplicating transfers", () => {
  const html = `<base href="/bundle/">
    <script src="entry.js?q=1"></script>
    <link rel="modulepreload" href="shared.js">
    <link rel="preload" as="script" href="/early">
    <link rel="preload" as="style" href="/style.css">`;
  const origin = "https://app.example";
  assert.deepEqual([...initialScriptUrls(html, `${origin}/`)],
    [`${origin}/bundle/entry.js?q=1`, `${origin}/bundle/shared.js`, `${origin}/early`]);
  const report = transferReport([
    asset(`${origin}/bundle/entry.js?q=1`),
    asset(`${origin}/bundle/shared.js`),
    asset(`${origin}/early`),
    asset(`${origin}/runtime.js`),
    asset(`${origin}/runtime.js`, { transferBytes: 55 }),
    asset("https://cdn.example/without-extension", { resourceType: "Fetch" }),
    asset(`${origin}/font.woff2`, { resourceType: "Font", mimeType: "font/woff2" }),
    asset("data:text/javascript,void(0)"),
  ], html, `${origin}/`);
  assert.equal(report.groups.localInitial.requests, 3);
  assert.equal(report.groups.localRuntime.requests, 2);
  assert.equal(report.groups.thirdParty.requests, 1);
  assert.equal(report.total.transferBytes, 560);
  assert.equal(report.total.requests, 6);
});

test("cold browser records gzip wire bytes, initial preload, dynamic import, third party and no second route", async () => {
  let nextRouteVisits = 0;
  const third = await serve((_req, res) => {
    res.setHeader("Content-Type", "text/javascript");
    res.end("window.externalLoaded = true;");
  });
  const entry = `
    import { shared } from "./shared.js";
    window.shared = shared;
    setTimeout(() => import("./runtime.js"), 100);
    ${"/* compressible entry content */\n".repeat(3000)}
  `;
  const compressedEntry = gzipSync(entry);
  const local = await serve((req, res) => {
    res.setHeader("Cache-Control", "max-age=86400");
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(`<html><body><a href="/next">Next</a>
        <link rel="modulepreload" href="/shared.js">
        <script type="module" src="/entry.js"></script>
        <script src="${third.url}/external"></script>
      </body></html>`);
    } else if (req.url === "/entry.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.setHeader("Content-Encoding", "gzip");
      res.end(compressedEntry);
    } else if (req.url === "/shared.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end("export const shared = 42;");
    } else if (req.url === "/runtime.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end("window.runtimeLoaded = true;");
    } else if (req.url === "/worker.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(`import "/worker-dependency.js";`);
    } else if (req.url === "/worker-dependency.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end("self.workerDependencyLoaded = true;");
    } else if (req.url === "/next") {
      nextRouteVisits++;
      res.end("Unexpected navigation");
    } else {
      res.writeHead(404).end();
    }
  });
  try {
    const report = await measureInitialJsTransfer({ url: `${local.url}/`, observationMs: 600 });
    assert.equal(report.valid, true, JSON.stringify({ problems: report.problems, assets: report.assets }));
    assert.equal(report.groups.localInitial.requests, 2, "preload reuse counts only once");
    assert.equal(report.groups.localRuntime.requests, 1);
    assert.equal(report.groups.thirdParty.requests, 1);
    assert.equal(report.total.requests, 4);
    assert.equal(nextRouteVisits, 0);
    const entryAsset = report.assets.find((a) => a.url.endsWith("/entry.js"))!;
    assert.ok(entryAsset.transferBytes >= compressedEntry.length);
    assert.ok(entryAsset.transferBytes < Buffer.byteLength(entry) / 10, "must measure compressed wire, not decoded JS");
    assert.ok(entryAsset.decodedBodyBytes >= Buffer.byteLength(entry));
    assert.ok(report.groups.thirdParty.transferBytes > 0, "cross-origin without TAO must not be zero");
    assert.ok(report.assets.every((a) => a.complete && !a.fromCache));
    assert.equal(report.total.transferBytes, Object.values(report.groups).reduce((sum, g) => sum + g.transferBytes, 0));
  } finally {
    await Promise.all([close(local.server), close(third.server)]);
  }
});

test("failed JS is explicit, pending requests and route changes never produce valid baselines", async () => {
  const local = await serve((req, res) => {
    res.setHeader("Content-Type", "text/html");
    if (req.url === "/failed") res.end(`<script src="/missing.js"></script>`);
    else if (req.url === "/pending") res.end(`<script>setTimeout(() => import("/slow.js"), 10)</script>`);
    else if (req.url === "/navigate") res.end(`<script>setTimeout(() => location.href="/other", 50)</script>`);
    else if (req.url === "/slow.js") { /* intentionally leave request open */ }
    else if (req.url === "/other") res.end("<script>window.other=true</script>");
    else res.writeHead(404).end("Not found");
  });
  try {
    const failed = await measureInitialJsTransfer({ url: `${local.url}/failed`, observationMs: 150 });
    assert.equal(failed.valid, false);
    assert.ok(failed.problems.includes("JavaScript request failed"));
    const pending = await measureInitialJsTransfer({ url: `${local.url}/pending`, observationMs: 150 });
    assert.equal(pending.valid, false);
    assert.ok(pending.problems.includes("JavaScript requests still pending at cutoff"));
    const navigated = await measureInitialJsTransfer({ url: `${local.url}/navigate`, observationMs: 300 });
    assert.equal(navigated.valid, false);
    assert.ok(navigated.problems.includes("Page navigated away during observation"));
  } finally {
    await close(local.server);
  }
});

test("rejects invalid targets and observation windows before launching browser", async () => {
  await assert.rejects(measureInitialJsTransfer({ url: "file:///tmp/index.html" }), /HTTP/);
  await assert.rejects(measureInitialJsTransfer({ url: "https://user:pass@example.org/" }), /credentials/);
  await assert.rejects(measureInitialJsTransfer({ url: "https://example.org/", observationMs: NaN }), /duration/);
});

test("worker and service-worker entry transfers and internal imports are observed across CDP sessions", async () => {
  const swBody = "self.loaded = true;\n" + "/* compressible worker content */\n".repeat(1000);
  const swCompressed = gzipSync(swBody);
  const local = await serve((req, res) => {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(`<script>
        new Worker("/worker.js", {type:"module"});
        navigator.serviceWorker.register("/sw.js");
      </script>`);
    } else {
      res.setHeader("Content-Type", "text/javascript");
      if (req.url === "/sw.js") {
        res.setHeader("Content-Encoding", "gzip");
        res.end(swCompressed);
      } else {
        res.end(req.url === "/worker.js" ? `import "/worker-dependency.js";` : "self.loaded = true;");
      }
    }
  });
  try {
    const report = await measureInitialJsTransfer({ url: `${local.url}/`, observationMs: 600 });
    const dependency = report.assets.find((a) => a.url.endsWith("/worker-dependency.js"));
    assert.ok(dependency && dependency.complete && dependency.transferBytes > 0);
    const entry = report.assets.find((a) => a.url.endsWith("/worker.js"));
    assert.ok(entry);
    assert.equal(entry.complete, true, JSON.stringify(report.problems));
    assert.ok(entry.transferBytes > 0);
    const sw = report.assets.find((a) => a.url.endsWith("/sw.js"));
    assert.ok(sw && sw.complete && sw.transferBytes > 0, JSON.stringify(report.problems));
    assert.ok(sw.transferBytes > swCompressed.length,
      `must include compressed worker body plus headers: ${JSON.stringify(sw)}`);
    assert.ok(sw.transferBytes < Buffer.byteLength(swBody) / 10, "must not count decoded worker bytes as wire bytes");
    assert.equal(report.valid, true, JSON.stringify({ problems: report.problems, assets: report.assets }));
  } finally {
    await close(local.server);
  }
});

function assertTransfersOnce(
  report: Awaited<ReturnType<typeof measureInitialJsTransfer>>, urls: string[],
) {
  assert.equal(report.valid, true, JSON.stringify({ problems: report.problems, assets: report.assets }));
  assert.deepEqual(report.assets.map((a) => a.url).sort(), [...urls].sort());
  assert.equal(report.total.requests, urls.length);
  assert.ok(report.assets.every((a) => a.complete && !a.fromCache && !a.error && a.transferBytes > 0));
  assert.equal(report.total.transferBytes, report.assets.reduce((sum, a) => sum + a.transferBytes, 0));
  assert.equal(report.total.transferBytes, Object.values(report.groups).reduce((sum, g) => sum + g.transferBytes, 0));
}

test("out-of-process cross-site iframe observes nested workers and their imports exactly once", async () => {
  const browser = await networkBrowserFixture();
  const scripts: Record<string, string> = {
    "/frame.js": `new Worker("/parent.js");`,
    "/parent.js": `importScripts("/parent-import.js"); new Worker("/nested.js");`,
    "/parent-import.js": "self.parentImport = true;",
    "/nested.js": `importScripts("/nested-import.js");`,
    "/nested-import.js": "self.nestedImport = true;",
  };
  const hits = new Map<string, number>();
  const frame = await serve((req, res) => {
    res.sendDate = false;
    hits.set(req.url!, (hits.get(req.url!) ?? 0) + 1);
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end('<script src="/frame.js"></script>');
    } else if (scripts[req.url!]) {
      res.setHeader("Content-Type", "text/javascript");
      res.end(scripts[req.url!]);
    } else res.writeHead(404).end();
  }, "127.0.0.2");
  const main = await serve((req, res) => {
    res.sendDate = false;
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(`<script src="/entry.js"></script><iframe src="${frame.url}/"></iframe>`);
    } else if (req.url === "/entry.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end("window.entry = true;");
    } else res.writeHead(404).end();
  });
  try {
    // An iframe on another port is merely cross-origin, not necessarily OOPIF.
    // Separate loopback sites plus --site-per-process force the real CDP boundary.
    const evidence = await networkEvidence(`${main.url}/`, browser.executablePath);
    assert.ok(evidence.targets.some((t) => t.type === "iframe"), JSON.stringify(evidence.targets));
    assert.ok(evidence.targets.some((t) => t.type === "worker" && t.parentType === "worker"),
      "must actually attach a worker created by another worker");
    hits.clear();
    const report = await measureInitialJsTransfer({
      url: `${main.url}/`, executablePath: browser.executablePath, observationMs: 800,
    });
    assertTransfersOnce(report, [`${main.url}/entry.js`, ...Object.keys(scripts).map((path) => frame.url + path)]);
    assert.equal(report.groups.localInitial.requests, 1);
    assert.equal(report.groups.localRuntime.requests, 0);
    assert.equal(report.groups.thirdParty.requests, 5);
    for (const path of Object.keys(scripts)) assert.equal(hits.get(path), 1, path);
  } finally {
    await Promise.all([close(main.server), close(frame.server)]);
    await browser.close();
  }
});

test("HTTPS HTTP/2 compressed worker wire bytes agree with real NetLog and CDP headers", async () => {
  const browser = await networkBrowserFixture();
  const body = `importScripts("/dependency.js");\n` + "/* compressed h2 worker */\n".repeat(2000);
  const compressed = gzipSync(body);
  const sessions = new Set<import("node:http2").ServerHttp2Session>();
  const hits = new Map<string, number>();
  const server = createSecureServer({ key: browser.key, cert: browser.cert, allowHTTP1: false });
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });
  server.on("stream", (stream, headers) => {
    const path = String(headers[":path"]);
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path === "/") {
      stream.respond({ ":status": 200, "content-type": "text/html" });
      stream.end('<script>new Worker("/worker.js");</script>');
    } else if (path === "/worker.js") {
      stream.respond({
        ":status": 200, "content-type": "text/javascript",
        "content-encoding": "gzip", "content-length": compressed.length,
      });
      stream.end(compressed);
    } else if (path === "/dependency.js") {
      stream.respond({ ":status": 200, "content-type": "text/javascript" });
      stream.end("self.imported = true;");
    } else {
      stream.respond({ ":status": 404 });
      stream.end();
    }
  });
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `https://127.0.0.1:${address.port}`;
    const evidence = await networkEvidence(`${url}/`, browser.executablePath);
    const wire = evidence.wire.filter((r) => r.url === `${url}/worker.js`);
    assert.equal(wire.length, 1);
    assert.equal(wire[0].status, 200);
    assert.match(wire[0].mimeType, /javascript/);
    assert.equal(wire[0].bodyTransferBytes, compressed.length, "actual gzip body, excluding HTTP/2 framing/headers");
    assert.equal(wire[0].decodedBodyBytes, Buffer.byteLength(body));
    assert.equal(wire[0].responseHeaderBytes, undefined, "HTTP/2 normalized header text is not HTTP/1 wire evidence");
    const response = evidence.responses.filter((r) => r.url === `${url}/worker.js`);
    assert.equal(response.length, 1);
    assert.equal(response[0].protocol, "h2", "must not silently fall back to HTTP/1");
    const migrated = asset(`${url}/worker.js`, {
      encodedBodyBytes: 0, decodedBodyBytes: Buffer.byteLength(body),
      responseHeaderBytes: response[0].headers, transferBytes: response[0].headers,
    });
    assert.deepEqual(reconcileWorkerTransfers([migrated], evidence.wire), []);
    assert.equal(migrated.transferBytes, response[0].headers + compressed.length);
    hits.clear();
    const report = await measureInitialJsTransfer({
      url: `${url}/`, executablePath: browser.executablePath, observationMs: 800,
    });
    assertTransfersOnce(report, [`${url}/worker.js`, `${url}/dependency.js`]);
    assert.equal(report.groups.localRuntime.requests, 2);
    const worker = report.assets.find((a) => a.url === `${url}/worker.js`)!;
    assert.equal(worker.transferSource, "cdp-headers-plus-chromium-netlog-body");
    assert.equal(worker.decodedBodyBytes, Buffer.byteLength(body));
    // Header/HTTP2 accounting can differ between independent cold visits.
    // Compare this visit's CDP evidence with the independently verified body,
    // not with another browser process's cumulative response length.
    assert.equal(worker.transferBytes, worker.responseHeaderBytes! + compressed.length,
      "this visit's CDP evidence plus exactly one compressed body");
    assert.equal(hits.get("/worker.js"), 1);
    assert.equal(hits.get("/dependency.js"), 1);
  } finally {
    for (const session of sessions) session.destroy();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    await browser.close();
  }
});

test("header-only worker finish without response metadata cannot pass the transfer budget", () => {
  const worker = asset("https://fixture.invalid/sw.js", {
    status: null, mimeType: "", decodedBodyBytes: 0, encodedBodyBytes: 0,
    transferBytes: 256, complete: true, transferSource: "cdp-loading-finished",
  });
  const problems = reconcileWorkerTransfers([worker], []);
  assert.deepEqual(problems, ["Missing HTTP response metadata for JavaScript"]);
  assert.equal(worker.status, null, "never invent status or body bytes");
  assert.equal(worker.transferBytes, 256);
  const outcome = evaluateTransferBudget({ ...sample, valid: false, problems }, budget, budget.profile);
  assert.equal(outcome.exitCode, 2, "incomplete evidence is a measurement error, not a passing budget");
  assert.deepEqual(outcome.violations, []);

  const emptyResponse = asset("https://fixture.invalid/empty.js", {
    status: 200, decodedBodyBytes: 0, encodedBodyBytes: 0, transferBytes: 256,
  });
  assert.deepEqual(reconcileWorkerTransfers([emptyResponse], []), [],
    "an observed empty HTTP response is distinct from missing response metadata");
});

test("checker rejects ambiguous, failed, incomplete or mismatched migrated-worker evidence", () => {
  const url = "https://fixture.invalid/worker.js";
  const types = {
    URL_REQUEST_START_JOB: 1, HTTP_TRANSACTION_READ_RESPONSE_HEADERS: 2,
    URL_REQUEST_JOB_BYTES_READ: 3, URL_REQUEST_JOB_FILTERED_BYTES_READ: 4, REQUEST_ALIVE: 5,
    HTTP_TRANSACTION_HTTP2_SEND_REQUEST_HEADERS: 6,
  };
  function events(id: number, options: { failed?: boolean; pending?: boolean; decoded?: number; encoded?: number } = {}) {
    const event = (type: number, phase: number, params: object) => ({ type, phase, params, source: { id } });
    return [
      event(1, 1, { url }),
      event(6, 0, {}),
      event(2, 0, { headers: ["HTTP/1.1 200", "content-encoding: gzip", "content-type: text/javascript"] }),
      event(3, 0, { byte_count: options.encoded ?? 30 }),
      event(3, 0, { byte_count: options.encoded === 0 ? 0 : 7 }),
      event(4, 0, { byte_count: options.decoded ?? 150 }),
      event(4, 0, { byte_count: 50 }),
      ...options.pending ? [] : [event(5, 2, options.failed ? { net_error: -2 } : {})],
    ];
  }
  const parse = (entries: ReturnType<typeof events>) => workerWireTransfers(JSON.stringify({
    constants: { logEventTypes: types }, events: entries,
  }));
  const input = () => asset(url, {
    encodedBodyBytes: 0, responseHeaderBytes: 80, transferBytes: 80, decodedBodyBytes: 200,
  });
  const good = parse(events(1));
  assert.deepEqual(good, [{ url, status: 200, mimeType: "text/javascript", bodyTransferBytes: 37, decodedBodyBytes: 200 }]);
  const http1Headers = ["HTTP/1.1 200 OK", "Content-Encoding: gzip", "Content-Type: text/javascript"];
  const http1Events = events(1).filter((event) => event.type !== 6);
  http1Events[1].params = { headers: http1Headers };
  const http1 = parse(http1Events);
  assert.equal(http1[0].responseHeaderBytes, Buffer.byteLength(http1Headers.join("\r\n") + "\r\n\r\n"));
  assert.equal("responseHeaderBytes" in good[0], false, "HTTP/2 header text must never be treated as HPACK wire bytes");
  const valid = input();
  assert.deepEqual(reconcileWorkerTransfers([valid], good), []);
  assert.equal(valid.transferBytes, 117, "sum body chunks once, then add headers once");
  assert.equal(valid.transferSource, "cdp-headers-plus-chromium-netlog-body");
  assert.deepEqual(reconcileWorkerTransfers([valid], good), []);
  assert.equal(valid.transferBytes, 117, "reconciliation must not add the body twice");
  const h2 = { ...input(), responseHeaderBytes: 80, transferBytes: 126 };
  assert.deepEqual(reconcileWorkerTransfers([h2], good), []);
  assert.equal(h2.transferBytes, 117, "HTTP/2 loadingFinished may include body/frame bytes; use response header evidence");
  const sw = { ...input(), responseHeaderBytes: undefined, transferBytes: http1[0].responseHeaderBytes! };
  assert.deepEqual(reconcileWorkerTransfers([sw], http1), []);
  assert.equal(sw.transferBytes, http1[0].responseHeaderBytes! + 37,
    "service-worker responses without CDP headers must confirm the HTTP/1 header-only finish");
  const unconfirmedSw = { ...input(), responseHeaderBytes: undefined, transferBytes: 999 };
  assert.deepEqual(reconcileWorkerTransfers([unconfirmedSw], http1),
    ["No complete wire-size evidence for migrated JavaScript"],
    "redacted/normalized headers or body-inclusive finishes must not fabricate header wire bytes");
  assert.deepEqual(parse(events(1, { failed: true })), []);
  assert.deepEqual(parse(events(1, { pending: true })), []);
  for (const [name, wire] of [
    ["ambiguous", parse([...events(1), ...events(2)])],
    ["failed", parse(events(1, { failed: true }))],
    ["incomplete", parse(events(1, { pending: true }))],
    ["decoded mismatch", parse(events(1, { decoded: 151 }))],
    ["zero body", parse(events(1, { encoded: 0 }))],
    ["wrong URL", good.map((r) => ({ ...r, url: url + "?other" }))],
  ] as const) {
    const candidate = input();
    const problems = reconcileWorkerTransfers([candidate], wire);
    assert.deepEqual(problems, ["No complete wire-size evidence for migrated JavaScript"], name);
    assert.equal(candidate.transferBytes, 80, name);
    assert.equal(candidate.transferSource, undefined, name);
    const outcome = evaluateTransferBudget({ ...sample, valid: problems.length === 0, problems }, budget, budget.profile);
    assert.equal(outcome.exitCode, 2, name);
    assert.deepEqual(outcome.violations, [], name);
  }
  const ordinary = asset(url, { encodedBodyBytes: 37, decodedBodyBytes: 200, transferBytes: 117 });
  assert.deepEqual(reconcileWorkerTransfers([ordinary], good), []);
  assert.equal(ordinary.transferBytes, 117, "ordinary CDP body must not be counted again");
  for (const responseHeaderBytes of [undefined, NaN, -1]) {
    const candidate = { ...input(), responseHeaderBytes };
    assert.deepEqual(reconcileWorkerTransfers([candidate], good),
      ["No complete wire-size evidence for migrated JavaScript"], "missing header evidence is not a valid match");
    assert.equal(candidate.transferBytes, 80);
  }
});
