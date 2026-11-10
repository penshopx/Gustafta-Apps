import { build as esbuild } from "esbuild";
import { build as viteBuild, createLogger, loadEnv } from "vite";
import { copyFile, lstat, mkdir, mkdtemp, open, readdir, rename, rm, readFile } from "fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { checkBuiltCss, checkInitialCssBudget, isCssBuildWarning } from "./check-built-css";
import { checkInitialJsBudget } from "./check-initial-js-budget";
import { checkDashboardJsBudget } from "./check-dashboard-js-budget";
import { checkPaymentBaseConfig } from "./check-payment-config";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "p-limit",
  "mammoth",
  "passport",
  "passport-local",
  "pdf-parse",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function recoverInterruptedPromotion() {
  const cwd = process.cwd();
  const dist = join(cwd, "dist");
  const previous = join(cwd, ".dist-previous");
  const legacyBackups = (await readdir(cwd))
    .filter((name) => /^\.dist-build-.+-previous$/.test(name))
    .map((name) => join(cwd, name));

  if (await exists(dist)) {
    // A published dist is complete: directory rename is atomic. A backup here
    // only means the process stopped after publication but before cleanup.
    if (await exists(previous)) await rm(previous, { recursive: true });
    for (const backup of legacyBackups) await rm(backup, { recursive: true });
    return;
  }

  // The fixed-name backup belongs to the latest promotion. Older random-name
  // backups can coexist after an upgrade and must not block its recovery.
  if (await exists(previous)) {
    await rename(previous, dist);
    console.log(`Recovered interrupted release from ${previous}`);
    for (const backup of legacyBackups) await rm(backup, { recursive: true });
    return;
  }
  if (legacyBackups.length > 1) {
    throw new Error(`Cannot recover dist: multiple build backups found: ${legacyBackups.join(", ")}`);
  }
  if (legacyBackups.length === 1) {
    await rename(legacyBackups[0], dist);
    console.log(`Recovered interrupted release from ${legacyBackups[0]}`);
  }
}

async function cleanAbandonedStaging() {
  const cwd = process.cwd();
  // Run only while holding the build lock, before creating this run's staging.
  // Legacy *-previous directories are release backups, not disposable staging.
  for (const entry of await readdir(cwd, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(".dist-build-") ||
        entry.name.endsWith("-previous")) continue;
    const path = join(cwd, entry.name);
    await rm(path, { recursive: true });
    console.log(`Removed abandoned build staging at ${path}`);
  }
}

async function buildAll() {
  // Recover before starting any work, even if the new build will fail.
  await recoverInterruptedPromotion();
  await cleanAbandonedStaging();
  // Vite's default build mode is production and its root is client (vite.config.ts).
  // Load the same client env that Vite will embed, including client/.env.production.
  checkPaymentBaseConfig(
    process.env.PAYMENT_BASE_URL,
    loadEnv("production", join(process.cwd(), "client"), "VITE_").VITE_PAYMENT_BASE_URL,
  );
  // Keep the current release untouched until every build and asset copy succeeds.
  // The sibling directory is on the same filesystem as dist for rename().
  const staging = await mkdtemp(join(process.cwd(), ".dist-build-"));
  const previous = join(process.cwd(), ".dist-previous");
  try {
    await buildIn(staging);

    let hadPrevious = false;
    try {
      await rename("dist", previous);
      hadPrevious = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, "dist");
    } catch (error) {
      if (hadPrevious) await rename(previous, "dist");
      throw error;
    }
    if (hadPrevious) {
      // A failed cleanup must not make a successfully published build look failed.
      await rm(previous, { recursive: true, force: true }).catch((error) =>
        console.warn(`Could not remove previous build at ${previous}:`, error),
      );
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function buildIn(staging: string) {
  console.log("building client...");
  const logger = createLogger();
  const cssWarnings: string[] = [];
  const originalWarn = logger.warn.bind(logger);
  logger.warn = (message, options) => {
    if (isCssBuildWarning(message)) cssWarnings.push(message);
    originalWarn(message, options);
  };
  await viteBuild({
    customLogger: logger,
    plugins: [{
      name: "dashboard-js-budget",
      async writeBundle(_options, bundle) {
        await checkDashboardJsBudget(
          join(staging, "public"),
          Object.values(bundle).filter((output) => output.type === "chunk"),
        );
      },
    }],
    build: { outDir: join(staging, "public") },
  });
  await checkBuiltCss(join(staging, "public"));
  await checkInitialCssBudget(join(staging, "public"));
  await checkInitialJsBudget(join(staging, "public"));
  if (cssWarnings.length) {
    throw new Error(`CSS build warning(s):\n${cssWarnings.join("\n")}`);
  }

  // Private fulfillment asset: included in the server deployment bundle but
  // deliberately kept in dist/private-assets (outside public) so Express cannot serve it
  // without the paid-order token gate.
  const privateAssets = join(staging, "private-assets");
  await mkdir(privateAssets, { recursive: true });
  await copyFile(
    "attached_assets/sbu-skk-tanpa-bingung-v2.2.0.pdf",
    join(privateAssets, "sbu-skk-tanpa-bingung-v2.2.0.pdf"),
  );
  await copyFile(
    "attached_assets/sbu-skk-lampiran-toolkit-v1.1.0.pdf",
    join(privateAssets, "sbu-skk-lampiran-toolkit-v1.1.0.pdf"),
  );
  await copyFile(
    "attached_assets/mini-ebook-sbu-skk-v1.1.0.pdf",
    join(privateAssets, "mini-ebook-sbu-skk-v1.1.0.pdf"),
  );
  await copyFile(
    "attached_assets/KEP_DIRJEN_BK_281_STANDAR_SKEMA_SERTIFIKASI_26_AGUSTUS_2026_SU_1788273103134.pdf",
    join(privateAssets, "KEP_DIRJEN_BK_281_STANDAR_SKEMA_SERTIFIKASI_26_AGUSTUS_2026_SU_1788273103134.pdf"),
  );
  // pdf-parse resolves its worker relative to the bundled server file.
  // Keep the worker beside dist/index.cjs so production PDF extraction works.
  await copyFile(
    "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs",
    join(staging, "pdf.worker.mjs"),
  );

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: join(staging, "index.cjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": "__filename",
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

async function runWithBuildLock() {
  // Keep this file in place: unlinking it after release could let another
  // process lock a different inode while a third process still holds the old one.
  const lockPath = join(process.cwd(), ".dist-build.lock");
  const handle = await open(lockPath, "a");
  try {
    // flock locks the inherited open file description, so the lock remains
    // owned by this process after flock exits and is released on close/crash.
    const lock = spawnSync("flock", ["-n", "-E", "75", "3"], {
      stdio: ["ignore", "ignore", "pipe", handle.fd],
      encoding: "utf8",
    });
    if (lock.error) throw new Error(`Cannot acquire build lock at ${lockPath}: ${lock.error.message}`);
    if (lock.status === 75) throw new Error(`Another build is running (lock: ${lockPath}). Try again after it finishes.`);
    if (lock.status !== 0) throw new Error(`Cannot acquire build lock at ${lockPath}: ${lock.stderr || `flock exited ${lock.status}`}`);

    if (process.argv.includes("--recover-only")) {
      await recoverInterruptedPromotion();
      await cleanAbandonedStaging();
    }
    else await buildAll();
  } finally {
    await handle.close();
  }
}

runWithBuildLock().catch((err) => {
  console.error(err);
  process.exit(1);
});
