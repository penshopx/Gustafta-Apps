import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("client/src/pages/hub-audit.tsx", "utf8");
const routes = readFileSync("server/routes.ts", "utf8");

test("Hub Audit exposes a confirmed one-click reset to solo", () => {
  assert.match(page, /data-testid=\{`btn-reset-solo-\$\{hub\.hub_id\}`\}/);
  assert.match(page, /<AlertDialogTitle>Reset \{hub\.hub_name\} ke solo\?<\/AlertDialogTitle>/);
  assert.match(page, /data-testid=\{`btn-confirm-reset-solo-\$\{hub\.hub_id\}`\}/);
  assert.match(page, /body: JSON\.stringify\(\{ candidateIds: \[\] \}\)/);
  assert.match(page, /qc\.invalidateQueries\(\{ queryKey: \["\/api\/admin\/hub-audit"\] \}\)/);
});

test("Hub Audit lists connected hubs so reset remains discoverable", () => {
  const handler = routes.match(
    /app\.get\("\/api\/admin\/hub-audit"[\s\S]*?(?=app\.post\("\/api\/admin\/hub-audit\/:id\/auto-connect")/
  )?.[0];

  assert.ok(handler, "GET hub-audit handler tidak ditemukan");
  assert.doesNotMatch(handler, /agentic_sub_agents::text = '\[\]'/);
  assert.match(page, /\{connectedCount\} sub-agen/);
});

test("Reset solo atomically clears authoritative pricing overrides", () => {
  const handler = routes.match(
    /app\.post\("\/api\/admin\/hub-audit\/:id\/auto-connect"[\s\S]*?(?=app\.post\("\/api\/admin\/hub-audit\/:id\/generate-prompt")/
  )?.[0];

  assert.ok(handler, "POST auto-connect handler tidak ditemukan");
  assert.match(handler, /db\.transaction\(async \(tx\) =>/);
  assert.match(handler, /license_class = NULL/);
  assert.match(handler, /license_price = NULL/);
  assert.match(handler, /\.set\(\{ price: DEFAULT_LICENSE_PRICE, priceOverride: null \}\)/);
});