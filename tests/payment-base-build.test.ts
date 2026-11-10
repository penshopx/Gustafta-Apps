import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const configuredUrl = "https://checkout-config.example.test";

test("checkout server membaca konfigurasi runtime, bukan import.meta milik Vite", async () => {
  const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
  assert.match(routes, /PAYMENT_BASE_URL,[\s\S]*?from "\.\/lib\/scalev"/);
  assert.doesNotMatch(routes, /client\/src\/lib\/payment-base|@\/lib\/payment-base/);

  // Bundle the actual server import graph: a seed importing client pricing
  // indirectly would otherwise reintroduce the CommonJS import.meta warning.
  const serverBundle = await build({
    entryPoints: [join(root, "server/index.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.url": "__filename" },
    logLevel: "silent",
  });
  assert.deepEqual(serverBundle.warnings, [], "whole server graph must not import Vite-only config");
  assert.doesNotMatch(serverBundle.outputFiles![0].text, /VITE_PAYMENT_BASE_URL|checkout-config\.example\.test/);

  const dir = mkdtempSync(join(tmpdir(), "payment-server-build-"));
  try {
    const entry = join(dir, "entry.ts");
    const outfile = join(dir, "checkout.cjs");
    writeFileSync(entry,
      `import { PAYMENT_BASE_URL } from ${JSON.stringify(join(root, "server/lib/scalev.ts"))};\n` +
      `console.log(PAYMENT_BASE_URL + "/c/checkout?variant_ids=42&qty=1");\n`);
    const result = await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "cjs",
      define: { "process.env.NODE_ENV": '"production"', "import.meta.url": "__filename" },
      logLevel: "silent",
    });
    assert.deepEqual(result.warnings, [], "server bundle must not warn about import.meta");
    const run = (paymentBaseUrl?: string) => {
      const env = { ...process.env };
      delete env.PAYMENT_BASE_URL;
      if (paymentBaseUrl) env.PAYMENT_BASE_URL = paymentBaseUrl;
      const output = spawnSync(process.execPath, [outfile], { env, encoding: "utf8" });
      assert.equal(output.status, 0, output.stderr);
      return output.stdout.trim();
    };
    assert.equal(run(configuredUrl), `${configuredUrl}/c/checkout?variant_ids=42&qty=1`);
    assert.equal(run(), "https://bayar.dokumenproyek.com/c/checkout?variant_ids=42&qty=1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkout klien tetap mengambil VITE_PAYMENT_BASE_URL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "payment-client-build-"));
  try {
    const entry = join(dir, "entry.ts");
    const outfile = join(dir, "checkout.cjs");
    writeFileSync(entry,
      `import { PAYMENT_BASE_URL } from ${JSON.stringify(join(root, "client/src/lib/payment-base.ts"))};\n` +
      `console.log(PAYMENT_BASE_URL + "/p/test");\n`);
    const result = await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "cjs",
      define: { "import.meta.env.VITE_PAYMENT_BASE_URL": JSON.stringify(configuredUrl) },
      logLevel: "silent",
    });
    assert.deepEqual(result.warnings, []);
    const output = spawnSync(process.execPath, [outfile], {
      env: { ...process.env, PAYMENT_BASE_URL: "https://wrong-server.example.test" },
      encoding: "utf8",
    });
    assert.equal(output.status, 0, output.stderr);
    assert.equal(output.stdout.trim(), `${configuredUrl}/p/test`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});