---
name: Paid access token recovery
description: Security rule for buyer recovery of bearer tokens that unlock paid products.
---

Never return a paid-product bearer token merely because a caller knows the buyer's email address. Require an authenticated account whose persisted email matches the purchase, or a short-lived one-time claim proof delivered to the buyer.

**Why:** Email addresses are often public or guessable. Treating email knowledge as possession lets anyone impersonate a buyer and unlock every agent or product tied to that address.

**How to apply:** Any claim/recovery endpoint that returns a reusable access token must validate identity or cryptographic possession before looking up or returning the token. Keep the downstream exact-product, active-status, and expiry checks as defense in depth.