import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { load } from "cheerio";

// Baseline (2026-09-29): 5,662,357 B raw / 1,146,821 B gzip.
// Allow ~9% growth for normal changes, but require deliberate review for larger jumps.
export const INITIAL_JS_LIMIT = { raw: 6_200_000, gzip: 1_250_000 };

export async function checkInitialJsBudget(
  publicDir: string,
  limit = INITIAL_JS_LIMIT,
): Promise<{ raw: number; gzip: number }> {
  const html = await readFile(resolve(publicDir, "index.html"), "utf8");
  const $ = load(html);
  const refs = new Set<string>();

  // Only assets fetched by the initial HTML. Dynamic imports (including Vite's
  // __vite__mapDeps entries for navigation) are intentionally not counted.
  $("script[src], link[rel~='modulepreload'][href]").each((_, element) => {
    const ref = element.tagName === "script" ? $(element).attr("src") : $(element).attr("href");
    if (ref) refs.add(ref);
  });

  const files = new Set<string>();
  for (const ref of refs) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref)) continue; // external URL
    const pathname = ref.split(/[?#]/, 1)[0];
    if (!pathname.endsWith(".js")) continue;
    const path = resolve(publicDir, pathname.replace(/^\/+/, ""));
    const rel = relative(resolve(publicDir), path);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Initial JS asset escapes build output: ${ref}`);
    }
    files.add(path);
  }
  if (!files.size) throw new Error("No local initial JS assets referenced by index.html");

  let raw = 0;
  let gzip = 0;
  for (const path of files) {
    const contents = await readFile(path); // missing assets must fail the build
    raw += contents.byteLength;
    gzip += gzipSync(contents).byteLength;
  }
  const format = (bytes: number) => `${(bytes / 1_000_000).toFixed(2)} MB (${bytes} B)`;
  console.log(`Initial JS from index.html (${files.size} assets): raw ${format(raw)}, gzip ${format(gzip)}`);
  if (raw > limit.raw || gzip > limit.gzip) {
    throw new Error(
      `Initial JS budget exceeded: raw ${format(raw)} (limit ${format(limit.raw)}), ` +
      `gzip ${format(gzip)} (limit ${format(limit.gzip)}). ` +
      "Check new eager imports in client/src/App.tsx and the entry path; " +
      "lazy-load route-only code, or review and intentionally update INITIAL_JS_LIMIT " +
      "in script/check-initial-js-budget.ts with a new measured baseline.",
    );
  }
  return { raw, gzip };
}