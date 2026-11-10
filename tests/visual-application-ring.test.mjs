import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import puppeteer from "puppeteer-core";

const project = fileURLToPath(new URL("../", import.meta.url));
const baselines = join(project, "tests/visual/baselines");
const selector = ".ring-2.ring-violet-400";
const cleanEnv = Object.fromEntries([
  "PATH", "HOME", "TMPDIR", "LD_LIBRARY_PATH", "NIX_LD", "NIX_LD_LIBRARY_PATH",
  "CHROME_PATH", "FONTCONFIG_FILE",
].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const env = {
  ...cleanEnv, NODE_ENV: "production", CI: "true", TZ: "UTC", LANG: "en_US.UTF-8",
  FONTCONFIG_FILE: process.env.FONTCONFIG_FILE || join(project, "generated-artifacts/visual-env/fonts.conf"),
  VISUAL_EXPECTED_CHROME: "138.0.7204.100",
};

function run(command, args, cwd, extraEnv = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], timeout: 180_000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.once("error", reject);
    child.once("close", (code, signal) => done({ code, signal, stdout, stderr }));
  });
}

async function fingerprints(dir) {
  return Promise.all((await readdir(dir)).sort().map(async name => [
    name, createHash("sha256").update(await readFile(join(dir, name))).digest("hex"),
  ]));
}

test("real application rejects only an outer Paket Bisnis ring color change on both viewports", { timeout: 480_000 }, async t => {
  const before = await fingerprints(baselines);
  t.after(async () => assert.deepEqual(await fingerprints(baselines), before, "Referensi aplikasi tidak boleh berubah"));
  await mkdir(join(project, "generated-artifacts"), { recursive: true });
  // Matches the CI upload glob; all evidence is retained, never application source.
  const cwd = await mkdtemp(join(project, "generated-artifacts/visual-negative-application-"));
  const visualRoot = join(cwd, "tests/visual");
  const buildDir = join(cwd, "frontend");
  console.log(`Bukti ring aplikasi asli: ${cwd}`);
  await cp(baselines, join(visualRoot, "baselines"), { recursive: true });
  await writeFile(join(cwd, "package.json"), JSON.stringify({
    scripts: { "visual:check": `node "${join(project, "scripts/check-visual.mjs")}"` },
  }));
  // Build actual App/routes/pricing/Tailwind, not an HTML imitation; no backend
  // imports, database, provider credentials, startup seeds or customer sessions.
  const build = await run("npm", ["exec", "--", "vite", "build", "--outDir", buildDir], project);
  await writeFile(join(cwd, "build.log"), build.stdout + build.stderr);
  assert.equal(build.signal, null, build.stderr);
  assert.equal(build.code, 0, build.stderr);
  const html = await readFile(join(buildDir, "index.html"), "utf8");
  let mutated = false;
  const app = express();
  app.use("/api", (_req, res) => res.status(401).json({ message: "Anonymous visual capture" }));
  app.get("/pricing", (_req, res) => res.type("html").send(html.replace("</head>",
    `${mutated ? `<style>${selector} { --tw-ring-color: #22c55e !important; }</style>` : ""}</head>`)));
  app.use(express.static(buildDir));
  app.get("/{*path}", (_req, res) => res.type("html").send(html));
  const server = await new Promise((done, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => done(listening));
    listening.once("error", reject);
  });
  t.after(async () => new Promise(done => { server.close(done); server.closeAllConnections(); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function compare(label, expectedCode) {
    // Exercise the actual npm command and checker. Never invoke --update.
    const result = await run("npm", ["run", "visual:check"], cwd, { VISUAL_BASE_URL: baseUrl });
    await writeFile(join(cwd, `${label}.log`), result.stdout + result.stderr);
    const results = join(visualRoot, "results");
    await rename(results, join(visualRoot, `results-${label}`));
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.stderr, "", "Harus gagal karena diff, bukan error browser/heading");
    assert.equal(result.code, expectedCode, result.stdout + result.stderr);
    for (const name of ["beranda", "kontraktor", "prose", "ring"]) {
      for (const view of ["desktop", "mobile"]) {
        const changed = expectedCode === 1 && name === "ring";
        assert.match(result.stdout, new RegExp(`${changed ? "BERUBAH" : "LULUS"} ${name}-${view}\\.png:`));
      }
    }
    return join(visualRoot, `results-${label}`);
  }

  const normal = await compare("normal", 0);
  for (const view of ["desktop", "mobile"]) {
    const name = `ring-${view}.png`;
    assert.deepEqual(await readFile(join(normal, name)), await readFile(join(visualRoot, "baselines", name)),
      "Kontrol ring normal harus sama persis dengan referensi yang ditinjau");
  }
  mutated = true;
  const changed = await compare("outer-ring", 1);

  // Inspect actual PNG pixels, not just exit status. The comparison must see a
  // magenta outer strip, and the content interior must be byte-for-byte unchanged.
  const browser = await puppeteer.launch({
    executablePath: env.CHROME_PATH || execFileSync("which", ["chromium"], { encoding: "utf8", env }).trim(),
    headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const evidence = [];
  for (const view of ["desktop", "mobile"]) {
    const name = `ring-${view}.png`;
    const bytes = await Promise.all([
      readFile(join(normal, name)), readFile(join(changed, name)),
      readFile(join(changed, name.replace(".png", "-diff.png"))),
    ]);
    const stats = await page.evaluate(async urls => {
      const images = await Promise.all(urls.map(async src => {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
        return { width: image.width, height: image.height, pixels: ctx.getImageData(0, 0, image.width, image.height).data };
      }));
      const [normal, actual, diff] = images;
      let interiorChanges = 0, outerChanges = 0, outerMagenta = 0;
      const padding = 4;
      for (let y = 0; y < normal.height; y++) {
        for (let x = 0; x < normal.width; x++) {
          const i = (y * normal.width + x) * 4;
          const outside = x < padding || y < padding || x >= normal.width - padding || y >= normal.height - padding;
          let different = false;
          for (let j = 0; j < 4; j++) if (normal.pixels[i + j] !== actual.pixels[i + j]) different = true;
          // Rounded outer-ring corners extend inside the rectangular bounding
          // box. Exclude only the 16px corner radius from the content assertion.
          const content = x >= padding + 16 && y >= padding + 16 &&
            x < normal.width - padding - 16 && y < normal.height - padding - 16;
          if (different && outside) outerChanges++;
          if (different && content) interiorChanges++;
          if (outside && diff.pixels[i] === 255 && diff.pixels[i + 1] === 0 && diff.pixels[i + 2] === 180) outerMagenta++;
        }
      }
      return {
        sizes: images.map(({ width, height }) => [width, height]),
        interiorChanges, outerChanges, outerMagenta,
      };
    }, bytes.map(bytes => `data:image/png;base64,${bytes.toString("base64")}`));
    evidence.push({ view, ...stats });
    assert.deepEqual(stats.sizes[0], stats.sizes[1], "Mutasi warna tidak boleh mengubah ukuran kartu");
    assert.deepEqual(stats.sizes[0], stats.sizes[2], "Diff bukan kegagalan perubahan dimensi");
    assert.equal(stats.interiorChanges, 0, "Hanya warna ring luar yang boleh berubah");
    assert.ok(stats.outerChanges > 1000, "Ring harus tercakup di luar bounding box");
    assert.ok(stats.outerMagenta > 1000, "Diff wajib menampilkan ring luar magenta");
    const report = await readFile(join(changed, "report.html"), "utf8");
    assert.match(report, new RegExp(`${name} — BERUBAH \\(([\\d.]+)%\\)`));
    for (const link of [`../baselines/${name}`, name, name.replace(".png", "-diff.png")]) {
      assert.ok(report.includes(`src="${link}"`));
      await readFile(resolve(changed, link));
    }
  }
  await writeFile(join(cwd, "outer-ring-pixels.json"), JSON.stringify(evidence, null, 2));
  assert.deepEqual(await fingerprints(join(visualRoot, "baselines")), before);
});
