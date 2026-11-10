---
name: KB publication version identity
description: Privacy-preserving identification and consent history for KB copies
---
Use source-scoped monotonic revisions for publication evidence, not private-content snapshots or content-derived fingerprints. An automatic revocation identifies the previously approved revision, not the edited replacement.

**Why:** Approval needs an identifiable version, not a second copy of private material; a public digest of predictable content could permit offline guessing. Historical publication must not be backfilled as if a known person had approved it.

**How to apply:** Preserve the revision and approval evidence atomically with visibility/content writes. Record authenticated actors when available and explicitly identify unattended work as system activity. Publication still applies only to the KB copy, never to original-file or trusted-application access.
