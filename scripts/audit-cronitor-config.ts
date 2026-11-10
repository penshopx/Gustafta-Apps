/**
 * Read-only Cronitor configuration audit. Never serialize provider objects or
 * errors to logs: these can contain telemetry keys and recipient identities.
 */
import { pathToFileURL } from "node:url";

type Kind = "ok" | "drift" | "provider_error" | "config_error";
type Target = { key: string; list: string; notifications: Record<string, string[]> };
type Baseline = { checker: Target; watchdog: Target };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function destinations(value: unknown): Record<string, string[]> | null {
  const obj = record(value);
  if (!obj) return null;
  const result: Record<string, string[]> = {};
  for (const [channel, recipients] of Object.entries(obj)) {
    if (!/^[a-z][a-z-]*$/.test(channel) || !Array.isArray(recipients) ||
        !recipients.length || recipients.some(r => typeof r !== "string" || !r.trim())) return null;
    result[channel] = recipients;
  }
  return result;
}

function normalize(value: Record<string, string[]>): string {
  return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([channel, recipients]) => [channel, [...recipients].sort()]));
}

function parseBaseline(raw: string | undefined): Baseline | null {
  try {
    const value = record(JSON.parse(raw || ""));
    if (!value || Object.keys(value).sort().join(",") !== "checker,watchdog") return null;
    const targets = ["checker", "watchdog"] as const;
    for (const name of targets) {
      const target = record(value[name]);
      if (!target || Object.keys(target).sort().join(",") !== "key,list,notifications" ||
          typeof target.key !== "string" || !target.key.trim() ||
          typeof target.list !== "string" || !target.list.trim() ||
          target.list === "default" || !destinations(target.notifications) ||
          !destinations(target.notifications)?.telegram?.length) return null;
    }
    const baseline = value as unknown as Baseline;
    if (baseline.checker.key === baseline.watchdog.key) return null;
    return baseline;
  } catch {
    return null;
  }
}

export async function auditCronitor(
  apiKey: string | undefined,
  baselineJson: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Kind> {
  const baseline = parseBaseline(baselineJson);
  if (!apiKey || !baseline) return "config_error";

  async function get(path: string): Promise<Record<string, unknown>> {
    const response = await fetcher(`https://cronitor.io/api/${path}`, {
      method: "GET",
      headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Provider unavailable");
    const body = record(await response.json());
    if (!body) throw new Error("Invalid provider response");
    return body;
  }

  try {
    let drift = false;
    const schedules = { checker: ["17 2 * * *", 21600], watchdog: ["31 10,18 * * *", 18000] } as const;
    for (const name of ["checker", "watchdog"] as const) {
      const expected = baseline[name];
      const monitor = await get(`monitors/${encodeURIComponent(expected.key)}`);
      const list = await get(`notifications/${encodeURIComponent(expected.list)}`);
      // The default API version exposes schedule (not schedules). Missing or
      // unexpected fields are drift, never interpreted as a healthy default.
      if (monitor.key !== expected.key || monitor.type !== "heartbeat" ||
          monitor.schedule !== schedules[name][0] || monitor.timezone !== "UTC" ||
          monitor.grace_seconds !== schedules[name][1] ||
          monitor.schedule_tolerance !== 0 || monitor.paused !== false ||
          !Array.isArray(monitor.notify) || monitor.notify.length !== 1 ||
          monitor.notify[0] !== expected.list) drift = true;

      const actual = destinations(list.notifications);
      if (list.key !== expected.list || list.status !== "active" || !actual ||
          normalize(actual) !== normalize(expected.notifications)) drift = true;
    }
    return drift ? "drift" : "ok";
  } catch {
    // 403, 404, timeout, malformed JSON and unknown response shape all fail
    // closed. Never log the exception or the API response body.
    return "provider_error";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  auditCronitor(process.env.CRONITOR_AUDIT_API_KEY, process.env.CRONITOR_AUDIT_BASELINE)
    .then(result => {
      console.log(`Cronitor configuration audit: ${result}`);
      if (result !== "ok") process.exitCode = 1;
    });
}