import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const privateFiles = [
  "sbu-skk-tanpa-bingung-v2.2.0.pdf",
  "sbu-skk-lampiran-toolkit-v1.1.0.pdf",
  "mini-ebook-sbu-skk-v1.1.0.pdf",
  "KEP_DIRJEN_BK_281_STANDAR_SKEMA_SERTIFIKASI_26_AGUSTUS_2026_SU_1788273103134.pdf",
];

function copyBuildScripts(sandbox: string) {
  for (const name of ["build.ts", "check-built-css.ts", "check-initial-js-budget.ts", "check-payment-config.ts"]) {
    writeFileSync(join(sandbox, "script", name), readFileSync(join(root, "script", name)));
  }
  mkdirSync(join(sandbox, "shared"), { recursive: true });
  writeFileSync(join(sandbox, "shared/payment-base-url.ts"), readFileSync(join(root, "shared/payment-base-url.ts")));
  // The real initial-JS check requires an entry referenced by the client HTML.
  writeFileSync(join(sandbox, "client/main.js"), 'console.log("fixture client");');
}

function releaseSnapshot(directory: string): Map<string, Buffer | null> {
  const snapshot = new Map<string, Buffer | null>();
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(relative, entry.name);
      if (entry.isDirectory()) {
        snapshot.set(name, null);
        visit(name);
      } else {
        assert.ok(entry.isFile(), `unexpected release entry: ${name}`);
        snapshot.set(name, readFileSync(join(directory, name)));
      }
    }
  };
  visit("");
  return snapshot;
}

test("bundling yang gagal tidak mengubah rilis sebelumnya; build sukses menggantinya", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "build-bundling-rollback-"));
  try {
    symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
    for (const dir of ["script", "client", "server", "attached_assets", "dist/public", "dist/private-assets"]) {
      mkdirSync(join(sandbox, dir), { recursive: true });
    }
    copyBuildScripts(sandbox);
    writeFileSync(join(sandbox, "package.json"), JSON.stringify({ name: "build-rollback-fixture", type: "module" }));
    writeFileSync(join(sandbox, "client/index.html"),
      '<html><head><link rel="stylesheet" href="/style.css"></head><body>new release<script type="module" src="/main.js"></script></body></html>');
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");
    for (const name of privateFiles) writeFileSync(join(sandbox, "attached_assets", name), `new ${name}`);

    const oldFiles = new Map([
      ["index.cjs", "old server"],
      ["public/index.html", "old client"],
      ["private-assets/previous.pdf", "old private asset"],
    ]);
    for (const [name, contents] of oldFiles) writeFileSync(join(sandbox, "dist", name), contents);
    const assertOldRelease = () => {
      for (const [name, contents] of oldFiles) {
        assert.equal(readFileSync(join(sandbox, "dist", name), "utf8"), contents, `${name} must stay intact`);
      }
      assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), [],
        "temporary builds must be cleaned on failure");
    };
    const runBuild = (args: string[] = []) => {
      const result = spawnSync(join(root, "node_modules/.bin/tsx"), ["script/build.ts", ...args], {
        cwd: sandbox, encoding: "utf8", timeout: 60_000,
      });
      assert.ifError(result.error);
      return result;
    };

    writeFileSync(join(sandbox, "vite.config.mjs"),
      'export default { root: "client", build: { outDir: "../dist/public" }, plugins: [{ name: "fail", buildStart() { throw new Error("simulated Vite failure"); } }] };');
    // A killed build leaves staging behind because its finally block cannot run.
    mkdirSync(join(sandbox, ".dist-build-abandoned/public"), { recursive: true });
    writeFileSync(join(sandbox, ".dist-build-abandoned/public/partial.js"), "partial bundle");
    const viteFailure = runBuild();
    assert.notEqual(viteFailure.status, 0);
    assert.match(viteFailure.stdout + viteFailure.stderr, /simulated Vite failure/);
    assert.match(viteFailure.stdout + viteFailure.stderr, /Removed abandoned build staging/);
    assertOldRelease();

    writeFileSync(join(sandbox, "vite.config.mjs"),
      'export default { root: "client", build: { outDir: "../dist/public" } };');
    writeFileSync(join(sandbox, "client/style.css"), String.raw`.\[-\:\|\]{-: |}`);
    const cssFailure = runBuild();
    assert.notEqual(cssFailure.status, 0);
    assert.match(cssFailure.stdout + cssFailure.stderr, /CSS (build warning|syntax warning)|Invalid generated CSS declaration/);
    assertOldRelease();

    // Vite-emitted, valid but oversized CSS must also block release promotion.
    writeFileSync(join(sandbox, "vite.config.mjs"),
      `export default { root: "client", build: { outDir: "../dist/public" },
        plugins: [{ name: "oversized-initial-css", generateBundle() {
          this.emitFile({ type: "asset", fileName: "oversized.css",
            source: ".oversized{color:red}".repeat(45_000) });
        }, transformIndexHtml(html) {
          return html.replace("</head>", '<link rel="stylesheet" href="/oversized.css"></head>');
        } }] };`);
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");
    const cssBudgetFailure = runBuild();
    assert.notEqual(cssBudgetFailure.status, 0);
    assert.match(cssBudgetFailure.stdout + cssBudgetFailure.stderr, /Initial CSS budget exceeded:.*oversized\.css/);
    assertOldRelease();
    writeFileSync(join(sandbox, "vite.config.mjs"),
      'export default { root: "client", build: { outDir: "../dist/public" } };');
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");

    // HTML links, inline CSS and imports surviving production CSS must be reviewed
    // before promotion, even though their bytes do not affect the local cap.
    const initialHtml = readFileSync(join(sandbox, "client/index.html"), "utf8");
    for (const source of ["html", "inline", "css"]) {
      writeFileSync(join(sandbox, "client/index.html"), source === "html"
        ? initialHtml.replace("</head>",
          '<link rel="stylesheet" href="https://unreviewed.example/style.css"></head>')
        : source === "inline"
          ? initialHtml.replace("</head>",
            '<style>@import url("https://unreviewed.example/style.css");</style></head>')
          : initialHtml);
      writeFileSync(join(sandbox, "client/style.css"), source === "css"
        ? '@import url("https://unreviewed.example/style.css"); .fixture{color:red}'
        : ".fixture{color:red}");
      const externalFailure = runBuild();
      assert.notEqual(externalFailure.status, 0);
      assert.match(externalFailure.stdout + externalFailure.stderr,
        /Unreviewed external initial stylesheet dependencies:[\s\S]*https:\/\/unreviewed.example\/style.css[\s\S]*REVIEWED_EXTERNAL_STYLESHEETS/);
      assertOldRelease();
    }
    writeFileSync(join(sandbox, "client/index.html"), initialHtml);
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");

    writeFileSync(join(sandbox, "server/index.ts"), "export const broken = ;");
    const serverFailure = runBuild();
    assert.notEqual(serverFailure.status, 0);
    assert.match(serverFailure.stdout + serverFailure.stderr, /ERROR|error/i);
    assertOldRelease();

    // Simulate SIGKILL between renaming the old dist and publishing staging.
    // The next build must restore the old release before it starts, even if
    // that next build itself fails.
    renameSync(join(sandbox, "dist"), join(sandbox, ".dist-previous"));
    assert.equal(existsSync(join(sandbox, "dist")), false);
    const earlyRecovery = runBuild(["--recover-only"]);
    assert.equal(earlyRecovery.status, 0, earlyRecovery.stdout + earlyRecovery.stderr);
    assertOldRelease();
    mkdirSync(join(sandbox, ".dist-build-stale-previous"));
    writeFileSync(join(sandbox, ".dist-build-stale-previous/index.cjs"), "older release");
    renameSync(join(sandbox, "dist"), join(sandbox, ".dist-previous"));
    const interrupted = runBuild();
    assert.notEqual(interrupted.status, 0);
    assert.match(interrupted.stdout + interrupted.stderr, /Recovered interrupted release/);
    assertOldRelease();
    assert.equal(existsSync(join(sandbox, ".dist-previous")), false);
    assert.equal(existsSync(join(sandbox, ".dist-build-stale-previous")), false);

    // Recover backups left by the old random-name promotion scheme too.
    renameSync(join(sandbox, "dist"), join(sandbox, ".dist-build-abandoned-previous"));
    const legacyInterrupted = runBuild();
    assert.notEqual(legacyInterrupted.status, 0);
    assert.match(legacyInterrupted.stdout + legacyInterrupted.stderr, /Recovered interrupted release/);
    assertOldRelease();

    // If the new dist was already published, a stale backup must not replace it.
    mkdirSync(join(sandbox, ".dist-previous"));
    writeFileSync(join(sandbox, ".dist-previous/index.cjs"), "stale server");
    const alreadyPublished = runBuild();
    assert.notEqual(alreadyPublished.status, 0);
    assertOldRelease();
    assert.equal(existsSync(join(sandbox, ".dist-previous")), false);

    writeFileSync(join(sandbox, "server/index.ts"), 'console.log("new server");');
    const success = runBuild();
    assert.equal(success.status, 0, success.stdout + success.stderr);
    assert.equal(existsSync(join(sandbox, "dist/private-assets/previous.pdf")), false);
    assert.match(readFileSync(join(sandbox, "dist/index.cjs"), "utf8"), /new server/);
    assert.match(readFileSync(join(sandbox, "dist/public/index.html"), "utf8"), /new release/);
    assert.equal(readFileSync(join(sandbox, "dist/private-assets", privateFiles[0]), "utf8"),
      `new ${privateFiles[0]}`);
    assert.ok(existsSync(join(sandbox, "dist/pdf.worker.mjs")));
    assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), []);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("copyFile yang gagal di tengah penyalinan membersihkan staging, melepas pengunci, dan mempertahankan seluruh dist", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "build-asset-copy-failure-"));
  try {
    symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
    for (const dir of ["script", "client", "server", "attached_assets",
      "dist/public/assets/nested", "dist/private-assets", "dist/empty-directory"]) {
      mkdirSync(join(sandbox, dir), { recursive: true });
    }
    copyBuildScripts(sandbox);
    const source = readFileSync(join(sandbox, "script/build.ts"), "utf8");
    const assetCopyPoint = `    join(privateAssets, "sbu-skk-tanpa-bingung-v2.2.0.pdf"),
  );`;
    assert.equal(source.split(assetCopyPoint).length, 2,
      "failure injection must follow the first real private asset copy");
    // Instrument only the sandbox: record real partial output, then remove the
    // next required source. The unmodified second copyFile must fail normally;
    // do not mock the copy or throw a synthetic error.
    writeFileSync(join(sandbox, "script/build.ts"), source.replace(assetCopyPoint, `${assetCopyPoint}
  const evidence = {
    staging,
    firstAsset: await readFile(join(privateAssets, ${JSON.stringify(privateFiles[0])}), "utf8"),
    clientHtml: await readFile(join(staging, "public/index.html"), "utf8"),
    privateAssets: await readdir(privateAssets),
    serverExists: await exists(join(staging, "index.cjs")),
  };
  const marker = await open("asset-copy-evidence.json", "w");
  try { await marker.writeFile(JSON.stringify(evidence)); }
  finally { await marker.close(); }
  await rm(${JSON.stringify(join("attached_assets", privateFiles[1]))});`));
    writeFileSync(join(sandbox, "package.json"), JSON.stringify({ name: "asset-copy-failure-fixture", type: "module" }));
    writeFileSync(join(sandbox, "vite.config.mjs"),
      'export default { root: "client", build: { outDir: "../dist/public" } };');
    writeFileSync(join(sandbox, "client/index.html"),
      '<html><head><link rel="stylesheet" href="/style.css"></head><body>new client<script type="module" src="/main.js"></script></body></html>');
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");
    writeFileSync(join(sandbox, "server/index.ts"), 'console.log("new server");');
    for (const name of privateFiles) writeFileSync(join(sandbox, "attached_assets", name), `new ${name}`);
    for (const [name, contents] of [
      ["index.cjs", "old server"],
      ["public/index.html", "old client"],
      ["public/assets/nested/old.js", "old nested asset"],
      ["private-assets/previous.pdf", "old private asset"],
      [".release-metadata", "old metadata"],
    ]) writeFileSync(join(sandbox, "dist", name), contents);
    writeFileSync(join(sandbox, "dist/pdf.worker.mjs"), Buffer.from([0, 255, 128, 13, 10]));
    const oldRelease = releaseSnapshot(join(sandbox, "dist"));
    const assertOldRelease = () => {
      assert.deepEqual(releaseSnapshot(join(sandbox, "dist")), oldRelease,
        "all release paths and bytes, including binary files and empty directories, must remain unchanged");
      assert.equal(existsSync(join(sandbox, ".dist-previous")), false, "promotion must not have started");
      assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), [],
        "the failing process must clean staging before recovery runs");
    };
    const runBuild = (args: string[] = []) => {
      const result = spawnSync(process.execPath, ["--import", "tsx", "script/build.ts", ...args], {
        cwd: sandbox, encoding: "utf8", timeout: 60_000,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null, "build must exit normally, not be killed");
      return result;
    };
    const failed = runBuild();
    const output = failed.stdout + failed.stderr;
    assert.equal(failed.status, 1, output);
    assert.match(output, /ENOENT/);
    assert.match(output, /syscall: 'copyfile'/, "the real copyFile must report the failure");
    assert.ok(output.includes(privateFiles[1]), output);
    assert.doesNotMatch(output, /building server/, "server bundling must not start after a required copy fails");
    const evidence = JSON.parse(readFileSync(join(sandbox, "asset-copy-evidence.json"), "utf8"));
    assert.equal(evidence.firstAsset, `new ${privateFiles[0]}`);
    assert.match(evidence.clientHtml, /new client/, "real Vite output must exist before the failure");
    assert.deepEqual(evidence.privateAssets, [privateFiles[0]], "only the first private asset was copied");
    assert.equal(evidence.serverExists, false);
    assert.equal(existsSync(join(sandbox, "attached_assets", privateFiles[1])), false);
    assert.equal(existsSync(evidence.staging), false, "the observed partial staging must have been removed");
    assertOldRelease();

    const recovered = runBuild(["--recover-only"]);
    assert.equal(recovered.status, 0,
      `a separate process must be able to acquire the released build lock: ${recovered.stdout}${recovered.stderr}`);
    assert.doesNotMatch(recovered.stdout + recovered.stderr, /Removed abandoned build staging/,
      "cleanup must have completed in the failed build, not in recovery");
    assertOldRelease();
    assert.ok(existsSync(join(sandbox, ".dist-build.lock")), "keep the shared lock inode for future builds");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("rename publikasi yang gagal memulihkan seluruh rilis lama, melepas pengunci, dan mengizinkan build berikutnya", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "build-promotion-rename-failure-"));
  try {
    symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
    for (const dir of ["script", "client", "server", "attached_assets",
      "dist/public/assets/nested", "dist/private-assets", "dist/empty-directory"]) {
      mkdirSync(join(sandbox, dir), { recursive: true });
    }
    copyBuildScripts(sandbox);
    const source = readFileSync(join(sandbox, "script/build.ts"), "utf8");
    const renameImport = "readdir, rename, rm, readFile";
    assert.equal(source.split(renameImport).length, 2, "instrument the fixture's rename import only");
    // Leave the production promotion/catch/finally blocks intact. Only the
    // staging -> dist operation fails; backup and rollback use real renames.
    // Temporarily move the source aside so the actual publication rename gets
    // ENOENT from the filesystem rather than throwing a fabricated error.
    writeFileSync(join(sandbox, "script/build.ts"),
      source.replace(renameImport, "readdir, rename as realRename, rm, readFile") + `
async function rename(from: string, to: string) {
  if (from.startsWith(join(process.cwd(), ".dist-build-")) && to === "dist") {
    const assets: Record<string, string> = {};
    for (const name of await readdir(join(from, "private-assets"))) {
      assets[name] = await readFile(join(from, "private-assets", name), "utf8");
    }
    const evidence = {
      pid: process.pid,
      staging: from,
      distExists: await exists("dist"),
      backupServer: await readFile(join(process.cwd(), ".dist-previous/index.cjs"), "utf8"),
      clientHtml: await readFile(join(from, "public/index.html"), "utf8"),
      server: await readFile(join(from, "index.cjs"), "utf8"),
      worker: (await readFile(join(from, "pdf.worker.mjs"))).toString("base64"),
      assets,
    };
    const marker = await open("rename-failure-evidence.json", "w");
    try { await marker.writeFile(JSON.stringify(evidence)); }
    finally { await marker.close(); }
    const heldStaging = from + "-held";
    await realRename(from, heldStaging);
    try {
      await realRename(from, to);
    } finally {
      // Put staging back before the production catch/finally blocks run, so
      // the failing build must still perform its own rollback and cleanup.
      await realRename(heldStaging, from);
    }
    return;
  }
  await realRename(from, to);
  if (from === join(process.cwd(), ".dist-previous") && to === "dist") {
    const marker = await open("rollback-pid", "w");
    try { await marker.writeFile(String(process.pid)); }
    finally { await marker.close(); }
  }
}
`);
    writeFileSync(join(sandbox, "package.json"), JSON.stringify({ name: "rename-failure-fixture", type: "module" }));
    writeFileSync(join(sandbox, "vite.config.mjs"),
      'export default { root: "client", build: { outDir: "../dist/public" } };');
    writeFileSync(join(sandbox, "client/index.html"),
      '<html><head><link rel="stylesheet" href="/style.css"></head><body>new client<script type="module" src="/main.js"></script></body></html>');
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");
    writeFileSync(join(sandbox, "server/index.ts"), 'console.log("new server");');
    for (const name of privateFiles) writeFileSync(join(sandbox, "attached_assets", name), `new ${name}`);
    for (const [name, contents] of [
      ["index.cjs", "old server"],
      ["public/index.html", "old client"],
      ["public/assets/nested/old.js", "old nested asset"],
      ["private-assets/previous.pdf", "old private asset"],
      [".release-metadata", "old metadata"],
    ]) writeFileSync(join(sandbox, "dist", name), contents);
    writeFileSync(join(sandbox, "dist/pdf.worker.mjs"), Buffer.from([0, 255, 128, 13, 10]));
    const oldRelease = releaseSnapshot(join(sandbox, "dist"));

    const failed = spawnSync(process.execPath, ["--import", "tsx", "script/build.ts"], {
      cwd: sandbox, encoding: "utf8", timeout: 60_000,
    });
    assert.ifError(failed.error);
    const output = failed.stdout + failed.stderr;
    assert.equal(failed.signal, null, "the build must handle the error, not be killed");
    assert.equal(failed.status, 1, output);
    assert.match(output, /ENOENT/);
    assert.match(output, /code: 'ENOENT'/);
    assert.match(output, /syscall: 'rename'/);
    const evidence = JSON.parse(readFileSync(join(sandbox, "rename-failure-evidence.json"), "utf8"));
    assert.ok(output.includes(`path: '${evidence.staging}'`),
      "the filesystem error must name the real staging source");
    assert.match(output, /dest: 'dist'/, "the failed rename must target dist");
    assert.equal(evidence.pid, failed.pid, "the directly owned build must encounter the failure");
    assert.equal(evidence.distExists, false, "old dist must already have moved to backup");
    assert.equal(evidence.backupServer, "old server");
    assert.match(evidence.clientHtml, /new client/, "real Vite bundling must finish before promotion");
    assert.match(evidence.server, /new server/, "real esbuild bundling must finish before promotion");
    assert.deepEqual(evidence.assets, Object.fromEntries(privateFiles.map((name) => [name, `new ${name}`])));
    assert.equal(evidence.worker,
      readFileSync(join(root, "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs")).toString("base64"));
    assert.equal(Number(readFileSync(join(sandbox, "rollback-pid"), "utf8")), failed.pid,
      "the failing process itself must perform the real rollback rename");

    // Check before launching any other build/recovery process: startup repair
    // must not mask a missing rollback or failed finally cleanup.
    assert.deepEqual(releaseSnapshot(join(sandbox, "dist")), oldRelease,
      "restore every path and byte, including nested assets, binary files, metadata and empty directories");
    assert.equal(existsSync(join(sandbox, ".dist-previous")), false, "rollback must consume the backup");
    assert.equal(existsSync(evidence.staging), false, "the failing process must remove its own staging");
    assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), []);
    assert.ok(existsSync(join(sandbox, ".dist-build.lock")), "retain the shared lock inode");
    const lockProbe = spawnSync("flock", ["-n", "-E", "75", ".dist-build.lock", "true"], {
      cwd: sandbox, encoding: "utf8", timeout: 5_000,
    });
    assert.ifError(lockProbe.error);
    assert.equal(lockProbe.status, 0, `a separate process must acquire the released lock: ${lockProbe.stderr}`);

    // Remove instrumentation only from the sandbox, then run a complete new
    // build, not just recovery or a lock probe. No manual release repair.
    writeFileSync(join(sandbox, "script/build.ts"), source);
    const success = spawnSync(process.execPath, ["--import", "tsx", "script/build.ts"], {
      cwd: sandbox, encoding: "utf8", timeout: 60_000,
    });
    assert.ifError(success.error);
    const successOutput = success.stdout + success.stderr;
    assert.equal(success.signal, null, successOutput);
    assert.equal(success.status, 0, successOutput);
    assert.notEqual(success.pid, failed.pid, "a new process must build and publish the next release");
    assert.doesNotMatch(successOutput, /Recovered interrupted release|Removed abandoned build staging/,
      "the failed process must have completed rollback and cleanup, without help from the next build");
    assert.match(readFileSync(join(sandbox, "dist/index.cjs"), "utf8"), /new server/);
    assert.match(readFileSync(join(sandbox, "dist/public/index.html"), "utf8"), /new client/);
    for (const name of privateFiles) {
      assert.equal(readFileSync(join(sandbox, "dist/private-assets", name), "utf8"), `new ${name}`);
    }
    assert.deepEqual(readFileSync(join(sandbox, "dist/pdf.worker.mjs")),
      readFileSync(join(root, "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs")));
    for (const name of ["private-assets/previous.pdf", "public/assets/nested/old.js",
      ".release-metadata", "empty-directory"]) {
      assert.equal(existsSync(join(sandbox, "dist", name)), false,
        `the successful build must replace rather than merge the old release: ${name}`);
    }
    assert.equal(existsSync(join(sandbox, ".dist-previous")), false);
    assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), []);
    assert.ok(existsSync(join(sandbox, ".dist-build.lock")), "retain the lock file after the successful build too");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("gagal menghapus cadangan hanya memberi peringatan; pemulihan terkunci mempertahankan seluruh rilis baru", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "build-backup-cleanup-failure-"));
  let lockFd: number | undefined;
  try {
    symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
    for (const dir of ["script", "client/public/assets/nested", "client/public/empty-directory",
      "server", "attached_assets", "dist/public", "dist/private-assets", "dist/empty-directory"]) {
      mkdirSync(join(sandbox, dir), { recursive: true });
    }
    copyBuildScripts(sandbox);
    const script = join(sandbox, "script/build.ts");
    const source = readFileSync(script, "utf8");
    const rmImport = "readdir, rename, rm, readFile";
    const builtPoint = "    await buildIn(staging);";
    assert.equal(source.split(rmImport).length, 2, "instrument only the sandbox's rm import");
    assert.equal(source.split(builtPoint).length, 2, "snapshot the complete real build before promotion");
    // Preserve production promotion, warning handling and finally cleanup.
    // Only post-publication backup deletion uses non-recursive rm, producing
    // a real filesystem error without removing any of the previous release.
    writeFileSync(script, source
      .replace(rmImport, "readdir, rename, rm as realRm, readFile")
      .replace(builtPoint, `${builtPoint}
    const entries: [string, string | null][] = [];
    async function visit(relative: string) {
      for (const entry of (await readdir(join(staging, relative), { withFileTypes: true }))
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const name = join(relative, entry.name);
        entries.push([name, entry.isDirectory() ? null : (await readFile(join(staging, name))).toString("base64")]);
        if (entry.isDirectory()) await visit(name);
      }
    }
    await visit("");
    const marker = await open("built-release.json", "w");
    try { await marker.writeFile(JSON.stringify({ pid: process.pid, entries })); }
    finally { await marker.close(); }`) + `
async function rm(path: string, options: Parameters<typeof realRm>[1]) {
  if (path === join(process.cwd(), ".dist-previous") && options?.force === true) {
    await realRm(path, { ...options, recursive: false });
    return;
  }
  await realRm(path, options);
}
`);
    writeFileSync(join(sandbox, "package.json"), JSON.stringify({ name: "backup-cleanup-fixture", type: "module" }));
    writeFileSync(join(sandbox, "vite.config.mjs"),
      'export default { root: "client", build: { outDir: "../dist/public" } };');
    writeFileSync(join(sandbox, "client/index.html"),
      '<html><head><link rel="stylesheet" href="/style.css"></head><body>new client<script type="module" src="/main.js"></script></body></html>');
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");
    const binaryAsset = Buffer.from([0, 255, 128, 13, 10, 42]);
    writeFileSync(join(sandbox, "client/public/assets/nested/fixture.bin"), binaryAsset);
    writeFileSync(join(sandbox, "server/index.ts"), 'console.log("new server");');
    for (const name of privateFiles) writeFileSync(join(sandbox, "attached_assets", name), `new ${name}`);
    for (const [name, contents] of [
      ["index.cjs", "old server"], ["public/index.html", "old client"],
      ["private-assets/previous.pdf", "old private asset"], [".release-metadata", "old metadata"],
    ]) writeFileSync(join(sandbox, "dist", name), contents);
    const dist = join(sandbox, "dist");
    const previous = join(sandbox, ".dist-previous");
    const oldRelease = releaseSnapshot(dist);
    const runBuild = (args: string[] = []) => {
      const result = spawnSync(process.execPath, ["--import", "tsx", "script/build.ts", ...args], {
        cwd: sandbox, encoding: "utf8", timeout: 60_000,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stdout + result.stderr);
      return result;
    };
    const success = runBuild();
    assert.equal(success.status, 0, success.stdout + success.stderr);
    assert.ok(success.stderr.includes(`Could not remove previous build at ${previous}:`), success.stderr);
    assert.match(success.stderr, /ERR_FS_EISDIR/, "the real non-recursive rm must fail on the backup directory");
    const evidence: { pid: number; entries: [string, string | null][] } =
      JSON.parse(readFileSync(join(sandbox, "built-release.json"), "utf8"));
    assert.equal(evidence.pid, success.pid, "the real build process must record the completed staging");
    const newRelease = new Map(evidence.entries.map(([name, contents]) =>
      [name, contents === null ? null : Buffer.from(contents, "base64")] as const));
    assert.notDeepEqual(newRelease, oldRelease);
    const assertNewRelease = () => assert.deepEqual(releaseSnapshot(dist), newRelease,
      "every built path and byte must survive publication, failed cleanup and recovery");
    assertNewRelease();
    assert.match(readFileSync(join(dist, "index.cjs"), "utf8"), /new server/);
    assert.match(readFileSync(join(dist, "public/index.html"), "utf8"), /new client/);
    for (const name of privateFiles) {
      assert.equal(readFileSync(join(dist, "private-assets", name), "utf8"), `new ${name}`);
    }
    assert.deepEqual(readFileSync(join(dist, "public/assets/nested/fixture.bin")), binaryAsset);
    assert.deepEqual(readFileSync(join(dist, "pdf.worker.mjs")),
      readFileSync(join(root, "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs")));
    assert.equal(newRelease.get("public/empty-directory"), null, "snapshot includes empty directories");
    assert.deepEqual(releaseSnapshot(previous), oldRelease, "failed cleanup must leave the entire real backup");
    assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), []);

    // Recovery must run the original script, not the failure-injected copy.
    writeFileSync(script, source);
    const lockPath = join(sandbox, ".dist-build.lock");
    const lockInode = statSync(lockPath).ino;
    lockFd = openSync(lockPath, "a");
    const held = spawnSync("flock", ["-n", "-E", "75", "3"], {
      cwd: sandbox, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "ignore", "pipe", lockFd],
    });
    assert.ifError(held.error);
    assert.equal(held.status, 0, held.stderr);
    const locked = runBuild(["--recover-only"]);
    assert.equal(locked.status, 1, locked.stdout + locked.stderr);
    assert.match(locked.stderr, /Another build is running/);
    assertNewRelease();
    assert.deepEqual(releaseSnapshot(previous), oldRelease, "recovery must not clean backups without the lock");
    closeSync(lockFd);
    lockFd = undefined;

    const recovered = runBuild(["--recover-only"]);
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.notEqual(recovered.pid, success.pid, "recovery must use a new process");
    assert.doesNotMatch(recovered.stdout + recovered.stderr,
      /building client|building server|Recovered interrupted release|Could not remove previous build/);
    assert.equal(existsSync(previous), false, "original recovery must remove the leftover backup");
    assertNewRelease();
    assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), []);
    assert.equal(statSync(lockPath).ino, lockInode, "all processes must retain the shared lock inode");
  } finally {
    if (lockFd !== undefined) closeSync(lockFd);
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("SIGKILL saat menyalin aset melepas pengunci, membersihkan staging, dan mempertahankan seluruh dist", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "build-killed-staging-"));
  let build: ReturnType<typeof spawn> | undefined;
  let closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
    for (const dir of ["script", "client", "server", "attached_assets",
      "dist/public/assets/nested", "dist/private-assets", "dist/empty-directory"]) {
      mkdirSync(join(sandbox, dir), { recursive: true });
    }
    copyBuildScripts(sandbox);
    const source = readFileSync(join(sandbox, "script/build.ts"), "utf8");
    const assetCopyPoint = `    join(privateAssets, "sbu-skk-tanpa-bingung-v2.2.0.pdf"),
  );`;
    assert.equal(source.split(assetCopyPoint).length, 2, "gate must follow the first real private asset copy");
    // Pause only the sandbox copy, with the real lock and partially assembled
    // staging. No production-only test hook or fabricated abandoned staging.
    writeFileSync(join(sandbox, "script/build.ts"), source.replace(assetCopyPoint, `${assetCopyPoint}
  const gate = await open("assets-paused.tmp", "w");
  await gate.writeFile(String(process.pid));
  await gate.close();
  await rename("assets-paused.tmp", "assets-paused");
  await new Promise<void>(() => setInterval(() => {}, 1000));`));
    writeFileSync(join(sandbox, "package.json"), JSON.stringify({ name: "killed-staging-fixture", type: "module" }));
    writeFileSync(join(sandbox, "vite.config.mjs"),
      'export default { root: "client", build: { outDir: "../dist/public" } };');
    writeFileSync(join(sandbox, "client/index.html"),
      '<html><head><link rel="stylesheet" href="/style.css"></head><body>new client<script type="module" src="/main.js"></script></body></html>');
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");
    writeFileSync(join(sandbox, "server/index.ts"), 'console.log("new server");');
    for (const name of privateFiles) writeFileSync(join(sandbox, "attached_assets", name), `new ${name}`);
    for (const [name, contents] of [
      ["index.cjs", "old server"],
      ["public/index.html", "old client"],
      ["public/assets/nested/old.js", "old nested asset"],
      ["private-assets/previous.pdf", "old private asset"],
      [".release-metadata", "old metadata"],
    ]) writeFileSync(join(sandbox, "dist", name), contents);
    writeFileSync(join(sandbox, "dist/pdf.worker.mjs"), Buffer.from([0, 255, 128, 13, 10]));
    const oldRelease = releaseSnapshot(join(sandbox, "dist"));
    const assertOldRelease = () => {
      assert.deepEqual(releaseSnapshot(join(sandbox, "dist")), oldRelease,
        "all release paths and bytes, including binary files and empty directories, must remain unchanged");
      assert.equal(existsSync(join(sandbox, ".dist-previous")), false, "promotion must not have started");
    };
    // Run Node directly so the child PID is the actual lock holder, not a CLI wrapper.
    build = spawn(process.execPath, ["--import", "tsx", "script/build.ts"], {
      cwd: sandbox, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    build.stdout!.on("data", (chunk) => { output += chunk; });
    build.stderr!.on("data", (chunk) => { output += chunk; });
    closed = new Promise((resolve, reject) => {
      build!.once("error", reject);
      build!.once("close", (code, signal) => resolve({ code, signal }));
    });
    // Observe failures immediately even while waiting for the gate.
    void closed.catch(() => {});
    const deadline = Date.now() + 30_000;
    while (!existsSync(join(sandbox, "assets-paused"))) {
      if (build.exitCode !== null || build.signalCode !== null) throw new Error(`Build exited before asset gate: ${output}`);
      if (Date.now() > deadline) throw new Error(`Build did not reach asset gate: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(Number(readFileSync(join(sandbox, "assets-paused"), "utf8")), build.pid);
    const abandoned = readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-"));
    assert.equal(abandoned.length, 1);
    const staging = join(sandbox, abandoned[0]);
    const partialRelease = releaseSnapshot(staging);
    assert.ok(existsSync(join(staging, "public/index.html")), "real Vite output must exist");
    assert.equal(readFileSync(join(staging, "private-assets", privateFiles[0]), "utf8"), `new ${privateFiles[0]}`);
    assert.equal(existsSync(join(staging, "private-assets", privateFiles[1])), false, "asset preparation must still be incomplete");
    assert.equal(existsSync(join(staging, "index.cjs")), false, "server build must not have started");
    assertOldRelease();
    const runRecovery = () => {
      const result = spawnSync(process.execPath, ["--import", "tsx", "script/build.ts", "--recover-only"], {
        cwd: sandbox, encoding: "utf8", timeout: 15_000,
      });
      assert.ifError(result.error);
      return result;
    };
    const locked = runRecovery();
    assert.equal(locked.status, 1, locked.stdout + locked.stderr);
    assert.match(locked.stdout + locked.stderr, /Another build is running/);
    assert.deepEqual(releaseSnapshot(staging), partialRelease, "rejected process must not clean live staging");
    assertOldRelease();

    assert.equal(build.kill("SIGKILL"), true);
    const killed = await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        exitTimer = setTimeout(() => reject(new Error(`Killed build did not exit: ${output}`)), 10_000);
      }),
    ]);
    clearTimeout(exitTimer);
    exitTimer = undefined;
    assert.deepEqual(killed, { code: null, signal: "SIGKILL" }, "real build must have been forcibly killed");
    assert.deepEqual(releaseSnapshot(staging), partialRelease, "SIGKILL must leave staging for the next process");
    assertOldRelease();
    const recovered = runRecovery();
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.match(recovered.stdout + recovered.stderr, /Removed abandoned build staging/);
    assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), []);
    assertOldRelease();
    assert.ok(existsSync(join(sandbox, ".dist-build.lock")), "keep the shared lock inode for future builds");
  } finally {
    if (exitTimer) clearTimeout(exitTimer);
    if (build && build.exitCode === null && build.signalCode === null) build.kill("SIGKILL");
    if (closed) await closed.catch(() => {});
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("SIGKILL saat promosi melepas pengunci dan proses baru memulihkan rilis lengkap", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "build-killed-promotion-"));
  let build: ReturnType<typeof spawn> | undefined;
  let buildPid: number | undefined;
  try {
    symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
    for (const dir of ["script", "client", "server", "attached_assets", "dist/public", "dist/private-assets"]) {
      mkdirSync(join(sandbox, dir), { recursive: true });
    }
    copyBuildScripts(sandbox);
    const source = readFileSync(join(root, "script/build.ts"), "utf8");
    const promotionPoint = "      hadPrevious = true;";
    assert.equal(source.split(promotionPoint).length, 2, "test gate must follow the real backup rename");
    // Instrument only this sandbox's copy: hold the actual build process after
    // moving dist to .dist-previous, before it can publish the new staging.
    // An unresolved timer-backed promise keeps the lock holder alive until SIGKILL;
    // a SIGSTOP after writing the marker can race with the observer.
    writeFileSync(join(sandbox, "script/build.ts"), source.replace(promotionPoint, `${promotionPoint}
      const gate = await open("promotion-paused.tmp", "w");
      await gate.writeFile(String(process.pid));
      await gate.close();
      await rename("promotion-paused.tmp", "promotion-paused");
      await new Promise<void>(() => setInterval(() => {}, 1000));`));
    writeFileSync(join(sandbox, "package.json"), JSON.stringify({ name: "killed-promotion-fixture", type: "module" }));
    writeFileSync(join(sandbox, "vite.config.mjs"),
      'export default { root: "client", build: { outDir: "../dist/public" } };');
    writeFileSync(join(sandbox, "client/index.html"),
      '<html><head><link rel="stylesheet" href="/style.css"></head><body>new client<script type="module" src="/main.js"></script></body></html>');
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");
    writeFileSync(join(sandbox, "server/index.ts"), 'console.log("new server");');
    for (const name of privateFiles) writeFileSync(join(sandbox, "attached_assets", name), `new ${name}`);
    const oldFiles = new Map([
      ["index.cjs", "old server"],
      ["public/index.html", "old client"],
      ["private-assets/previous.pdf", "old private asset"],
    ]);
    for (const [name, contents] of oldFiles) writeFileSync(join(sandbox, "dist", name), contents);

    build = spawn(join(root, "node_modules/.bin/tsx"), ["script/build.ts"], {
      cwd: sandbox, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    build.stdout!.on("data", (chunk) => { output += chunk; });
    build.stderr!.on("data", (chunk) => { output += chunk; });
    const closed = new Promise<void>((resolve, reject) => {
      build!.once("error", reject);
      build!.once("close", () => resolve());
    });
    const deadline = Date.now() + 30_000;
    while (!existsSync(join(sandbox, "promotion-paused"))) {
      if (build.exitCode !== null) throw new Error(`Build exited before promotion: ${output}`);
      if (Date.now() > deadline) throw new Error(`Build did not reach promotion: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    buildPid = Number(readFileSync(join(sandbox, "promotion-paused"), "utf8"));
    assert.ok(Number.isSafeInteger(buildPid) && buildPid > 0);
    assert.equal(existsSync(join(sandbox, "dist")), false);
    for (const [name, contents] of oldFiles) {
      assert.equal(readFileSync(join(sandbox, ".dist-previous", name), "utf8"), contents);
    }
    const abandoned = readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-"));
    assert.equal(abandoned.length, 1, "staging must remain while build is stopped");

    const runRecovery = () => {
      const result = spawnSync(join(root, "node_modules/.bin/tsx"), ["script/build.ts", "--recover-only"], {
        cwd: sandbox, encoding: "utf8", timeout: 15_000,
      });
      assert.ifError(result.error);
      return result;
    };
    const locked = runRecovery();
    assert.equal(locked.status, 1, locked.stdout + locked.stderr);
    assert.match(locked.stdout + locked.stderr, /Another build is running/);
    assert.equal(existsSync(join(sandbox, "dist")), false);

    process.kill(buildPid, "SIGKILL");
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          exitTimer = setTimeout(() => reject(new Error("Killed build did not exit")), 10_000);
        }),
      ]);
    } finally {
      if (exitTimer) clearTimeout(exitTimer);
    }
    buildPid = undefined;
    const recovered = runRecovery();
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.match(recovered.stdout + recovered.stderr, /Recovered interrupted release/);
    for (const [name, contents] of oldFiles) {
      assert.equal(readFileSync(join(sandbox, "dist", name), "utf8"), contents, `${name} must be restored`);
    }
    assert.equal(existsSync(join(sandbox, ".dist-previous")), false);
    assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), []);
    assert.ok(existsSync(join(sandbox, ".dist-build.lock")), "lock inode must stay available for future builds");
  } finally {
    if (buildPid) {
      try { process.kill(buildPid, "SIGKILL"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    if (build && build.exitCode === null) build.kill("SIGKILL");
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("SIGKILL setelah publikasi mempertahankan seluruh dist baru dan hanya membuang cadangan basi", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "build-killed-after-publication-"));
  let build: ReturnType<typeof spawn> | undefined;
  let closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
    for (const dir of ["script", "client/public/assets/nested", "server", "attached_assets",
      "dist/public", "dist/private-assets", "dist/empty-directory"]) {
      mkdirSync(join(sandbox, dir), { recursive: true });
    }
    copyBuildScripts(sandbox);
    const source = readFileSync(join(sandbox, "script/build.ts"), "utf8");
    const cleanupPoint = `    if (hadPrevious) {
      // A failed cleanup must not make a successfully published build look failed.`;
    assert.equal(source.split(cleanupPoint).length, 2,
      "gate must follow the real staging-to-dist rename and precede backup cleanup");
    // Pause only the sandbox copy. Vite, esbuild, asset copies, both promotion
    // renames and the OS lock all run normally; neither release is fabricated.
    writeFileSync(join(sandbox, "script/build.ts"), source.replace(cleanupPoint, `
    const gate = await open("published-paused.tmp", "w");
    await gate.writeFile(String(process.pid));
    await gate.close();
    await rename("published-paused.tmp", "published-paused");
    await new Promise<void>(() => setInterval(() => {}, 1000));
${cleanupPoint}`));
    writeFileSync(join(sandbox, "package.json"), JSON.stringify({ name: "killed-publication-fixture", type: "module" }));
    writeFileSync(join(sandbox, "vite.config.mjs"),
      'export default { root: "client", build: { outDir: "../dist/public" } };');
    writeFileSync(join(sandbox, "client/index.html"),
      '<html><head><link rel="stylesheet" href="/style.css"></head><body>published new client<script type="module" src="/main.js"></script></body></html>');
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");
    const binaryAsset = Buffer.from([0, 255, 128, 13, 10, 42]);
    writeFileSync(join(sandbox, "client/public/assets/nested/fixture.bin"), binaryAsset);
    writeFileSync(join(sandbox, "server/index.ts"), 'console.log("published new server");');
    for (const name of privateFiles) writeFileSync(join(sandbox, "attached_assets", name), `new ${name}`);
    for (const [name, contents] of [
      ["index.cjs", "old server"],
      ["public/index.html", "old client"],
      ["private-assets/previous.pdf", "old private asset"],
      [".release-metadata", "old metadata"],
    ]) writeFileSync(join(sandbox, "dist", name), contents);
    writeFileSync(join(sandbox, "dist/pdf.worker.mjs"), Buffer.from([255, 0, 1]));
    const oldRelease = releaseSnapshot(join(sandbox, "dist"));

    // Direct Node invocation makes the observed child the actual lock holder.
    build = spawn(process.execPath, ["--import", "tsx", "script/build.ts"], {
      cwd: sandbox, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    build.stdout!.on("data", (chunk) => { output += chunk; });
    build.stderr!.on("data", (chunk) => { output += chunk; });
    closed = new Promise((resolve, reject) => {
      build!.once("error", reject);
      build!.once("close", (code, signal) => resolve({ code, signal }));
    });
    void closed.catch(() => {});
    const deadline = Date.now() + 30_000;
    while (!existsSync(join(sandbox, "published-paused"))) {
      if (build.exitCode !== null || build.signalCode !== null) throw new Error(`Build exited before cleanup gate: ${output}`);
      if (Date.now() > deadline) throw new Error(`Build did not reach cleanup gate: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(Number(readFileSync(join(sandbox, "published-paused"), "utf8")), build.pid);
    const dist = join(sandbox, "dist");
    const previous = join(sandbox, ".dist-previous");
    assert.deepEqual(releaseSnapshot(previous), oldRelease, "real promotion must retain the complete previous release");
    assert.match(readFileSync(join(dist, "index.cjs"), "utf8"), /published new server/);
    assert.match(readFileSync(join(dist, "public/index.html"), "utf8"), /published new client/);
    for (const name of privateFiles) {
      assert.equal(readFileSync(join(dist, "private-assets", name), "utf8"), `new ${name}`);
    }
    assert.deepEqual(readFileSync(join(dist, "public/assets/nested/fixture.bin")), binaryAsset);
    assert.deepEqual(readFileSync(join(dist, "pdf.worker.mjs")),
      readFileSync(join(root, "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs")));
    assert.equal(existsSync(join(dist, "private-assets/previous.pdf")), false);
    const newRelease = releaseSnapshot(dist);
    assert.notDeepEqual(newRelease, oldRelease, "the gate must observe the new release, not the restored old one");
    assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), [],
      "staging must already have been renamed into dist");
    const assertBothReleases = () => {
      assert.deepEqual(releaseSnapshot(dist), newRelease);
      assert.deepEqual(releaseSnapshot(previous), oldRelease);
    };
    const runRecovery = () => {
      const result = spawnSync(process.execPath, ["--import", "tsx", "script/build.ts", "--recover-only"], {
        cwd: sandbox, encoding: "utf8", timeout: 15_000,
      });
      assert.ifError(result.error);
      return result;
    };
    const locked = runRecovery();
    assert.equal(locked.status, 1, locked.stdout + locked.stderr);
    assert.match(locked.stdout + locked.stderr, /Another build is running/);
    assertBothReleases();

    assert.equal(build.kill("SIGKILL"), true);
    const killed = await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        exitTimer = setTimeout(() => reject(new Error(`Killed build did not exit: ${output}`)), 10_000);
      }),
    ]);
    clearTimeout(exitTimer);
    exitTimer = undefined;
    assert.deepEqual(killed, { code: null, signal: "SIGKILL" }, "the actual build must be forcibly killed");
    assertBothReleases();

    const recovered = runRecovery();
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.doesNotMatch(recovered.stdout + recovered.stderr, /Recovered interrupted release/,
      "a published release must not be replaced by its backup");
    assert.deepEqual(releaseSnapshot(dist), newRelease,
      "every published path and byte must survive recovery, including nested binary and private assets");
    assert.equal(existsSync(previous), false, "recovery must remove the real stale backup");
    assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), []);
    assert.ok(existsSync(join(sandbox, ".dist-build.lock")), "keep the shared lock inode for future builds");
  } finally {
    if (exitTimer) clearTimeout(exitTimer);
    if (build && build.exitCode === null && build.signalCode === null) build.kill("SIGKILL");
    if (closed) await closed.catch(() => {});
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("build paralel ditolak tanpa mengubah rilis yang sedang dibangun", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "build-parallel-"));
  let first: ReturnType<typeof spawn> | undefined;
  try {
    symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
    for (const dir of ["script", "client", "server", "attached_assets", "dist/public", "dist/private-assets"]) {
      mkdirSync(join(sandbox, dir), { recursive: true });
    }
    copyBuildScripts(sandbox);
    writeFileSync(join(sandbox, "package.json"), JSON.stringify({ name: "build-parallel-fixture", type: "module" }));
    writeFileSync(join(sandbox, "client/index.html"),
      '<html><head><link rel="stylesheet" href="/style.css"></head><body>release A<script type="module" src="/main.js"></script></body></html>');
    writeFileSync(join(sandbox, "client/style.css"), ".fixture{color:red}");
    writeFileSync(join(sandbox, "server/index.ts"), 'console.log("server A");');
    for (const name of privateFiles) writeFileSync(join(sandbox, "attached_assets", name), `asset A ${name}`);
    writeFileSync(join(sandbox, "dist/index.cjs"), "old server");
    writeFileSync(join(sandbox, "dist/public/index.html"), "old client");
    writeFileSync(join(sandbox, "dist/private-assets/previous.pdf"), "old private asset");

    // Hold the first process inside Vite. The second process must fail before
    // it can recover, build or promote anything in the same sandbox.
    writeFileSync(join(sandbox, "vite.config.mjs"), `
      import { existsSync, writeFileSync } from "node:fs";
      export default { root: "client", plugins: [{
        name: "hold-first-build",
        async buildStart() {
          writeFileSync("build-entered", "yes");
          const started = Date.now();
          while (!existsSync("release-first")) {
            if (Date.now() - started > 30000) throw new Error("test build gate timed out");
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        }
      }] };
    `);
    first = spawn(join(root, "node_modules/.bin/tsx"), ["script/build.ts"], {
      cwd: sandbox, stdio: ["ignore", "pipe", "pipe"],
    });
    let firstOutput = "";
    first.stdout!.on("data", (chunk) => { firstOutput += chunk; });
    first.stderr!.on("data", (chunk) => { firstOutput += chunk; });
    const firstExit = new Promise<number | null>((resolve, reject) => {
      first!.once("error", reject);
      first!.once("close", resolve);
    });
    const deadline = Date.now() + 15_000;
    while (!existsSync(join(sandbox, "build-entered"))) {
      if (first.exitCode !== null) throw new Error(`First build exited early: ${firstOutput}`);
      if (Date.now() > deadline) throw new Error(`First build did not reach gate: ${firstOutput}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const activeStaging = readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-"));
    assert.equal(activeStaging.length, 1, "first build must have active staging");
    const activeMarker = join(sandbox, activeStaging[0], "active-marker");
    writeFileSync(activeMarker, "still building");

    const second = spawnSync(join(root, "node_modules/.bin/tsx"), ["script/build.ts"], {
      cwd: sandbox, encoding: "utf8", timeout: 10_000,
    });
    assert.ifError(second.error);
    assert.notEqual(second.status, 0);
    assert.match(second.stdout + second.stderr, /Another build is running/);
    assert.equal(readFileSync(activeMarker, "utf8"), "still building",
      "rejected parallel build must not clean active staging");
    assert.equal(readFileSync(join(sandbox, "dist/index.cjs"), "utf8"), "old server");
    assert.equal(readFileSync(join(sandbox, "dist/public/index.html"), "utf8"), "old client");
    assert.equal(readFileSync(join(sandbox, "dist/private-assets/previous.pdf"), "utf8"), "old private asset");

    writeFileSync(join(sandbox, "release-first"), "yes");
    assert.equal(await firstExit, 0, firstOutput);
    assert.match(readFileSync(join(sandbox, "dist/index.cjs"), "utf8"), /server A/);
    assert.match(readFileSync(join(sandbox, "dist/public/index.html"), "utf8"), /release A/);
    assert.equal(readFileSync(join(sandbox, "dist/private-assets", privateFiles[0]), "utf8"),
      `asset A ${privateFiles[0]}`);
    assert.ok(existsSync(join(sandbox, "dist/pdf.worker.mjs")));
    assert.equal(existsSync(join(sandbox, "dist/private-assets/previous.pdf")), false);
    assert.equal(existsSync(join(sandbox, ".dist-previous")), false);
    assert.deepEqual(readdirSync(sandbox).filter((name) => name.startsWith(".dist-build-")), []);
  } finally {
    if (first && first.exitCode === null) first.kill("SIGKILL");
    rmSync(sandbox, { recursive: true, force: true });
  }
});