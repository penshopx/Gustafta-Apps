import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

// Regression: a product deleted by an admin must disappear from the next
// catalog response immediately, even while the production cache is warm.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";

const { db } = await import("../server/db");
import { agents as agentsTable, storeProducts } from "../shared/schema";
import { eq, inArray } from "drizzle-orm";
const { storage } = await import("../server/storage");
const { invalidateStoreCatalog, getStoreCatalogItems } = await import("../server/routes");

const RUN = `spd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createdAgentIds: number[] = [];
const createdProductIds: number[] = [];

let server: Server;
let base = "";

function alwaysAuth(_req: any, _res: any, next: any) {
  next();
}

before(async () => {
  if (!testDatabaseReady) return;
  const app = express();

  // Mirror the production DELETE handler exactly:
  // deleteStoreProduct → invalidateStoreCatalog → response.
  app.delete("/api/store/admin/products/:id", alwaysAuth, async (req, res) => {
    try {
      const ok = await storage.deleteStoreProduct(Number(req.params.id));
      invalidateStoreCatalog();
      res.json({ success: ok });
    } catch {
      res.status(500).json({ error: "Failed to delete product" });
    }
  });

  // Use the production catalog builder and cache.
  app.get("/api/store/catalog", async (req, res) => {
    try {
      const search = String(req.query.search || "").trim().toLowerCase();
      const category = String(req.query.category || "").trim();
      const items = await getStoreCatalogItems(category, search);
      res.json({ items, total: items.length });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as any).port}`;
      resolve();
    });
  });

  const [agent] = await db.insert(agentsTable).values({
    name: `${RUN} Agent`,
    isListed: false,
    isActive: true,
    paymentUrl: "",
  } as any).returning({ id: agentsTable.id });
  createdAgentIds.push(agent.id);

  const [product] = await db.insert(storeProducts).values({
    name: `${RUN} Product`,
    description: "catalog deletion cache regression",
    price: 299_000,
    agentId: agent.id,
    isActive: true,
    isGustafta: false,
    sortOrder: 999,
    paymentUrl: `https://checkout.example.com/pay/${RUN}`,
  } as any).returning({ id: storeProducts.id });
  createdProductIds.push(product.id);
});

after(async () => {
  if (!testDatabaseReady) return;
  invalidateStoreCatalog();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  if (createdProductIds.length > 0) {
    await db.delete(storeProducts).where(inArray(storeProducts.id, createdProductIds));
  }
  if (createdAgentIds.length > 0) {
    await db.delete(agentsTable).where(inArray(agentsTable.id, createdAgentIds));
  }
});

async function catalogHasProduct(): Promise<boolean> {
  const response = await fetch(`${base}/api/store/catalog`);
  assert.equal(response.status, 200, "GET /api/store/catalog harus 200");
  const body = await response.json();
  return body.items.some((item: any) => item.productId === createdProductIds[0]);
}

test("DELETE produk menghilangkannya dari GET katalog berikutnya tanpa menunggu cache kedaluwarsa", { skip: !testDatabaseReady && testDbSkip }, async () => {
  invalidateStoreCatalog();
  assert.equal(await catalogHasProduct(), true, "GET pertama harus menghangatkan cache dengan produk");

  const response = await fetch(`${base}/api/store/admin/products/${createdProductIds[0]}`, {
    method: "DELETE",
  });
  assert.equal(response.status, 200, "DELETE harus 200");
  assert.deepEqual(await response.json(), { success: true });

  const rows = await db.select({ id: storeProducts.id })
    .from(storeProducts)
    .where(eq(storeProducts.id, createdProductIds[0]));
  assert.equal(rows.length, 0, "produk harus benar-benar terhapus dari database");
  assert.equal(
    await catalogHasProduct(),
    false,
    "GET langsung setelah DELETE tidak boleh menyajikan produk dari cache lama",
  );
});

test("routes.ts menginvalidasi katalog setelah deleteStoreProduct dan sebelum respons", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server", "routes.ts"), "utf-8");
  const deleteIndex = source.indexOf('app.delete("/api/store/admin/products/:id"');
  assert.notEqual(deleteIndex, -1, "handler DELETE produk harus ada");

  const nextRouteIndex = source.indexOf('app.post("/api/admin/store/products/:id/test-download"', deleteIndex);
  const block = source.slice(deleteIndex, nextRouteIndex);
  const deleteCallIndex = block.indexOf("deleteStoreProduct(");
  const invalidateIndex = block.indexOf("invalidateStoreCatalog()");
  const responseIndex = block.indexOf("res.json({ success: ok })");

  assert.notEqual(deleteCallIndex, -1, "handler harus memanggil deleteStoreProduct");
  assert.notEqual(invalidateIndex, -1, "handler harus memanggil invalidateStoreCatalog");
  assert.notEqual(responseIndex, -1, "handler harus mengirim hasil penghapusan");
  assert.ok(deleteCallIndex < invalidateIndex, "invalidasi harus terjadi setelah penghapusan");
  assert.ok(invalidateIndex < responseIndex, "invalidasi harus terjadi sebelum respons");
});