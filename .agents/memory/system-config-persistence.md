---
name: system_config as lightweight persistence
description: Pattern for persisting in-memory counters/stats to system_config so they survive server restarts, without adding new tables.
---

## Rule
For simple counters or stats that accumulate in memory (e.g. `_brevoStats`), use `system_config` with a serialized JSON value instead of a new DB table.

**Why:** New tables need DDL (drizzle-kit push is blocked in this project), but system_config already exists. Upsert is one line.

**How to apply:**
1. Load from system_config at module/route init (async IIFE, non-fatal).
2. After any mutation to the in-memory object, fire-and-forget `_persistBrevoStats()` → upsert into system_config.
3. The GET stats endpoint reads from the in-memory object (fast); the DB copy is the restart-safe snapshot.

**Limitation:** Not suitable for high-frequency writes (every request) — only for low-frequency events like email webhooks.

**Enforcement exception:** Low-volume pilot spend counters may reuse this store,
but must use locked database transactions rather than in-memory snapshots or
fire-and-forget writes.

**Why:** Best-effort statistics can tolerate loss; a lost spend reservation permits
unapproved additional provider calls. The Workroom pilot is bounded to a small
daily total, not an unbounded high-frequency usage meter.
