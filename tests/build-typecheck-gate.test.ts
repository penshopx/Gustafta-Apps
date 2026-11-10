import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("build berhenti saat pemeriksaan tipe gagal, sebelum artefak lama dihapus", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
  assert.equal(pkg.scripts.build,
    "npx tsx script/build.ts --recover-only && npm run check && npx tsx script/build.ts");
  assert.equal(pkg.scripts.check, "tsc");
  assert.ok(tsconfig.include.includes("script/build.ts"), "release script must be checked");
  assert.equal(tsconfig.include.some((entry: string) => entry === "script/**/*" || entry === "script/*.ts"), false,
    "maintenance scripts must not be added to the check");

  const sandbox = mkdtempSync(join(tmpdir(), "build-typecheck-gate-"));
  try {
    symlinkSync(join(root, "node_modules"), join(sandbox, "node_modules"), "dir");
    mkdirSync(join(sandbox, "dist"));
    mkdirSync(join(sandbox, "script"));
    const artifact = join(sandbox, "dist", "previous-release.txt");
    const bundlerMarker = join(sandbox, "bundler-started.txt");
    const recoveryMarker = join(sandbox, "recovery-started.txt");
    writeFileSync(artifact, "existing release");
    // Keep the project's actual include list, but avoid writing the shared incremental cache.
    writeFileSync(join(sandbox, "tsconfig.json"), JSON.stringify({
      ...tsconfig,
      compilerOptions: { ...tsconfig.compilerOptions, incremental: false, tsBuildInfoFile: undefined },
    }));
    writeFileSync(join(sandbox, "script", "maintenance.ts"),
      'const unrelatedNumber: number = "not part of the release gate";\n');
    // The preflight recovery is safe; bundling after a missed type error is not.
    writeFileSync(join(sandbox, "script", "build.ts"),
      `import { rmSync, writeFileSync } from "node:fs";\nconst expectedNumber: number = "wrong type";\nif (process.argv.includes("--recover-only")) {\n  writeFileSync("recovery-started.txt", "started");\n} else {\n  rmSync("dist", { recursive: true, force: true });\n  writeFileSync("bundler-started.txt", "started");\n}\n`);
    writeFileSync(join(sandbox, "package.json"), JSON.stringify({
      name: "build-gate-fixture",
      version: "1.0.0",
      type: "module",
      scripts: { build: pkg.scripts.build, check: pkg.scripts.check },
    }));

    const result = spawnSync("npm", ["run", "build"], {
      cwd: sandbox,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, "build must reject invalid types");
    assert.match(result.stdout + result.stderr, /script\/build\.ts.*error TS2322:/,
      "real tsc must report the build script's type error");
    assert.equal(readFileSync(recoveryMarker, "utf8"), "started");
    assert.equal(readFileSync(artifact, "utf8"), "existing release");
    assert.equal(existsSync(bundlerMarker), false, "bundling must not start");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("publish Replit memakai npm run build yang dijaga pemeriksaan tipe", () => {
  const config = readFileSync(join(root, ".replit"), "utf8");
  const deployment = config.split(/^\[deployment\]\s*$/m)[1]?.split(/^\[/m)[0];
  assert.ok(deployment, "deployment section must exist");
  assert.match(deployment, /^build\s*=\s*\[\s*"npm"\s*,\s*"run"\s*,\s*"build"\s*\]\s*$/m);
});
