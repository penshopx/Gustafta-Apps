/**
 * Durable monitor state in a repository issue (not Actions cache).
 * Only canonical app names and a delivery phase are persisted.
 */
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ISO_ECOSYSTEM_APPS, PROJECT_ECOSYSTEM_APPS } from "../client/src/data/ecosystem-apps";
import { findIssueByTitle } from "./ecosystem-issue-lookup";

const names = [...ISO_ECOSYSTEM_APPS, ...PROJECT_ECOSYSTEM_APPS].map((app) => app.name);
const reasonPattern = /^(?:URL tidak valid|URL harus HTTPS|redirect HTTP \d{3}|HTTP \d{3}|timeout setelah \d+ detik|gagal terhubung|halaman HTTP (?:\d{3}|tidak tersedia)|halaman dialihkan ke domain lain|halaman kosong, salah, atau gagal dimuat)$/;
const title = "Ecosystem health monitor state (automated; do not edit)";
const prefix = "ecosystem-health-state-v1\n";

export function isKnownAppName(name: string): boolean {
  return names.includes(name);
}

export function failedAppNames(report: unknown): string[] {
  if (!Array.isArray(report) || !report.every((entry) => typeof entry === "string")) {
    throw new Error("Laporan pemeriksaan tidak valid");
  }
  const failures = new Set<string>();
  for (const entry of report) {
    const name = names.find((candidate) => entry.startsWith(`${candidate}: `));
    if (!name || !reasonPattern.test(entry.slice(name.length + 2))) {
      throw new Error("Laporan pemeriksaan mengandung aplikasi atau status tidak dikenal");
    }
    failures.add(name);
  }
  return [...failures];
}

export function recoveredAppNames(previous: unknown, current: string[]): string[] {
  if (!Array.isArray(previous) ||
      !previous.every((name) => typeof name === "string" && names.includes(name))) {
    throw new Error("Status pemeriksaan sebelumnya tidak valid");
  }
  return [...new Set(previous)].filter((name) => !current.includes(name));
}

type State = { failed: string[]; phase: "idle" } |
  { failed: string[]; phase: "sending"; current: string[] };
type Issue = { number: number; title: string; body: string; pull_request?: unknown };
type Transport = (url: string, init?: RequestInit) => Promise<Response>;

export function parseState(body: unknown): State {
  if (typeof body !== "string" || !body.startsWith(prefix)) throw new Error("Invalid state");
  const value: unknown = JSON.parse(body.slice(prefix.length));
  if (!value || typeof value !== "object") throw new Error("Invalid state");
  const state = value as Record<string, unknown>;
  recoveredAppNames(state.failed, []);
  if (state.phase === "idle" && Object.keys(state).sort().join(",") === "failed,phase") return state as State;
  if (state.phase === "sending" && Object.keys(state).sort().join(",") === "current,failed,phase") {
    recoveredAppNames(state.current, []);
    if (!recoveredAppNames(state.failed, state.current as string[]).length) throw new Error("Invalid recovery claim");
    return state as State;
  }
  throw new Error("Invalid state");
}

export function serializeState(state: State): string {
  // Never pass unchecked values (especially report text) to the issue body.
  parseState(prefix + JSON.stringify(state));
  return prefix + JSON.stringify(state);
}

export class EcosystemStateStore {
  constructor(
    private readonly repository: string,
    private readonly token: string,
    private readonly transport: Transport = fetch,
  ) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) throw new Error("Invalid GitHub configuration");
  }

  private async api(path: string, method = "GET", body?: object): Promise<any> {
    const response = await this.transport(
      `https://api.github.com${path.startsWith("/search/issues?") ? "" : `/repos/${this.repository}`}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    // Never include API response bodies, URLs, or credentials in logs/errors.
    if (!response.ok) throw new Error(`GitHub state request failed (${response.status})`);
    return response.json();
  }

  async load(): Promise<{ issue: number; state: State } | null> {
    const issue = await findIssueByTitle<Issue>(
      this.repository, title, (path) => this.api(path), "Duplicate monitor state",
    );
    if (!issue) return null;
    if (!Number.isSafeInteger(issue.number) || issue.number <= 0) throw new Error("Invalid issue number");
    return { issue: issue.number, state: parseState(issue.body) };
  }

  async create(state: State): Promise<void> {
    await this.api("/issues", "POST", { title, body: serializeState(state) });
  }

  async save(issue: number, state: State): Promise<void> {
    if (!Number.isSafeInteger(issue) || issue <= 0) throw new Error("Invalid issue number");
    await this.api(`/issues/${issue}`, "PATCH", { body: serializeState(state) });
  }
}

/** A single serialized workflow owns this state. A missing/unavailable state is never treated as healthy. */
export async function transition(
  store: EcosystemStateStore,
  action: "prepare" | "finish" | "release" | "resolve-delivered" | "resolve-retry",
  current?: string[],
): Promise<string[]> {
  const saved = await store.load();
  if (!saved) {
    if (action !== "prepare" || !current) throw new Error("Missing state");
    await store.create({ failed: current, phase: "idle" });
    return [];
  }
  const { issue, state } = saved;
  if (action === "resolve-delivered" || action === "resolve-retry") {
    if (state.phase !== "sending") throw new Error("No ambiguous delivery");
    await store.save(issue, action === "resolve-delivered"
      ? { failed: state.current, phase: "idle" }
      : { failed: state.failed, phase: "idle" });
    return [];
  }
  if (action === "prepare") {
    if (!current || state.phase !== "idle") throw new Error("Unresolved recovery delivery");
    const recovered = recoveredAppNames(state.failed, current);
    await store.save(issue, recovered.length
      ? { failed: state.failed, current, phase: "sending" }
      : { failed: current, phase: "idle" });
    return recovered;
  }
  if (state.phase !== "sending") throw new Error("No recovery in progress");
  await store.save(issue, action === "finish"
    ? { failed: state.current, phase: "idle" }
    : { failed: state.failed, phase: "idle" });
  return [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const action = process.argv[2] as Parameters<typeof transition>[1];
    if (!["prepare", "finish", "release", "resolve-delivered", "resolve-retry"].includes(action)) throw new Error("Invalid action");
    const store = new EcosystemStateStore(process.env.GITHUB_REPOSITORY || "", process.env.GH_TOKEN || "");
    let current: string[] | undefined;
    if (action === "prepare") {
      const report = JSON.parse(await readFile(process.env.ECOSYSTEM_HEALTH_REPORT || "", "utf8"));
      current = failedAppNames(report);
    }
    const recovered = await transition(store, action, current);
    if (action === "prepare") {
      await writeFile(process.env.ECOSYSTEM_RECOVERED_REPORT || "", JSON.stringify(recovered), { mode: 0o600 });
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `recovered=${recovered.length > 0}\n`);
      console.log(`[Ecosystem status] ${current!.length} aplikasi gagal, ${recovered.length} pulih.`);
    } else console.log("[Ecosystem status] Status pengiriman diperbarui.");
  } catch {
    console.error("[Ecosystem status] Status tidak dapat dipastikan atau disimpan; pengiriman pemulihan dihentikan.");
    process.exitCode = 1;
  }
}