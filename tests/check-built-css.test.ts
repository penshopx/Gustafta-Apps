import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBuiltCss, isCssBuildWarning } from "../script/check-built-css";

test("rejects Tailwind's fake -: property and other CSS syntax warnings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "css-build-check-"));
  try {
    const assets = join(dir, "assets");
    await mkdir(assets);
    const file = join(assets, "index.css");
    await writeFile(file, ".ok{color:red}");
    await checkBuiltCss(dir);

    await writeFile(file, String.raw`.\[-\:\|\]{-: |}`);
    await assert.rejects(checkBuiltCss(dir), /Invalid generated CSS declaration "-:"/);

    await writeFile(file, ".invalid{color:red; bad property:value}");
    await assert.rejects(checkBuiltCss(dir), /CSS syntax warning/);

    await rm(file);
    await assert.rejects(checkBuiltCss(dir), /No production CSS found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only CSS build warnings are release blockers", () => {
  assert.equal(isCssBuildWarning("[esbuild css minify]\nExpected identifier but found \"-\""), true);
  assert.equal(isCssBuildWarning("[vite:css][postcss] invalid declaration"), true);
  assert.equal(isCssBuildWarning("[lightningcss minify] bad declaration"), true);
  assert.equal(isCssBuildWarning("Some chunks are larger than 500 kB"), false);
});