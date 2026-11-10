---
name: Visual font rendering policy
description: Stable visual comparisons require matching fontconfig rendering policy as well as font file bytes.
---

Pin both the actual font archive build and the fontconfig hinting policy when reproducing the reviewed visual references. The same DejaVu version from Debian and Ubuntu can contain different font bytes.

**Why:** Isolating the correct Ubuntu font files without the original slight-hinting/RGB/LCD policy changed text rasterization enough to fail every reference, despite matching layouts and Chromium versions. Matching the rendering policy restored the comparisons without changing references or thresholds.

**How to apply:** When replacing CI images or updating fonts, preserve the explicit rendering policy or review the resulting references manually. A font filename or upstream version alone is not a content pin.

Chrome for Testing's generic Linux download may not start in the Nix workspace because it cannot find the required shared libraries. Use an explicitly selected, version-matched system Chromium for local checks; keep the verified downloaded binary in Ubuntu CI.

**Why:** Workspace runtime libraries differ from the Linux Chrome distribution. Globally replacing library paths can also break Node and system tools.

**How to apply:** Treat this as local verification compatibility, not grounds for silently using an arbitrary browser in CI.

Font-enabled checks must verify loaded faces and inspect Resource Timing for CSS
imports, not rely solely on Puppeteer's intercepted request events.

**Why:** In the workspace Chromium, a lazy Google Fonts CSS import appeared in
Resource Timing and registered/loaded its faces without appearing in the page's
intercepted request list. A request-event-only assertion incorrectly reported
that the font stylesheet had never loaded. The visual gate intends to block
Google Fonts, but some later pages can still register and load external faces;
do not assume its images are exclusively fallback fonts without inspecting them.

**How to apply:** Pair offline fallback comparisons with a small font-enabled
capture when changing fonts. Wait for the lazy face to be registered before
calling `document.fonts.load`; loading an unknown family can resolve with no faces.

Preserve a font's optical-size axis when narrowing its requested weight range.

**Why:** DM Sans requested without its existing optical-size axis uses different
glyph shapes/metrics at heading sizes even though its family and weight names
are unchanged. This can look like a cascade or font-weight regression.

**How to apply:** Keep the existing optical-size range unless a typography redesign
is intended; compare real loaded font faces, not just computed family strings.
