---
name: SBU profile pilot access
description: Owner-confirmed access boundary for the first SBU Accelerator company-profile integration
---

The initial SBU Accelerator integration is single-company with explicitly authorized users, not a multi-company shared-token integration. Grant only `profile:read`; do not include document permissions.

**Why:** The owner selected this model explicitly. A Ruang Simpan connection token identifies one Gustafta profile owner, not whichever Clerk user is signed into SBU. Treating every login as authorized would expose the company's profile to unrelated users.

**How to apply:** The SBU backend must verify both a valid user session and explicit permission to access the configured company's profile before calling Gustafta. Keep the connection token server-side. A successful login alone is insufficient. Changes to multi-company access or document scope require an explicit new decision. Implementation belongs in the separate SBU workspace; do not alter the Gustafta API to assume SBU user identity.