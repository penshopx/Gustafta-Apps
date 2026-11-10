---
name: Optimistic first-create
description: First-write version gating needs a separate insert path from updates.
---

**Rule:** When a versioned record starts at revision 0, require 0 for creation and the exact stored revision for each update. Implement insert and update as separate atomic branches, with a unique-key conflict returning a retryable conflict rather than replacing an existing row.

**Why:** Applying `WHERE expected_revision = 0` to an `INSERT … ON CONFLICT DO UPDATE` input prevents *all later valid updates* from reaching the conflict branch. Omitting that creation gate instead accepts arbitrary stale revisions on first write. A mock route test missed both SQL behaviors.

**How to apply:** For any new shared canonical record, run a rollback-only PostgreSQL test covering missing row with incorrect revision, first create, valid update, stale update, and audit revision count; do not rely only on HTTP mocks.