---
name: Wouter/Radix navigation tests
description: Quirks when exercising real header navigation inside happy-dom tests.
---

For navigation tests using Wouter's memory location, pass `record: true` to get a `history` array. Radix dropdown triggers respond to `pointerDown` (with a primary mouse button), not a plain click, in happy-dom.

**Why:** A route-level navigation test initially failed to inspect history, then failed to open the menu even though the trigger rendered correctly.

**How to apply:** Use these event and memory-location settings when testing the actual header-to-route journey; avoid treating an unopened Radix menu as a missing navigation link.

In real-browser Radix Select tests, wait for the intended option to receive focus after keyboard navigation before activating it.

**Why:** Keyboard navigation may defer focus; sending End and Enter immediately back-to-back can leave the menu open and produce intermittent failures even when scrolling works.

**How to apply:** Assert the active option after navigation, then activate that option and wait for the menu to close. Separately assert actual wheel scrolling so keyboard navigation cannot conceal a broken scroll container.