import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertScalevVariantExists,
  ScalevVariantValidationError,
} from "../server/lib/scalev";

const realFetch = globalThis.fetch;
const oldApiKey = process.env.SCALEV_API_KEY;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (oldApiKey === undefined) delete process.env.SCALEV_API_KEY;
  else process.env.SCALEV_API_KEY = oldApiKey;
});

function mockScalev(status: number, body: unknown) {
  process.env.SCALEV_API_KEY = "test-only-key";
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    assert.equal(String(input), "https://api.scalev.id/v2/variants/12345");
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer test-only-key");
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

test("varian Scalev yang masih ada lolos verifikasi", async () => {
  mockScalev(200, { code: 200, data: { id: 12345, name: "Varian aktif" } });
  await assert.doesNotReject(assertScalevVariantExists(12345));
});

test("varian yang dihapus di Scalev ditolak dengan peringatan jelas", async () => {
  mockScalev(404, { code: 404, error: "not found" });
  await assert.rejects(
    assertScalevVariantExists(12345),
    (error: unknown) => {
      assert.ok(error instanceof ScalevVariantValidationError);
      assert.equal(error.kind, "not_found");
      assert.match(error.message, /tidak ditemukan|sudah dihapus/i);
      return true;
    },
  );
});

test("gangguan Scalev gagal tertutup agar ID yang belum terverifikasi tidak tersimpan", async () => {
  mockScalev(503, { error: "maintenance" });
  await assert.rejects(
    assertScalevVariantExists(12345),
    (error: unknown) => {
      assert.ok(error instanceof ScalevVariantValidationError);
      assert.equal(error.kind, "unavailable");
      assert.match(error.message, /belum disimpan|gagal memverifikasi/i);
      return true;
    },
  );
});

test("respons sukses tanpa payload varian konkret tetap ditolak", async () => {
  mockScalev(200, { code: 200, data: null });
  await assert.rejects(
    assertScalevVariantExists(12345),
    (error: unknown) => {
      assert.ok(error instanceof ScalevVariantValidationError);
      assert.equal(error.kind, "not_found");
      return true;
    },
  );
});

test("PATCH produk memverifikasi field yang disimpan dan meneruskan warning ke admin", () => {
  const routes = fs.readFileSync(path.join(process.cwd(), "server/routes.ts"), "utf8");
  const admin = fs.readFileSync(path.join(process.cwd(), "client/src/pages/admin.tsx"), "utf8");
  const routeStart = routes.indexOf('app.patch("/api/store/admin/products/:id"');
  const routeEnd = routes.indexOf('app.delete("/api/store/admin/products/:id"', routeStart);
  const handler = routes.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(handler, /hasOwnProperty\.call\(req\.body,\s*"scalevVariantId"\)/);
  assert.match(handler, /await assertScalevVariantExists\(variantId\)/);
  assert.match(handler, /error\.kind === "not_found" \? 422 : 502/);
  assert.match(
    admin,
    /handle401Error\(err,\s*"Gagal memperbarui produk\.",\s*err\?\.message\)/,
    "toast edit produk harus menampilkan detail warning dari server",
  );
  assert.match(admin, /data-testid="input-edit-product-scalev-variant-id"/);
  assert.match(admin, /scalevVariantId:\s*p\.scalevVariantId != null \? String\(p\.scalevVariantId\) : ""/);
  assert.match(admin, /scalevVariantId:\s*editProductForm\.scalevVariantId === "" \? null : Number\(editProductForm\.scalevVariantId\)/);
});
