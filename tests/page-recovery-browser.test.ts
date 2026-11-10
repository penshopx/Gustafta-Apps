import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer, { type CDPSession } from "puppeteer-core";

test("service worker serves cached JS/CSS offline and returns valid 503 responses for uncached assets", { timeout: 60000 }, async () => {
  const sw = await readFile(resolve("client/public/sw.js"), "utf8");
  const assets = new Map([
    ["/cached.js", { type: "text/javascript", body: "window.cachedAsset = true;" }],
    ["/cached.css", { type: "text/css", body: "body { color: green; }" }],
  ]);
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://fixture").pathname;
    res.setHeader("Cache-Control", "no-store");
    if (path === "/sw.js") {
      res.setHeader("Content-Type", "text/javascript");
      // Observe worker rejections as well as rejected page fetches.
      res.end(sw + `
        self.testUnhandledRejections = [];
        self.addEventListener("unhandledrejection", () => {
          self.testUnhandledRejections.push("worker-unhandled-rejection");
        });
      `);
    } else if (assets.has(path)) {
      const asset = assets.get(path)!;
      res.setHeader("Content-Type", asset.type);
      res.end(asset.body);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Service worker offline fixture</title>");
    }
  });
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    browser = await puppeteer.launch({
      executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(String(error)));
    await page.goto(url);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction("navigator.serviceWorker.controller !== null");
    const worker = await browser.waitForTarget(target => target.type() === "service_worker" && target.url() === `${url}/sw.js`);
    const session = await worker.createCDPSession();
    await session.send("Network.enable");
    // Fetch through the actual worker, not Chromium's HTTP cache.
    await page.setCacheEnabled(false);
    for (const [path, asset] of assets) {
      const result = await page.evaluate(async path => {
        const response = await fetch(path);
        return { status: response.status, body: await response.text() };
      }, path);
      assert.deepEqual(result, { status: 200, body: asset.body });
    }
    // Wait for the worker's asynchronous cache writes before going offline.
    await page.waitForFunction(`(async () => {
      const js = await caches.match("/cached.js");
      const css = await caches.match("/cached.css");
      return Boolean(js && css);
    })()`);
    await page.setOfflineMode(true);
    await session.send("Network.emulateNetworkConditions", {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    for (const path of ["/cached.js", "/cached.css", "/missing.js", "/missing.css"]) {
      const result = await page.evaluate(async path => {
        const response = await fetch(path);
        return { status: response.status, body: await response.text() };
      }, path);
      const cached = assets.get(path);
      assert.deepEqual(result, cached
        ? { status: 200, body: cached.body }
        : { status: 503, body: "Offline" }, path);
    }
    // Include background revalidation failures for cache hits.
    await new Promise(done => setTimeout(done, 350));
    const rejections = await session.send("Runtime.evaluate", {
      expression: "self.testUnhandledRejections", returnByValue: true,
    });
    assert.deepEqual(rejections.result.value, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  }
});

// Explicit, isolated browser test: no app database or customer data.
// npx tsx --test tests/page-recovery-browser.test.ts
test("old tabs and controlled PWAs recover from replaced Vite assets without reload loops", { timeout: 120000 }, async () => {
  const parent = resolve("generated-artifacts");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "page-recovery-"));
  const boundary = resolve("client/src/components/page-error-boundary.tsx");
  const classifier = resolve("client/src/lib/page-load-error.ts");
  let server: ReturnType<typeof createServer> | undefined;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    await writeFile(join(root, "index.html"), '<div id="root"></div><script type="module" src="/entry.tsx"></script>');
    await writeFile(join(root, "entry.tsx"), `
      import React, { lazy, Suspense, useState } from "react";
      import { createRoot } from "react-dom/client";
      import { PageErrorBoundary } from ${JSON.stringify(boundary)};
      import { recordPreloadError } from ${JSON.stringify(classifier)};
      window.addEventListener("vite:preloadError", recordPreloadError);
      const Route = lazy(() => import("./route"));
      function App() {
        const [path, setPath] = useState(location.pathname);
        return <PageErrorBoundary><button id="navigate" onClick={() => {
          history.pushState(null, "", "/additional?keep=1#section");
          setPath(location.pathname);
        }}>Open route</button><Suspense fallback={<p>Loading</p>}>
          {path === "/additional" ? <Route /> : <p id="home">Home</p>}
        </Suspense></PageErrorBoundary>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    `);
    async function release(version: string) {
      await writeFile(join(root, "route.tsx"), `import React from "react"; import "./route.css";
        export default function Route() { return <h1 id="loaded">Release ${version}</h1>; }`);
      await writeFile(join(root, "route.css"), `h1 { color: ${version === "A" ? "blue" : "green"}; }`);
      const output = join(root, version);
      await build({
        configFile: false, root, plugins: [react()], logLevel: "error",
        build: { outDir: output, target: "esnext", emptyOutDir: true },
      });
      const files = new Map<string, Buffer>();
      files.set("/index.html", await readFile(join(output, "index.html")));
      for (const name of await readdir(join(output, "assets"))) {
        files.set(`/assets/${name}`, await readFile(join(output, "assets", name)));
      }
      return files;
    }
    const old = await release("A");
    const current = await release("B");
    assert.notDeepEqual([...old.keys()], [...current.keys()], "real builds must have different asset hashes");
    const sw = await readFile(resolve("client/public/sw.js"));
    const staticAssets = new Map<string, Buffer>();
    for (const name of ["icon-192.png", "icon-512.png", "manifest.json"]) {
      staticAssets.set(`/${name}`, await readFile(resolve("client/public", name)));
    }
    let replaced = false;
    let failKind = "js";
    let blockCurrentRoutes = false;
    let updateWorker = false;
    const missing: string[] = [];
    server = createServer((req, res) => {
      const path = new URL(req.url!, "http://fixture").pathname;
      res.setHeader("Cache-Control", "no-store");
      if (path === "/sw.js") {
        res.setHeader("Content-Type", "text/javascript");
        // Byte change exercises a real update without replacing production worker logic.
        res.end(updateWorker && replaced ? Buffer.concat([sw, Buffer.from("\n// Release B\n")]) : sw);
      } else if (staticAssets.has(path)) {
        res.setHeader("Content-Type", path.endsWith(".png") ? "image/png" : "application/json");
        res.end(staticAssets.get(path));
      } else if (path.startsWith("/assets/")) {
        const isStaleFailure = replaced && old.has(path) && !current.has(path) && path.endsWith(`.${failKind}`);
        const isCurrentFailure = blockCurrentRoutes && /\/route-.*\.(js|css)$/.test(path);
        const bytes = isStaleFailure || isCurrentFailure ? undefined
          : (replaced ? current.get(path) : old.get(path)) ?? old.get(path);
        if (!bytes) {
          missing.push(path);
          res.writeHead(404).end("Asset no longer exists");
        } else {
          res.setHeader("Content-Type", path.endsWith(".css") ? "text/css" : "text/javascript");
          res.end(bytes);
        }
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end((replaced ? current : old).get("/index.html"));
      }
    });
    await new Promise<void>(done => server!.listen(0, "127.0.0.1", done));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    browser = await puppeteer.launch({
      executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const scenarios = [
      ...["js", "css", "offline"].map(scenario => ({ mode: "tab", scenario })),
      ...["js", "css", "offline", "worker-update"].map(scenario => ({ mode: "pwa", scenario })),
    ];
    for (const { mode, scenario } of scenarios) {
      // A fresh origin storage partition prevents caches/registrations leaking between scenarios.
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const label = `${mode}/${scenario}`;
      let navigations = 0;
      page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
      await page.setCacheEnabled(false);
      replaced = false;
      failKind = scenario === "worker-update" ? "js" : scenario;
      blockCurrentRoutes = false;
      updateWorker = scenario === "worker-update";
      await page.goto(url);
      await page.waitForSelector("#home");
      let workerSession: CDPSession | undefined;
      if (mode === "pwa") {
        await page.evaluate(async () => {
          await navigator.serviceWorker.register("/sw.js");
          await navigator.serviceWorker.ready;
        });
        await page.waitForFunction("navigator.serviceWorker.controller !== null");
        // Reload under worker control to warm actual entry JS and navigation HTML.
        const response = await page.reload();
        assert.equal(response?.fromServiceWorker(), true, `${label}: HTML must pass through the worker`);
        await page.waitForSelector("#home");
        const entryAssets = [...old.keys()].filter(path => /\/index-.*\.js$/.test(path));
        const routeAssets = [...old.keys()].filter(path => /\/route-.*\.(js|css)$/.test(path));
        assert.ok(entryAssets.length > 0 && routeAssets.length >= 2);
        await page.waitForFunction(`(async () => {
          for (const path of ${JSON.stringify(["/", ...entryAssets])}) {
            if (!(await caches.match(path))) return false;
          }
          return true;
        })()`);
        const cachedHTML = await page.evaluate(async () => (await caches.match("/"))!.text());
        assert.ok(entryAssets.every(path => cachedHTML.includes(path)), `${label}: cached HTML is release A`);
        const cacheHasRoutes = await page.evaluate(async paths => {
          for (const path of paths) {
            if (await caches.match(path)) return true;
          }
          return false;
        }, routeAssets);
        assert.equal(cacheHasRoutes, false, `${label}: lazy route must not be warmed`);
        const worker = await browser.waitForTarget(target =>
          target.type() === "service_worker" && target.url() === `${url}/sw.js`
          && target.browserContext() === context);
        workerSession = await worker.createCDPSession();
        await workerSession.send("Network.enable");
      }
      // Keep the old runtime in the tab, but serve the next release.
      replaced = true;
      const beforeWorkerUpdate = navigations;
      if (scenario === "worker-update") {
        await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          const changed = new Promise<void>(done =>
            navigator.serviceWorker.addEventListener("controllerchange", () => done(), { once: true }));
          await registration!.update();
          await changed;
        });
        assert.equal(await page.$eval("#home", el => el.textContent), "Home",
          "worker activation must not reload the existing tab");
        assert.equal(navigations, beforeWorkerUpdate, "worker update must not navigate");
      }
      const previousMissing = missing.length;
      if (scenario === "offline") {
        await page.setOfflineMode(true);
        await workerSession?.send("Network.emulateNetworkConditions", {
          offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
        });
        if (mode === "pwa") {
          const cachedHome = await page.evaluate(async () => {
            const response = await fetch("/");
            return { status: response.status, text: await response.text() };
          });
          assert.equal(cachedHome.status, 200, "offline worker must serve its warmed HTML");
          assert.match(cachedHome.text, /\/assets\/index-.*\.js/, "offline HTML must contain the cached entry");
        }
      }
      const beforeRoute = navigations;
      await page.click("#navigate");
      await page.waitForSelector('[data-testid="page-recovery"]');
      assert.equal(navigations, beforeRoute + 1, `${label}: only the requested history.pushState navigation`);
      assert.match(await page.$eval("h1", el => el.textContent!), /Halaman belum berhasil dimuat/);
      if (scenario !== "offline") {
        assert.ok(missing.slice(previousMissing).some(path => path.endsWith(`.${failKind}`)), label);
      } else {
        await page.waitForFunction('document.querySelector("button").disabled === true');
        assert.match(await page.$eval("body", el => el.textContent!), /Anda sedang offline/);
        await new Promise(done => setTimeout(done, 350));
        assert.equal(navigations, beforeRoute + 1, `${label}: no offline reload`);
        await workerSession?.send("Network.emulateNetworkConditions", {
          offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
        });
        await page.setOfflineMode(false);
        await page.waitForFunction('document.querySelector("button").disabled === false');
      }
      const beforeReload = navigations;
      await new Promise(done => setTimeout(done, 350));
      assert.equal(navigations, beforeReload, "neither failure nor online recovery triggers an automatic reload");
      // Even a fresh release whose assets still fail must remain a manual retry.
      blockCurrentRoutes = scenario === "js";
      await Promise.all([page.waitForNavigation(), page.click("button")]);
      if (blockCurrentRoutes) {
        await page.waitForSelector('[data-testid="page-recovery"]');
        const afterFailedReload = navigations;
        await new Promise(done => setTimeout(done, 350));
        assert.equal(navigations, afterFailedReload, "a repeated failure cannot cause a reload loop");
        blockCurrentRoutes = false;
        await Promise.all([page.waitForNavigation(), page.click("button")]);
      }
      await page.waitForSelector("#loaded");
      assert.equal(await page.$eval("#loaded", el => el.textContent), "Release B");
      assert.equal(await page.$eval("#loaded", el => getComputedStyle(el).color), "rgb(0, 128, 0)",
        `${label}: release B stylesheet must load too`);
      assert.equal(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash,
        "/additional?keep=1#section", "explicit reload preserves the requested route");
      await context.close();
    }
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done()));
    await rm(root, { recursive: true, force: true });
  }
});
