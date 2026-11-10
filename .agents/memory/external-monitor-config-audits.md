---
name: External monitor configuration audits
description: Boundaries for auditing third-party heartbeat schedules and recipients safely
---

Keep the expected recipient identities in a private configuration secret, not a committed file or an issue. Compare both the monitor's notification-list attachment and the list's destinations: a correct list alone does not prove either monitor uses it.

**Why:** A recipient can be removed or swapped after a one-time acceptance test while the heartbeat schedule continues to look healthy. Auditing with production failure telemetry would itself generate a false outage. A warning sent through the monitored provider would be lost when that provider fails.

**How to apply:** Prefer read-only provider credentials and fail closed on unavailable or unfamiliar API responses; emit only fixed status codes to logs. Route scheduled audit failures through a separate delivery service. Keep controlled human receipt tests separate from configuration drift checks.

Healthchecks Management API v3 cannot audit per-check integration attachments with a read-only key: it omits channels and disallows listing integrations. A GET-only auditor needs a project read-write key; do not describe its credential as read-only.

**Why:** The documented API exposes integration ID/kind/name and attachments, but not recipient destinations, global disabled state or email verification. Treating those absent fields as proof of delivery would give false assurance.

**How to apply:** Keep broader credentials private and out of PR workflows, disallow redirects and provider-supplied URLs, and preserve monthly disposable-check human receipt tests. Configuration `ok` means only API-visible configuration matches.

For properties absent from a documented API, use an explicitly expiring operator observation against an independently approved private destination baseline. Do not present that observation as live provider telemetry.

**Why:** API-visible IDs and aliases can remain unchanged while a destination or global activation changes. Human observations only cover a point in time; silently renewing them would hide the same blind spot.

**How to apply:** Require renewed dashboard inspection and human receipt confirmation, record inaccessible or ambiguous sources as unverifiable, and never update the approved baseline merely to match unexpected observations.