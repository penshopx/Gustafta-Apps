// Task #315 — durable contract for the customer-visible Bersertifikat badge.
//
// The HTTP+DB test in curation-badge-flag-removal.test.ts proves that a live
// landing response carries isCertified=true after storage mapping. This
// focused contract keeps the buyer-facing Beli branch reviewable as well:
// certified products must render the green badge, before the creator fallback,
// and must not be confused with the official Gustafta badge.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const landingSource = fs.readFileSync(
  path.join(process.cwd(), "client", "src", "pages", "product-landing.tsx"),
  "utf8",
);
const pricingStart = landingSource.indexOf('{/* Pricing / Offers */}');
const pricingSection = landingSource.slice(pricingStart);

test("Beli landing renders Bersertifikat as the green certified badge", () => {
  assert.notEqual(pricingStart, -1, "pricing/Beli section must exist");

  const officialIndex = pricingSection.indexOf("agent.isGustafta ?");
  const certifiedIndex = pricingSection.indexOf(") : agent.isCertified ?");
  const creatorFallbackIndex = pricingSection.indexOf(") : (");

  assert.ok(officialIndex >= 0, "official badge branch must exist");
  assert.ok(certifiedIndex > officialIndex, "certified branch must follow official precedence");
  assert.ok(
    creatorFallbackIndex === -1 || certifiedIndex < creatorFallbackIndex,
    "certified branch must precede the creator fallback",
  );
  assert.match(pricingSection, /className="bg-emerald-600 text-white border-emerald-700/);
  assert.match(pricingSection, /data-testid=\{`badge-beli-bersertifikat-\$\{agent\.id\}`\}/);
  assert.match(pricingSection, />\s*Bersertifikat\s*</);
});

test("landing API mapping and Beli UI use the same certification flag", () => {
  const routesSource = fs.readFileSync(
    path.join(process.cwd(), "server", "routes.ts"),
    "utf8",
  );
  const landingRouteStart = routesSource.indexOf('app.get("/api/landing/:agentId"');
  const landingRoute = routesSource.slice(landingRouteStart, landingRouteStart + 5000);

  assert.notEqual(landingRouteStart, -1, "public landing API route must exist");
  assert.match(
    landingRoute,
    /isCertified:\s*\(agent as any\)\.isCertified === true/,
    "landing API must expose the mapped database flag",
  );
  assert.match(
    pricingSection,
    /agent\.isGustafta \|\| agent\.isCertified \|\| agent\.isCreatorMade/,
    "Beli badge visibility must be driven by the landing API flags",
  );
});