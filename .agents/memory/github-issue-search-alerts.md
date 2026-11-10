---
name: GitHub issue search for alert state
description: Why alert marker lookup pairs narrow search with a fresh issue-list check
---

When finding durable alert markers in large repositories, search by a specific title rather than scanning the whole issue list, but never treat an incomplete or capped search as proof of absence. Also inspect the newest live issues before creating a claim.

**Why:** GitHub issue search has a 1,000-result cap and asynchronous indexing. A successful empty search immediately after claim creation can otherwise permit another email. The live issue list catches recent claims while title search reaches older markers.

**How to apply:** Any issue-backed notification deduplication should validate search completeness, compare exact titles and non-PR results, check duplicates, and fail closed on API errors. Keep a recent live-list check for indexing lag.