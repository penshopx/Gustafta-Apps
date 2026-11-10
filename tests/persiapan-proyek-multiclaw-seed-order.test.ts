import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const serverIndex = readFileSync(
  new URL("../server/index.ts", import.meta.url),
  "utf8",
);

const multiclawSeedCall = "seedPersiapanProyekMulticlaw()";
const requiredMemberSeedCalls = [
  "seedDesainProyekClaw()",
  "seedRencanaProyekClaw()",
  "seedStudiKelayakanClaw()",
];

test("boot seeds all Persiapan Proyek member claws before the MultiClaw", () => {
  const multiclawPosition = serverIndex.indexOf(multiclawSeedCall);
  assert.notEqual(
    multiclawPosition,
    -1,
    `${multiclawSeedCall} must be called during boot`,
  );

  for (const memberSeedCall of requiredMemberSeedCalls) {
    const memberPosition = serverIndex.indexOf(memberSeedCall);
    assert.notEqual(
      memberPosition,
      -1,
      `${memberSeedCall} must be called during boot`,
    );
    assert.ok(
      memberPosition < multiclawPosition,
      `${memberSeedCall} must run before ${multiclawSeedCall}; otherwise the MultiClaw seed silently defers wiring until the next deploy`,
    );
  }
});