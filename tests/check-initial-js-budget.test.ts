import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { checkInitialJsBudget } from "../script/check-initial-js-budget";

test("counts only local JS referenced by index.html, once per asset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "initial-js-budget-"));
  try {
    await mkdir(join(dir, "assets"));
    const entry = "const start = true;";
    const preload = "export const shared = 1;";
    await writeFile(join(dir, "assets", "index.js"), entry);
    await writeFile(join(dir, "assets", "shared.js"), preload);
    await writeFile(join(dir, "assets", "route-only.js"), "x".repeat(100_000));
    await writeFile(join(dir, "index.html"), `
      <script type="module" src="/assets/index.js"></script>
      <link rel="modulepreload" href="/assets/shared.js">
      <link rel="modulepreload" href="/assets/shared.js">
      <script src="https://example.org/external.js"></script>
    `);
    const expected = {
      raw: Buffer.byteLength(entry) + Buffer.byteLength(preload),
      gzip: gzipSync(entry).byteLength + gzipSync(preload).byteLength,
    };
    assert.deepEqual(await checkInitialJsBudget(dir, expected), expected);
    await assert.rejects(checkInitialJsBudget(dir, { ...expected, gzip: expected.gzip - 1 }), /Initial JS budget exceeded.*lazy-load route-only code/);
    await assert.rejects(checkInitialJsBudget(dir, { ...expected, raw: expected.raw - 1 }), /Initial JS budget exceeded/);
    await rm(join(dir, "assets", "shared.js"));
    await assert.rejects(checkInitialJsBudget(dir), /ENOENT/);
    await writeFile(join(dir, "index.html"), `<script src="https://example.org/external.js"></script>`);
    await assert.rejects(checkInitialJsBudget(dir), /No local initial JS assets/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});