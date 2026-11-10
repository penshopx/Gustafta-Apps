---
name: Scalev provisioning verification
description: Reliable reconciliation rules for Scalev registry variants and store attachment.
---

Scalev provisioning and verification must tolerate HTTP 429 responses using bounded `Retry-After`/exponential backoff. Verify store visibility primarily through the registry's mapped variant unique ID; use SKU only as the idempotent discovery key for newer products.

**Why:** The Scalev API rate-limits ordinary sequential reconciliation calls, and legacy active products can have a valid attached variant with no SKU. SKU-only verification therefore reports a false failure even though runtime checkout uses the mapped variant unique ID.

**How to apply:** For provisioning scripts, retry only explicit 429 responses with a finite attempt cap. Build verification indexes by both SKU and variant unique ID, and still require the mapped variant and price to match exactly.