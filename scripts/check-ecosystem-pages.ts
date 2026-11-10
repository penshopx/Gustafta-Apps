/**
 * Pemeriksaan tampilan publik terjadwal (bukan bagian dari npm test).
 * Jalankan setelah check:ecosystem-links agar laporan kegagalan dapat digabung.
 */
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Browser, getInstalledBrowsers } from "@puppeteer/browsers";
import puppeteer from "puppeteer-core";
import type { ChildProcess } from "node:child_process";
import { cleanupOwnedBrowser, ownedBrowserProcessRunning } from "./lib/owned-browser-cleanup";
import {
  ISO_ECOSYSTEM_APPS,
  PROJECT_ECOSYSTEM_APPS,
} from "../client/src/data/ecosystem-apps";

const apps = [...ISO_ECOSYSTEM_APPS, ...PROJECT_ECOSYSTEM_APPS];
const PAGE_TIMEOUT_MS = 15_000;
const HEADING_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 5_000;
const CLOSE_TIMEOUT_MS = 5_000;
const CLEANUP_TIMEOUT_MS = 1_000;
/** Shorter deadlines can be injected for offline regression tests. */
interface PageCheckOptions {
  /** Bounds each newPage() independently of Puppeteer's navigation timeout. */
  openTimeoutMs?: number;
  closeTimeoutMs?: number;
  /** Total emergency budget for the owned child and browser transport. */
  cleanupTimeoutMs?: number;
  /** Test seam: must create a fresh checker-owned browser, never an external one. */
  launchBrowser?: () => ReturnType<typeof puppeteer.launch>;
}
// Any HTTP response from either independent provider proves browser connectivity.
// These addresses must never appear in reports or logs.
const CONNECTIVITY_PROBES = ["https://www.google.com/generate_204", "https://www.cloudflare.com/cdn-cgi/trace"];

export class BrowserUnavailableError extends Error {
  constructor() {
    super("Browser pemeriksa tidak tersedia");
  }
}

async function withBrowserDeadline<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new BrowserUnavailableError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function openPageWithDeadline(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  openTimeoutMs: number,
  closeTimeoutMs: number,
) {
  let abandoned = false;
  try {
    return await withBrowserDeadline(async () => {
      const page = await browser.newPage();
      if (abandoned) {
        // A tab arriving after the deadline must never be checked or publish
        // results. Dispose of it best-effort without delaying the failure path.
        void withBrowserDeadline(() => page.close(), closeTimeoutMs).catch(() => {});
        throw new BrowserUnavailableError();
      }
      return page;
    }, openTimeoutMs);
  } catch {
    abandoned = true;
    throw new BrowserUnavailableError();
  }
}

async function browserExecutable(): Promise<string> {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const installed = await getInstalledBrowsers({ cacheDir: join(homedir(), ".cache", "puppeteer") });
  const chrome = installed.find((item) => item.browser === Browser.CHROME);
  if (!chrome) throw new Error("Chrome tidak tersedia");
  return chrome.executablePath;
}

async function browserHasConnectivity(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>,
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
): Promise<boolean> {
  for (const address of CONNECTIVITY_PROBES) {
    try {
      const response = await page.goto(address, { waitUntil: "domcontentloaded", timeout: 5_000 });
      if (response) return true;
    } catch {
      if (!browser.isConnected()) throw new BrowserUnavailableError();
    }
    if (!browser.isConnected()) throw new BrowserUnavailableError();
  }
  return false;
}

export async function checkEcosystemPageHealth(
  browserOverride?: Awaited<ReturnType<typeof puppeteer.launch>>,
  options: PageCheckOptions = {},
): Promise<{ failures: string[]; networkUnavailable: boolean }> {
  const openTimeoutMs = options.openTimeoutMs ?? OPEN_TIMEOUT_MS;
  const closeTimeoutMs = options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS;
  if (!Number.isFinite(openTimeoutMs) || openTimeoutMs <= 0 || openTimeoutMs > OPEN_TIMEOUT_MS) {
    throw new Error("Batas waktu pembukaan tidak valid");
  }
  if (!Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0 || closeTimeoutMs > CLOSE_TIMEOUT_MS) {
    throw new Error("Batas waktu penutupan tidak valid");
  }
  if (!Number.isFinite(cleanupTimeoutMs) || cleanupTimeoutMs <= 0 || cleanupTimeoutMs > CLEANUP_TIMEOUT_MS) {
    throw new Error("Batas waktu pembersihan tidak valid");
  }
  if (!apps.length) return { failures: ["Daftar aplikasi eksternal kosong"], networkUnavailable: false };
  let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  const ownsBrowser = browserOverride == null;
  let ownedChild: ChildProcess | null = null;
  try {
    browser = browserOverride ?? await (options.launchBrowser ?? (async () => puppeteer.launch({
      executablePath: await browserExecutable(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    })))();
    if (ownsBrowser) {
      // Capture the exact child once, while ownership is known. Overrides are
      // never queried for a process handle, even after a shutdown timeout.
      try { ownedChild = browser.process(); } catch { /* no ownership proof */ }
    }
  } catch {
    throw new BrowserUnavailableError();
  }

  const failures: string[] = [];
  let networkUnavailable = false;
  try {
    for (const app of apps) {
      let page;
      try {
        page = await openPageWithDeadline(browser, openTimeoutMs, closeTimeoutMs);
      } catch {
        throw new BrowserUnavailableError();
      }
      try {
        const response = await page.goto(app.href, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT_MS,
        });
        if (!response || response.status() < 200 || response.status() >= 300) {
          failures.push(`${app.name}: halaman HTTP ${response?.status() ?? "tidak tersedia"}`);
          continue;
        }
        if (new URL(page.url()).origin !== new URL(app.href).origin) {
          failures.push(`${app.name}: halaman dialihkan ke domain lain`);
          continue;
        }
        // Require app-specific visible content after JavaScript renders; a 200
        // response with an empty root, generic error page, or another app fails.
        await page.waitForFunction(
          (expected) => {
            for (const heading of document.querySelectorAll("h1")) {
              if (heading.getClientRects().length > 0 &&
                  getComputedStyle(heading).visibility === "visible" &&
                  (heading as HTMLElement).innerText.replace(/\s+/g, " ").trim().includes(expected)) {
                return true;
              }
            }
            return false;
          },
          { timeout: HEADING_TIMEOUT_MS, polling: 250 },
          app.healthHeading,
        );
      } catch {
        if (!browser.isConnected()) throw new BrowserUnavailableError();
        if (await browserHasConnectivity(page, browser)) {
          failures.push(`${app.name}: halaman kosong, salah, atau gagal dimuat`);
        } else {
          networkUnavailable = true;
        }
      } finally {
        if (browser.isConnected()) {
          try {
            await withBrowserDeadline(() => page.close(), closeTimeoutMs);
          } catch {
            throw new BrowserUnavailableError();
          }
        }
      }
      if (networkUnavailable) break;
    }
    if (!browser.isConnected()) throw new BrowserUnavailableError();
  } catch (error) {
    if (!browser.isConnected()) throw new BrowserUnavailableError();
    throw error;
  } finally {
    let shutdownFailed = false;
    try {
      if (!browser.isConnected()) throw new BrowserUnavailableError();
      // Cleanup must also be bounded, or a stuck tab can just move the hang
      // into browser.close() and prevent the unavailable marker being written.
      await withBrowserDeadline(() => browser.close(), closeTimeoutMs);
      // Puppeteer normally disconnects during close(). Only a clean exit of
      // our captured child proves this was shutdown rather than transport loss;
      // close() resolving alone is not proof (its callback can swallow errors).
      if (!browser.isConnected() &&
          !(ownsBrowser && ownedChild?.exitCode === 0 && ownedChild.signalCode === null)) {
        throw new BrowserUnavailableError();
      }
    } catch {
      shutdownFailed = true;
    }
    if (ownsBrowser && (shutdownFailed || ownedBrowserProcessRunning(ownedChild))) {
      // Also covers a disconnected transport and a close() that resolves
      // without actually reaping the child. Never force-clean an override.
      shutdownFailed = true;
      if (!await cleanupOwnedBrowser(browser, ownedChild, cleanupTimeoutMs)) {
        console.error("Pembersihan browser pemeriksa tidak dapat dipastikan selesai.");
      }
    }
    if (shutdownFailed) throw new BrowserUnavailableError();
  }
  return { failures, networkUnavailable };
}

export async function runPageCheck(
  browserOverride?: Awaited<ReturnType<typeof puppeteer.launch>>,
  options: PageCheckOptions = {},
): Promise<void> {
  const report = process.env.ECOSYSTEM_HEALTH_REPORT;
  let existing: string[] = [];
  if (report) {
    try {
      const parsed: unknown = JSON.parse(await readFile(report, "utf8"));
      if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
        throw new Error("Laporan tidak valid");
      }
      existing = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  let failures: string[];
  let networkUnavailable: boolean;
  try {
    ({ failures, networkUnavailable } = await checkEcosystemPageHealth(browserOverride, options));
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      if (process.env.ECOSYSTEM_BROWSER_UNAVAILABLE) {
        await writeFile(process.env.ECOSYSTEM_BROWSER_UNAVAILABLE, "unavailable", { mode: 0o600 });
      }
      console.error("Pemeriksaan tampilan tidak dapat dijalankan: browser pemeriksa tidak tersedia.");
    } else {
      console.error("Pemeriksaan tampilan tidak dapat diselesaikan.");
    }
    process.exitCode = 1;
    return;
  }
  // A failed HEAD request is already reported by the link checker; keep one
  // actionable reason per app in the operational email.
  const combined = [
    ...existing,
    ...failures.filter((failure) => !existing.some((item) =>
      item.startsWith(`${failure.split(":")[0]}:`))),
  ];
  if (report) await writeFile(report, JSON.stringify(combined), { mode: 0o600 });
  if (networkUnavailable && process.env.ECOSYSTEM_NETWORK_UNAVAILABLE) {
    await writeFile(process.env.ECOSYSTEM_NETWORK_UNAVAILABLE, "unavailable", { mode: 0o600 });
  }
  if (!networkUnavailable && process.env.ECOSYSTEM_PAGES_COMPLETE) {
    await writeFile(process.env.ECOSYSTEM_PAGES_COMPLETE, "ok", { mode: 0o600 });
  }
  if (networkUnavailable) {
    console.error("Konektivitas browser pemeriksa tidak dapat dipastikan; kegagalan halaman yang belum terbukti tidak dilaporkan.");
    process.exitCode = 1;
  }
  if (failures.length) {
    console.error(`Pemeriksaan tampilan gagal (${failures.length}/${apps.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else if (!networkUnavailable) {
    console.log(`${apps.length} halaman aplikasi eksternal tampil dengan benar.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runPageCheck();
}