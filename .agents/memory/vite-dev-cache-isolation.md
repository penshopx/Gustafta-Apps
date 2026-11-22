---
name: Vite dev cache isolation
description: Prevent blank previews when the main app and test fixtures run Vite
---

Keep the long-lived app's Vite dependency-optimizer cache separate from Vite caches used by browser/test fixtures. In development, send `Cache-Control: no-store` for the HTML and transformed/optimized modules so a preview cannot keep an immutable module that points at chunks replaced by a later optimizer run.

**Why:** The app and test Vite servers shared `node_modules/.vite`. After restarts or test runs replaced that directory, an existing Replit preview kept optimized module URLs with the same browser hash, then requested chunk files that no longer existed and rendered a blank page.

**How to apply:** When the project uses Vite middleware mode alongside browser tests that also start Vite, give the app a dedicated `cacheDir`, set no-store headers on development responses, and ensure root-route loading states render visible feedback instead of `null`. Verify both a clean browser and the normal preview after a restart.
