import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export interface ProcessIdentity {
  pid: number;
  parent: number;
  start: string;
  state: string;
}

export async function identity(pid: number): Promise<ProcessIdentity | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return { pid, parent: Number(fields[1]), state: fields[0], start: fields[19] };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
}

export async function processes() {
  return (await Promise.all((await readdir("/proc"))
    .filter((name) => /^\d+$/.test(name)).map((name) => identity(Number(name)))))
    .filter((item): item is ProcessIdentity => item !== null);
}

export async function tree(root: ProcessIdentity): Promise<ProcessIdentity[]> {
  assert.equal((await identity(root.pid))?.start, root.start, "fixture root identity must still match");
  const all = await processes();
  const owned = new Set([root.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of all) {
      if (owned.has(item.parent) && !owned.has(item.pid)) {
        owned.add(item.pid);
        changed = true;
      }
    }
  }
  return all.filter((item) => owned.has(item.pid));
}

export async function isLive(item: ProcessIdentity): Promise<boolean> {
  const current = await identity(item.pid);
  return current?.start === item.start && !["Z", "X"].includes(current.state);
}

export async function waitForExit(items: ProcessIdentity[], timeout: number): Promise<ProcessIdentity[]> {
  const deadline = performance.now() + timeout;
  let live: ProcessIdentity[];
  do {
    live = (await Promise.all(items.map(async (item) => await isLive(item) ? item : null)))
      .filter((item): item is ProcessIdentity => item !== null);
    if (!live.length) return [];
    await delay(25);
  } while (performance.now() < deadline);
  return live;
}

export async function signalFixture(item: ProcessIdentity, signal: NodeJS.Signals) {
  if (!await isLive(item)) return;
  try { process.kill(item.pid, signal); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
