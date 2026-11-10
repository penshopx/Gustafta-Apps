import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(path, "utf8");
const html = read("client/index.html");
const css = read("client/src/index.css");

test("initial document requests only the shared UI families once", () => {
  const links = [...html.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*>/g)]
    .map((match) => match[1]).filter((href) => href.startsWith("https://fonts.googleapis.com/css2?"));
  assert.equal(links.length, 1);
  const url = new URL(links[0].replaceAll("&amp;", "&"));
  assert.deepEqual(url.searchParams.getAll("family"), [
    "DM Sans:ital,opsz,wght@0,9..40,400..900;1,9..40,400..900",
    "JetBrains Mono:ital,wght@0,400..700;1,400..700",
  ]);
  assert.equal(url.searchParams.get("display"), "swap");
  assert.doesNotMatch(css, /@import\s+(?:url\()?['"]https?:/);
});

test("the serif face is loaded only by the pages that actually use it", () => {
  const serif = read("client/src/styles/serif-font.css");
  const url = new URL(serif.match(/https:\/\/fonts\.googleapis\.com\/css2[^'"]+/)[0]);
  assert.deepEqual(url.searchParams.getAll("family"), ["Libre Baskerville:ital,wght@0,400;0,700;1,400"]);
  assert.equal(url.searchParams.get("display"), "swap");
  const consumers = [];
  const importers = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.[jt]sx?$/.test(path)) {
        const source = read(path);
        if (/\bfont-serif\b/.test(source)) consumers.push(path);
        if (source.includes('import "@/styles/serif-font.css"')) importers.push(path);
      }
    }
  }
  visit("client/src");
  assert.ok(consumers.length > 0);
  assert.deepEqual(importers.sort(), consumers.sort(), "each serif consumer must own its lazy CSS import");
  for (const path of consumers) {
    const page = path.split("/").at(-1).replace(/\.tsx$/, "");
    assert.ok(read("client/src/App.tsx").includes(`lazy(() => import("@/pages/${page}"))`), `${page} must remain a lazy route`);
  }
  assert.doesNotMatch(read("client/src/main.tsx"), /serif-font/);
  assert.doesNotMatch(read("client/src/App.tsx"), /import\s+["'][^"']*serif-font/);
});
