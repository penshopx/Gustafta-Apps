---
name: Production shares the dev database
description: Shared-database safety and verification of the exact published target
---
Rule: Treat mutations to the project database as instantly customer-facing. The project's published app has shared its Postgres with development; do not assume a separate production safety buffer. A separate Replit production database was not present when checked.

**Why:** Verified 2026-08-10: publishing 6 packages (SQL in dev DB) made them appear on the prod catalog immediately, while the new `order_cta` field (code) stayed absent until republish.

**How to apply:** "Promote to production" for registry/config data = no-op (already live). Only code changes require Publish. Treat dev-DB mutations as INSTANTLY customer-facing — no safety buffer. Older memory notes claiming a separate prod DB (e.g. claw-agent-model) predate this and are wrong for data; boot-time reconciles still matter only for code-coupled changes.

Verify the exact hostname used by an external caller before claiming a fix is live there. Do not assume the primary deployment URL and a custom domain serve the same release or even the same deployment.

**Why:** Direct anonymous checks found a working JSON API on the primary deployment URL while the custom domain returned the SPA's HTML for the same API path. A permission fix on one target did not establish endpoint availability on the other.

**How to apply:** Obtain current deployment metadata and compare the exact endpoint on each relevant hostname. Keep API activation, caller configuration, and live token verification as separate checks. Never announce a custom-domain endpoint as activated based only on the primary URL.
