---
name: MultiClaw Persona persistence
description: How Persona & UX changes must be confirmed as saved in the MultiClaw admin.
---

The MultiClaw Persona & UX editor must not treat an HTTP success response or optimistic client state as proof that data persisted. After PATCH, read the agent back without cache and compare the greeting, conversation starters, and enabled state before showing success. Surface the server's actual failure reason.

MultiClaw startup seeds can overwrite existing prompts and settings. Admin edits to fields that seeds reconcile must therefore be persisted as explicit overrides and reapplied after the full seed/reconciliation pass; a successful database update alone is not restart-durable.

**Why:** The requirement is actual saved data, not merely a generic success toast; a fresh-read projection can hide a failed write, and seed scripts can overwrite an admin-edited prompt during boot.

**How to apply:** Save editable configuration and its restart-durable override atomically, reapply overrides only after all startup seeds finish, then verify a no-cache server read before showing success. Cover authorization failures and readback mismatches.
