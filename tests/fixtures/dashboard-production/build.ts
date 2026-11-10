import { build } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("generated-artifacts/dashboard-production");
await mkdir(output, { recursive: true });
await build({
  // Use the application's production plugins, aliases, CSS, and build target.
  configFile: resolve("vite.config.ts"),
  root: resolve("tests/fixtures/dashboard-production"),
  publicDir: false,
  build: { outDir: resolve(output, "public"), emptyOutDir: true },
  plugins: [{
    name: "dashboard-production-module-evidence",
    async generateBundle(_options, bundle) {
      const chunks: Record<string, string> = {};
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of Object.keys(chunk.modules)) {
          const match = id.match(/\/components\/(?:panels|dialogs)\/([^/]+)\.tsx$/);
          if (match) chunks[match[1]] = chunk.fileName;
        }
      }
      await writeFile(resolve(output, "chunks.json"), JSON.stringify(chunks, null, 2));
    },
  }],
});
