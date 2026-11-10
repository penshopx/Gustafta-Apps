/**
 * Kirim ringkasan aman ke email operasional untuk kegagalan atau pemulihan.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { failedAppNames, isKnownAppName } from "./ecosystem-health-state";

type Fetcher = typeof fetch;
type EmailConfig = { apiKey?: string; recipient?: string; sender?: string };

export async function notifyNetworkUnavailable(
  config: EmailConfig,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  if (!config.apiKey || !config.recipient) {
    console.error("[Ecosystem alert] Pengiriman gagal: BREVO_API_KEY atau BREVO_ALERT_EMAIL belum dikonfigurasi di GitHub Actions secrets.");
    return false;
  }
  try {
    const message = "Konektivitas jaringan pemeriksa tautan tidak dapat dipastikan. Status koneksi aplikasi eksternal belum dapat dipastikan; periksa jaringan runner sebelum menyimpulkan aplikasi gagal.";
    const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Gustafta", email: config.sender || "noreply@gustafta.my.id" },
        to: [{ email: config.recipient }],
        subject: "Peringatan: konektivitas pemeriksa tautan terganggu",
        textContent: message,
        htmlContent: `<p>${message}</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`[Ecosystem alert] Pengiriman gagal: Brevo HTTP ${response.status}`);
      return false;
    }
    console.log("[Ecosystem alert] Gangguan konektivitas pemeriksa dilaporkan.");
    return true;
  } catch {
    console.error("[Ecosystem alert] Pengiriman gagal: koneksi ke Brevo bermasalah.");
    return false;
  }
}

export async function notifyBrowserUnavailable(
  config: EmailConfig,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  if (!config.apiKey || !config.recipient) {
    console.error("[Ecosystem alert] Pengiriman gagal: BREVO_API_KEY atau BREVO_ALERT_EMAIL belum dikonfigurasi di GitHub Actions secrets.");
    return false;
  }
  try {
    const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Gustafta", email: config.sender || "noreply@gustafta.my.id" },
        to: [{ email: config.recipient }],
        subject: "Peringatan: browser pemeriksa ekosistem tidak tersedia",
        textContent: "Pemeriksaan tampilan aplikasi eksternal tidak dapat diselesaikan karena browser pemeriksa tidak tersedia. Status tampilan aplikasi belum dapat dipastikan; periksa jalur pemeriksaan.",
        htmlContent: "<p>Pemeriksaan tampilan aplikasi eksternal tidak dapat diselesaikan karena browser pemeriksa tidak tersedia. Status tampilan aplikasi belum dapat dipastikan; periksa jalur pemeriksaan.</p>",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`[Ecosystem alert] Pengiriman gagal: Brevo HTTP ${response.status}`);
      return false;
    }
    console.log("[Ecosystem alert] Gangguan browser pemeriksa dilaporkan.");
    return true;
  } catch {
    console.error("[Ecosystem alert] Pengiriman gagal: koneksi ke Brevo bermasalah.");
    return false;
  }
}

export async function notifyEcosystemFailures(
  failures: string[],
  config: { apiKey?: string; recipient?: string; sender?: string },
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  if (!failures.length) return true;
  // Reject report contents that are not emitted by our checkers; raw URLs or
  // provider errors must never be forwarded to operational email.
  try {
    failedAppNames(failures);
  } catch {
    console.error("[Ecosystem alert] Pengiriman gagal: laporan pemeriksaan tidak valid.");
    return false;
  }
  if (!config.apiKey || !config.recipient) {
    console.error("[Ecosystem alert] Pengiriman gagal: BREVO_API_KEY atau BREVO_ALERT_EMAIL belum dikonfigurasi di GitHub Actions secrets.");
    return false;
  }
  // The checker emits only app names and fixed status categories; never include
  // raw exception messages, response bodies, URLs, or credentials in this report.
  const text = `Pemeriksaan aplikasi eksternal gagal (${failures.length}):\n${failures.map((failure) => `- ${failure}`).join("\n")}`;
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  try {
    const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Gustafta", email: config.sender || "noreply@gustafta.my.id" },
        to: [{ email: config.recipient }],
        subject: "Peringatan: aplikasi eksternal tidak dapat diakses",
        textContent: text,
        htmlContent: `<p>Pemeriksaan aplikasi eksternal gagal:</p><ul>${failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join("")}</ul>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // Never print the provider body, which may echo submitted data or secrets.
      console.error(`[Ecosystem alert] Pengiriman gagal: Brevo HTTP ${response.status}`);
      return false;
    }
    console.log(`[Ecosystem alert] Terkirim: ${failures.length} aplikasi gagal.`);
    return true;
  } catch {
    console.error("[Ecosystem alert] Pengiriman gagal: koneksi ke Brevo bermasalah.");
    return false;
  }
}

export async function notifyEcosystemRecovery(
  recovered: string[],
  config: { apiKey?: string; recipient?: string; sender?: string; onAmbiguous?: () => void },
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  if (!recovered.length) return true;
  // Only canonical names may appear in the email, not arbitrary report data.
  if (!recovered.every(isKnownAppName)) {
    console.error("[Ecosystem alert] Pengiriman gagal: laporan pemulihan tidak valid.");
    return false;
  }
  if (!config.apiKey || !config.recipient) {
    console.error("[Ecosystem alert] Pengiriman gagal: BREVO_API_KEY atau BREVO_ALERT_EMAIL belum dikonfigurasi di GitHub Actions secrets.");
    return false;
  }
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  try {
    const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Gustafta", email: config.sender || "noreply@gustafta.my.id" },
        to: [{ email: config.recipient }],
        subject: "Pemulihan: aplikasi eksternal kembali dapat diakses",
        textContent: `Aplikasi eksternal kembali dapat diakses (${recovered.length}):\n${recovered.map((name) => `- ${name}`).join("\n")}`,
        htmlContent: `<p>Aplikasi eksternal kembali dapat diakses:</p><ul>${recovered.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (response.status >= 500) config.onAmbiguous?.();
      console.error(`[Ecosystem alert] Pengiriman gagal: Brevo HTTP ${response.status}`);
      return false;
    }
    console.log(`[Ecosystem alert] Terkirim: ${recovered.length} aplikasi pulih.`);
    return true;
  } catch {
    config.onAmbiguous?.();
    console.error("[Ecosystem alert] Pengiriman gagal: koneksi ke Brevo bermasalah.");
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const recovery = process.argv[2] === "recovery";
    const browser = process.argv[2] === "browser";
    const network = process.argv[2] === "network";
    if (browser || network) {
      if (!await (browser ? notifyBrowserUnavailable : notifyNetworkUnavailable)({
        apiKey: process.env.BREVO_API_KEY,
        recipient: process.env.BREVO_ALERT_EMAIL,
        sender: process.env.BREVO_SENDER_EMAIL,
      })) process.exitCode = 1;
    } else {
      const entries: unknown = JSON.parse(await readFile(
        recovery ? process.env.ECOSYSTEM_RECOVERED_REPORT || "" : process.env.ECOSYSTEM_HEALTH_REPORT || "", "utf8"));
      if (!Array.isArray(entries) || !entries.length || !entries.every((item) => typeof item === "string")) {
        throw new Error("Laporan pemeriksaan tidak valid");
      }
      let ambiguous = false;
      if (!await (recovery ? notifyEcosystemRecovery : notifyEcosystemFailures)(entries, {
        apiKey: process.env.BREVO_API_KEY,
        recipient: process.env.BREVO_ALERT_EMAIL,
        sender: process.env.BREVO_SENDER_EMAIL,
        onAmbiguous: () => { ambiguous = true; },
      })) process.exitCode = ambiguous ? 2 : 1;
    }
  } catch {
    console.error("[Ecosystem alert] Pengiriman gagal: laporan pemeriksaan tidak tersedia atau tidak valid.");
    process.exitCode = 1;
  }
}