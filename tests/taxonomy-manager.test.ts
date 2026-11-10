import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MemStorage } from "../server/storage";
import { registerTaxonomyAdminRoutes, validateTaxonomyHierarchy } from "../server/taxonomy-admin-routes";
import type { KnowledgeTaxonomyTreeNode } from "../shared/schema";

test("taxonomy hierarchy rejects mismatched parent and cycles", () => {
  const child: KnowledgeTaxonomyTreeNode = {
    id: 2, name: "Child", slug: "child", level: "subsektor", parentId: 1,
    description: "", sortOrder: 0, isActive: true, createdAt: "", children: [],
  };
  const parent: KnowledgeTaxonomyTreeNode = {
    ...child, id: 1, name: "Parent", slug: "parent", level: "sektor", parentId: null, children: [child],
  };
  assert.match(validateTaxonomyHierarchy([parent], { level: "topik", parentId: 1 })!, /induk/);
  assert.match(validateTaxonomyHierarchy([parent], { level: "sektor", parentId: 2 }, 1)!, /induk/);
  assert.match(validateTaxonomyHierarchy([parent], { level: "subsektor", parentId: 2 }, 1)!, /dirinya|turunannya/);
  assert.equal(validateTaxonomyHierarchy([parent], { level: "subsektor", parentId: 1 }), null);
});

test("admin manages taxonomy through HTTP; stale usage prevents deletion", async () => {
  const storage = new MemStorage();
  const app = express();
  app.use(express.json());
  const auth: express.RequestHandler = (req, res, next) => {
    if (!req.header("x-role")) return res.status(401).json({ error: "Login required" });
    if (req.header("x-role") !== "missing-actor") req.user = { id: "session-admin" } as any;
    next();
  };
  const admin: express.RequestHandler = (req, res, next) =>
    ["admin", "missing-actor"].includes(req.header("x-role") ?? "") ? next() : res.status(403).json({ error: "Admin only" });
  registerTaxonomyAdminRoutes(app, storage, auth, admin);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (method: string, path: string, role?: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(role ? { "x-role": role } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    const path = "/api/taxonomy";
    assert.equal((await request("GET", `${path}/usage`)).status, 401);
    assert.equal((await request("GET", `${path}/usage`, "user")).status, 403);
    assert.equal((await request("POST", path, "user", { name: "A", slug: "a" })).status, 403);
    assert.equal((await request("POST", path, "missing-actor", { name: "A", slug: "a" })).status, 401);
    assert.equal((await request("POST", path, "admin", { name: "Child", slug: "child", level: "topik" })).status, 400);
    const created = await request("POST", path, "admin", { name: "Sektor Baru", slug: "sektor-baru", level: "sektor", actorId: "spoofed" });
    assert.equal(created.status, 201);
    const id = created.body.id as number;
    const endpoint = `${path}/${id}`;
    assert.equal((await request("GET", `${endpoint}/history`)).status, 401);
    assert.equal((await request("GET", `${endpoint}/history`, "user")).status, 403);
    assert.equal((await request("GET", `${endpoint}/history?beforeId=invalid`, "admin")).status, 400);
    assert.equal((await request("PATCH", endpoint, "user", { name: "Hijacked" })).status, 403);
    const edited = await request("PATCH", endpoint, "admin", { name: "Diganti" });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.name, "Diganti");
    assert.equal((await request("PATCH", endpoint, "admin", { name: "Diganti" })).status, 200);
    assert.equal((await request("PATCH", endpoint, "admin", {})).status, 200);
    const child = await request("POST", path, "admin", { name: "Sub", slug: "sub", level: "subsektor", parentId: id });
    assert.equal(child.status, 201);
    assert.equal((await request("DELETE", endpoint, "admin", { confirmedUsageCount: 0 })).status, 409);
    assert.equal((await request("DELETE", `${path}/${child.body.id}`, "user", { confirmedUsageCount: 0 })).status, 403);
    const kb = await storage.createKnowledgeBase({
      agentId: "agent-test", name: "Dokumen", type: "text", content: "Isi dokumen tetap ada",
      taxonomyId: child.body.id,
    });
    assert.equal((await request("GET", `${path}/usage`, "admin")).body[child.body.id], 1);
    assert.equal((await request("DELETE", `${path}/${child.body.id}`, "admin", { confirmedUsageCount: 0 })).status, 409);
    assert.equal((await storage.getKnowledgeBases("agent-test")).find(item => item.id === kb.id)?.taxonomyId, child.body.id);
    assert.equal((await request("DELETE", `${path}/${child.body.id}`, "admin")).status, 409);
    assert.equal((await request("DELETE", `${path}/${child.body.id}`, "admin", { confirmedUsageCount: 1 })).status, 200);
    assert.equal((await storage.getKnowledgeBases("agent-test")).find(item => item.id === kb.id)?.taxonomyId, null);
    assert.equal((await storage.getKnowledgeBases("agent-test")).find(item => item.id === kb.id)?.content, "Isi dokumen tetap ada");
    assert.equal((await request("DELETE", endpoint, "admin", { confirmedUsageCount: 0 })).status, 200);
    assert.equal((await request("DELETE", endpoint, "admin", { confirmedUsageCount: 0 })).status, 404);
    const history = (await request("GET", `${endpoint}/history`, "admin")).body;
    assert.deepEqual(history.map((entry: any) => entry.action), ["delete", "update", "create"]);
    for (const entry of history) {
      assert.equal(entry.actorId, "session-admin");
      assert.ok(!Number.isNaN(Date.parse(entry.createdAt)));
      assert.equal(entry.taxonomyId, id);
    }
    assert.equal(history[2].before, null);
    assert.equal(history[2].after.name, "Sektor Baru");
    assert.equal(history[1].before.name, "Sektor Baru");
    assert.equal(history[1].after.name, "Diganti");
    assert.equal(history[0].before.name, "Diganti");
    assert.equal(history[0].after, null);
    const older = (await request("GET", `${endpoint}/history?beforeId=${history[0].id}`, "admin")).body;
    assert.deepEqual(older.map((entry: any) => entry.action), ["update", "create"]);
    const childHistory = (await request("GET", `${path}/${child.body.id}/history`, "admin")).body;
    assert.deepEqual(childHistory.map((entry: any) => entry.action), ["delete", "create"]);
    assert.ok(!JSON.stringify(childHistory).includes("Isi dokumen tetap ada"));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
