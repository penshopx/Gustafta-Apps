---
name: Healthchecks ping URL exposure
description: Safe response when a Healthchecks UUID ping URL appears in a shared screenshot
---

Treat Healthchecks UUID ping URLs as bearer credentials. An exposed UUID URL cannot be rotated in place: recreate the affected check and replace its GitHub Actions secret with the new URL. Never repeat the exposed value in a response or ask for a screenshot showing the Ping URL column.

**Why:** Healthchecks documents each check UUID as unique and immutable; possession of the URL permits a false healthy ping. A dashboard screenshot can unintentionally expose the complete URL.

**How to apply:** If an operator shares a check screenshot containing a UUID URL, advise them to recreate that check before connecting it to workflows. If it was already connected, replace the corresponding secret. Confirm the replacement by check name and status only, without requesting the new URL.