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

test("retry delivery hanya dapat dipanggil superadmin", () => {
  const block = routeBlock("/api/store/admin/orders/:id/retry-delivery");
  assert.match(block, /isAuthenticated,\s*requireSuperAdmin/);
  assert.doesNotMatch(block, /requireAdmin,\s*async/);
});

test("retry delivery menolak order non-pending dan klaim pengiriman bersifat atomik", () => {
  const block = routeBlock("/api/store/admin/orders/:id/retry-delivery");
  assert.match(block, /order\.status !== "pending"/);
  assert.match(block, /delivery_status <> 'sending'/);
  assert.match(block, /WHERE id=\$1\s+AND status='pending'/);
  assert.match(block, /processDigitalDeliveryOrder\(orderId, getServerBaseUrl\(req\)\)/);
});

test("retry delivery mencoba email lalu WA dan hanya sukses setelah salah satu kanal terkirim", () => {
  const block = routeBlock("/api/store/admin/orders/:id/retry-delivery");
  const emailSuccess = block.indexOf('delivery.deliveryStatus === "sent"');
  const waAttempt = block.indexOf("await sendWaMessage");
  const waSuccess = block.indexOf("if (waResult.sent)");
  const failure = block.indexOf("status='pending', delivery_status='failed'");

  assert.ok(emailSuccess >= 0, "hasil email harus diperiksa");
  assert.ok(waAttempt > emailSuccess, "WA harus menjadi fallback setelah email gagal");
  assert.ok(waSuccess > waAttempt, "hasil WA harus diperiksa sebelum sukses");
  assert.ok(failure > waSuccess, "kedua kegagalan harus mengembalikan order ke pending");
  assert.match(block, /res\.status\(502\)\.json/);
});

test("panel admin hanya menawarkan Kirim Ulang untuk superadmin dan order digital pending", () => {
  assert.match(
    adminSource,
    /isSuperAdmin && order\.status === "pending" && Boolean\(order\.downloadPath\)/,
  );
  assert.match(
    adminSource,
    /\/api\/store\/admin\/orders\/\$\{orderId\}\/retry-delivery/,
  );
  assert.match(adminSource, /data-testid=\{`button-retry-delivery-\$\{order\.id\}`\}/);
});