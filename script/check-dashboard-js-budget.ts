import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { Rollup } from "vite";

// Decimal bytes; baseline: chunk 473,498 / 107,420 gzip,
// recursive static graph 1,579,506 / 455,809 gzip. Allow roughly 10% growth.
export const DASHBOARD_JS_LIMIT = {
  chunk: { raw: 520_000, gzip: 120_000 },
  graph: { raw: 1_750_000, gzip: 510_000 },
};

type Chunk = Pick<Rollup.OutputChunk, "fileName" | "facadeModuleId" | "imports"> & {
  modules: Record<string, unknown>;
};
type Size = { raw: number; gzip: number };
const normalize = (id: string) => id.replace(/\\/g, "/").split(/[?#]/, 1)[0];
const isDashboard = (id: string) => /(?:^|\/)src\/pages\/dashboard\.tsx$/.test(normalize(id));

function isOptionalPanel(id: string) {
  const path = normalize(id);
  return /(?:^|\/)src\/components\/panels\/[^/]+-panel\.tsx$/.test(path) &&
    !path.endsWith("/persona-panel.tsx");
}

export async function checkDashboardJsBudget(
  publicDir: string,
  chunks: readonly Chunk[],
  limit = DASHBOARD_JS_LIMIT,
): Promise<{ chunk: Size; graph: Size; assets: string[] }> {
  // Use emitted module identity, never a hash-dependent filename or JS regex.
  // Rollup can omit the facade when the dynamic route shares exports. Its
  // module identity remains in modules even in that case (or after inlining).
  const dashboards = chunks.filter((chunk) =>
    (chunk.facadeModuleId != null && isDashboard(chunk.facadeModuleId)) ||
    Object.keys(chunk.modules).some(isDashboard));
  if (dashboards.length !== 1) {
    throw new Error(`Expected exactly one dashboard entry chunk, found ${dashboards.length}`);
  }
  const dashboard = dashboards[0];
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  if (byFile.size !== chunks.length) throw new Error("Duplicate emitted JS chunk filename");
  const visited = new Set<string>();
  const sizes = new Map<string, Size>();
  const graph: Size = { raw: 0, gzip: 0 };

  async function visit(file: string): Promise<void> {
    if (visited.has(file)) return; // shared dependencies and cycles count once
    const chunk = byFile.get(file);
    if (!chunk) throw new Error(`Missing static JS chunk in dashboard graph: ${file}`);
    visited.add(file);
    const path = resolve(publicDir, file);
    const rel = relative(resolve(publicDir), path);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
      throw new Error(`Dashboard JS asset escapes build output: ${file}`);
    }
    const optional = Object.keys(chunk.modules).filter(isOptionalPanel);
    if (optional.length) {
      throw new Error(`Optional dashboard panel entered initial static graph (${file}): ${optional.join(", ")}. Restore its lazy boundary.`);
    }
    const contents = await readFile(path); // absent output must fail closed
    const size = { raw: contents.byteLength, gzip: gzipSync(contents).byteLength };
    sizes.set(file, size);
    graph.raw += size.raw;
    graph.gzip += size.gzip;
    // Rollup imports are static edges only. Do not scan code, dynamicImports,
    // Vite __vite__mapDeps/preload lists, or unrelated chunks.
    for (const dependency of chunk.imports) await visit(dependency);
  }

  await visit(dashboard.fileName);
  const chunk = sizes.get(dashboard.fileName)!;
  for (const [label, size, budget] of [
    ["chunk", chunk, limit.chunk],
    ["static graph", graph, limit.graph],
  ] as const) {
    console.log(`Dashboard JS ${label}: raw ${size.raw} B (limit ${budget.raw} B), gzip ${size.gzip} B (limit ${budget.gzip} B)`);
    if (size.raw > budget.raw || size.gzip > budget.gzip) {
      throw new Error(`Dashboard JS ${label} budget exceeded. Check eager panel/shared imports; restore lazy boundaries or deliberately review DASHBOARD_JS_LIMIT in script/check-dashboard-js-budget.ts with a measured baseline.`);
    }
  }
  console.log(`Dashboard static graph: ${visited.size} unique JS assets`);
  return { chunk, graph, assets: [...visited] };
}
