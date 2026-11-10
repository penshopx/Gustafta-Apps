import type { ChildProcess } from "node:child_process";
import type { Browser } from "puppeteer-core";

export function ownedBrowserProcessRunning(child: ChildProcess | null): boolean {
  return child !== null && child.exitCode === null && child.signalCode === null;
}

function signalAndWait(
  child: ChildProcess,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(!ownedBrowserProcessRunning(child));
    // Register before kill: an immediate exit/error must not be missed.
    child.once("exit", onExit);
    child.once("error", onError);
    timer = setTimeout(() => finish(!ownedBrowserProcessRunning(child)), timeoutMs);
    try {
      if (!ownedBrowserProcessRunning(child)) finish(true);
      else if (!child.kill(signal)) finish(!ownedBrowserProcessRunning(child));
    } catch {
      finish(!ownedBrowserProcessRunning(child));
    }
  });
}

async function disconnectWithin(browser: Pick<Browser, "disconnect">, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => browser.disconnect()).then(() => true, () => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Only call for a browser launched by this checker, with its captured child
 * handle. Never discover processes by name, signal a process group, or kill a
 * numeric PID supplied by a caller. Missing ownership proof means no kill.
 * timeoutMs is the total emergency-cleanup budget, not a per-operation limit.
 */
export async function cleanupOwnedBrowser(
  browser: Pick<Browser, "disconnect">,
  child: ChildProcess | null,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  // Reserve time for escalation and transport disposal even if SIGTERM is
  // ignored. None of these steps may consume another full cleanup budget.
  const signalBudget = timeoutMs / 3;
  const remaining = () => Math.max(0, deadline - performance.now());
  let exited = child !== null && !ownedBrowserProcessRunning(child);
  try {
    if (child && !exited) {
      exited = await signalAndWait(child, "SIGTERM", Math.min(signalBudget, remaining()));
      if (!exited) exited = await signalAndWait(child, "SIGKILL", Math.min(signalBudget, remaining()));
    }
  } catch {
    // Cleanup must never replace the original checker failure or expose
    // process arguments / provider details in the operational report.
    exited = false;
  }
  const disconnected = await disconnectWithin(browser, remaining());
  return exited && disconnected;
}
