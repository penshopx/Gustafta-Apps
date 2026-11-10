/**
 * Fixture-only watchdog. No application imports, process-name lookup, process
 * group signals, user profiles, or external navigation. The directory is
 * created here, before the tester can launch Chromium, closing the launch /
 * PID-registration gap if that tester dies inside puppeteer.launch().
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identity, processes, signalFixture, waitForExit, type ProcessIdentity } from "./chromium-fixture-processes";

const directory = await mkdtemp(join(tmpdir(), "chromium-guarded-fixture-"));
const profile = join(directory, "profile");
const captured = new Map<string, ProcessIdentity>();
let finishing = false;
let scan = Promise.resolve();
function capture() {
  scan = scan.then(async () => {
    const all = await processes();
    for (const item of all) {
      let args: string[];
      try { args = (await readFile(`/proc/${item.pid}/cmdline`, "utf8")).split("\0"); }
      catch (error) {
        if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
        throw error;
      }
      // Match the complete argument, never a substring or an executable name.
      // Recheck identity after cmdline to reject a PID reused during the read.
      if (args.includes(`--user-data-dir=${profile}`) &&
          (await identity(item.pid))?.start === item.start) {
        captured.set(`${item.pid}:${item.start}`, item);
      }
    }
    // Retain proven descendants even if their root later exits/reparents them.
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of all) {
        const parent = all.find((candidate) => candidate.pid === item.parent);
        if (parent && captured.has(`${parent.pid}:${parent.start}`) &&
            !captured.has(`${item.pid}:${item.start}`)) {
          captured.set(`${item.pid}:${item.start}`, item);
          changed = true;
        }
      }
    }
  });
  return scan;
}
const interval = setInterval(() => { void capture().catch(fail); }, 100);
// A hung tester cannot keep this fixture indefinitely.
const lifetime = setTimeout(() => { void finish(); }, 90_000);
const hardLimit = () => setTimeout(() => {
  console.error("Fixture watchdog exceeded its cleanup budget; profile retained");
  process.exit(1);
}, 8_000);

function fail(error: unknown) {
  console.error("Fixture watchdog could not prove cleanup:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
  void finish();
}

async function finish() {
  if (finishing) return;
  finishing = true;
  clearInterval(interval);
  clearTimeout(lifetime);
  const deadline = hardLimit();
  try {
    await capture();
    // Freeze proven processes before the final census: a running descendant
    // could otherwise fork/recreate its profile while its parent is exiting.
    let frozen = false;
    for (let pass = 0; pass < 10; pass++) {
      const count = captured.size;
      for (const item of captured.values()) await signalFixture(item, "SIGSTOP");
      await capture();
      if (captured.size === count) { frozen = true; break; }
    }
    if (!frozen) throw new Error("Fixture process census did not stabilize");
    const owned = [...captured.values()].reverse();
    for (const item of owned) await signalFixture(item, "SIGKILL");
    if ((await waitForExit(owned, 2_000)).length) throw new Error("Executing fixture processes remain");
    await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
  } catch (error) {
    console.error("Fixture watchdog cleanup failed; profile retained:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    if (process.connected) process.disconnect();
  }
}
process.on("disconnect", () => { void finish(); });
process.on("message", (message) => {
  if (message === "release") void finish();
  if (message === "capture" && !finishing) {
    void capture().then(() => {
      send("captured");
    }).catch(fail);
  }
});
process.on("SIGTERM", () => { void finish(); });
process.on("SIGINT", () => { void finish(); });
function send(value: string | { profile: string; directory: string }) {
  if (!process.connected) { void finish(); return; }
  // Parent death can race the connected check. Never let an IPC write error
  // terminate this watchdog before its independent cleanup has run.
  process.send?.(value, undefined, undefined, (error: Error | null) => {
    if (error) void finish();
  });
}
if (process.connected) send({ profile, directory });
else await finish();
