---
name: Dashboard budget module identity
description: Why dashboard graph identification must not require a Rollup facade.
---

Identify the dashboard in emitted chunk metadata by contained module identity as
well as facade identity.

**Why:** The production Rollup build can emit the dashboard chunk with a null
facade even though it contains the dashboard module. Requiring a facade rejects
the valid production output. Filename hashes are not stable identifiers.

**How to apply:** When changing route-size checks, retain coverage for null
facades and use static import metadata rather than scanning generated preload
strings or dynamic import lists.
