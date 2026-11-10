import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPreviewRouting } from "../scripts/lib/preview-routing-contract.mjs";
import { createRoutingFixture, readRoutingConfig, validateRoutingConfig } from "./helpers/preview-routing-fixture.mjs";

const config = readRoutingConfig();
const paths = [
  ["/", "gustafta", 200],
  ["/src/main.tsx", "gustafta", 200],
  ["/api/v1/ruang-simpan/company-profile", "gustafta", 401],
  ["/api/fixture-probe?source=startup", "gustafta", 401],
  ["/api/__mockup/nested", "gustafta", 401],
  ["/__mockup/", "sandbox", 200],
  ["/__mockup/src/main.tsx", "sandbox", 200],
  ["/__mockup/nested/path?source=restart", "sandbox", 200],
];

async function checkPhase(origin, generations, phase) {
  for (const [path, service, status] of paths) {
    const response = await fetch(new URL(path, origin), {
      redirect: "error", signal: AbortSignal.timeout(3_000),
    });
    const body = await response.text();
    const label = `${phase}: ${path}`;
    if (!generations[service]) {
      assert.equal(response.status, 503, `${label} must not fall back to the other service`);
      assert.equal(response.headers.get("x-fixture-service"), null, label);
      continue;
    }
    assert.equal(response.status, status, label);
    assert.equal(response.headers.get("x-fixture-service"), service, label);
    assert.equal(response.headers.get("x-fixture-generation"), String(generations[service]), label);
    if (path.endsWith("main.tsx")) {
      assert.match(response.headers.get("content-type"), /javascript/, label);
      assert(body.includes(`"generation":${generations[service]}`), `${label}: fresh script`);
    }
  }
  if (generations.gustafta && generations.sandbox) {
    await checkPreviewRouting({ origin, log: () => {} });
  }
}

test("preview configuration preserves root/API and sandbox ownership", () => {
  validateRoutingConfig(config);
});

for (const order of [["gustafta", "sandbox"], ["sandbox", "gustafta"]]) {
  for (const restarted of ["gustafta", "sandbox"]) {
    test(`${order.join(" then ")}; restart ${restarted}`, { timeout: 15_000 }, async (t) => {
      const fixture = await createRoutingFixture(config);
      t.after(() => fixture.close());
      const generations = { gustafta: 0, sandbox: 0 };
      await checkPhase(fixture.origin, generations, "neither started");
      for (const name of order) {
        await fixture.start(name);
        generations[name] = 1;
        await checkPhase(fixture.origin, generations, `started ${name}`);
      }
      await fixture.stop(restarted);
      generations[restarted] = 0;
      await checkPhase(fixture.origin, generations, `stopped ${restarted}`);
      await fixture.start(restarted);
      generations[restarted] = 2;
      await checkPhase(fixture.origin, generations, `restarted ${restarted}`);
      t.diagnostic("Verified identity, availability, generation and shared HTTP contract at every phase.");
    });
  }
}
