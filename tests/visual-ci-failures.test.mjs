import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const runner = join(project, "scripts/run-visual-ci.mjs");
const baselines = join(project, "tests/visual/baselines");
const workflow = readFileSync(join(project, ".github/workflows/visual.yml"), "utf8");
const stale = "STALE-REPORT-FROM-PREVIOUS-RUN";

// A strict allowlist: no customer database, provider keys or application sessions
// can enter the build/check processes, including nested npm commands.
const cleanEnv = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LD_LIBRARY_PATH", "NIX_LD", "NIX_LD_LIBRARY_PATH"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
);
async function fingerprints(dir) {
  const files = (await readdir(dir)).sort();
  return Promise.all(files.map(async (name) => [
    name, createHash("sha256").update(await readFile(join(dir, name))).digest("hex"),
  ]));
}

function run(cwd, env) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [runner], {
      cwd, env, stdio: ["ignore", "pipe", "pipe"], timeout: 90_000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", reject);
    child.once("close", (code, signal) => done({ code, signal, stdout, stderr }));
  });
}

async function assertServerStopped(result, shouldStart) {
  const url = result.stdout.match(/Frontend aplikasi siap: (http:\/\/127\.0\.0\.1:\d+)/);
  if (!shouldStart) {
    assert.equal(url, null, result.stdout);
    return;
  }
  assert.ok(url, result.stdout + result.stderr);
  // A normally exited owned runner plus a refused connection proves its server
  // was closed, rather than relying only on the presence of a finally clause.
  await assert.rejects(fetch(url[1], { signal: AbortSignal.timeout(2_000) }), (error) => {
    assert.equal(error.cause?.code, "ECONNREFUSED");
    return true;
  });
}

async function extractedArtifact(cwd, label) {
  // Model upload-artifact v4's least-common-ancestor layout from the actual
  // Actions path list. Archive/extract it elsewhere, with no source fallback.
  const upload = workflow.match(/name: visual-comparison-[^\n]+\n[\s\S]*?path: \|\n((?: {12}[^\n]+\n)+)/);
  assert.ok(upload, "Visual comparison upload path list is required");
  const paths = upload[1].trim().split("\n").map((line) => line.trim().replace(/\/$/, ""));
  assert.deepEqual(paths, ["tests/visual/results", "tests/visual/baselines"]);
  const common = "tests/visual";
  const staging = join(cwd, `staging-${label}`);
  const extracted = join(cwd, `extracted-${label}`);
  await mkdir(staging);
  await mkdir(extracted);
  for (const path of paths) await cp(join(cwd, path), join(staging, relative(common, path)), { recursive: true });
  const archive = join(cwd, `${label}.tar`);
  for (const args of [
    ["-cf", archive, "-C", staging, "."],
    ["-xf", archive, "-C", extracted],
  ]) {
    const result = spawnSync("tar", args, { env: cleanEnv, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  await rm(staging, { recursive: true });
  const reportPath = join(extracted, "results/report.html");
  const report = await readFile(reportPath, "utf8");
  const links = [...report.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]);
  for (const link of links) {
    const path = resolve(dirname(reportPath), link);
    assert.ok(path.startsWith(extracted + sep), `Link escapes artifact: ${link}`);
    const bytes = await readFile(path);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", link);
    assert.equal(bytes.subarray(-12).toString("hex"), "0000000049454e44ae426082", link);
  }
  return { report, links };
}

test("pre-release failures leave fresh, portable evidence and stop their isolated frontend", { timeout: 240_000 }, async (t) => {
  const originalHashes = await fingerprints(baselines);
  const artifacts = join(project, "generated-artifacts");
  await mkdir(artifacts, { recursive: true });
  const evidence = await mkdtemp(join(artifacts, "visual-ci-failures-"));
  console.log(`Bukti kegagalan runner: ${evidence}`);
  const browser = process.env.CHROME_PATH || (
    existsSync(join(project, "generated-artifacts/visual-env/chrome-linux64/chrome"))
      ? join(project, "generated-artifacts/visual-env/chrome-linux64/chrome")
      : spawnSync("which", ["chromium"], { env: cleanEnv, encoding: "utf8" }).stdout.trim()
  );
  assert.ok(browser && existsSync(browser), "Jalankan visual:setup atau tentukan CHROME_PATH.");
  t.after(async () => assert.deepEqual(await fingerprints(baselines), originalHashes));

  for (const scenario of ["build", "browser", "heading", "comparison"]) {
    await t.test(scenario, async (scenarioTest) => {
      const cwd = join(evidence, scenario);
      const toolRoot = join(cwd, "generated-artifacts/visual-env");
      const resultDir = join(cwd, "tests/visual/results");
      await mkdir(join(toolRoot, "chrome-linux64"), { recursive: true });
      await mkdir(resultDir, { recursive: true });
      await cp(baselines, join(cwd, "tests/visual/baselines"), { recursive: true });
      const before = await fingerprints(join(cwd, "tests/visual/baselines"));
      await symlink(join(project, "node_modules"), join(cwd, "node_modules"), "dir");
      // Never upload dependency trees or linked browser binaries with evidence.
      scenarioTest.after(async () => {
        await rm(join(cwd, "node_modules"), { force: true });
        await rm(join(toolRoot, "chrome-linux64/chrome"), { force: true });
      });
      await writeFile(join(cwd, "package.json"), JSON.stringify({
        type: "module",
        scripts: { "visual:check": `node "${join(project, "scripts/check-visual.mjs")}"` },
      }));
      await cp(join(project, "tests/visual/fixtures/ci.html"), join(cwd, "index.html"));
      await writeFile(join(cwd, "vite.config.mjs"), scenario === "build"
        ? 'throw new Error("ISOLATED_BUILD_FAILURE_<marker>");'
        : "export default { logLevel: 'error' };");
      // Tests are about runner failures, not application typography. Keep this
      // fixture's fontconfig independent of host fonts and customer resources.
      await writeFile(join(toolRoot, "fonts.conf"), `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><cachedir>${join(cwd, "font-cache")}</cachedir></fontconfig>`);
      const executable = join(toolRoot, "chrome-linux64/chrome");
      if (scenario === "browser") {
        await writeFile(executable, "#!/bin/sh\necho 'ISOLATED_BROWSER_LAUNCH_FAILURE_<marker>' >&2\nexit 23\n", { mode: 0o755 });
      } else {
        await symlink(browser, executable);
      }
      await writeFile(join(resultDir, "report.html"), stale);
      await writeFile(join(resultDir, "stale.png"), stale);
      const result = await run(cwd, {
        ...cleanEnv, CI: "true",
        VITE_FIXTURE_MISSING_HEADING: String(scenario === "heading"),
      });
      await writeFile(join(cwd, "runner.log"), result.stdout + result.stderr);
      assert.equal(result.signal, null, result.stdout + result.stderr);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      const report = await readFile(join(resultDir, "report.html"), "utf8");
      assert.ok(!report.includes(stale));
      assert.equal(existsSync(join(resultDir, "stale.png")), false);
      const expected = {
        build: /Build frontend gagal/,
        browser: /ISOLATED_BROWSER_LAUNCH_FAILURE_&lt;marker&gt;/,
        heading: /kontraktor: heading atau anchor h1 tidak tersedia/,
        comparison: /BERUBAH/,
      }[scenario];
      assert.match(report, expected);
      if (scenario === "browser") assert.doesNotMatch(report, /FAILURE_<marker>/);
      if (scenario === "heading" || scenario === "comparison") {
        assert.match(result.stdout, /Browser visual: Chrome\/138\.0\.7204\.100/);
        assert.match(result.stdout, /Tertangkap: beranda-desktop\.png/);
      }
      await assertServerStopped(result, scenario !== "build");
      assert.deepEqual(await fingerprints(join(cwd, "tests/visual/baselines")), before);
      const packaged = await extractedArtifact(cwd, scenario);
      assert.equal(packaged.report, report);
      assert.equal(packaged.links.length, scenario === "comparison" ? 24 : scenario === "heading" ? 2 : 0);
      if (scenario === "comparison") {
        assert.equal((report.match(/ — BERUBAH/g) || []).length, 8);
        assert.equal((packaged.links.filter((link) => link.endsWith("-diff.png"))).length, 8);
      }
    });
  }
});
