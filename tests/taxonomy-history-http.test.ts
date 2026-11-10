import { test } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MemStorage } from "../server/storage";
import { registerTaxonomyAdminRoutes } from "../server/taxonomy-admin-routes";

test("admin audit discovers deleted categories, filters snapshots and paginates without KB", async () => {
  const storage = new MemStorage();
  const node = await storage.createTaxonomyNode({ name: "Nama lama", slug: "slug-lama", level: "sektor" }, "admin-create");
  for (let index = 0; index < 52; index++) {
    await storage.updateTaxonomyNode(node.id, { name: `Nama baru ${index}` }, "admin-update");
  }
  await storage.deleteTaxonomyNode(node.id, 0, "admin-delete");
  await storage.createTaxonomyNode({ name: "Tidak cocok", slug: "lain", level: "sektor" }, "other");
  const app = express();
  const authenticated: RequestHandler = (req, res, next) => {
    if (!req.headers["x-test-user"]) { res.status(401).json({ error: "Login required" }); return; }
    next();
  };
  const admin: RequestHandler = (req, res, next) => {
    if (req.headers["x-test-user"] !== "effective-admin") { res.status(403).json({ error: "Admin required" }); return; }
    next();
  };
  registerTaxonomyAdminRoutes(app, storage, authenticated, admin);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/taxonomy`;
  const request = async (path: string, account: string | null = "effective-admin") => {
    const res = await fetch(`${base}${path}`, { headers: account ? { "x-test-user": account } : {} });
    return { status: res.status, data: await res.json() as any };
  };
  try {
    for (const path of ["/audit", `/${node.id}/history`]) {
      assert.equal((await request(path, null)).status, 401);
      assert.equal((await request(path, "ordinary-user")).status, 403);
    }
    const first = await request(`/${node.id}/history`);
    assert.equal(first.status, 200);
    assert.equal(first.data.length, 50);
    assert.equal(first.data[0].action, "delete");
    assert.equal(first.data[0].actorId, "admin-delete");
    assert.equal(first.data[0].after, null);
    assert.ok(first.data[0].createdAt);
    const second = await request(`/${node.id}/history?beforeId=${first.data.at(-1).id}`);
    assert.equal(second.data.length, 4);
    assert.equal(second.data.at(-1).action, "create");
    assert.equal(new Set([...first.data, ...second.data].map(entry => entry.id)).size, 54);
    const all = await request("/audit");
    assert.equal(all.data.length, 50);
    const older = await request(`/audit?beforeId=${all.data.at(-1).id}`);
    assert.equal(older.data.length, 5);
    for (const search of ["NAMA BARU", "slug-lama", String(node.id)]) {
      const found = await request(`/audit?search=${encodeURIComponent(search)}`);
      assert.equal(found.status, 200);
      assert.equal(found.data.length, 50);
      assert.ok(found.data.every((entry: any) => entry.taxonomyId === node.id));
    }
    assert.equal((await request("/audit?search=Nama%20lama")).data.length, 2);
    assert.deepEqual((await request("/audit?search=%25")).data, []);
    assert.deepEqual((await request("/audit?search=nonexistent")).data, []);
    for (const query of ["beforeId=0", "beforeId=-1", "beforeId=abc", "beforeId=1&beforeId=2", `search=${"a".repeat(256)}`, "search=a&search=b"]) {
      assert.equal((await request(`/audit?${query}`)).status, 400, query);
    }
    assert.equal((await request(`/${node.id}/history?beforeId=bad`)).status, 400);
    assert.deepEqual((await request("/999999/history")).data, []);
    for (const entry of first.data) {
      assert.deepEqual(Object.keys(entry).sort(), ["action", "actorId", "after", "before", "createdAt", "id", "taxonomyId"].sort());
      for (const snapshot of [entry.before, entry.after].filter(Boolean)) {
        assert.ok(Object.keys(snapshot).every(key =>
          ["id", "name", "slug", "description", "level", "parentId", "sortOrder", "isActive", "createdAt"].includes(key)));
      }
    }
    storage.getTaxonomyAuditHistory = async () => { throw new Error("private database detail"); };
    assert.deepEqual(await request("/audit"), { status: 500, data: { error: "Gagal membaca riwayat kategori." } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
