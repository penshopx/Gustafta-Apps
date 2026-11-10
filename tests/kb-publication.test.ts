import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import { registerKBPublicationRoutes, type PublicationSource } from "../server/kb-publication-routes";
import { loadContextSources } from "../server/lib/kb-context-access";
import type { KnowledgeBase, KnowledgeChunk } from "../shared/schema";

test("startup repair preserves owner consent, edits revoke it atomically, and context visibility is never cached", () => {
  for (const path of ["../server/index.ts", "../migrations/0029_private_knowledge_context.sql"]) {
    const text = readFileSync(new URL(path, import.meta.url), "utf8");
    const update = text.slice(text.indexOf("UPDATE knowledge_bases kb"));
    assert.match(update, /WHERE kb\.visibility = 'platform' AND \(/);
  }
  const storage = readFileSync(new URL("../server/db-storage.ts", import.meta.url), "utf8");
  const read = storage.slice(storage.indexOf("async getKnowledgeBases("), storage.indexOf("async createKnowledgeBase("));
  assert.doesNotMatch(read, /kbCache\.get/);
  const update = storage.slice(storage.indexOf("async updateKnowledgeBase("), storage.indexOf("async deleteKnowledgeBase("));
  assert.match(update, /data\.processingStatus === "processing"/);
  assert.match(update, /CASE WHEN.*visibility.*= 'published' THEN 'private'/);
  assert.match(update, /\.set\(updateData\)/);
});

test("publication requires consent, document ownership AND agent management; revocation isolates both contexts", async () => {
  const source: PublicationSource = {
    id: 1, agentId: 7, ownerUserId: "document-owner",
    visibility: "private", processingStatus: "completed",
  };
  let writes = 0;
  const app = express();
  app.use(express.json());
  registerKBPublicationRoutes(app, {
    authenticate(req, res, next) {
      if (!req.headers["x-user"]) return res.status(401).end();
      next();
    },
    userId: req => String(req.headers["x-user"] || ""),
    getAgent: async () => ({ id: "7", isPublic: true, userId: "agent-owner" }),
    canManage: async req => req.headers["x-manage"] === "yes"
      ? { ok: true } : { ok: false, status: 403, error: "No edit access" },
    async withLockedSource(id, fn) {
      return fn(id === source.id ? source : undefined, async visibility => {
        writes++;
        source.visibility = visibility;
      }, async () => []);
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const post = (actor?: string, manage = false, body: unknown = { publish: true, confirmed: true }, id = "1") =>
    fetch(`http://127.0.0.1:${address.port}/api/knowledge-base/${id}/publication`, {
      method: "POST", headers: {
        "Content-Type": "application/json",
        ...(actor ? { "x-user": actor } : {}), "x-manage": manage ? "yes" : "no",
      }, body: JSON.stringify(body),
    });
  const context = (viewer?: string) => loadContextSources({
    async getKnowledgeBases() {
      return [{ ...source, id: "1", agentId: "7", content: "private document", status: "active" }] as KnowledgeBase[];
    },
    async getChunksByAgent() { return [{ knowledgeBaseId: 1, content: "private chunk" }] as KnowledgeChunk[]; },
  }, "7", viewer);
  try {
    assert.equal((await post()).status, 401);
    assert.equal((await post("agent-owner", true)).status, 403);
    assert.equal((await post("admin", true)).status, 403);
    assert.equal((await post("document-owner")).status, 403);
    for (const body of [{ publish: true }, { publish: true, confirmed: false }, { publish: "true", confirmed: true }]) {
      assert.equal((await post("document-owner", true, body)).status, 400);
    }
    assert.equal((await post("document-owner", true, undefined, "bad")).status, 400);
    assert.equal((await post("document-owner", true, undefined, "2")).status, 404);
    assert.equal(writes, 0);
    assert.equal((await context()).kbs.length, 0);
    assert.equal((await context("visitor")).chunks.length, 0);
    assert.equal((await context("document-owner")).kbs.length, 1);
    source.processingStatus = "processing";
    assert.equal((await post("document-owner", true)).status, 403);
    source.processingStatus = "completed";
    source.visibility = "platform";
    assert.equal((await post("document-owner", true)).status, 403);
    source.visibility = "private";
    assert.equal((await post("document-owner", true)).status, 200);
    assert.equal((await context()).kbs.length, 1);
    assert.equal((await context("visitor")).chunks.length, 1);
    assert.equal((await post("document-owner", true, { publish: false, confirmed: true })).status, 200);
    assert.equal((await context()).kbs.length, 0);
    assert.equal((await context("visitor")).chunks.length, 0);
    assert.equal((await context("document-owner")).kbs.length, 1);
    source.visibility = "published";
    source.ownerUserId = null;
    assert.equal((await context()).kbs.length, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
