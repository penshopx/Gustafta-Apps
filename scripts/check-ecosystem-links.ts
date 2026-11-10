/**
 * Pemeriksaan jaringan terpisah dari npm test.
 * Jalankan: npm run check:ecosystem-links
 */
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import {
  ISO_ECOSYSTEM_APPS,
  PROJECT_ECOSYSTEM_APPS,
} from "../client/src/data/ecosystem-apps";

type AppLink = { name: string; href: string };
type Fetcher = typeof fetch;

const apps: AppLink[] = [...ISO_ECOSYSTEM_APPS, ...PROJECT_ECOSYSTEM_APPS];
const TIMEOUT_MS = 10_000;
// Separate providers: an HTTP response from any proves the runner can
// reach the public internet. The third provider is only tried if both primary
// providers fail. Never include these addresses in reports/logs.
const CONNECTIVITY_PROBES = ["https://www.google.com/generate_204", "https://www.cloudflare.com/cdn-cgi/trace"];
const FALLBACK_CONNECTIVITY_PROBE = "https://www.wikipedia.org/";

type LinkResult = { failure: string | null; connectionFailed: boolean; responseReceived: boolean };

function describeResponse(response: Response): string {
  if (response.status >= 300 && response.status < 400) {
    return `redirect HTTP ${response.status}`;
  }
  return `HTTP ${response.status}`;
}

async function checkLinkResult(
  app: AppLink,
  fetcher: Fetcher,
): Promise<LinkResult> {
  let url: URL;
  try {
    url = new URL(app.href);
  } catch {
    return { failure: `${app.name}: URL tidak valid`, connectionFailed: false, responseReceived: false };
  }
  if (url.protocol !== "https:") {
    return { failure: `${app.name}: URL harus HTTPS`, connectionFailed: false, responseReceived: false };
  }

  const controller = new AbortController();
  const timeoutResult: LinkResult = {
    failure: `${app.name}: timeout setelah ${TIMEOUT_MS / 1000} detik`,
    connectionFailed: true,
    responseReceived: false,
  };
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<LinkResult>((resolve) => {
    timer = setTimeout(() => {
      resolve(timeoutResult);
      controller.abort();
    }, TIMEOUT_MS);
  });
  const request = (async (): Promise<LinkResult> => {
    try {
      let response = await fetcher(app.href, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
      });
      // Some hosts reject HEAD. A read-only GET is the compatibility fallback;
      // do not download the response body.
      if (response.status === 405 || response.status === 501) {
        await response.body?.cancel();
        if (controller.signal.aborted) return timeoutResult;
        response = await fetcher(app.href, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
        });
      }
      await response.body?.cancel();
      if (controller.signal.aborted) return timeoutResult;
      if (response.status >= 200 && response.status < 300) return { failure: null, connectionFailed: false, responseReceived: true };
      return { failure: `${app.name}: ${describeResponse(response)}`, connectionFailed: false, responseReceived: true };
    } catch {
      return controller.signal.aborted
        ? timeoutResult
        : { failure: `${app.name}: gagal terhubung`, connectionFailed: true, responseReceived: false };
    }
  })();
  try {
    // Abort is best-effort. Bound HEAD, fallback GET and body cancellation
    // together, and observe the request even when it settles after the deadline.
    return await Promise.race([deadline, request]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function checkLink(app: AppLink, fetcher: Fetcher = fetch): Promise<string | null> {
  return (await checkLinkResult(app, fetcher)).failure;
}

async function probeAddress(address: string, fetcher: Fetcher): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
      controller.abort();
    }, 5_000);
  });
  const request = (async () => {
    // A provider may close HEAD at the edge instead of returning 405.
    // Try GET only when HEAD did not produce an HTTP response.
    for (const method of ["HEAD", "GET"]) {
      try {
        const response = await fetcher(address, {
          method, redirect: "manual", signal: controller.signal,
        });
        // Cancellation is only an optimization; the HTTP response already
        // established connectivity. Do not wait for a stuck cancellation,
        // and handle failures even when the response arrives after the deadline.
        try { void response.body?.cancel().catch(() => {}); } catch { /* no body is consumed */ }
        if (controller.signal.aborted) return false;
        return true; // Any HTTP response proves connectivity, even 4xx/5xx.
      } catch {
        if (controller.signal.aborted) break;
      }
    }
    return false;
  })();
  try {
    // Abort is best-effort: fetch implementations may ignore it. The race
    // bounds HEAD + GET together and observes late request rejections.
    return await Promise.race([deadline, request]);
  } finally {
    clearTimeout(timer!);
  }
}

async function probeConnectivity(fetcher: Fetcher): Promise<boolean> {
  const results = await Promise.all(CONNECTIVITY_PROBES.map((address) => probeAddress(address, fetcher)));
  if (results.some(Boolean)) return true;
  return probeAddress(FALLBACK_CONNECTIVITY_PROBE, fetcher);
}

export async function checkEcosystemLinkHealth(
  links: readonly AppLink[] = apps,
  fetcher: Fetcher = fetch,
): Promise<{ failures: string[]; networkUnavailable: boolean }> {
  if (links.length === 0) return { failures: ["Daftar aplikasi eksternal kosong"], networkUnavailable: false };
  const results = await Promise.all(links.map((app) => checkLinkResult(app, fetcher)));
  const hasConnectionFailures = results.some((result) => result.connectionFailed);
  // An HTTP response from an app also proves this runner can reach the internet.
  // If a probe changes policy, do not suppress app failures when another responds.
  const appResponded = results.some((result) => result.responseReceived);
  const networkUnavailable = hasConnectionFailures && !appResponded && !await probeConnectivity(fetcher);
  return {
    failures: results.filter((result) => !networkUnavailable || !result.connectionFailed)
      .map((result) => result.failure).filter((failure): failure is string => failure !== null),
    networkUnavailable,
  };
}

export async function checkEcosystemLinks(
  links: readonly AppLink[] = apps,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  return (await checkEcosystemLinkHealth(links, fetcher)).failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { failures, networkUnavailable } = await checkEcosystemLinkHealth();
  if (process.env.ECOSYSTEM_HEALTH_REPORT) {
    await writeFile(process.env.ECOSYSTEM_HEALTH_REPORT, JSON.stringify(failures), { mode: 0o600 });
  }
  if (networkUnavailable && process.env.ECOSYSTEM_NETWORK_UNAVAILABLE) {
    await writeFile(process.env.ECOSYSTEM_NETWORK_UNAVAILABLE, "unavailable", { mode: 0o600 });
  }
  if (!networkUnavailable && process.env.ECOSYSTEM_LINKS_COMPLETE) {
    await writeFile(process.env.ECOSYSTEM_LINKS_COMPLETE, "ok", { mode: 0o600 });
  }
  if (networkUnavailable) {
    console.error("Konektivitas pemeriksa tidak dapat dipastikan; kegagalan koneksi aplikasi tidak dilaporkan.");
    process.exitCode = 1;
  }
  if (failures.length) {
    console.error(`Pemeriksaan aplikasi eksternal gagal (${failures.length}/${apps.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else if (!networkUnavailable) {
    console.log(`${apps.length} aplikasi eksternal dapat diakses.`);
  }
}