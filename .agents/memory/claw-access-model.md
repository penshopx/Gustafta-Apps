---
name: Per-Claw access model
description: Product policy for individually licensed Claw access and package-based bundles.
---

# Per-Claw access model

**Desired product behavior:** access is defined per user-visible Claw, and supports both individual entitlements and package/subscription bundles. A package grants a set of per-Claw entitlements; it does not make every Claw available by default.

**Scope decision:** individual licenses apply to the 72 Claws currently assigned to the ten field packages. The 13 base Claws retain their current tier-based access. A user may gain access to a packaged Claw through either an individual license or an eligible package; either source grants the same use permission.

Each visible Claw must resolve to its canonical agent identity and be checked before rendering its chat and on every server chat surface, including streaming. Hiding a navigation link is not authorization. Direct URLs and direct API calls must receive the same entitlement decision. Listing or publishing a Claw does not itself grant a user access.

An authorized orchestrator may use its configured sub-agents internally. This does not automatically grant users direct access to each sub-agent; direct access is a separate entitlement unless the product policy explicitly includes it.

Keep identity, authorization, subscription, billing, and entitlement data in the shared Gustafta platform rather than duplicating them in a separate Builder app. Existing admin and superadmin permissions must continue to use effective server-side authorization.

**Why:** the owner chose both individual per-Claw access and package access so users can receive specific Claws directly or as a curated bundle, and limited individual licensing to packaged Claws while retaining the current tier-based base set.

**How to apply:** before implementation, map each user-facing Claw route to its canonical agent; define grant sources (individual license, active package/subscription, and any explicitly public access); enforce one shared server-side entitlement check across chat and streaming; and test direct URL/API denial, allowed package membership, individual grants, and internal sub-agent invocation separately.
