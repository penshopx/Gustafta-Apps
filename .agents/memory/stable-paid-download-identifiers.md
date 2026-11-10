---
name: Stable paid-download identifiers
description: Authorization and URL identity rules for paid digital files, including multi-product orders and stale links.
---

# Stable paid-download identifiers

Paid digital-download URLs must identify both the entitled product and the file's semantic role. Numeric database row IDs are compatibility-only and must not be the canonical buyer-facing identity.

Version refreshes must update the existing product-and-role row in place. A changed storage key must not cause a delete-and-insert cycle, even though the numeric ID is compatibility-only.

**Why:** Reconcilers can replace file rows, making saved numeric links stale. A role without product identity is also ambiguous for packages containing several products that each have a `main` file. A versioned storage path once caused otherwise unchanged main/supplement files to receive new row IDs during a binary refresh.

**How to apply:** Authorize the token first, require the requested product to belong to its entitlement, then resolve the role only within that product. A missing legacy numeric ID may fall back only when exactly one entitled product is unambiguous; an existing foreign ID must always be denied. Seeders should select and lock the existing `(product, role)` row, update it, and insert only when that semantic role has never existed.