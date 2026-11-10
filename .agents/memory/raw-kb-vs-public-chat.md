---
name: Raw KB access versus public chat
description: Public agent chat permission does not imply permission to dump its Knowledge Base source documents.
---

**Rule:** Treat raw Knowledge Base content, versions, and exports as configuration-source reads, separate from chat visibility. Owner/admin/collaborator may read user-owned KB; logged-in users may still read ownerless system KB. A public agent or a KB `isShared` flag alone does not grant raw-source access. Check each row of a cross-agent version chain independently.

**Why:** Public chat is an intended output channel, but raw KB includes full extracted documents (sometimes imported from a user's private storage). Reusing the chat guard allows another login to dump the owner's complete source text via a guessed agent or taxonomy ID.

**How to apply:** Any new endpoint or background-on-behalf-of-user operation that returns or feeds raw KB by caller-supplied ID should authorize source access before lookup; keep intentional shared-system chat behavior distinct.