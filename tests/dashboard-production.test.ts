import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import puppeteer, { type Page } from "puppeteer-core";
import { serveProductionTransfer } from "../scripts/lib/initial-js-production-server";

const output = resolve("generated-artifacts/dashboard-production");
const panels = [
  { module: "policy-panel", label: "Kebijakan Agen", selector: '[data-testid="button-preview-policy-prompt"]' },
  { module: "agentic-ai-panel", label: "Agentic AI", selector: '[data-testid="toggle-advanced-mode"]' },
  { module: "knowledge-base-panel", label: "Knowledge Base", selector: '[data-testid="switch-rag-toggle"]' },
  { module: "project-brain-panel", label: "Otak Proyek", heading: "Otak Proyek" },
  { module: "mini-apps-panel", label: "Mini Apps", selector: '[data-testid="button-create-mini-app"]' },
  { module: "deliverables-panel", label: "Deliverables", selector: '[data-testid="button-apply-preset-defaults"]' },
  { module: "studio-panel", label: "Studio Kompetensi", selector: '[data-testid="panel-studio"]' },
  { module: "ekosistem-panel", label: "Studio Belajar", selector: '[data-testid="button-ekosistem-multiclaw"]' },
  { module: "integrations-panel", label: "Integrations", heading: "Integrations" },
  { module: "widget-panel", label: "Widget", heading: "Widget Customization" },
  { module: "broadcast-panel", label: "Broadcast WA", heading: "WA Broadcast" },
  { module: "tender-panel", label: "Info Tender", selector: '[data-testid="tabs-tender"]' },
  { module: "conversion-panel", label: "Conversion", selector: '[data-testid="button-save-conversion"]' },
  { module: "landing-page-panel", label: "Rangkuman Chatbot", selector: '[data-testid="tab-landing-generator"]' },
  { module: "marketing-panel", label: "Brief Marketing", selector: '[data-testid="text-marketing-title"]' },
  { module: "product-settings-panel", label: "Monetisasi", selector: '[data-testid="textarea-product-problem"]' },
  { module: "revenue-panel", label: "Revenue & Klien", heading: "Revenue & Klien" },
  { module: "affiliate-panel", label: "Afiliasi", heading: "Program Afiliasi" },
  { module: "voucher-panel", label: "Voucher", selector: '[data-testid="input-voucher-name"]' },
  { module: "chat-console-panel", label: "Chat Console", selector: '[data-testid="button-export-chat"]' },
  { module: "analytics-panel", label: "Analytics", heading: "Analytics" },
  { module: "admin-agents-panel", label: "Sistem Agen AI", selector: '[data-testid="button-refresh-agents"]' },
];
const modules = [
  ...panels.map(panel => panel.module),
  "user-profile-dialog", "share-agent-dialog", "edit-big-idea-dialog", "edit-toolbox-dialog",
];

test("production dashboard opens real panels/dialogs and keeps its shell for admin and non-admin", { timeout: 240_000 }, async () => {
  // Do not silently omit a newly introduced lazy dashboard panel.
  const dashboardSource = await readFile(resolve("client/src/pages/dashboard.tsx"), "utf8");
  const declaredPanels = [...dashboardSource.matchAll(/import\("@\/components\/panels\/([^"]+)"\)/g)].map(match => match[1]);
  assert.deepEqual([...panels.map(panel => panel.module)].sort(), declaredPanels.sort());
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "report.json"), JSON.stringify({ passed: false, reason: "Check did not finish" }));
  // Build in a fresh process with no application/database/provider secrets.
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", resolve("tests/fixtures/dashboard-production/build.ts")], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: "production" },
      stdio: "inherit", timeout: 120_000,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? done() : reject(new Error(`Fixture build failed: ${signal ?? code}`)));
  });
  const chunks: Record<string, string> = JSON.parse(await readFile(resolve(output, "chunks.json"), "utf8"));
  for (const name of modules) assert.ok(chunks[name], `Real module absent from production build: ${name}`);
  const server = await serveProductionTransfer(resolve(output, "public"));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  const results: unknown[] = [];
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH ?? execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, TZ: "UTC", LANG: "en_US.UTF-8" },
    });
    for (const admin of [false, true]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      page.setDefaultTimeout(12_000);
      const errors: string[] = [];
      const forbidden: string[] = [];
      const fetched = new Set<string>();
      const apiReads: string[] = [];
      const adminStatuses: number[] = [];
      let step = "initial Persona";
      page.on("pageerror", error => errors.push(String(error)));
      page.on("response", response => {
        const url = new URL(response.url());
        if (url.pathname === "/api/admin/agents/status") adminStatuses.push(response.status());
        if (url.pathname.startsWith("/assets/") && url.pathname.endsWith(".js")) {
          if (response.status() !== 200) errors.push(`Chunk HTTP ${response.status()}: ${url.pathname}`);
          else fetched.add(url.pathname.slice(1));
        }
      });
      await page.setRequestInterception(true);
      page.on("request", request => {
        const url = new URL(request.url());
        if (url.origin !== new URL(server.url).origin || request.method() !== "GET") {
          forbidden.push(`${request.method()} ${url.origin}${url.pathname}`);
          void request.abort();
          return;
        }
        if (!url.pathname.startsWith("/api/")) { void request.continue(); return; }
        apiReads.push(url.pathname);
        let body: unknown;
        let status = 200;
        switch (url.pathname) {
          case "/api/partner/by-host": body = null; break;
          case "/api/analytics/dashboard-fixture/summary":
            body = { totalMessages: 42, totalSessions: 7, totalIntegrationCalls: 0, messagesLast7Days: [1, 2, 3, 4, 5, 6, 21], topHours: [] }; break;
          case "/api/knowledge-base/dashboard-fixture":
          case "/api/mini-apps/dashboard-fixture":
          case "/api/project-brain/templates/dashboard-fixture":
          case "/api/project-brain/instances/dashboard-fixture":
          case "/api/integrations/dashboard-fixture":
          case "/api/internal/agents-for-toolbox/3":
          case "/api/memories/dashboard-fixture":
          case "/api/agentic-deliverables/dashboard-fixture":
          case "/api/leads/dashboard-fixture":
          case "/api/clients/dashboard-fixture":
          case "/api/affiliates":
          case "/api/vouchers":
          case "/api/wa-contacts/dashboard-fixture":
          case "/api/wa-broadcasts":
          case "/api/tender-sources":
          case "/api/tenders":
          case "/api/cores":
          case "/api/agents/dashboard-fixture/collaborators":
          case "/api/agents/dashboard-fixture/pending-invites": body = []; break;
          case "/api/admin/agents/status":
            status = admin ? 200 : 403;
            body = admin ? {} : { message: "Fixture access denied" }; break;
          case "/api/project-brain/instances/dashboard-fixture/active": body = null; break;
          case "/api/agents/dashboard-fixture/policy-defaults": body = { seriesName: null, defaults: {} }; break;
          case "/api/knowledge-base/dashboard-fixture/rag-stats":
            body = { totalChunks: 0, totalKnowledgeBases: 0, ragEnabled: false, chunksByKb: [] }; break;
          case "/api/clients/dashboard-fixture/stats":
            body = { totalClients: 0, activeClients: 0, revenueThisMonth: 0, trialClients: 0 }; break;
          case "/api/config/app-url": body = { appUrl: server.url.replace(/\/$/, "") }; break;
          case "/api/public/modul/2": body = { slug: "fixture-module" }; break;
          default:
            forbidden.push(`Unexpected API read: ${url.pathname}`);
            status = 500; body = { message: "Unconfigured fixture endpoint" };
        }
        void request.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
      });
      try {
        await page.goto(`${server.url}?admin=${admin}`, { waitUntil: "networkidle0" });
        await page.waitForSelector('input#name');
        // The same actual shell element must survive all lazy suspensions and tab changes.
        await page.evaluate(() => {
          document.querySelector("aside")!.setAttribute("data-fixture-shell", "retained");
          document.querySelector("header")!.setAttribute("data-fixture-header", "retained");
        });
        async function shell() {
          assert.ok(await page.$('aside[data-fixture-shell="retained"]'), "Dashboard sidebar shell was replaced");
          assert.ok(await page.$('header[data-fixture-header="retained"]'), "Dashboard header was replaced");
          assert.equal(await page.$('[data-testid="page-recovery"]'), null, "Lazy import reached error boundary");
          assert.equal(new URL(page.url()).pathname, "/", "Tab change navigated away");
        }
        async function open(label: string, selector: string) {
          await clickButton(page, label);
          await page.waitForSelector(selector, { visible: true });
          await shell();
        }
        const openedPanels: string[] = [];
        async function openPanel(panel: typeof panels[number]) {
          step = panel.module;
          await clickButton(page, panel.label);
          if (panel.selector) await page.waitForSelector(panel.selector, { visible: true });
          else await page.waitForFunction((heading) => {
            for (const element of document.querySelectorAll("h2")) {
              if (element.getClientRects().length && element.textContent?.trim() === heading) return true;
            }
            return false;
          }, {}, panel.heading);
          await shell();
          if (panel.module === "analytics-panel") {
            await page.waitForFunction('document.body.textContent.includes("Messages Last 7 Days") && document.body.textContent.includes("42")');
          }
        }
        for (const panel of panels) {
          await openPanel(panel);
          if (panel.module === "mini-apps-panel") {
            for (const viewport of [{ width: 1024, height: 576 }, { width: 390, height: 700 }]) {
              step = `mini-apps-panel scroll ${viewport.width}: open`;
              await page.setViewport(viewport);
              await clickSelector(page, '[data-testid="button-create-mini-app"]');
              await page.waitForSelector('[role="dialog"]', { visible: true });
              await page.focus('[aria-label="Tipe Mini App"]');
              await page.keyboard.press("ArrowDown");
              await page.waitForSelector('[role="listbox"]', { visible: true });
              step = `mini-apps-panel scroll ${viewport.width}: wheel`;
              const bounds = await page.$eval('[role="listbox"]', element => {
                const rect = element.getBoundingClientRect();
                return { top: rect.top, bottom: rect.bottom, height: rect.height };
              });
              assert.ok(bounds.top >= 0 && bounds.bottom <= viewport.height, "Mini App type menu must fit the screen");
              assert.ok(bounds.height <= 320, "Long type menu must have a bounded height");
              const scrollable = '[role="listbox"] [data-radix-select-viewport]';
              const area = await page.$eval(scrollable, element => {
                const rect = element.getBoundingClientRect();
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
                  overflow: element.scrollHeight > element.clientHeight };
              });
              assert.ok(area.overflow, "Type choices must overflow the scrollable viewport");
              await page.mouse.move(area.x, area.y);
              await page.mouse.wheel({ deltaY: 500 });
              await page.waitForFunction(() =>
                (document.querySelector('[role="listbox"] [data-radix-select-viewport]')?.scrollTop ?? 0) > 0);
              step = `mini-apps-panel scroll ${viewport.width}: choose last`;
              await page.keyboard.press("End");
              await page.waitForFunction(() => {
                const options = document.querySelectorAll('[role="listbox"] [role="option"]');
                return options.length > 0 && document.activeElement === options[options.length - 1];
              });
              const options = await page.$$('[role="listbox"] [role="option"]');
              await options[options.length - 1].click();
              await page.waitForSelector('[role="listbox"]', { hidden: true });
              const dialog = await page.$('[role="dialog"]');
              assert.ok(dialog);
              if (!admin) await page.screenshot({
                path: resolve(output, `mini-app-scroll-${viewport.width}.png`),
              });
              await page.keyboard.press("Escape");
              await page.waitForSelector('[role="dialog"]', { hidden: true });
            }
            await page.setViewport({ width: 1440, height: 1000 });
          }
          openedPanels.push(panel.module);
          await open("Persona", "input#name");
          assert.equal(await page.$eval("input#name", el => (el as HTMLInputElement).value), "Dashboard Fixture Agent");
          // Reopening must work too (module cache and unmount/remount).
          await openPanel(panel);
        }
        assert.ok(apiReads.includes("/api/admin/agents/status"), "Admin panel must read its protected status");
        await page.waitForNetworkIdle();
        assert.ok(adminStatuses.length > 0, "Missing protected status response");
        assert.ok(adminStatuses.every(status => status === (admin ? 200 : 403)), "Role-specific API response changed");
        await open("Persona", "input#name");

        async function dialog(trigger: () => Promise<unknown>, selector: string) {
          step = selector;
          await trigger();
          await page.waitForSelector(`[role="dialog"] ${selector}`, { visible: true });
          await shell();
          await page.keyboard.press("Escape");
          await page.waitForSelector('[role="dialog"]', { hidden: true });
          await shell();
        }
        await dialog(() => clickButtonContaining(page, "Fixture Profile"), 'input#displayName');
        await dialog(() => clickSelector(page, '[data-testid="button-edit-agent-dashboard-fixture"]'), '[data-testid="input-edit-agent-name"]');
        await dialog(() => clickSelector(page, '[data-testid="button-share-agent-dashboard-fixture"]'), '[data-testid="input-share-email"]');
        await clickSelector(page, '[data-testid="breadcrumb-chatbot"]');
        await clickSelector(page, '[data-testid="toggle-biasa-group"]');
        await dialog(() => clickSelector(page, '[data-testid="button-edit-toolbox-3"]'), '[data-testid="input-edit-toolbox-name"]');
        await clickSelector(page, '[data-testid="breadcrumb-modul"]');
        await dialog(() => clickSelector(page, '[data-testid="button-edit-bigidea-2"]'), '[data-testid="input-edit-bigidea-name"]');
        await open("Persona", "input#name");
        await page.screenshot({ path: resolve(output, admin ? "admin.png" : "user.png") });
        for (const name of modules) assert.ok(fetched.has(chunks[name]), `Real production chunk not loaded: ${name}`);
        assert.deepEqual(errors, [], "Browser errors");
        assert.deepEqual(forbidden, [], "Unexpected requests (no writes or external services allowed)");
        results.push({ admin, modules, openedPanels, apiReads, adminStatuses, passed: true });
      } catch (error) {
        await page.screenshot({ path: resolve(output, "failure.png") });
        const message = `admin=${admin}, step=${step}: ${String(error)}; browser=${JSON.stringify(errors)}; blocked=${JSON.stringify(forbidden)}`;
        await writeFile(resolve(output, "report.json"), JSON.stringify({ passed: false, results, error: message }, null, 2));
        throw new Error(message);
      } finally { await context.close(); }
    }
    await writeFile(resolve(output, "report.json"), JSON.stringify({ passed: true, results }, null, 2));
  } finally {
    await browser?.close();
    await server.close();
  }
});

async function clickButton(page: Page, label: string) {
  // Native DOM click also works for sidebar entries below its scroll viewport.
  const found = await page.evaluate((text) => {
    for (const button of document.querySelectorAll("button")) {
      const content = button.textContent?.trim();
      if ((content === text || content === `${text}New`) && button.getClientRects().length && !button.disabled) {
        button.click(); return true;
      }
    }
    return false;
  }, label);
  assert.ok(found, `Visible dashboard button not found: ${label}`);
}

async function clickButtonContaining(page: Page, label: string) {
  const found = await page.evaluate((text) => {
    for (const button of document.querySelectorAll<HTMLButtonElement>("aside button")) {
      if (button.textContent?.includes(text) && button.getClientRects().length && !button.disabled) {
        button.click(); return true;
      }
    }
    return false;
  }, label);
  assert.ok(found, `Hierarchy button not found: ${label}`);
}

async function clickSelector(page: Page, selector: string) {
  await page.waitForSelector(selector);
  // Dashboard recreates the sidebar subtree on hover. Dispatch to the current
  // DOM target directly so a coordinate click cannot accidentally activate a row.
  await page.$eval(selector, el => (el as HTMLElement).click());
}
