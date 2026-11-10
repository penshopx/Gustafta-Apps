/**
 * Font-enabled spot checks, complementary to the offline visual gate.
 * Serves only Vite's frontend; API calls are intercepted (no DB or providers).
 * FONT_CAPTURE_LABEL=before captures evidence without enforcing the new policy.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "vite";
import puppeteer from "puppeteer-core";

const label = process.env.FONT_CAPTURE_LABEL || "after";
const fontStylesheets = (page) => page.evaluate(() => performance.getEntriesByType("resource")
  .filter((entry) => new URL(entry.name).hostname === "fonts.googleapis.com")
  .map((entry) => entry.name));
assert.match(label, /^[a-z-]+$/);
const output = resolve("generated-artifacts/public-fonts", label);
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });
  const report = [];
  for (const width of [1280, 390]) {
    for (const [name, path] of [
      ["beranda", "/"], ["login", "/login"], ["daftar", "/login?mode=register"],
      ["kontraktor", "/kontraktor"], ["dokumentasi", "/documentation"], ["harga", "/pricing"],
    ]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const failures = [];
      await page.setViewport({ width, height: width === 390 ? 844 : 800, deviceScaleFactor: 1 });
      await page.setCacheEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.origin === origin && url.pathname.startsWith("/api/")) {
          return request.respond({ status: 401, contentType: "application/json", body: '{"message":"Anonymous font check"}' });
        }
        if (url.origin === origin || ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return request.continue();
        return request.abort();
      });
      page.on("requestfailed", (request) => {
        if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) failures.push(`${request.url()}: ${request.failure()?.errorText}`);
      });
      try {
        await page.goto(origin + path, { waitUntil: "networkidle0", timeout: 60_000 });
        await page.waitForSelector("h1", { timeout: 30_000 });
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: `
          *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
          iframe, video, [data-replit], div.fixed.bottom-6, a[data-testid^="link-topbar-wa-"] { visibility: hidden !important; }
        ` });
        const fonts = await page.evaluate(() => ({
          heading: document.querySelector("h1").textContent.trim(),
          bodyFamily: getComputedStyle(document.body).fontFamily,
          headingFamily: getComputedStyle(document.querySelector("h1")).fontFamily,
          loaded: [...document.fonts].filter((font) => font.status === "loaded")
            .map((font) => ({ family: font.family, weight: font.weight, style: font.style })),
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
        let stylesheets = await fontStylesheets(page);
        assert.equal(failures.length, 0, `External font failures: ${failures.join("\n")}`);
        assert.ok(fonts.loaded.some((font) => font.family.replaceAll('"', "") === "DM Sans"), `${name}: DM Sans must actually load`);
        if (label !== "before") {
          assert.equal(stylesheets.length, 1, `${name}: one font stylesheet, no duplicate import or serif preload`);
          const families = new URL(stylesheets[0]).searchParams.getAll("family").map((value) => value.split(":")[0]);
          assert.deepEqual(families, ["DM Sans", "JetBrains Mono"]);
          assert.ok(fonts.loaded.every((font) => ["DM Sans", "JetBrains Mono"].includes(font.family.replaceAll('"', ""))));
        }
        await page.screenshot({ path: resolve(output, `${name}-${width}.png`) });
        report.push({ name, width, ...fonts, stylesheets });
        console.log(`${name} ${width}: ${fonts.headingFamily}; loaded: ${[...new Set(fonts.loaded.map((font) => font.family))].join(", ")}`);
        if (label !== "before" && name === "harga") {
          // Navigate within the SPA: the serif stylesheet must not have been
          // fetched above, but must become available on a real lazy route.
          await page.evaluate(() => {
            history.pushState(null, "", "/product/font-inventory");
            dispatchEvent(new PopStateEvent("popstate"));
          });
          await page.waitForFunction(() => document.querySelector("h1")?.textContent.includes("Halaman tidak ditemukan"));
          await page.waitForFunction(() => {
            for (const font of document.fonts) {
              if (font.family.replaceAll('"', "") === "Libre Baskerville") return true;
            }
            return false;
          }, { timeout: 30_000 });
          await page.evaluate(async () => {
            // Typography specimen only, not a bypass of any protected page.
            const sample = document.createElement("div");
            sample.className = "font-serif";
            sample.innerHTML = "<p>Dokumen — Konstruksi Indonesia 2026</p><p><b>Judul tebal</b> <i>Catatan miring</i></p>";
            sample.style.cssText = "padding:24px;font-size:24px;position:fixed;inset:0;background:white;color:black;z-index:99999";
            document.body.append(sample);
            await Promise.all([
              document.fonts.load('400 24px "Libre Baskerville"'),
              document.fonts.load('700 24px "Libre Baskerville"'),
              document.fonts.load('italic 400 24px "Libre Baskerville"'),
            ]);
          });
          stylesheets = await fontStylesheets(page);
          assert.equal(stylesheets.length, 2, "serif route adds exactly one stylesheet");
          assert.deepEqual(new URL(stylesheets[1]).searchParams.getAll("family"), ["Libre Baskerville:ital,wght@0,400;0,700;1,400"]);
          assert.ok(await page.evaluate(() => [...document.fonts].some((font) => font.family.replaceAll('"', "") === "Libre Baskerville" && font.status === "loaded")));
          await page.screenshot({ path: resolve(output, `serif-${width}.png`) });
          console.log(`serif ${width}: lazy stylesheet and regular/bold/italic faces loaded`);
        }
      } finally {
        await context.close();
      }
    }
  }
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
