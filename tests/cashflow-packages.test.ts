import assert from "node:assert/strict";
import test from "node:test";
import { CASHFLOW_TIERS } from "../client/src/data/pricing";
import {
  getCashflowPackageDefinitions,
} from "../server/seed-cashflow-packages";

test("CASHFLOW-PBJ exposes exactly nine purchasable tier-duration packages", () => {
  const definitions = getCashflowPackageDefinitions();
  assert.equal(definitions.length, 9);
  assert.equal(new Set(definitions.map((item) => item.key)).size, 9);
  assert.equal(new Set(definitions.map((item) => item.packageId)).size, 9);
  assert.deepEqual(
    definitions.map((item) => item.durationMonths),
    [3, 6, 12, 3, 6, 12, 3, 6, 12],
  );
});

test("package prices come directly from CASHFLOW_TIERS in pricing.ts", () => {
  const expected = new Map(
    CASHFLOW_TIERS.flatMap((tier) =>
      tier.durations.map((duration) => [duration.key, duration.total] as const),
    ),
  );
  for (const definition of getCashflowPackageDefinitions()) {
    assert.equal(definition.price, expected.get(definition.key));
  }
});

test("tier entitlements contain only the promised CASHFLOW agents", () => {
  const definitions = getCashflowPackageDefinitions();
  const onePerTier = new Map(
    definitions
      .filter((definition) => definition.durationMonths === 3)
      .map((definition) => [definition.tierKey, definition.agentSlugs]),
  );
  assert.deepEqual(onePerTier.get("mandor"), [
    "si-kas-claw",
    "si-berkas-claw",
  ]);
  assert.deepEqual(onePerTier.get("kontraktor"), [
    "si-kas-claw",
    "si-berkas-claw",
    "si-pasal-claw",
    "si-lapangan-claw",
    "si-strategi-claw",
    "cashflow-pbj-multiclaw",
  ]);
  assert.deepEqual(onePerTier.get("direktur"), [
    "si-kas-claw",
    "si-berkas-claw",
    "si-pasal-claw",
    "si-lapangan-claw",
    "si-strategi-claw",
    "si-pajak-claw",
    "si-darurat-claw",
    "cashflow-pbj-multiclaw",
  ]);
});