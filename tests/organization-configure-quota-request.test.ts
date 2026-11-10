import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  organizationBlueprintSchema,
  createEmptyOrgMember,
  type OrganizationBlueprint,
} from "../shared/blueprint/organization-blueprint-schema.ts";
import { registerOrganizationEngineRoutes } from "../server/organization-engine-routes.ts";

function buildOrg(): OrganizationBlueprint {
  const lead = createEmptyOrgMember("lead", "orchestrator", "Lead");
  lead.blueprint.modules.identity.data.name = "Lead agent";
  const specialist = createEmptyOrgMember("specialist", "specialist", "Specialist");
  specialist.blueprint.modules.identity.data.name = "Specialist agent";
  const support = createEmptyOrgMember("support", "support", "Support");
  support.blueprint.modules.identity.data.name = "Support agent";
  return organizationBlueprintSchema.parse({
    meta: { schemaVersion: "1.0.0", status: "draft", name: "Test organization" },
    members: [lead, specialist, support],
    structure: {
      leadLocalId: "lead",
      edges: [
        { fromLocalId: "lead", toLocalId: "specialist", role: "SPECIALIST" },
        { fromLocalId: "lead", toLocalId: "support", role: "SUPPORT" },
      ],
    },
    overallConfidence: 0,
  });
}

type SharedFakeDatabase = {
  state: { agents: any[]; children: any[]; seq: number; txCalls: number; quotaReads: number };
  advisoryLocks: Map<string, Promise<void>>;
};

function makeStorage(
  options: { count?: number; limit?: number; subscription?: any } = {},
  shared: SharedFakeDatabase = {
    state: { agents: [], children: [], seq: 0, txCalls: 0, quotaReads: 0 },
    advisoryLocks: new Map(),
  },
) {
  const { state, advisoryLocks } = shared;
  const base = {
    async getAgentBySlug() { return undefined; },
    async createAgent(agent: any) {
      const created = { ...agent, id: ++state.seq };
      state.agents.push(created);
      return created;
    },
    async updateAgent(id: string, data: any) {
      const agent = state.agents.find((row) => String(row.id) === String(id));
      if (!agent) return undefined;
      Object.assign(agent, data);
      return agent;
    },
    async createKnowledgeBase(data: any) { state.children.push(data); return data; },
    async createMiniApp(data: any) { state.children.push(data); return data; },
    async createIntegration(data: any) { state.children.push(data); return data; },
    async createProjectBrainTemplate(data: any) { state.children.push(data); return data; },
    async getActiveSubscription() {
      state.quotaReads++;
      return options.subscription === undefined
        ? { status: "active", chatbotLimit: options.limit ?? 3 }
        : options.subscription;
    },
    async countUserAgents(userId: string) {
      state.quotaReads++;
      return (options.count ?? 0) + state.agents.filter((agent) => agent.userId === userId).length;
    },
  };
  const storage = {
    ...base,
    async runInTransaction(fn: (storage: any) => Promise<any>) {
      state.txCalls++;
      const snapshot = {
        agents: structuredClone(state.agents),
        children: structuredClone(state.children),
        seq: state.seq,
      };
      try {
        return await fn(base);
      } catch (error) {
        state.agents = snapshot.agents;
        state.children = snapshot.children;
        state.seq = snapshot.seq;
        throw error;
      }
    },
    async withAgentQuotaLock(userId: string, fn: (storage: any) => Promise<any>) {
      const previous = advisoryLocks.get(userId) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => { release = resolve; });
      advisoryLocks.set(userId, current);
      await previous;
      try {
        return await storage.runInTransaction((tx: any) => fn({
          ...tx,
          getActiveSubscription: base.getActiveSubscription,
          countUserAgents: base.countUserAgents,
        }));
      } finally {
        release();
        if (advisoryLocks.get(userId) === current) advisoryLocks.delete(userId);
      }
    },
  };
  return { storage, state, shared };
}

function register(storage: any) {
  let configure: any;
  const app = {
    post(path: string, ...handlers: any[]) {
      if (path === "/api/organization/configure") configure = handlers.at(-1);
    },
    get() {},
    put() {},
    delete() {},
  };
  registerOrganizationEngineRoutes(app as any, { storage });
  return async (body: any, userId = "quota-user") => {
    let status = 200;
    let payload: any;
    await configure(
      { body, user: { claims: { sub: userId } } },
      {
        status(code: number) { status = code; return this; },
        json(data: any) { payload = data; return this; },
      },
    );
    return { status, payload };
  };
}

test("POST configure dryRun default never reads quota or writes", async () => {
  const { storage, state } = makeStorage({ count: 3, limit: 3 });
  const response = await register(storage)({ organization: buildOrg() });
  assert.equal(response.status, 200);
  assert.equal(response.payload.dryRun, true);
  assert.equal(state.txCalls, 0);
  assert.equal(state.quotaReads, 0);
  assert.equal(state.agents.length, 0);
});

test("POST configure rejects the whole mapped team if member quota is insufficient", async () => {
  const { storage, state } = makeStorage({ count: 2, limit: 3 });
  const response = await register(storage)({ organization: buildOrg(), dryRun: false });
  assert.equal(response.status, 403);
  assert.equal(response.payload.code, "LIMIT_REACHED");
  assert.equal(response.payload.currentCount, 2);
  assert.equal(response.payload.requestedCount, 3);
  assert.equal(state.txCalls, 1);
  assert.equal(state.agents.length, 0);
});

test("POST configure requires an active subscription for non-admin users", async () => {
  const { storage, state } = makeStorage({ subscription: null });
  const response = await register(storage)({ organization: buildOrg(), dryRun: false });
  assert.equal(response.status, 403);
  assert.equal(response.payload.reason, "dialog_required");
  assert.equal(state.txCalls, 1);
  assert.equal(state.agents.length, 0);
});

test("POST configure admin bypasses subscription and quota and stamps every agent", async () => {
  const { storage, state } = makeStorage({ count: 9, limit: 1, subscription: null });
  const previousAdmins = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = "quota-admin";
  try {
    const response = await register(storage)({ organization: buildOrg(), dryRun: false }, "quota-admin");
    assert.equal(response.status, 200);
    assert.equal(response.payload.applied, true);
    assert.equal(state.agents.length, 3);
    assert.ok(state.agents.every((agent) => agent.userId === "quota-admin"));
    assert.equal(state.quotaReads, 0);
  } finally {
    if (previousAdmins === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = previousAdmins;
  }
});

test("concurrent team materializations serialize quota consumption per user", async () => {
  const shared: SharedFakeDatabase = {
    state: { agents: [], children: [], seq: 0, txCalls: 0, quotaReads: 0 },
    advisoryLocks: new Map(),
  };
  // Separate adapters model independently scaled application workers sharing
  // only the database-backed advisory-lock namespace.
  const workerA = makeStorage({ count: 0, limit: 3 }, shared);
  const workerB = makeStorage({ count: 0, limit: 3 }, shared);
  const requestA = register(workerA.storage);
  const requestB = register(workerB.storage);
  const responses = await Promise.all([
    requestA({ organization: buildOrg(), dryRun: false }),
    requestB({ organization: buildOrg(), dryRun: false }),
  ]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(responses.filter((response) => response.status === 403).length, 1);
  assert.equal(shared.state.agents.length, 3);
  assert.equal(shared.state.txCalls, 2);
});

test("single-agent and team creation share the same cross-worker lock", async () => {
  const shared: SharedFakeDatabase = {
    state: { agents: [], children: [], seq: 0, txCalls: 0, quotaReads: 0 },
    advisoryLocks: new Map(),
  };
  const teamWorker = makeStorage({ count: 0, limit: 3 }, shared);
  const singleWorker = makeStorage({ count: 0, limit: 3 }, shared);
  const teamRequest = register(teamWorker.storage);

  const [teamResponse, singleOutcome] = await Promise.all([
    teamRequest({ organization: buildOrg(), dryRun: false }),
    singleWorker.storage.withAgentQuotaLock("quota-user", async (tx: any) => {
      const subscription = await tx.getActiveSubscription("quota-user");
      const currentCount = await tx.countUserAgents("quota-user");
      if (!subscription || currentCount >= (subscription.chatbotLimit || 3)) return "quota-denied";
      await tx.createAgent({ userId: "quota-user", name: "single agent" });
      return "created";
    }),
  ]);

  assert.ok(shared.state.agents.length <= 3, "shared lock must prevent team + single oversubscription");
  assert.ok(teamResponse.status === 200 || teamResponse.status === 403);
  assert.ok(singleOutcome === "created" || singleOutcome === "quota-denied");
  if (teamResponse.status === 200) assert.equal(singleOutcome, "quota-denied");
  if (singleOutcome === "created") assert.equal(teamResponse.status, 403);
});

test("production quota lock is PostgreSQL transaction-scoped and single-agent creation uses it", () => {
  const root = resolve(process.cwd());
  const dbStorage = readFileSync(resolve(root, "server/db-storage.ts"), "utf8");
  const route = readFileSync(resolve(root, "server/routes.ts"), "utf8");
  assert.match(dbStorage, /pg_advisory_xact_lock\(1397051217, hashtext\(\$\{userId\}\)\)/);
  assert.match(dbStorage, /withAgentQuotaLock[\s\S]*?db\.transaction\(async \(tx\)[\s\S]*?tx\.execute\(sql`SELECT pg_advisory_xact_lock/);
  const lockImplementation = dbStorage.slice(
    dbStorage.indexOf("async withAgentQuotaLock"),
    dbStorage.indexOf("async incrementTrialMessages", dbStorage.indexOf("async withAgentQuotaLock")),
  );
  assert.ok(lockImplementation.indexOf("tx.execute(sql`SELECT pg_advisory_xact_lock") < lockImplementation.indexOf("tx.select().from(subscriptionsTable)"));
  assert.ok(lockImplementation.indexOf("tx.execute(sql`SELECT pg_advisory_xact_lock") < lockImplementation.indexOf(".from(agents)"));
  assert.match(lockImplementation, /this\.createAgent\(agent, tx\)/);
  const createRoute = route.slice(route.indexOf('app.post("/api/agents"'), route.indexOf('app.post("/api/agents"') + 15000);
  assert.match(createRoute, /storage\.withAgentQuotaLock\(userId/);
  assert.match(createRoute, /quotaTx\.countUserAgents\(userId\)/);
  assert.match(createRoute, /quotaTx\.createAgent\(\{\s*\.\.\.parsed\.data,\s*userId\s*\}/);
  assert.ok(createRoute.indexOf("storage.withAgentQuotaLock(userId") < createRoute.indexOf("quotaTx.getActiveSubscription(userId)"));
  assert.ok(createRoute.indexOf("quotaTx.getActiveSubscription(userId)") < createRoute.indexOf("quotaTx.countUserAgents(userId)"));
  assert.ok(createRoute.indexOf("quotaTx.countUserAgents(userId)") < createRoute.indexOf("quotaTx.createAgent("));
});