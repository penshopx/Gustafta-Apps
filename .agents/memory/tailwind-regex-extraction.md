---
name: Tailwind regex extraction
description: Avoid source regex patterns that Tailwind mistakes for arbitrary CSS declarations.
---

Tailwind scans source text, including JavaScript regex literals, for class candidates. A character class beginning `[-:` can be mistaken for Tailwind's arbitrary-property syntax and produce invalid CSS declarations like `-: |`.

**Why:** The production CSS minifier warned `Expected identifier but found "-"` even though the handwritten styles were valid; the invalid declarations came from regex literals in TSX.

**How to apply:** When writing regex character classes in Tailwind-scanned source, avoid starting them with `[-:`. Reorder the characters or use an equivalent expression, and confirm the generated CSS/build does not contain spurious arbitrary-property rules.