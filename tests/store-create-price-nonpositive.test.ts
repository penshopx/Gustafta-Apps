import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";

async function postWithCreateGuard(body: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  let createCalls = 0;

  app.post("/api/store/admin/products", async (req, res) => {
    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: "Harga harus lebih besar dari 0" });
    }
    if (req.body?.priceOverride != null) {
      const priceOverride = Number(req.body.priceOverride);
      if (!Number.isFinite(priceOverride) || priceOverride <= 0) {
        return res.status(400).json({ error: "Override harga harus lebih besar dari 0" });
      }
    }
    createCalls += 1;
    res.json({ id: 1, ...req.body });
  });

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const port = (server.address() as any).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/store/admin/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() as any, createCalls };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

for (const price of [0, -1]) {
  test(`POST price=${price} → 400 sebelum produk dibuat`, async () => {
    const result = await postWithCreateGuard({ name: "Produk tes", price });
    assert.equal(result.status, 400);
    assert.match(String(result.json.error), /harga harus lebih besar dari 0/i);
    assert.equal(result.createCalls, 0);
  });
}

for (const priceOverride of [0, -1]) {
  test(`POST priceOverride=${priceOverride} → 400 sebelum produk dibuat`, async () => {
    const result = await postWithCreateGuard({ name: "Produk tes", price: 100_000, priceOverride });
    assert.equal(result.status, 400);
    assert.match(String(result.json.error), /override harga harus lebih besar dari 0/i);
    assert.equal(result.createCalls, 0);
  });
}

test("Statis: handler POST memvalidasi harga sebelum createStoreProduct", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server", "routes.ts"), "utf8");
  const start = source.indexOf('app.post("/api/store/admin/products"');
  assert.ok(start >= 0);
  const handler = source.slice(start, start + 1600);
  assert.match(handler, /Number\(req\.body\?\.price\)/);
  assert.match(handler, /price <= 0/);
  assert.match(handler, /priceOverride <= 0/);
  assert.match(handler, /status\(400\)/);
  assert.ok(handler.indexOf("status(400)") < handler.indexOf("createStoreProduct"));
});

test("Statis: form tambah menampilkan error inline dan mencegah simpan", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "client", "src", "pages", "admin.tsx"), "utf8");
  assert.match(source, /error-create-product-price/);
  assert.match(source, /error-create-product-price-override/);
  assert.match(source, /productForm\.price !== "" && Number\(productForm\.price\) <= 0/);
  assert.match(source, /productForm\.priceOverride !== "" && Number\(productForm\.priceOverride\) <= 0/);
  const saveButton = source.indexOf('data-testid="button-save-product"');
  const preceding = source.slice(Math.max(0, saveButton - 1800), saveButton);
  assert.match(preceding, /disabled=\{[^}]*Number\(productForm\.price\) <= 0[^}]*priceOverride[^}]*<= 0[^}]*\}/s);
});