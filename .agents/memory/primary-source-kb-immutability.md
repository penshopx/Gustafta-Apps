---
name: Primary-source KB immutability
description: Protect official documents in RAG knowledge bases from editorial content reconcilers.
---

Checksum-marked chunks and extracted text from an official primary-source document are immutable. A content reconciler may update derived summaries, prompts, and editorial KBs, but must explicitly exclude the primary source.

**Why:** An official document may mention superseded regulations, transition dates, or historical wording that is legally meaningful. Blind replacement would silently falsify the source while leaving its official attribution and checksum attached.

**How to apply:** Mark every primary-source KB and chunk with a verified source checksum. Add a checksum exclusion to reconcilers before selecting rows, and test both sides: stale editorial content changes while checksum-marked source content remains byte-for-byte untouched.