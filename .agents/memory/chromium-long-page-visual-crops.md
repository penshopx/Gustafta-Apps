---
name: Chromium long-page visual crops
description: Why visual references of components far below the fold need coordinate-based capture and human inspection.
---

On a long public page at mobile width, Puppeteer's element screenshot produced an image of the preceding and following cards instead of the selected card, while reporting success. A sticky header could also appear across the middle of a long element screenshot. The apparently stable compare still returned zero difference because the wrong reference and wrong capture matched.

**Why:** Browser element screenshot scrolling/clipping can disagree on pages much taller than the viewport; a passing self-comparison alone proves reproducibility, not correct coverage.

**How to apply:** For distant components, capture using their bounding box translated to document coordinates with captureBeyondViewport; neutralize sticky headers for component-only images. Visually inspect baseline images, especially mobile, before accepting them.

Bounding rectangles also exclude outer box-shadows/rings. Keep visual coverage tests against the real styled component, not only an inset-ring fixture.

**Why:** An outer-ring color mutation can leave only tiny rounded-corner differences inside the rectangle, passing a whole-image threshold despite a visibly different ring.

**How to apply:** Include a narrowly scoped margin for exterior decoration, inspect both viewport references manually, and prove that a color-only mutation changes exterior pixels without changing dimensions or content. When expanding a crop, compare the old image with the candidate's unpadded interior before accepting the new reference.