import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { checkDashboardJsBudget } from "../script/check-dashboard-js-budget";

const unlimited = {
  chunk: { raw: Infinity, gzip: Infinity },
  graph: { raw: Infinity, gzip: Infinity },
};

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "dashboard-budget-"));
  await mkdir(join(dir, "assets"));
  const contents = {
    "assets/dashboard-hash.js": 'import "./entry.js"; import "./shared.js"; const __vite__mapDeps = ["assets/optional.js"]; import("./optional.js");',
    "assets/entry.js": 'export * from "./shared.js";',
    "assets/shared.js": 'import "./entry.js"; export const shared = true;',
  };
  for (const [file, code] of Object.entries(contents)) await writeFile(join(dir, file), code);
  const chunks = [
    {
      fileName: "assets/dashboard-hash.js",
      facadeModuleId: "/project/client/src/pages/dashboard.tsx",
      imports: ["assets/entry.js", "assets/shared.js"],
      modules: {
        "/project/client/src/pages/dashboard.tsx": {},
        "/project/client/src/components/panels/persona-panel.tsx": {},
      },
      dynamicImports: ["assets/optional.js"],
    },
    { fileName: "assets/entry.js", facadeModuleId: null, imports: ["assets/shared.js"], modules: {} },
    { fileName: "assets/shared.js", facadeModuleId: null, imports: ["assets/entry.js"], modules: {} },
    // No file on disk: dynamic/preload-only assets must not be read.
    {
      fileName: "assets/optional.js",
      facadeModuleId: "/project/client/src/components/panels/analytics-panel.tsx",
      imports: [],
      modules: { "/project/client/src/components/panels/analytics-panel.tsx": {} },
    },
  ];
  const chunk = {
    raw: Buffer.byteLength(contents["assets/dashboard-hash.js"]),
    gzip: gzipSync(contents["assets/dashboard-hash.js"]).byteLength,
  };
  const graph = Object.values(contents).reduce((size, code) => ({
    raw: size.raw + Buffer.byteLength(code),
    gzip: size.gzip + gzipSync(code).byteLength,
  }), { raw: 0, gzip: 0 });
  return { dir, chunks, chunk, graph, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("recurses through static imports, includes shared entry, deduplicates diamonds/cycles and ignores dynamic/preload-only assets", async () => {
  const f = await fixture();
  try {
    const result = await checkDashboardJsBudget(f.dir, f.chunks, { chunk: f.chunk, graph: f.graph });
    assert.deepEqual(result, {
      chunk: f.chunk, graph: f.graph,
      assets: ["assets/dashboard-hash.js", "assets/entry.js", "assets/shared.js"],
    });
  } finally { await f.cleanup(); }
});

test("identifies dashboard by module identity when Rollup omits its facade", async () => {
  const f = await fixture();
  try {
    const chunks = f.chunks.map(c => ({ ...c, facadeModuleId: null }));
    assert.deepEqual((await checkDashboardJsBudget(f.dir, chunks)).graph, f.graph);
  } finally { await f.cleanup(); }
});

for (const scope of ["chunk", "graph"] as const) {
  for (const metric of ["raw", "gzip"] as const) {
    test(`rejects ${scope} ${metric} overflow independently`, async () => {
      const f = await fixture();
      try {
        const limit = { chunk: { ...unlimited.chunk }, graph: { ...unlimited.graph } };
        limit[scope][metric] = f[scope][metric] - 1;
        await assert.rejects(checkDashboardJsBudget(f.dir, f.chunks, limit), /budget exceeded/);
      } finally { await f.cleanup(); }
    });
  }
}

test("rejects optional panels imported directly, transitively, or inlined even below budget", async () => {
  const f = await fixture();
  try {
    for (const parent of [0, 2]) {
      f.chunks[parent].imports.push("assets/optional.js");
      await assert.rejects(checkDashboardJsBudget(f.dir, f.chunks, unlimited), /Optional dashboard panel.*analytics-panel/);
      f.chunks[parent].imports.pop();
    }
    Object.assign(f.chunks[0].modules, {
      "C:\\project\\client\\src\\components\\panels\\knowledge-base-panel.tsx?query": {},
    });
    await assert.rejects(checkDashboardJsBudget(f.dir, f.chunks, unlimited), /Optional dashboard panel.*knowledge-base-panel/);
  } finally { await f.cleanup(); }
});

test("fails closed on missing or ambiguous dashboard identity, static metadata, and emitted assets", async () => {
  const f = await fixture();
  try {
    await assert.rejects(checkDashboardJsBudget(f.dir, f.chunks.slice(1)), /found 0/);
    await assert.rejects(checkDashboardJsBudget(f.dir, [...f.chunks, f.chunks[0]]), /found 2/);
    await assert.rejects(checkDashboardJsBudget(f.dir, f.chunks.slice(0, 2)), /Missing static JS chunk/);
    await rm(join(f.dir, "assets/shared.js"));
    await assert.rejects(checkDashboardJsBudget(f.dir, f.chunks), /ENOENT/);
    f.chunks[0].fileName = "../outside.js";
    await assert.rejects(checkDashboardJsBudget(f.dir, f.chunks), /escapes build output/);
  } finally { await f.cleanup(); }
});
