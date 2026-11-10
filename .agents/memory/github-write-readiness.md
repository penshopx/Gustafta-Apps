---
name: GitHub connector write readiness
description: Read access and a healthy connection do not establish permission or transport readiness for workflow PR writes.
---

Do not infer that GitHub PR writes will work from successful reads, repository
admin metadata, a healthy OAuth connection, or one successful small object write.
In this workspace, some write requests have returned non-JSON HTTP 403 despite
those positive signals.

**Why:** Reauthorizing did not resolve the rejection. A non-JSON response does
not establish that GitHub itself rejected a permission; the failing layer is
not confirmed. Repeated authorization prompts create work without proving a fix.

**How to apply:** Refresh authorization at most once when requested by the
connection flow. Try a meaningfully different supported transport only when
authorized to continue, then stop after repeated rejection and report exactly
which deliverables exist. Never fall back to plaintext credentials embedded in
the Git remote. Provide a checked transfer patch rather than claiming a PR exists.
