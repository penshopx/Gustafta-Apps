---
name: Post-failure Actions heartbeats
description: Why an API-health ping after an alert failure needs explicit status handling
---

GitHub Actions implicitly adds `success()` to a step's `if` condition when no status-check function is present. A condition inspecting an earlier step's `outcome` is not enough to run after failure; include `always()` explicitly, then gate on the exact successful inspection and state outputs.

**Why:** An external alert-state heartbeat must still distinguish a mail-provider failure (GitHub claim safely saved as `sending`) from a GitHub state API failure. Without `always()`, both skip the final heartbeat simply because the email step failed.

**How to apply:** For any post-failure notification or external success ping in Actions, review both the implicit job status and the explicit step outcomes. Keep scheduled-only gating so manual or downstream events cannot mask missing scheduled checks.