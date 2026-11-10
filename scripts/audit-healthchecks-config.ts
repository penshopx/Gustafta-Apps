/**
 * GET-only Healthchecks audit. Provider data, errors, UUIDs and channel names
 * must never reach logs, job outputs or alert messages.
 */
import { pathToFileURL } from "node:url";
import { verifyHealthchecksDestinations, type Verification } from "./verify-healthchecks-destinations";

type Kind = "ok" | "drift" | "provider_error" | "config_error";
type Name = "checker" | "watchdog";
type Channel = { id: string; kind: "email" | "telegram"; name: string };
type Target = { uuid: string; channels: Channel[] };
type Baseline = Record<Name, Target>;
export type HealthchecksAudit = { checker: Kind; watchdog: Kind };
const names: Name[] = ["checker", "watchdog"];
const schedules = { checker: ["17 2 * * *", 21600], watchdog: ["31 10,18 * * *", 18000] } as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parseBaseline(raw: string | undefined): Baseline | null {
  try {
    const value = record(JSON.parse(raw || ""));
    if (!value || Object.keys(value).sort().join(",") !== "checker,watchdog") return null;
    for (const name of names) {
      const target = record(value[name]);
      if (!target || Object.keys(target).sort().join(",") !== "channels,uuid" ||
          typeof target.uuid !== "string" || !uuid.test(target.uuid) ||
          !Array.isArray(target.channels) || target.channels.length !== 2) return null;
      const channels = target.channels.map(record);
      if (channels.some(ch => !ch || Object.keys(ch).sort().join(",") !== "id,kind,name" ||
          typeof ch.id !== "string" || !uuid.test(ch.id) ||
          typeof ch.name !== "string" || !ch.name.trim())) return null;
      if (new Set(channels.map(ch => ch!.id)).size !== 2 ||
          channels.map(ch => ch!.kind).sort().join(",") !== "email,telegram") return null;
    }
    const baseline = value as unknown as Baseline;
    if (baseline.checker.uuid === baseline.watchdog.uuid) return null;
    return baseline;
  } catch {
    return null;
  }
}

export async function auditHealthchecks(
  apiKey: string | undefined,
  baselineJson: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<HealthchecksAudit> {
  const baseline = parseBaseline(baselineJson);
  if (!apiKey?.trim() || !baseline) return { checker: "config_error", watchdog: "config_error" };
  const result: HealthchecksAudit = { checker: "provider_error", watchdog: "provider_error" };

  async function get(path: string): Promise<Record<string, unknown>> {
    // Never follow redirects or use provider-supplied URLs (including ping_url).
    const response = await fetcher(`https://healthchecks.io/api/v3/${path}`, {
      method: "GET",
      headers: { "X-Api-Key": apiKey! },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Provider unavailable");
    const body = record(await response.json());
    if (!body) throw new Error("Invalid provider response");
    return body;
  }

  let channels: Record<string, unknown>[];
  try {
    const body = await get("channels/");
    if (!Array.isArray(body.channels)) return result;
    const parsed = body.channels.map(record);
    if (parsed.some(ch => !ch || typeof ch.id !== "string" || !uuid.test(ch.id) ||
        typeof ch.kind !== "string" || typeof ch.name !== "string") ||
        new Set(parsed.map(ch => ch!.id)).size !== parsed.length) return result;
    channels = parsed as Record<string, unknown>[];
  } catch {
    return result;
  }

  for (const name of names) {
    try {
      const expected = baseline[name];
      const check = await get(`checks/${expected.uuid}`);
      // A read-only key omits channels: do not mistake absence for verification.
      if (typeof check.uuid !== "string" || typeof check.channels !== "string" ||
          typeof check.schedule !== "string" || typeof check.tz !== "string" ||
          typeof check.grace !== "number" || typeof check.status !== "string" ||
          !["new", "up", "grace", "down", "paused"].includes(check.status)) continue;
      const attached = check.channels === "" ? [] : check.channels.split(",");
      if (attached.some(id => !uuid.test(id)) || new Set(attached).size !== attached.length) continue;
      let drift = check.uuid !== expected.uuid || check.schedule !== schedules[name][0] ||
        check.tz !== "UTC" || check.grace !== schedules[name][1] || check.status === "paused";
      if (attached.length !== expected.channels.length) drift = true;
      for (const expectedChannel of expected.channels) {
        const actual = channels.find(ch => ch.id === expectedChannel.id);
        if (!attached.includes(expectedChannel.id) || !actual ||
            actual.kind !== expectedChannel.kind || actual.name !== expectedChannel.name) drift = true;
      }
      result[name] = drift ? "drift" : "ok";
    } catch {
      // Continue to the other check, but retain failure for this one.
      result[name] = "provider_error";
    }
  }
  return result;
}

export function auditHealthchecksOperatorVerification(
  apiBaselineJson: string | undefined,
  destinationBaselineJson: string | undefined,
  observationJson: string | undefined,
  now = Date.now(),
): Verification {
  const baseline = parseBaseline(apiBaselineJson);
  if (!baseline) return "config_error";
  return verifyHealthchecksDestinations(
    names.flatMap(name => baseline[name].channels), destinationBaselineJson, observationJson, now,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  auditHealthchecks(process.env.HEALTHCHECKS_AUDIT_API_KEY, process.env.HEALTHCHECKS_AUDIT_BASELINE)
    .then(result => {
      for (const name of names) console.log(`Healthchecks configuration audit ${name}: ${result[name]}`);
      const verification = auditHealthchecksOperatorVerification(
        process.env.HEALTHCHECKS_AUDIT_BASELINE,
        process.env.HEALTHCHECKS_DESTINATION_BASELINE,
        process.env.HEALTHCHECKS_OPERATOR_VERIFICATION,
      );
      console.log(`Healthchecks operator verification: ${verification}`);
      if (names.some(name => result[name] !== "ok") || verification !== "ok") process.exitCode = 1;
    }).catch(() => {
      console.error("Healthchecks configuration audit: provider_error");
      process.exitCode = 1;
    });
}
