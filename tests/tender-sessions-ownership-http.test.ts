import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const {
  authorizeTenderAgentForWizard,
  registerCompanyProfileRoutes,
  registerTenderSessionRoutes,
} = await import("../server/tender-session-routes");
const ownerId = "tender-owner";
const otherId = "tender-other";

let server: Server;
let baseUrl = "";
let tenderPrivateContextReads = 0;
const sessions = new Map<number, any>([
  [12, { id: 12, userId: ownerId, companyProfileId: 7, status: "draft" }],
  [13, { id: 13, userId: otherId, companyProfileId: null, status: "draft" }],
]);
const companyProfiles = new Map<number, any>([
  [7, { id: 7, userId: ownerId, name: "Owner Company" }],
  [8, { id: 8, userId: otherId, name: "Other Company" }],
]);
const fakeStorage = {
  getTenderSessions: async (userId: string) => [...sessions.values()].filter((row) => row.userId === userId),
  getTenderSession: async (id: number, userId: string) => {
    const row = sessions.get(id);
    return row?.userId === userId ? row : undefined;
  },
  createTenderSession: async (data: any) => {
    const row = { id: 20, ...data };
    sessions.set(row.id, row);
    return row;
  },
  updateTenderSession: async (id: number, userId: string, data: any) => {
    const row = sessions.get(id);
    if (!row || row.userId !== userId) return undefined;
    const updated = { ...row, ...data };
    sessions.set(id, updated);
    return updated;
  },
  deleteTenderSession: async (id: number, userId: string) => {
    const row = sessions.get(id);
    return row?.userId === userId ? sessions.delete(id) : false;
  },
  getCompanyProfiles: async (userId: string) =>
    [...companyProfiles.values()].filter((profile) => profile.userId === userId),
  getCompanyProfile: async (id: number, userId: string) => {
    const profile = companyProfiles.get(id);
    return profile?.userId === userId ? profile : undefined;
  },
  createCompanyProfile: async (data: any) => {
    const profile = { id: 9, ...data };
    companyProfiles.set(profile.id, profile);
    return profile;
  },
  updateCompanyProfile: async (id: number, userId: string, data: any) => {
    const profile = companyProfiles.get(id);
    if (!profile || profile.userId !== userId) return undefined;
    const updated = { ...profile, ...data };
    companyProfiles.set(id, updated);
    return updated;
  },
  deleteCompanyProfile: async (id: number, userId: string) => {
    const profile = companyProfiles.get(id);
    return profile?.userId === userId ? companyProfiles.delete(id) : false;
  },
} as any;

async function request(path: string, method = "GET", identity?: { type: "oidc" | "email"; id: string }, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(identity ? { "x-test-identity": identity.type, "x-test-user": identity.id } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json() as any };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, res, next) => {
    const id = req.headers["x-test-user"];
    const type = req.headers["x-test-identity"];
    if (!id || !type) return res.status(401).json({ error: "Unauthorized" });
    if (type === "email") req.session = { emailUser: { id } };
    else req.user = { claims: { sub: id } };
    next();
  });
  registerCompanyProfileRoutes(app, fakeStorage, ((_req: any, _res: any, next: any) => next()) as any);
  registerTenderSessionRoutes(app, fakeStorage, ((_req: any, _res: any, next: any) => next()) as any);
  app.post("/api/ai/tender-wizard", async (req: any, res) => {
    const authorized = await authorizeTenderAgentForWizard(req, req.body.agentId, {
      getAgent: async (agentId) => agentId === "private-agent" ? { id: agentId, userId: ownerId } : undefined,
      assertCanAccessAgentChat: async (request, agent) =>
        request.headers["x-test-user"] === agent.userId
          ? { ok: true }
          : { ok: false, status: 403, error: "Forbidden" },
    });
    if (!authorized.ok) return res.status(authorized.status).json({ error: authorized.error });
    if (authorized.agent) tenderPrivateContextReads += 1;
    res.json({ ok: true });
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("tender list/detail enforce OIDC and email identity ownership", async () => {
  const list = await request("/api/tender-sessions", "GET", { type: "oidc", id: ownerId });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.map((row: any) => row.id), [12]);

  const emailDetail = await request("/api/tender-sessions/12", "GET", { type: "email", id: ownerId });
  assert.equal(emailDetail.status, 200);
  const foreignDetail = await request("/api/tender-sessions/13", "GET", { type: "oidc", id: ownerId });
  assert.equal(foreignDetail.status, 404);
  assert.equal((await request("/api/tender-sessions/12")).status, 401);
});

test("tender create/change validates company-profile ownership and patch fields", async () => {
  const forgedCreate = await request("/api/tender-sessions", "POST", { type: "oidc", id: ownerId }, {
    companyProfileId: 8,
  });
  assert.equal(forgedCreate.status, 400);

  const invalidId = await request("/api/tender-sessions", "POST", { type: "email", id: ownerId }, {
    companyProfileId: -1,
  });
  assert.equal(invalidId.status, 400);

  const created = await request("/api/tender-sessions", "POST", { type: "email", id: ownerId }, {
    userId: otherId,
    companyProfileId: 7,
    tenderProfile: { packageName: "Paket" },
  });
  assert.equal(created.status, 400);

  const validCreate = await request("/api/tender-sessions", "POST", { type: "email", id: ownerId }, {
    companyProfileId: 7,
    tenderProfile: { packageName: "Paket" },
  });
  assert.equal(validCreate.status, 201);
  assert.equal(validCreate.json.userId, ownerId);

  const changedToForeign = await request("/api/tender-sessions/12", "PATCH", { type: "oidc", id: ownerId }, {
    companyProfileId: 8,
  });
  assert.equal(changedToForeign.status, 400);
  const forbiddenField = await request("/api/tender-sessions/12", "PATCH", { type: "oidc", id: ownerId }, {
    userId: otherId,
    status: "completed",
  });
  assert.equal(forbiddenField.status, 400);
  assert.equal(sessions.get(12)?.userId, ownerId);
  assert.equal(sessions.get(12)?.status, "draft");
});

test("tender update/delete by foreign identity return 404 and don't mutate", async () => {
  const patch = await request("/api/tender-sessions/13", "PATCH", { type: "email", id: ownerId }, {
    status: "completed",
  });
  const deletion = await request("/api/tender-sessions/13", "DELETE", { type: "oidc", id: ownerId });
  assert.equal(patch.status, 404);
  assert.equal(deletion.status, 404);
  assert.equal(sessions.get(13)?.userId, otherId);
  assert.equal(sessions.get(13)?.status, "draft");
});

test("company-profile CRUD scopes identity and applies a validated create/patch allowlist", async () => {
  const ownerList = await request("/api/company-profiles", "GET", { type: "oidc", id: ownerId });
  assert.equal(ownerList.status, 200);
  assert.deepEqual(ownerList.json.map((profile: any) => profile.id), [7]);

  const ownerDetail = await request("/api/company-profiles/7", "GET", { type: "email", id: ownerId });
  assert.equal(ownerDetail.status, 200);
  const foreignDetail = await request("/api/company-profiles/8", "GET", { type: "oidc", id: ownerId });
  assert.equal(foreignDetail.status, 404);
  const foreignPatch = await request("/api/company-profiles/8", "PATCH", { type: "email", id: ownerId }, {
    name: "IDOR update",
  });
  const foreignDelete = await request("/api/company-profiles/8", "DELETE", { type: "oidc", id: ownerId });
  assert.equal(foreignPatch.status, 404);
  assert.equal(foreignDelete.status, 404);
  assert.equal(companyProfiles.get(8)?.name, "Other Company");

  const forgedCreate = await request("/api/company-profiles", "POST", { type: "oidc", id: ownerId }, {
    name: "Forged company",
    userId: otherId,
  });
  const invalidCreate = await request("/api/company-profiles", "POST", { type: "email", id: ownerId }, {
    name: "",
  });
  assert.equal(forgedCreate.status, 400);
  assert.equal(invalidCreate.status, 400);

  const created = await request("/api/company-profiles", "POST", { type: "email", id: ownerId }, {
    name: "Created company",
    businessType: "PT",
    experiences: [{ projectName: "Project", year: "2024", role: "Contractor", summary: "Works" }],
    personnel: [{
      name: "Person",
      position: "Engineer",
      education: "",
      certifications: [{ name: "SKK", issuer: "" }],
      experiences: [],
      competencies: [],
    }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.userId, ownerId);

  const forgedPatch = await request("/api/company-profiles/7", "PATCH", { type: "oidc", id: ownerId }, {
    userId: otherId,
    name: "Owner reassignment",
  });
  assert.equal(forgedPatch.status, 400);
  const ownerPatch = await request("/api/company-profiles/7", "PATCH", { type: "email", id: ownerId }, {
    name: "Owner Company Revised",
  });
  assert.equal(ownerPatch.status, 200);
  assert.equal(ownerPatch.json.name, "Owner Company Revised");
  assert.equal((await request("/api/company-profiles/7", "DELETE", { type: "oidc", id: ownerId })).status, 200);
  assert.equal((await request("/api/company-profiles")).status, 401);
});

test("tender wizard denies private agent context before KB/Project Brain reads", async () => {
  tenderPrivateContextReads = 0;
  const denied = await request("/api/ai/tender-wizard", "POST", { type: "oidc", id: otherId }, {
    agentId: "private-agent",
  });
  assert.equal(denied.status, 403);
  assert.equal(tenderPrivateContextReads, 0);

  const authorized = await request("/api/ai/tender-wizard", "POST", { type: "email", id: ownerId }, {
    agentId: "private-agent",
  });
  assert.equal(authorized.status, 200);
  assert.equal(tenderPrivateContextReads, 1);
});