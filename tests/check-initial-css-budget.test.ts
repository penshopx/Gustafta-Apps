import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  checkInitialCssBudget, inspectInitialStylesheets, INITIAL_CSS_BASELINE, INITIAL_CSS_LIMIT,
  REVIEWED_EXTERNAL_STYLESHEETS,
} from "../script/check-built-css";

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "initial-css-budget-"));
  try {
    await mkdir(join(dir, "assets"));
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("counts initial local bytes once, excluding route-only and reviewed external bytes", () =>
  fixture(async (dir) => {
    const entry = ".initial::after{content:'Indonesia ✓'}";
    const preload = ".preload{color:blue}";
    await writeFile(join(dir, "assets/index.css"), entry);
    await writeFile(join(dir, "assets/shared style.css"), preload);
    // Much larger than the budget, but not referenced by initial HTML.
    await writeFile(join(dir, "assets/route-only.css"), ".route{color:red}".repeat(100_000));
    await writeFile(join(dir, "index.html"), `
      <link rel="stylesheet" href="/assets/index.css?v=1#main">
      <link rel="stylesheet" href="./assets/../assets/index.css?v=2">
      <link rel="preload" as="style" href="assets/shared%20style.css">
      <link rel="stylesheet" href="/assets/shared%20style.css">
      <link rel="stylesheet" href="https://cdn.example.org/external.css">
      <link rel="stylesheet" href="//cdn.example.org/external.css">
      <link rel="stylesheet" href="data:text/css,.external{}">
      <link rel="prefetch" as="style" href="/assets/route-only.css">
      <link rel="preload" as="script" href="/assets/route-only.css">
      <a href="/assets/route-only.css">Another page</a>
    `);
    const expected = {
      raw: Buffer.byteLength(entry) + Buffer.byteLength(preload),
      gzip: gzipSync(entry).byteLength + gzipSync(preload).byteLength,
    };
    const reviewed = ["https://cdn.example.org/external.css", "data:text/css,.external{}"];
    assert.deepEqual(await checkInitialCssBudget(dir, expected, reviewed), expected);
    await assert.rejects(checkInitialCssBudget(dir, { ...expected, raw: expected.raw - 1 }, reviewed),
      /Initial CSS budget exceeded:.*baseline.*limit.*Counted assets:.*lazy-loaded pages.*INITIAL_CSS_LIMIT/);
    await assert.rejects(checkInitialCssBudget(dir, { ...expected, gzip: expected.gzip - 1 }, reviewed),
      /Initial CSS budget exceeded:.*gzip.*limit/);
    await rm(join(dir, "assets/index.css"));
    await assert.rejects(checkInitialCssBudget(dir), /ENOENT/);
  }));

test("missing HTML or local stylesheets fails closed", () =>
  fixture(async (dir) => {
    await assert.rejects(checkInitialCssBudget(dir), /ENOENT/);
    await writeFile(join(dir, "index.html"),
      '<link rel="stylesheet" href="https://cdn.example.org/external.css">');
    await assert.rejects(checkInitialCssBudget(dir, undefined, ["https://cdn.example.org/external.css"]),
      /No local initial CSS assets/);
    await writeFile(join(dir, "index.html"), '<link rel="stylesheet" href="/missing.css">');
    await assert.rejects(checkInitialCssBudget(dir), /ENOENT/);
  }));

test("references cannot escape build output, including URL-encoded traversal", () =>
  fixture(async (dir) => {
    for (const href of ["../outside.css", "/assets/../../outside.css", "%2e%2e/outside.css"]) {
      await writeFile(join(dir, "index.html"), `<link rel="stylesheet" href="${href}">`);
      await assert.rejects(checkInitialCssBudget(dir), /Initial CSS asset escapes build output/);
    }
  }));

test("reviewed production baseline has approximately 10% headroom in both budgets", () => {
  for (const key of ["raw", "gzip"] as const) {
    const headroom = INITIAL_CSS_LIMIT[key] / INITIAL_CSS_BASELINE[key];
    assert.ok(headroom >= 1.09 && headroom <= 1.11, `${key}: budget headroom is ${headroom}`);
  }
});

test("new HTML stylesheet and style preload fail even when local byte budget passes", () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "assets/index.css"), ".a{color:red}");
    for (const link of [
      '<link rel="stylesheet" href="https://new.example/a.css">',
      '<link rel="PRELOAD" as="STYLE" href="//new.example/a.css">',
    ]) {
      await writeFile(join(dir, "index.html"),
        `<link rel="stylesheet" href="/assets/index.css">${link}`);
      await assert.rejects(checkInitialCssBudget(dir),
        /Unreviewed external initial stylesheet dependencies:[\s\S]*https:\/\/new.example\/a.css[\s\S]*Review[\s\S]*REVIEWED_EXTERNAL_STYLESHEETS[\s\S]*No network requests/);
    }
  }));

test("parses imports, deduplicates URLs and reports sources without scanning unrelated CSS", () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "index.html"), `
      <link rel="stylesheet" href="/assets/index.css">
      <link rel="stylesheet" href="https://cdn.example/a.css?a=1&amp;b=2#html">
      <link rel="preload" as="style" href="//cdn.example/a.css?a=1&amp;b=2">
      <link rel="prefetch" as="style" href="/assets/route.css">
      <link rel="preconnect" href="https://ignored.example">
    `);
    await writeFile(join(dir, "assets/index.css"), `
      /* @import "https://ignored.example/comment.css"; */
      @import url("//cdn.example/a.css?a=1&b=2#css") layer(fonts) screen;
      @import "\\68 ttps://cdn.example/b.css";
      @import "./nested.css";
      .a{content:"@import 'https://ignored.example/string.css';";background:url(https://ignored.example/image.png)}
    `);
    await writeFile(join(dir, "assets/nested.css"),
      '@import "./index.css"; @import "https://cdn.example/a.css?a=1&b=2";');
    await writeFile(join(dir, "assets/route.css"),
      '@import "https://unreviewed.example/route.css";');
    const { files, external } = await inspectInitialStylesheets(dir);
    assert.equal(files.size, 2);
    assert.deepEqual([...external.keys()].sort(), [
      "https://cdn.example/a.css?a=1&b=2", "https://cdn.example/b.css",
    ]);
    assert.deepEqual([...external.get("https://cdn.example/a.css?a=1&b=2")!].sort(),
      ["assets/index.css", "assets/nested.css", "index.html"]);
    await assert.rejects(checkInitialCssBudget(dir),
      /Unreviewed external initial stylesheet dependencies:[\s\S]*cdn.example\/b.css/);
    const result = await checkInitialCssBudget(dir, undefined, [...external.keys()]);
    const css = await Promise.all([...files].map((path) => readFile(path)));
    assert.equal(result.raw, css.reduce((sum, bytes) => sum + bytes.byteLength, 0));
  }));

test("review uses exact query and protocol, not just approved hostname", () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "assets/index.css"), ".a{}");
    const url = REVIEWED_EXTERNAL_STYLESHEETS[0];
    for (const altered of [url + "&extra=1", url.replace("https:", "http:"), url.replace("display=swap", "display=block")]) {
      await writeFile(join(dir, "index.html"),
        `<link rel="stylesheet" href="/assets/index.css"><link rel="stylesheet" href="${altered}">`);
      await assert.rejects(checkInitialCssBudget(dir), /Unreviewed external/);
    }
  }));

test("current shared Google Fonts URL is reviewed without any network access", (t) =>
  fixture(async (dir) => {
    const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("Network forbidden"); });
    const html = await readFile(new URL("../client/index.html", import.meta.url), "utf8");
    const link = html.match(/<link[^>]+fonts\.googleapis\.com\/css2[^>]+>/)![0];
    await writeFile(join(dir, "index.html"), `<link rel="stylesheet" href="/assets/index.css">${link}`);
    await writeFile(join(dir, "assets/index.css"), ".a{}");
    const log = t.mock.method(console, "log", () => {});
    await checkInitialCssBudget(dir);
    const report = log.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
    assert.match(report, /External initial stylesheet dependencies \(1 unique/);
    assert.match(report, /NOT included in the local CSS byte budget/);
    assert.match(report, /not a total network download measurement/);
    assert.equal(fetchMock.mock.calls.length, 0);
  }));

test("local import traversal and missing imports fail closed", () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "index.html"), '<link rel="stylesheet" href="/assets/index.css">');
    for (const ref of ["../../outside.css", "%2e%2e/%2e%2e/outside.css"]) {
      await writeFile(join(dir, "assets/index.css"), `@import "${ref}";`);
      await assert.rejects(checkInitialCssBudget(dir), /Initial CSS asset escapes build output/);
    }
    await writeFile(join(dir, "assets/index.css"), '@import "./missing.css";');
    await assert.rejects(checkInitialCssBudget(dir), /ENOENT/);
  }));

test("inline style imports require review and deduplicate with linked and nested CSS", () =>
  fixture(async (dir) => {
    const url = "https://inline.example/font.css?a=1&b=2";
    await writeFile(join(dir, "assets/index.css"),
      `@import "${url}"; .a{color:red}`);
    await writeFile(join(dir, "assets/inline-local.css"),
      '@import "https://inline.example/nested.css";');
    await writeFile(join(dir, "index.html"), `
      <link rel="stylesheet" href="/assets/index.css">
      <link rel="stylesheet" href="https://inline.example/font.css?a=1&amp;b=2">
      <style>
        /* @import "https://ignored.example/comment.css"; */
        @import url("//inline.example/font.css?a=1&b=2");
        @import "./assets/inline-local.css";
        .a{content:"@import 'https://ignored.example/string.css';"}
      </style>
      <style type="text/css">@import "https://inline.example/new.css";</style>
      <style type="application/json">@import "https://ignored.example/not-css";</style>
    `);
    const { files, external } = await inspectInitialStylesheets(dir);
    assert.equal(files.size, 2);
    assert.deepEqual([...external.keys()].sort(), [
      url, "https://inline.example/nested.css", "https://inline.example/new.css",
    ]);
    assert.deepEqual([...external.get(url)!].sort(), ["assets/index.css", "index.html"]);
    await assert.rejects(checkInitialCssBudget(dir, undefined, [url, "https://inline.example/nested.css"]),
      /Unreviewed external initial stylesheet dependencies:\s+https:\/\/inline.example\/new.css/);
    await checkInitialCssBudget(dir, undefined, [...external.keys()]);
  }));
