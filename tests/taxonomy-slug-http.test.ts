import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MemStorage } from "../server/storage";
import { registerTaxonomyAdminRoutes } from "../server/taxonomy-admin-routes";
import { isTaxonomySlugConflict, TAXONOMY_SLUG_CONFLICT, TAXONOMY_SLUG_CONSTRAINT } from "../shared/taxonomy-slug";

test("conflict detection recognizes wrapped PostgreSQL errors, not unrelated unique failures", () => {
  assert.ok(isTaxonomySlugConflict({ cause: { code: "23505", constraint: TAXONOMY_SLUG_CONSTRAINT } }));
  assert.equal(isTaxonomySlugConflict({ code: "23505", constraint: "taxonomy_audit_log_pkey" }), false);
  const cyclic: any = {}; cyclic.cause = cyclic;
  assert.equal(isTaxonomySlugConflict(cyclic), false);
});

test("admin create/edit conflict is actionable and never changes the draft target or audit", async () => {
  const storage = new MemStorage();
  const app = express();
  app.use(express.json());
  registerTaxonomyAdminRoutes(app, storage, (req, _res, next) => {
    req.user = { id: "admin" } as any; next();
  }, (_req, _res, next) => next());
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/taxonomy`;
  const request = async (method: string, path: string, body: unknown) => {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const a = await request("POST", "", { name: "A", slug: "global", level: "sektor", isActive: false });
    assert.equal(a.status, 201);
    const b = await request("POST", "", { name: "B", slug: "other", level: "sektor" });
    assert.equal(b.status, 201);
    for (const result of [
      await request("POST", "", { name: "Sub", slug: "global", level: "subsektor", parentId: b.body.id }),
      await request("PATCH", `/${b.body.id}`, { slug: "global", name: "Must not change" }),
    ]) {
      assert.equal(result.status, 409);
      assert.deepEqual(result.body, { code: "TAXONOMY_SLUG_CONFLICT", field: "slug", error: TAXONOMY_SLUG_CONFLICT });
    }
    assert.equal((await storage.getTaxonomyNode(b.body.id))?.name, "B");
    assert.equal((await storage.getTaxonomyAuditHistory(b.body.id)).length, 1);
    assert.equal((await request("PATCH", `/${a.body.id}`, { slug: "global", name: "A renamed" })).status, 200);
    assert.equal((await request("POST", "", { name: "Sub", slug: "global-b", level: "subsektor", parentId: b.body.id })).status, 201);
    for (const slug of ["UPPER", "bad slug", ""]) {
      assert.equal((await request("POST", "", { name: "Invalid", slug, level: "sektor" })).status, 400);
    }
    storage.createTaxonomyNode = async () => { throw { cause: { code: "23505", constraint: "unrelated_unique" } }; };
    assert.equal((await request("POST", "", { name: "Other error", slug: "new-slug", level: "sektor" })).status, 500);
    storage.createTaxonomyNode = async () => { throw { cause: { code: "23505", constraint: TAXONOMY_SLUG_CONSTRAINT } }; };
    assert.equal((await request("POST", "", { name: "Wrapped", slug: "new-slug", level: "sektor" })).status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
