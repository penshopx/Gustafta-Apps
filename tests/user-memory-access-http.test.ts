// Request-level regression coverage for per-user memory ownership and agent
// chat authorization. Uses the production access guard + MemStorage, without DB.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { MemStorage } from "../server/storage";
import { makeAgentAccessGuards } from "../server/lib/agent-access-guards";

const storage = new MemStorage();
let ownerId = "";
let collaboratorId = "";
let strangerId = "";
let privateAgentId = "";
let publicAgentId = "";
let server: Server;
let baseUrl = "";

const guards = makeAgentAccessGuards({
  getCollaboratorRole: (agentId, userId) => storage.getCollaboratorRole(agentId, userId),
  getDbRole: async () => "",
  adminUserIds: () => [],
});

function authShim(req: any, _res: any, next: any) {
  const userId = req.headers["x-test-user"];
  if (userId) req.user = { id: String(userId) };
  const emailUserId = req.headers["x-test-email-user"];
  if (emailUserId) {
    req.session = { emailUser: { id: String(emailUserId) } };
    // Production auth middleware hydrates email-session identity into req.user.
    req.user = { claims: { sub: String(emailUserId) } };
  }
  next();
}

function authenticated(req: any, res: any, next: any) {
  if (!req.user?.id && !req.user?.claims?.sub) return res.status(401).json({ error: "Unauthorized" });
  next();
}

async function resolveAccess(req: any, agentId: string) {
  const userId = req.user?.claims?.sub || req.user?.id || req.session?.emailUser?.id || "";
  if (!userId) return { ok: false as const, status: 401, error: "Unauthorized" };
  if (!/^\d+$/.test(agentId)) return { ok: false as const, status: 400, error: "Invalid agentId" };
  const agent = await storage.getAgent(agentId);
  if (!agent) return { ok: false as const, status: 404, error: "Agent not found" };
  const access = await guards.assertCanAccessAgentChat(req, agent);
  if (!access.ok) return { ok: false as const, status: access.status, error: access.error };
  return { ok: true as const, userId, agent };
}

const app = express();
app.use(express.json());
app.use(authShim);

app.get("/api/memories/:agentId", authenticated, async (req: any, res) => {
  const access = await resolveAccess(req, req.params.agentId);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  res.json(await storage.getUserMemories(req.params.agentId, req.query.sessionId, access.userId));
});

app.post("/api/memories", authenticated, async (req: any, res) => {
  const { agentId, sessionId, category, content } = req.body;
  if (!agentId || typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "agentId and content are required" });
  }
  const access = await resolveAccess(req, String(agentId));
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  res.json(await storage.createUserMemory({
    agentId: Number(access.agent.id),
    userId: access.userId,
    sessionId: typeof sessionId === "string" ? sessionId : "",
    category: typeof category === "string" && category ? category : "memory",
    content: content.trim(),
  }));
});

app.delete("/api/memories/agent/:agentId", authenticated, async (req: any, res) => {
  const access = await resolveAccess(req, req.params.agentId);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  res.json({
    success: await storage.deleteUserMemoriesByAgent(
      req.params.agentId, req.query.sessionId, access.userId,
    ),
  });
});

app.delete("/api/memories/:id", authenticated, async (req: any, res) => {
  const userId = req.user?.claims?.sub || req.user?.id || req.session?.emailUser?.id || "";
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = req.params.id as string;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: "Invalid memory id" });
  const memory = await storage.getUserMemoryById(id, userId);
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  const access = await resolveAccess(req, String(memory.agentId));
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  res.json({ success: await storage.deleteUserMemory(id, userId) });
});

before(async () => {
  const owner = await storage.createUser({ username: "memory-owner", password: "x", email: "memory-owner@example.com" } as any);
  const collaborator = await storage.createUser({ username: "memory-editor", password: "x", email: "memory-editor@example.com" } as any);
  const stranger = await storage.createUser({ username: "memory-stranger", password: "x", email: "memory-stranger@example.com" } as any);
  ownerId = owner.id;
  collaboratorId = collaborator.id;
  strangerId = stranger.id;
  const privateAgent = await storage.createAgent({ name: "Private memory agent", userId: ownerId, isPublic: false } as any);
  const publicAgent = await storage.createAgent({ name: "Public memory agent", userId: ownerId, isPublic: true } as any);
  // Production agents use serial ids; MemStorage defaults to UUIDs.
  (storage as any).agents.delete(privateAgent.id);
  privateAgent.id = "101";
  (storage as any).agents.set(privateAgent.id, privateAgent);
  (storage as any).agents.delete(publicAgent.id);
  publicAgent.id = "102";
  (storage as any).agents.set(publicAgent.id, publicAgent);
  privateAgentId = privateAgent.id;
  publicAgentId = publicAgent.id;
  await storage.addOrUpdateCollaborator({
    agentId: privateAgentId, userId: collaboratorId, role: "viewer", invitedBy: ownerId,
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function request(method: string, path: string, userId?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (userId?.startsWith("email-session:")) {
    headers["x-test-email-user"] = userId.slice("email-session:".length);
  } else if (userId) {
    headers["x-test-user"] = userId;
  }
  if (body) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("private and shared memories are isolated per authenticated user", async () => {
  const created = await request("POST", "/api/memories", ownerId, {
    agentId: privateAgentId, sessionId: "same-caller-chosen-session", content: "owner only",
  });
  assert.equal(created.status, 200);
  const ownerMemory = await created.json() as { id: number; userId: string };
  assert.equal(ownerMemory.userId, ownerId);

  assert.equal((await request("GET", `/api/memories/${privateAgentId}`, strangerId)).status, 403);
  const collaboratorRead = await request("GET", `/api/memories/${privateAgentId}`, collaboratorId);
  assert.equal(collaboratorRead.status, 200);
  assert.deepEqual(await collaboratorRead.json(), []);

  const collaboratorCreate = await request("POST", "/api/memories", collaboratorId, {
    agentId: privateAgentId, sessionId: "same-caller-chosen-session", content: "collaborator only",
  });
  assert.equal(collaboratorCreate.status, 200);
  assert.deepEqual(
    (await (await request("GET", `/api/memories/${privateAgentId}`, ownerId)).json() as any[])
      .map((memory) => memory.content),
    ["owner only"],
  );
});

test("public agent memories are also partitioned by user", async () => {
  assert.equal((await request("POST", "/api/memories", ownerId, {
    agentId: publicAgentId, sessionId: "visitor-session", content: "owner public memory",
  })).status, 200);
  assert.equal((await request("POST", "/api/memories", strangerId, {
    agentId: publicAgentId, sessionId: "visitor-session", content: "stranger public memory",
  })).status, 200);
  const read = await request("GET", `/api/memories/${publicAgentId}?sessionId=visitor-session`, ownerId);
  assert.deepEqual((await read.json() as any[]).map((memory) => memory.content), ["owner public memory"]);
  assert.equal((await request("GET", `/api/memories/${publicAgentId}`)).status, 401);
});

test("email-session identity remains the owner of saved and loaded memories", async () => {
  const emailUser = await storage.createUser({
    username: "memory-email-session", password: "x", email: "memory-email-session@example.com",
  } as any);
  const emailPrincipal = `email-session:${emailUser.id}`;
  const response = await request("POST", "/api/memories", emailPrincipal, {
    agentId: publicAgentId, sessionId: "email-chat-session", content: "email user memory",
  });
  assert.equal(response.status, 200);
  const memory = await response.json() as { userId: string };
  assert.equal(memory.userId, emailUser.id);
  assert.deepEqual(
    (await (await request(
      "GET", `/api/memories/${publicAgentId}?sessionId=email-chat-session`, emailPrincipal,
    )).json() as any[]).map((item) => item.content),
    ["email user memory"],
  );
  assert.deepEqual(
    await (await request("GET", `/api/memories/${publicAgentId}?sessionId=email-chat-session`, strangerId)).json(),
    [],
  );
});

test("memory deletion cannot cross user ownership or agent chat access", async () => {
  const response = await request("POST", "/api/memories", ownerId, {
    agentId: privateAgentId, sessionId: "delete-test", content: "protected memory",
  });
  const memory = await response.json() as { id: number };
  assert.equal((await request("DELETE", `/api/memories/${memory.id}`, strangerId)).status, 404);
  assert.deepEqual(
    (await (await request("GET", `/api/memories/${privateAgentId}?sessionId=delete-test`, ownerId)).json() as any[])
      .map((item) => item.content),
    ["protected memory"],
  );
  assert.equal((await request("DELETE", `/api/memories/${memory.id}`, ownerId)).status, 200);
  assert.deepEqual(await (await request("GET", `/api/memories/${privateAgentId}?sessionId=delete-test`, ownerId)).json(), []);

  assert.equal((await request("DELETE", `/api/memories/agent/${privateAgentId}`, strangerId)).status, 403);
  assert.equal((await request("DELETE", `/api/memories/agent/${privateAgentId}`, collaboratorId)).status, 200);
});

test("legacy owner-null rows remain inaccessible and undeletable", async () => {
  const legacy = await storage.createUserMemory({
    agentId: Number(privateAgentId),
    userId: null,
    sessionId: ownerId,
    category: "memory",
    content: "legacy row",
  });
  assert.equal((await request("GET", `/api/memories/${privateAgentId}?sessionId=${ownerId}`, ownerId)).status, 200);
  assert.equal((await storage.getUserMemories(privateAgentId, ownerId, ownerId))
    .some((memory) => memory.id === legacy.id), false);
  assert.equal((await request("DELETE", `/api/memories/${legacy.id}`, ownerId)).status, 404);
});