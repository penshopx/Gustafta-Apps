---
name: MultiClaw Persona persistence
description: How Persona & UX changes must be confirmed as saved in the MultiClaw admin.
---

The MultiClaw Persona & UX editor must not treat an HTTP success response or optimistic client state as proof that data persisted. After PATCH, read the agent back without cache and compare the greeting, conversation starters, and enabled state before showing success. Surface the server's actual failure reason.

**Why:** The user clarified that the requirement is actual saved data, not merely preventing fields from appearing blank after reload; a GET projection omission can hide saved data, while a generic success toast can conceal a failed write.

**How to apply:** When changing the Persona & UX save path, verify the PATCH payload survives a fresh read and cover authorization errors and readback mismatches in tests.
