import { test } from "node:test";
import assert from "node:assert/strict";
import type { KnowledgeBase, KnowledgeChunk } from "@shared/schema";
import { selectContextKB, selectContextChunks, loadContextSources } from "../server/lib/kb-context-access";
import { searchKnowledgeBase } from "../server/lib/rag-service";
import { readFileSync } from "node:fs";

test("private Ruang Simpan knowledge is isolated from public visitors and other users", async () => {
  const kb = (id: number, visibility: string, ownerUserId: string | null) =>
    ({ id: String(id), visibility, ownerUserId, status: "active", content: `source-${id}` }) as KnowledgeBase;
  const all = [kb(1, "platform", null), kb(2, "private", "owner-a"), kb(3, "private", null)];
  const chunks = all.map((item, index) =>
    ({ knowledgeBaseId: Number(item.id), content: `secret-${index}`, embedding: [] }) as unknown as KnowledgeChunk);

  for (const viewer of [undefined, "other-user"]) {
    const allowed = selectContextKB(all, viewer);
    assert.deepEqual(allowed.map(k => k.id), ["1"]);
    assert.deepEqual(selectContextChunks(chunks, allowed).map(c => c.content), ["secret-0"]);
    assert.equal(await searchKnowledgeBase("query", selectContextChunks(chunks, allowed), 5, new Map(allowed.map(k => [Number(k.id), k]))), "secret-0");
  }

  const ownerKB = selectContextKB(all, "owner-a");
  assert.deepEqual(ownerKB.map(k => k.id), ["1", "2"]);
  assert.deepEqual(selectContextChunks(chunks, ownerKB).map(c => c.content), ["secret-0", "secret-1"]);
  assert.equal(await searchKnowledgeBase("query", chunks, 5, new Map(ownerKB.map(k => [Number(k.id), k]))), "secret-0\n\nsecret-1");
});

test("imported KB cannot enter chat RAG or DocGen source context for another visitor", async () => {
  // Same loader is used by non-stream chat, streaming chat, and DocGen.
  const kbs = [
    { id: "1", visibility: "platform", ownerUserId: null, content: "curated source", status: "active" },
    { id: "2", visibility: "private", ownerUserId: "owner-a", content: "private import", status: "active" },
  ] as KnowledgeBase[];
  const chunks = [
    { knowledgeBaseId: 1, content: "curated chunk", embedding: [] },
    { knowledgeBaseId: 2, content: "private chunk", embedding: [] },
  ] as unknown as KnowledgeChunk[];
  const source = {
    async getKnowledgeBases() { return kbs; },
    async getChunksByAgent() { return chunks; },
  };
  for (const visitor of [undefined, "visitor-b"]) {
    const context = await loadContextSources(source, "101", visitor);
    const chat = await searchKnowledgeBase("query", context.chunks, 5,
      new Map(context.kbs.map(kb => [Number(kb.id), kb])));
    const docgen = context.kbs.map(kb => kb.content).join("\n");
    assert.equal(chat, "curated chunk");
    assert.equal(docgen, "curated source");
  }
  const owner = await loadContextSources(source, "101", "owner-a");
  assert.equal(owner.kbs.length, 2);
});

test("all user-content import routes label KB private at creation, including direct Ruang Simpan SQL", () => {
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const routeBlock = (start: string) => {
    const first = routes.indexOf(start);
    const last = routes.indexOf("\n  app.", first + start.length);
    assert.ok(first >= 0 && last > first, `route block missing: ${start}`);
    return routes.slice(first, last);
  };
  for (const start of [
    'app.post("/api/agents/import"',
    'app.post("/api/agents/:id/apply-import"',
    'app.post("/api/chatbot-templates/:id/use"',
    'app.post("/api/hspk/upload/:agentId"',
  ]) {
    const block = routeBlock(start);
    assert.match(block, /visibility:\s*"private"/);
    assert.match(block, /ownerUserId:\s*(userId|getAuthenticatedMemoryUserId\(req\))/);
  }
  const rs = readFileSync(new URL("../server/ruang-simpan-routes.ts", import.meta.url), "utf8");
  const assistant = rs.slice(rs.indexOf('app.post("/api/ruang-simpan/generate-assistant"'));
  assert.match(assistant, /INSERT INTO knowledge_bases[^`]*visibility, owner_user_id/);
  assert.match(assistant, /extractedPreview, userId\]/);
});