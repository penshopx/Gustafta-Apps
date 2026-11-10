---
name: Dashboard browser fixtures
description: Avoid accidental row activation when exercising sidebar action buttons in browser fixtures.
---

In dashboard smoke fixtures, dispatch sidebar icon actions to their current DOM target rather than relying on pointer coordinates after a hover.

**Why:** Hover can recreate the sidebar subtree between pointer movement and click. A coordinate click intended for Edit can instead activate the enclosing agent row, producing an unexpected write. The smoke test must reject that write rather than silently allow it.

**How to apply:** For import/opening checks, use a selector-targeted DOM click and keep all writes blocked. Real pointer usability is a separate behavior to verify and fix, not something a smoke fixture should claim to cover.
