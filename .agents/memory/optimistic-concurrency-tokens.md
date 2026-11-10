---
name: Optimistic concurrency tokens
description: Why browser-facing optimistic concurrency must use integer revisions instead of database timestamps.
---

Use a monotonically increasing integer revision as the optimistic concurrency token for records edited through browser JSON.

**Why:** PostgreSQL timestamps can retain microseconds, while JavaScript Date and JSON typically retain only milliseconds. Sending a timestamp to the browser and comparing it back to the original database value can reject every write as a false conflict.

**How to apply:** Return the revision with each record, require the client's seen revision on conflict-prone writes, and atomically update with `WHERE revision = expected` plus `revision = revision + 1`. Treat zero updated rows as a conflict after separately confirming ownership/existence.

For consent, identical content is not necessarily the same revision: A→B→A must
not revive approval of the first A. A digest alone is insufficient.

**Why:** Workroom versioning needed a migration-free path because development and
production may share a database. Reusing retained material-event identities avoids
schema changes, while a content digest detects legacy writes outside that ledger.

**How to apply:** Preserve the append-only revision anchor if introducing retention
or cleanup; migrate the anchor first rather than allowing revision numbers to
decrease. Capture consent tokens when the user acts, not after a background refresh.

For an external source, the event revision and the identity of the referenced
bytes have separate responsibilities; one cannot replace the other.

**Why:** Live source identity and retained private evidence are separate. An
object-store read is not covered by PostgreSQL locks; a verified application-level
archive is not provider WORM or permission to run external side effects.

**How to apply:** Keep point-of-use revalidation fail-closed, and require immutable
source versions before extending this approval mechanism across external runtimes.