---
name: Tailwind 4 design parity
description: Non-obvious differences to account for when preserving the Tailwind 3 design on Tailwind 4.
---

Tailwind 4's default palette is OKLCH, its default ring is 1px/currentColor rather than 3px/blue, and its shadow scale shifts names. Even when the old color tokens are supplied to the theme, the typography plugin can emit OKLCH values directly into its prose variables; preserving the old prose appearance requires an explicit override. Application-owned CSS variables can also collide with utility theme names, so inline utility theme values where a shared variable name has a separate application meaning.

**Why:** A successful build and nearly identical utility-class coverage did not imply equal computed styles during the Tailwind 3→4 migration.

**How to apply:** When upgrading Tailwind or typography again, compare compiled declarations and representative pages as well as build warnings; check default ring, shadow, radius and prose variables specifically. Put prose palette overrides in the utilities layer, not unlayered CSS, so the dark prose-invert variant can override light prose values.