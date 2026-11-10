/** Independent delivery; only fixed messages/statuses may leave this module. */
import { pathToFileURL } from "node:url";

export async function notifyMonitorConfigAudit(
  config: { apiKey?: string; recipient?: string; sender?: string },
  fetcher: typeof fetch = fetch,
): Promise<"sent" | "config_error" | "delivery_error"> {
  if (!config.apiKey?.trim() || !config.recipient?.trim()) return "config_error";
  try {
    const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Gustafta", email: config.sender || "noreply@gustafta.my.id" },
        to: [{ email: config.recipient }],
        subject: "Peringatan: konfigurasi monitor cadangan perlu diperiksa",
        textContent: "Audit konfigurasi Healthchecks atau Cronitor gagal atau tidak dapat diverifikasi. Periksa workflow audit, jadwal, grace, integrasi kedua check/monitor, serta masa berlaku verifikasi operator atas tujuan, aktivasi global, verifikasi email, dan penerimaan kanal. Ini bukan laporan gangguan aplikasi.",
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    void response.body?.cancel().catch(() => {});
    return response.ok ? "sent" : "delivery_error";
  } catch {
    return "delivery_error";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  notifyMonitorConfigAudit({
    apiKey: process.env.BREVO_API_KEY,
    recipient: process.env.BREVO_ALERT_EMAIL,
    sender: process.env.BREVO_SENDER_EMAIL,
  }).then(result => {
    console.log(`Configuration audit warning: ${result}`);
    if (result !== "sent") process.exitCode = 1;
  });
}
