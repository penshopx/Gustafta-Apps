import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { checkPaymentBaseConfig } from "../script/check-payment-config";
import { DEFAULT_PAYMENT_BASE_URL } from "../shared/payment-base-url";

test("build rilis membandingkan konfigurasi runtime server dengan nilai produksi Vite", () => {
  const buildScript = readFileSync(fileURLToPath(new URL("../script/build.ts", import.meta.url)), "utf8");
  assert.match(buildScript, /checkPaymentBaseConfig\(\s*process\.env\.PAYMENT_BASE_URL,\s*loadEnv\("production", join\(process\.cwd\(\), "client"\), "VITE_"\)\.VITE_PAYMENT_BASE_URL/);
});

test("alamat pembayaran yang sama lolos pemeriksaan", () => {
  assert.doesNotThrow(() => checkPaymentBaseConfig("https://bayar.example.test", "https://bayar.example.test"));
});

test("alamat pembayaran berbeda menghentikan build dengan kedua nama variabel", () => {
  assert.throws(
    () => checkPaymentBaseConfig("https://server.example.test", "https://client.example.test"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /PAYMENT_BASE_URL="https:\/\/server\.example\.test"/);
      assert.match(error.message, /VITE_PAYMENT_BASE_URL="https:\/\/client\.example\.test"/);
      return true;
    },
  );
});

test("satu alamat baru dan satu alamat bawaan yang berbeda ditolak saat build rilis", () => {
  assert.throws(
    () => checkPaymentBaseConfig("https://server.example.test", undefined),
    /PAYMENT_BASE_URL="https:\/\/server\.example\.test".*VITE_PAYMENT_BASE_URL="https:\/\/bayar\.dokumenproyek\.com"/,
  );
  assert.throws(
    () => checkPaymentBaseConfig(undefined, "https://client.example.test"),
    /PAYMENT_BASE_URL="https:\/\/bayar\.dokumenproyek\.com".*VITE_PAYMENT_BASE_URL="https:\/\/client\.example\.test"/,
  );
});

test("nilai bawaan yang sama tetap lolos bila salah satu atau keduanya tidak diatur", () => {
  assert.doesNotThrow(() => checkPaymentBaseConfig(DEFAULT_PAYMENT_BASE_URL, undefined));
  assert.doesNotThrow(() => checkPaymentBaseConfig(undefined, DEFAULT_PAYMENT_BASE_URL));
  assert.doesNotThrow(() => checkPaymentBaseConfig(undefined, undefined));
});

test("Vite memakai nilai mode production dari folder client atau override proses", () => {
  const clientRoot = mkdtempSync(join(tmpdir(), "payment-client-env-"));
  try {
    writeFileSync(join(clientRoot, ".env.production"), "VITE_PAYMENT_BASE_URL=https://release.example.test\n");
    writeFileSync(join(clientRoot, ".env.development"), "VITE_PAYMENT_BASE_URL=https://dev.example.test\n");
    // An explicit process variable takes precedence over the client env file in Vite.
    const expected = process.env.VITE_PAYMENT_BASE_URL || "https://release.example.test";
    assert.equal(loadEnv("production", clientRoot, "VITE_").VITE_PAYMENT_BASE_URL, expected);
  } finally {
    rmSync(clientRoot, { recursive: true, force: true });
  }
});