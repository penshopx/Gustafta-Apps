import { prepareTestDatabase, testDbSkip } from "./test-database";
const ready = await prepareTestDatabase();

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { registerKBPublicationRoutes } from "../server/kb-publication-routes";
import { knowledgeBases, kbPublicationHistory } from "../shared/schema";
import { kbPublicationHistoryDDL, recordKBPublication, readKBPublicationHistory } from "../server/lib/kb-publication-history";

test("boot DDL and committed migration match and do not backfill fictional consent", () => {
  assert.equal(kbPublicationHistoryDDL.trim(),
    readFileSync(new URL("../migrations/0032_kb_publication_history.sql", import.meta.url), "utf8").trim());
  assert.doesNotMatch(kbPublicationHistoryDDL, /INSERT INTO/i);
});

test("publication history: scoped authorization, revisions, pagination and all-or-nothing writes", {
  skip: ready ? false : testDbSkip, timeout: 60_000,
}, async () => {
  const { db, pool } = await import("../server/db");
  const { dbStorage } = await import("../server/db-storage");
  const source = await dbStorage.createKnowledgeBase({
    agentId: "123456789", name: "PRIVATE_NAME_NEVER_LOGGED", content: "PRIVATE_CONTENT_NEVER_LOGGED",
    extractedText: "PRIVATE_EXTRACT_NEVER_LOGGED", type: "text",
    ownerUserId: "document-owner", visibility: "private", processingStatus: "completed",
    fileUrl: "/api/ruang-simpan/file/private-original/download",
  });
  const id = Number(source.id);
  const app = express();
  app.use(express.json());
  registerKBPublicationRoutes(app, {
    authenticate(req, res, next) {
      if (!req.headers["x-user"]) return res.status(401).end();
      next();
    },
    userId: req => String(req.headers["x-user"] || ""),
    getAgent: async () => ({ id: source.agentId }),
    canManage: async req => req.headers["x-manage"] === "yes"
      ? { ok: true } : { ok: false, status: 403, error: "No management permission" },
    withLockedSource: (sourceId, fn) => db.transaction(async tx => {
      const [row] = await tx.select().from(knowledgeBases).where(eq(knowledgeBases.id, sourceId)).for("update");
      return fn(row, async (visibility, actor) => {
        await recordKBPublication(tx, row, actor, visibility === "published" ? "publish" : "revoke", "consent");
        await tx.update(knowledgeBases).set({ visibility }).where(eq(knowledgeBases.id, sourceId));
      }, before => readKBPublicationHistory(tx, sourceId, before));
    }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const request = (method: string, path: string, actor = "document-owner", manage = true, body?: unknown) =>
    fetch(`http://127.0.0.1:${port}/api/knowledge-base/${id}/publication${path}`, {
      method, headers: { "Content-Type": "application/json", "x-user": actor, "x-manage": manage ? "yes" : "no" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const publish = (value: boolean) => request("POST", "", undefined, undefined, { publish: value, confirmed: true });
  const row = async () => (await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id)))[0];
  const history = async () => {
    const response = await request("GET", "/history");
    assert.equal(response.status, 200);
    return response.json() as Promise<{ entries: any[]; nextBefore: number | null }>;
  };
  try {
    for (const actor of ["", "other", "admin"]) {
      assert.equal((await request("GET", "/history", actor)).status, actor ? 403 : 401);
    }
    assert.equal((await request("GET", "/history", "document-owner", false)).status, 403);
    assert.equal((await request("GET", "/history?before=bad")).status, 400);
    assert.deepEqual((await history()).entries, []);
    assert.equal((await publish(true)).status, 200);
    assert.equal((await publish(true)).status, 200);
    let entries = (await history()).entries;
    assert.equal(entries.length, 1, "idempotent publication does not fabricate approvals");
    assert.equal(entries[0].action, "publish");
    assert.equal(entries[0].actorId, "document-owner");
    assert.equal(entries[0].contentRevision, 1);
    assert.ok(Number.isFinite(Date.parse(entries[0].createdAt)));
    assert.doesNotMatch(JSON.stringify(entries), /PRIVATE_|ruang-simpan/);
    assert.deepEqual(Object.keys(entries[0]).sort(),
      ["id", "sourceId", "agentId", "actorId", "action", "reason", "contentRevision", "createdAt"].sort());

    await dbStorage.updateKnowledgeBase(source.id, { content: "PRIVATE_CHANGED" }, "editor");
    assert.equal((await row()).visibility, "private");
    assert.equal((await row()).contentRevision, 2);
    entries = (await history()).entries;
    assert.equal(entries[0].action, "revoke");
    assert.equal(entries[0].reason, "content_edit");
    assert.equal(entries[0].actorId, "editor");
    assert.equal(entries[0].contentRevision, 1, "automatic revocation identifies the approved old version");
    assert.equal((await publish(true)).status, 200);
    assert.equal((await history()).entries[0].contentRevision, 2);
    await dbStorage.updateKnowledgeBase(source.id, { processingStatus: "processing" }, "editor");
    assert.equal((await history()).entries[0].reason, "reprocess");
    assert.equal((await row()).visibility, "private");
    await dbStorage.updateKnowledgeBase(source.id, { processingStatus: "completed" });
    await publish(true);
    await publish(false);
    assert.equal((await history()).entries[0].reason, "consent");
    await publish(true);

    // Force evidence persistence to fail: neither approval nor edit may commit.
    await pool.query(`CREATE FUNCTION reject_kb_history_fixture() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'fixture rejects evidence'; END $$;
      CREATE TRIGGER reject_kb_history_fixture BEFORE INSERT ON kb_publication_history
      FOR EACH ROW WHEN (NEW.source_id = ${id}) EXECUTE FUNCTION reject_kb_history_fixture();`);
    const snapshot = await row();
    const count = (await history()).entries.length;
    assert.equal((await publish(false)).status, 500);
    await assert.rejects(dbStorage.updateKnowledgeBase(source.id, { content: "FAILED_EDIT" }, "editor"));
    assert.deepEqual(await row(), snapshot);
    assert.equal((await history()).entries.length, count);
    await pool.query(`DROP TRIGGER reject_kb_history_fixture ON kb_publication_history;
      DROP FUNCTION reject_kb_history_fixture();`);
    await publish(false);
    await pool.query(`CREATE FUNCTION reject_kb_visibility_fixture() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'fixture rejects visibility'; END $$;
      CREATE TRIGGER reject_kb_visibility_fixture BEFORE UPDATE ON knowledge_bases
      FOR EACH ROW WHEN (OLD.id = ${id}) EXECUTE FUNCTION reject_kb_visibility_fixture();`);
    const beforeFailure = (await history()).entries.length;
    assert.equal((await publish(true)).status, 500);
    assert.equal((await row()).visibility, "private");
    assert.equal((await history()).entries.length, beforeFailure, "failed visibility rolls evidence back");
    await pool.query(`DROP TRIGGER reject_kb_visibility_fixture ON knowledge_bases;
      DROP FUNCTION reject_kb_visibility_fixture();`);

    // Same source only, stable descending pagination, including an exact boundary.
    await db.insert(kbPublicationHistory).values(Array.from({ length: 51 }, () => ({
      sourceId: id, agentId: Number(source.agentId), actorId: null,
      action: "revoke" as const, reason: "content_edit" as const, contentRevision: 3,
    })));
    await db.insert(kbPublicationHistory).values({
      sourceId: id + 1, agentId: Number(source.agentId), actorId: "UNRELATED",
      action: "publish", reason: "consent", contentRevision: 1,
    });
    const first = await history();
    assert.equal(first.entries.length, 50);
    assert.ok(first.nextBefore);
    const second = await (await request("GET", `/history?before=${first.nextBefore}`)).json() as any;
    assert.ok(second.entries.length > 0);
    assert.ok(second.entries.every((entry: any) => entry.id < first.nextBefore! && entry.sourceId === id));
    assert.equal(second.nextBefore, null);
    assert.equal((await row()).fileUrl, source.fileUrl, "publication never changes original file access");
    await dbStorage.deleteKnowledgeBase(source.id);
    assert.ok((await db.select().from(kbPublicationHistory).where(eq(kbPublicationHistory.sourceId, id))).length);
    assert.equal((await request("GET", "/history")).status, 404, "retained evidence is not an orphan access bypass");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.query(`DROP TRIGGER IF EXISTS reject_kb_history_fixture ON kb_publication_history;
      DROP FUNCTION IF EXISTS reject_kb_history_fixture();
      DROP TRIGGER IF EXISTS reject_kb_visibility_fixture ON knowledge_bases;
      DROP FUNCTION IF EXISTS reject_kb_visibility_fixture();`);
    await db.delete(kbPublicationHistory).where(eq(kbPublicationHistory.sourceId, id));
    await db.delete(kbPublicationHistory).where(eq(kbPublicationHistory.sourceId, id + 1));
    await dbStorage.deleteKnowledgeBase(source.id);
    await pool.end();
  }
});
