import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { withAgentCreationQuota } from "../server/lib/agent-quota.ts";

test("quota helper gates requested team size under shared worker lock", async () => {
  const shared = {
    agents: [] as Array<{ userId: string }>,
    locks: new Map<string, Promise<void>>(),
  };
  const makeWorker = () => ({
    async withAgentQuotaLock<T>(userId: string, fn: (tx: any) => Promise<T>) {
      const previous = shared.locks.get(userId) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => { release = resolve; });
      shared.locks.set(userId, current);
      await previous;
      try {
        return await fn({
          async getActiveSubscription() { return { status: "active", chatbotLimit: 3 }; },
          async countUserAgents(ownerId: string) {
            return shared.agents.filter((agent) => agent.userId === ownerId).length;
          },
          async createAgent(agent: { userId: string }) {
            shared.agents.push(agent);
            return { ...agent, id: shared.agents.length };
          },
        });
      } finally {
        release();
        if (shared.locks.get(userId) === current) shared.locks.delete(userId);
      }
    },
  });
  const [teamResult, importResult] = await Promise.all([
    withAgentCreationQuota(makeWorker(), "owner-1", 3, false, async (tx) => {
      for (let i = 0; i < 3; i++) await tx.createAgent({ userId: "owner-1" });
      return "team-created";
    }),
    withAgentCreationQuota(makeWorker(), "owner-1", 1, false, async (tx) => {
      await tx.createAgent({ userId: "owner-1" });
      return "import-created";
    }),
  ]);
  assert.equal(shared.agents.length, 3);
  assert.equal(Number(teamResult.allowed) + Number(importResult.allowed), 1);
});

test("all named user-facing alternate creation routes use the shared gate and owner stamp", () => {
  const routes = readFileSync(resolve(process.cwd(), "server/routes.ts"), "utf8");
  const blueprintRoutes = readFileSync(resolve(process.cwd(), "server/blueprint-engine-routes.ts"), "utf8");
  const slice = (source: string, start: string, end: string) => {
    const startAt = source.indexOf(start);
    assert.notEqual(startAt, -1, `route missing: ${start}`);
    const endAt = source.indexOf(end, startAt + start.length);
    assert.notEqual(endAt, -1, `route terminator missing: ${end}`);
    return source.slice(startAt, endAt);
  };

  const templateCreate = slice(routes, 'app.post("/api/templates/:id/create-agent"', 'app.get("/api/agents/:id/export"');
  assert.match(templateCreate, /withAgentCreationQuota/);
  assert.match(templateCreate, /tx\.createAgent\(\{\s*\.\.\.agentData,\s*userId\s*\}/);

  const configImport = slice(routes, 'app.post("/api/agents/import"', 'app.post(\n    "/api/agents/import-document"');
  assert.match(configImport, /withAgentCreationQuota/);
  assert.match(configImport, /\.\.\.config\.agent[\s\S]*?userId,/);
  assert.match(configImport, /tx\.createKnowledgeBase/);

  const tutorTeam = slice(routes, 'app.post("/api/tutor-builder/create-team"', 'app.get("/api/tutor-builder/teams"');
  assert.match(tutorTeam, /withAgentCreationQuota/);
  assert.match(tutorTeam, /blueprint\.specialists\.length \+ 1/);
  assert.match(tutorTeam, /tx\.createAgent/);

  const chatbotTemplateUse = slice(routes, 'app.post("/api/chatbot-templates/:id/use"', 'app.delete("/api/chatbot-templates/:id"');
  assert.match(chatbotTemplateUse, /withAgentCreationQuota/);
  assert.match(chatbotTemplateUse, /userId,/);
  assert.match(chatbotTemplateUse, /tx\.createKnowledgeBase/);

  const blueprintConfigure = slice(blueprintRoutes, '"/api/blueprint/configure"', '"/api/blueprint/certificate/share"');
  assert.match(blueprintConfigure, /mode === "create" && !dryRun/);
  assert.match(blueprintConfigure, /withAgentCreationQuota/);
  assert.match(blueprintConfigure, /storage:\s*txStorage/);
});