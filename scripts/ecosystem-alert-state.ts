/**
 * Durable weekly alert claims. A claim is never equivalent to confirmed delivery:
 * "sending" blocks unattended retries until an operator verifies the email.
 * Issues contain only a fixed category, week, digest and delivery phase.
 */
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { findIssueByTitle } from "./ecosystem-issue-lookup";

const keyPattern = /^ecosystem-(?:alert-\d{4}-W\d{2}-[a-f0-9]{64}|(?:browser|network)-alert-\d{4}-W\d{2}|watchdog-(?:failed|missed)-\d{4}-\d{2}-\d{2})$/;
const prefix = "Ecosystem alert delivery: ";
type Phase = "sending" | "sent";
type Issue = { number: number; title: string; body: string; pull_request?: unknown };
type Transport = (url: string, init?: RequestInit) => Promise<Response>;

export function validateAlertKey(key: string): void {
  if (!keyPattern.test(key)) throw new Error("Invalid alert key");
}

export class AlertState {
  constructor(private repository: string, private token: string, private transport: Transport = fetch) {
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
    if (!response.ok) throw new Error("GitHub alert state unavailable");
    return response.json();
  }

  private async find(key: string): Promise<Issue | undefined> {
    const title = prefix + key;
    const found = await findIssueByTitle<Issue>(
      this.repository, title, (path) => this.api(path), "Duplicate alert state",
    );
    if (found && (!Number.isSafeInteger(found.number) || found.number <= 0 ||
      !["sending", "sent"].includes(found.body))) throw new Error("Invalid alert state");
    return found;
  }

  async claim(key: string): Promise<boolean> {
    validateAlertKey(key);
    if (await this.find(key)) return false;
    const created = await this.api("/issues", "POST", { title: prefix + key, body: "sending" });
    if (!created || !Number.isSafeInteger(created.number) || created.number <= 0 ||
        created.title !== prefix + key || created.body !== "sending") {
      throw new Error("Invalid alert claim");
    }
    return true;
  }

  async finish(key: string): Promise<void> {
    validateAlertKey(key);
    const issue = await this.find(key);
    if (!issue || issue.body !== "sending") throw new Error("Missing alert claim");
    await this.api(`/issues/${issue.number}`, "PATCH", { body: "sent" });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const action = process.argv[2];
    const key = process.env.ALERT_KEY || "";
    const state = new AlertState(process.env.GITHUB_REPOSITORY || "", process.env.GH_TOKEN || "");
    if (action === "claim") {
      const send = await state.claim(key);
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `send=${send}\n`);
      console.log(send ? "Alert claim saved." : "Alert already claimed; no duplicate email.");
    } else if (action === "finish") {
      await state.finish(key);
      console.log("Alert delivery recorded.");
    } else throw new Error("Invalid action");
  } catch {
    console.error("Alert delivery state unavailable; automatic delivery stopped.");
    process.exitCode = 1;
  }
}