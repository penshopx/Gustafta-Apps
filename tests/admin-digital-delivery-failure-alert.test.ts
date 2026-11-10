import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSource = readFileSync(resolve("server/routes.ts"), "utf8");
const adminSource = readFileSync(resolve("client/src/pages/admin.tsx"), "utf8");

function routeBlock(path: string): string {
  const start = routesSource.indexOf(`"${path}"`);
  assert.notEqual(start, -1, `Route ${path} harus tersedia`);
  const nextRoute = routesSource.indexOf("\n  app.", start + path.length);
  return routesSource.slice(start, nextRoute === -1 ? routesSource.length : nextRoute);
}

test("kegagalan delivery nyata disimpan secara atomik sebelum alert WA dicoba", () => {
  const fnStart = routesSource.indexOf("async function _sendDigitalDeliveryFailureAlert");
  const fnEnd = routesSource.indexOf("\n  // Proactive bounce alert", fnStart);
  const block = routesSource.slice(fnStart, fnEnd);

  assert.match(block, /@test\\\.gustafta\\\.id/);
  assert.ok(
    block.indexOf("await _recordDigitalDeliveryFailure(opts)") > block.indexOf("@test"),
    "buyer test harus dikecualikan sebelum persistensi",
  );
  assert.ok(
    block.indexOf("await _recordDigitalDeliveryFailure(opts)") < block.indexOf("process.env.SUPERADMIN_PHONE"),
    "kegagalan harus tersimpan sebelum konfigurasi WA diperiksa",
  );
  assert.match(routesSource, /ON CONFLICT \(key\) DO UPDATE SET/);
  assert.match(routesSource, /COALESCE\(\(system_config\.value::jsonb ->> 'count'\)::integer, 0\) \+ 1/);
});

test("endpoint status dan acknowledge dilindungi admin serta mereset hitungan", () => {
  const getBlock = routeBlock("/api/admin/digital-delivery-failures");
  const acknowledgeBlock = routeBlock("/api/admin/digital-delivery-failures/acknowledge");

  assert.match(getBlock, /isAuthenticated,\s*requireAdmin/);
  assert.match(acknowledgeBlock, /isAuthenticated,\s*requireAdmin/);
  assert.match(getBlock, /version:\s*rows\[0\]\.value/);
  assert.match(acknowledgeBlock, /AND value = \$\{observedVersion\}/);
  assert.match(acknowledgeBlock, /affectedRows === 0/);
  assert.match(acknowledgeBlock, /res\.status\(409\)/);
});

test("dashboard menampilkan warning global dan dapat mengakui kegagalan", () => {
  assert.match(adminSource, /queryKey:\s*\["\/api\/admin\/digital-delivery-failures"\]/);
  assert.match(adminSource, /data-testid="banner-digital-delivery-failures"/);
  assert.match(adminSource, /data-testid="button-acknowledge-digital-delivery-failures"/);
  assert.match(adminSource, /\/api\/admin\/digital-delivery-failures\/acknowledge/);
  assert.match(adminSource, /mutate\(digitalDeliveryFailures!\.version\)/);
});
