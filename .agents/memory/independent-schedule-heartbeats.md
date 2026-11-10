---
name: Independent schedule heartbeats
description: Why external cron monitoring ignores manual and workflow_run activity
---

Use separate external cron heartbeat checks for every independently scheduled monitoring workflow, including the configuration audit, not just the primary inspection and watchdog. Only scheduled invocations count; manual runs and downstream workflow_run triggers must not reset the independent timers. Route each check to two independent recipient transports at the external provider, not from GitHub Actions.

**Why:** A watchdog triggered by workflow_run may keep running while its own fallback schedule has stopped; a manual inspection can mask a disabled primary schedule. Neither demonstrates that GitHub still delivers scheduled events. Healthy checker/watchdog schedules also say nothing about an audit-only scheduling failure. An external provider must own the timer and notification delivery, because GitHub cannot warn when all its schedules stop. A second email recipient on the same transport does not protect against email delivery failure.

**How to apply:** Provision distinct checks with email plus a non-email channel outside GitHub. Keep heartbeat payloads empty and provider reminders disabled to limit notifications; confirm scheduled pings and receipt on both channels with a disposable test check before treating this as active protection. Real recipient receipt is not established by repository tests or documentation alone.

The intended GitHub repository for Gustafta monitoring is `penshopx/landing-page`.

**Why:** The user explicitly confirmed this repository as the monitoring target.

**How to apply:** Inspect and prepare monitoring changes for this repository; do not substitute another similarly named Gustafta repository. This target choice is not approval to merge changes or activate scheduled alarms.