---
name: Puppeteer browser predicates under tsx
description: Avoid nested callbacks in Puppeteer waitForFunction predicates compiled by tsx.
---

When writing Puppeteer `waitForFunction` predicates in TypeScript run through tsx, use a direct inline loop rather than a nested helper function or array callback.

**Why:** A predicate that matched the DOM in plain Node repeatedly timed out when run from a tsx script. The same predicate succeeded after removing nested arrow functions. tsx may inject a helper into the serialized callback that is unavailable in the browser context.

**How to apply:** For browser-side polling, keep the predicate self-contained with no nested function declarations or closure dependencies. Confirm a known live page succeeds before relying on it in scheduled checks.