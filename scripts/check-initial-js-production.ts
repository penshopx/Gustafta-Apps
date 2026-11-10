import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { measureInitialJsTransfer } from "./check-initial-js-transfer";
import { evaluateTransferBudget, parseTransferBudget } from "./lib/initial-js-transfer-budget";
import { PRODUCTION_TRANSFER_PROFILE, serveProductionTransfer } from "./lib/initial-js-production-server";
import { checkInitialJsBudget } from "../script/check-initial-js-budget";

const directory = resolve("generated-artifacts/initial-js-production");
const output = resolve(directory, "report.json");
const buildDir = resolve(directory, "public");

async function main() {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await writeFile(output, JSON.stringify({
    valid: false, outcome: "measurement-error", exitCode: 2, problems: ["Production check did not finish"],
  }) + "\n");
  if (process.argv.length > 2) throw new Error("Production gate accepts no arguments; edit the reviewed budget instead");
  const budget = parseTransferBudget(JSON.parse(await readFile("config/initial-js-transfer-budget.json", "utf8")));
  // Only toolchain necessities: never pass application/database/provider secrets.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NODE_ENV: "production", TZ: "UTC", LANG: "en_US.UTF-8",
    VITE_META_PIXEL_ID: "",
  };
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", buildDir], {
      env, stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? done() :
      reject(new Error(`Production build failed: ${signal ?? code}`)));
  });
  // Complements, never replaces, the existing static HTML budget.
  await checkInitialJsBudget(buildDir);
  const server = await serveProductionTransfer(buildDir);
  try {
    const executablePath = process.env.CI && process.env.CI !== "false"
      ? resolve("generated-artifacts/visual-env/chrome-linux64/chrome")
      : process.env.CHROME_PATH ?? resolve("generated-artifacts/visual-env/chrome-linux64/chrome");
    const report = await measureInitialJsTransfer({
      url: server.url, executablePath, observationMs: budget.observationMs,
    });
    const result = evaluateTransferBudget(report, budget, report.serverProfile ?? undefined);
    await writeFile(output, JSON.stringify({
      ...report, ...result, budget,
      server: { profile: PRODUCTION_TRANSFER_PROFILE, compression: "gzip level 6", api: "fixed anonymous 401" },
    }, null, 2) + "\n");
    console.table(report.groups);
    console.log(`${result.outcome}; report: ${output}`);
    process.exitCode = result.exitCode;
  } finally {
    await server.close();
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  await mkdir(directory, { recursive: true });
  await writeFile(output, JSON.stringify({
    schemaVersion: 1, valid: false, outcome: "measurement-error", exitCode: 2, problems: [message],
  }, null, 2) + "\n");
  process.exitCode = 2;
});
