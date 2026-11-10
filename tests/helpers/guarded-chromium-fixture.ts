import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

export const offlineChromiumArgs = [
  "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
  "--disable-component-update", "--disable-domain-reliability",
  "--disable-breakpad", "--disable-crash-reporter",
  "--host-resolver-rules=MAP * ~NOTFOUND",
  "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>",
];

export async function createFixtureWatchdog() {
  const child = fork(fileURLToPath(new URL("./chromium-fixture-watchdog.ts", import.meta.url)), [], {
    execArgv: ["--import", "tsx"],
    detached: true,
    env: { PATH: process.env.PATH },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  // Startup errors also reject message(); keep this deferred exit promise
  // handled until release() consumes it.
  void exited.catch(() => {});
  function message() {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => done(new Error("Fixture watchdog IPC timed out")), 10_000);
      const onMessage = (value: unknown) => done(undefined, value);
      const onExit = () => done(new Error("Fixture watchdog exited before acknowledgement"));
      function done(error?: Error, value?: unknown) {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        child.off("error", done);
        if (error) reject(error); else resolve(value);
      }
      child.once("message", onMessage);
      child.once("exit", onExit);
      child.once("error", done);
    });
  }
  try {
    const ready = await message() as { profile: string; directory: string };
    assert.equal(typeof ready.profile, "string");
    return {
      ...ready, child,
      async capture() {
        const reply = message();
        child.send("capture");
        assert.equal(await reply, "captured");
      },
      async release() {
        if (child.connected) child.send("release", () => {});
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            exited,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Fixture watchdog cleanup timed out")), 10_000);
            }),
          ]);
          assert.deepEqual(result, { code: 0, signal: null });
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
    };
  } catch (error) {
    if (child.connected) child.disconnect();
    throw error;
  }
}

export async function launchGuardedChromium(
  watchdog: Awaited<ReturnType<typeof createFixtureWatchdog>>,
  executablePath: string,
) {
  const browser = await puppeteer.launch({
    executablePath, userDataDir: watchdog.profile, headless: true,
    timeout: 10_000, protocolTimeout: 3_000, args: offlineChromiumArgs,
    // The independent watchdog, not Puppeteer's parent signal handler, must
    // recover fixtures if the tester receives TERM/INT.
    handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false,
  });
  await watchdog.capture();
  return browser;
}
