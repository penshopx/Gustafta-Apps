import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { load } from "cheerio";
import { build, transform } from "esbuild";

// Measured from a production-mode Vite build on 2026-10-13 (not dev CSS):
// index-wY4As31u.css, summed once per index.html stylesheet, gzipSync defaults.
export const INITIAL_CSS_BASELINE = { raw: 727_367, gzip: 80_568 };
// ~10% headroom for ordinary changes; growth beyond this needs explicit review.
export const INITIAL_CSS_LIMIT = { raw: 800_000, gzip: 89_000 };

// Exact URLs, not an origin allowlist: changing font families/weights or query
// parameters also needs review. Never populate this list from build output.
// Reviewed existing shared UI fonts in client/index.html (DM Sans, JetBrains Mono).
export const REVIEWED_EXTERNAL_STYLESHEETS: readonly string[] = [
  "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..900;1,9..40,400..900&family=JetBrains+Mono:ital,wght@0,400..700;1,400..700&display=swap",
];

function externalStylesheet(ref: string): string | undefined {
  if (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref)) return;
  // The public site uses HTTPS. Keep HTTP distinct; fragments do not affect
  // the requested resource, but preserve queries (including their order).
  return new URL(ref.startsWith("//") ? `https:${ref}` : ref).href.split("#", 1)[0];
}

export async function inspectInitialStylesheets(publicDir: string) {
  const root = resolve(publicDir);
  const $ = load(await readFile(join(root, "index.html"), "utf8"));
  const files = new Set<string>();
  const external = new Map<string, Set<string>>();
  const record = (ref: string, source: string, baseDir: string) => {
    const url = externalStylesheet(ref);
    if (url) {
      const sources = external.get(url) ?? new Set<string>();
      sources.add(source);
      external.set(url, sources);
      return;
    }
    if (!ref) return;
    const pathname = decodeURIComponent(ref.split(/[?#]/, 1)[0]);
    const path = resolve(ref.startsWith("/") ? root : baseDir, pathname.replace(/^\/+/, ""));
    const rel = relative(root, path);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
      throw new Error(`Initial CSS asset escapes build output: ${ref}`);
    }
    files.add(path);
  };
  // Do not scan route-only CSS, prefetches, scripts, or font/image URLs.
  $("link[href]").each((_, element) => {
    const rel = ($(element).attr("rel") ?? "").toLowerCase().split(/\s+/);
    const as = ($(element).attr("as") ?? "").toLowerCase();
    if (rel.includes("stylesheet") || (rel.includes("preload") && as === "style")) {
      record($(element).attr("href")!.trim(), "index.html", root);
    }
  });
  // esbuild parses real import rules (including CSS escapes), not comments or
  // string content. Mark EVERY import external so parsing never resolves or
  // fetches anything; read only validated local paths ourselves.
  const inspectImports = async (contents: string, source: string, baseDir: string) => {
    const { metafile } = await build({
      stdin: { contents, loader: "css" },
      bundle: true, external: ["*"], write: false, metafile: true, logLevel: "silent",
    });
    for (const input of Object.values(metafile!.inputs)) {
      for (const dependency of input.imports) {
        if (dependency.kind === "import-rule") {
          record(dependency.path, source, baseDir);
        }
      }
    }
  };
  // Inline CSS can trigger the same external downloads as a linked stylesheet.
  for (const element of $("style").toArray()) {
    const type = ($(element).attr("type") ?? "").trim().toLowerCase();
    if (!type || type === "text/css") {
      await inspectImports($(element).text(), "index.html", root);
    }
  }
  // Follow local @imports too, with Set iteration handling cycles and dedupe.
  for (const path of files) {
    await inspectImports(await readFile(path, "utf8"), relative(root, path), dirname(path));
  }
  return { files, external };
}

export async function checkInitialCssBudget(
  publicDir: string,
  limit = INITIAL_CSS_LIMIT,
  reviewed: readonly string[] = REVIEWED_EXTERNAL_STYLESHEETS,
): Promise<{ raw: number; gzip: number }> {
  const root = resolve(publicDir);
  const { files, external } = await inspectInitialStylesheets(root);
  const approved = new Set(reviewed.map((url) => externalStylesheet(url)));
  const unreviewed = [...external.keys()].filter((url) => !approved.has(url)).sort();
  console.log(
    `External initial stylesheet dependencies (${external.size} unique; static/offline inspection):\n` +
    [...external].sort(([a], [b]) => a.localeCompare(b))
      .map(([url, sources]) => `  ${url} [${[...sources].sort().join(", ")}]`).join("\n") +
    "\nExternal stylesheet/font downloads and transitive remote imports are NOT included in the local CSS byte budget; " +
    "this is not a total network download measurement.",
  );
  if (unreviewed.length) {
    throw new Error(
      `Unreviewed external initial stylesheet dependencies:\n${unreviewed.join("\n")}\n` +
      "Review the provider, exact URL (including query parameters), and download impact. " +
      "If necessary, intentionally update REVIEWED_EXTERNAL_STYLESHEETS in script/check-built-css.ts; " +
      "do not auto-approve dependencies or increase the local CSS budget to bypass review. No network requests were made.",
    );
  }
  if (!files.size) throw new Error("No local initial CSS assets referenced by index.html");

  let raw = 0;
  let gzip = 0;
  for (const path of files) {
    const contents = await readFile(path); // Missing referenced assets must fail.
    raw += contents.byteLength;
    // Sum compressed responses individually, not one combined CSS stream.
    gzip += gzipSync(contents).byteLength;
  }
  const format = (bytes: number) => `${(bytes / 1_000).toFixed(2)} kB (${bytes} B)`;
  const comparison = (value: number, baseline: number) =>
    `${format(value)} (baseline ${format(baseline)}, change ${((value / baseline - 1) * 100).toFixed(1)}%)`;
  console.log(
    `Initial CSS from index.html (${files.size} local assets, including local @imports): ` +
    `raw ${comparison(raw, INITIAL_CSS_BASELINE.raw)}, ` +
    `gzip ${comparison(gzip, INITIAL_CSS_BASELINE.gzip)}`,
  );
  if (raw > limit.raw || gzip > limit.gzip) {
    throw new Error(
      `Initial CSS budget exceeded: raw ${comparison(raw, INITIAL_CSS_BASELINE.raw)} (limit ${format(limit.raw)}), ` +
      `gzip ${comparison(gzip, INITIAL_CSS_BASELINE.gzip)} (limit ${format(limit.gzip)}). ` +
      `Counted assets: ${[...files].map((path) => relative(root, path)).join(", ")}. ` +
      "Check global CSS imports in client/src/main.tsx and client/src/index.css, " +
      "Tailwind source scanning and generated utilities; move route-only styles to lazy-loaded pages. " +
      "If growth is necessary, review and intentionally update INITIAL_CSS_BASELINE and INITIAL_CSS_LIMIT " +
      "in script/check-built-css.ts using a new production-mode measurement; do not raise limits automatically.",
    );
  }
  return { raw, gzip };
}

// Vite reports these through its normal logger, without rejecting the build.
export function isCssBuildWarning(message: string): boolean {
  return /\[(?:esbuild css minify|lightningcss minify|vite:css\]\[(?:postcss|lightningcss))\]/.test(
    message,
  );
}

export async function checkBuiltCss(publicDir: string): Promise<void> {
  const cssFiles: string[] = [];
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".css")) cssFiles.push(path);
    }
  }
  await visit(publicDir);
  if (!cssFiles.length) throw new Error(`No production CSS found in ${publicDir}`);

  for (const path of cssFiles) {
    const css = await readFile(path, "utf8");
    // Tailwind can mistake TSX regex fragments for arbitrary properties, e.g.
    // .\[-\:\|\]{-: |}. This survives Vite's minifier as an invalid declaration.
    if (/(?:^|[;{])\s*-:/.test(css)) {
      throw new Error(`Invalid generated CSS declaration "-:" in ${path}`);
    }
    // Check the emitted CSS as well as Vite's warnings: not every plugin
    // forwards diagnostics to Vite, and minification does not always fail.
    const { warnings } = await transform(css, { loader: "css", logLevel: "silent" });
    if (warnings.length) {
      throw new Error(
        `CSS syntax warning in ${path}: ${warnings.map((warning) => warning.text).join("; ")}`,
      );
    }
  }
}