/**
 * Explicit human observation, not an undocumented Healthchecks API response.
 * Inputs stay private; callers may emit only the fixed result codes below.
 */
export type Verification = "ok" | "drift" | "config_error" | "verification_due" | "source_unavailable";
export type ChannelIdentity = { id: string; kind: "email" | "telegram" };
const maxAge = 31 * 24 * 60 * 60 * 1000;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function keys(value: Record<string, unknown>, expected: string): boolean {
  return Object.keys(value).sort().join(",") === expected;
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

export function verifyHealthchecksDestinations(
  attached: ChannelIdentity[],
  baselineJson: string | undefined,
  observationJson: string | undefined,
  now = Date.now(),
): Verification {
  try {
    const baseline = object(JSON.parse(baselineJson || ""));
    if (!baseline || !keys(baseline, "channels,version") || baseline.version !== 1 ||
        !Array.isArray(baseline.channels) || !attached.length) return "config_error";
    const expected = baseline.channels.map(object);
    const unique = new Map(attached.map(ch => [ch.id, ch.kind]));
    if (attached.some(ch => unique.get(ch.id) !== ch.kind) ||
        expected.length !== unique.size ||
        new Set(expected.map(ch => ch?.id)).size !== expected.length ||
        expected.some(ch => !ch || !keys(ch, "destination,id,kind") ||
          !text(ch.id) || !text(ch.destination) || unique.get(ch.id) !== ch.kind)) return "config_error";

    if (!observationJson?.trim()) return "verification_due";
    const observation = object(JSON.parse(observationJson));
    if (!observation || !keys(observation, "channels,checkedAt,source,status,version") ||
        observation.version !== 1 || observation.source !== "dashboard" ||
        !["available", "inaccessible"].includes(observation.status as string) ||
        typeof observation.checkedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observation.checkedAt) ||
        !Array.isArray(observation.channels)) return "config_error";
    const checkedAt = Date.parse(observation.checkedAt);
    if (!Number.isFinite(checkedAt) || !Number.isFinite(now) ||
        new Date(checkedAt).toISOString() !== observation.checkedAt || checkedAt > now) return "config_error";
    if (observation.status === "inaccessible") return "source_unavailable";
    if (now - checkedAt >= maxAge) return "verification_due";
    const observed = observation.channels.map(object);
    if (observed.some(ch => !ch || !keys(ch, "destination,emailVerified,enabled,id,kind,receiptConfirmed") ||
        !text(ch.id) || !text(ch.destination) || !["email", "telegram"].includes(ch.kind as string) ||
        typeof ch.enabled !== "boolean" || typeof ch.receiptConfirmed !== "boolean" ||
        (ch.kind === "email" ? typeof ch.emailVerified !== "boolean" : ch.emailVerified !== null)) ||
        new Set(observed.map(ch => ch?.id)).size !== observed.length) return "config_error";
    if (observed.length !== expected.length) return "drift";
    for (const channel of expected) {
      const actual = observed.find(ch => ch!.id === channel!.id);
      if (!actual || actual.kind !== channel!.kind || actual.destination !== channel!.destination ||
          actual.enabled !== true || actual.receiptConfirmed !== true ||
          (actual.kind === "email" && actual.emailVerified !== true)) return "drift";
    }
    return "ok";
  } catch {
    return "config_error";
  }
}
