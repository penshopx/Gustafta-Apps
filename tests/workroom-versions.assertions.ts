import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { DatabaseStorage } from "../server/db-storage";
import type { FixtureVersionStore } from "./workroom-version-store";
import { VERSION_LOG, versionManifest } from "../server/lib/workroom-source-versions";
import type { WorkroomSourceVersion } from "../shared/workroom-transitions";

type Request = (path: string, body: any, method?: string, owner?: string | null, withReview?: boolean) => Promise<Response>;
export async function assertWorkroomSourceVersions(storage: DatabaseStorage, pool: Pool, store: FixtureVersionStore, id: number, request: Request) {
  const a = randomUUID(), b = randomUUID();
  const snapshot = async () => {
    const room = await storage.getWorkroomReviewSnapshot(id, "fixture-owner");
    assert.ok(room);
    return room;
  };
  const expected = async () => {
    const room = await snapshot();
    return { expectedReviewRevision: room.reviewRevision, expectedReviewFingerprint: room.reviewFingerprint };
  };
  const capture = async () => request("/source-versions", await expected());
  const download = (version: WorkroomSourceVersion, fileId = a, owner: string | null = "fixture-owner") =>
    request(`/source-versions/${version.versionId}/files/${fileId}`, undefined, "GET", owner);
  try {
    for (const [fileId, name, bytes] of [[a, "Evidence A.pdf", "A"], [b, "Evidence B.pdf", "B"]]) {
      await pool.query(`INSERT INTO ruang_simpan_files(id,user_id,original_name,size_bytes,file_content)
        VALUES($1,'fixture-owner',$2,1,$3)`, [fileId, name, Buffer.from(bytes)]);
    }
    assert.equal((await request("/sources", { fileIds: [a, b] })).status, 200);
    const denied = await request("/source-versions", await expected(), "POST", "other-owner");
    assert.equal(denied.status, 404);
    assert.equal((await request("/source-versions", {}, "POST", null)).status, 401);
    assert.equal((await request("/source-versions", {}, "POST", "fixture-owner", false)).status, 409);
    const response = await capture();
    assert.equal(response.status, 201);
    const first = await response.json() as WorkroomSourceVersion;
    const writeCount = store.writes.length;
    assert.equal((await (await capture()).json()).versionId, first.versionId, "same review is idempotent");
    assert.equal(store.writes.length, writeCount, "idempotency must not rewrite blobs");
    const gate = (await snapshot()).gates[0];
    assert.equal((await request(`/gate/${gate.id}/decide`, { status: "approved" })).status, 200);
    assert.ok((await snapshot()).logs.some(log => (log.meta as any)?.sourceVersionId === first.versionId),
      "approval audit must refer to the retained immutable version");
    assert.ok(!JSON.stringify(first).includes("workroom-versions/"));
    assert.ok(!JSON.stringify(await snapshot()).includes("workroom-versions/"), "private intent keys must never escape through journals");
    assert.equal((await request("/source-versions", undefined, "GET", "other-owner")).status, 404);
    assert.equal((await download(first, a, "other-owner")).status, 404);
    assert.equal((await download(first, a, null)).status, 401);
    assert.equal((await download(first, randomUUID())).status, 404);
    const original = await download(first);
    assert.equal(await original.text(), "A");
    assert.equal(original.headers.get("cache-control"), "private, no-store");
    assert.equal(original.headers.get("x-content-type-options"), "nosniff");
    assert.match(original.headers.get("content-disposition")!, /^attachment;/);
    const oldExpected = await expected();
    await pool.query("UPDATE ruang_simpan_files SET file_content=$1,size_bytes=3,updated_at=clock_timestamp() WHERE id=$2", [Buffer.from("NEW"), a]);
    assert.equal((await request("/source-versions", oldExpected)).status, 409);
    assert.equal(await (await download(first)).text(), "A", "old bytes must not silently become current bytes");
    const second = await (await capture()).json() as WorkroomSourceVersion;
    assert.notEqual(second.versionId, first.versionId);
    assert.equal(await (await download(second)).text(), "NEW");
    const logs = await pool.query("SELECT meta FROM workroom_logs WHERE workroom_id=$1 AND type=$2", [id, VERSION_LOG]);
    const manifest = logs.rows.find(row => row.meta.versionId === first.versionId).meta;
    const key = manifest.files.find((file: any) => file.fileId === a).key;
    const saved = store.objects.get(key)!;
    store.objects.set(key, Buffer.from("tampered bytes"));
    assert.equal((await download(first)).status, 409);
    store.objects.set(key, saved);
    store.failRead = true;
    const unreadable = await download(first);
    assert.equal(unreadable.status, 503);
    assert.ok(!(await unreadable.text()).includes("PRIVATE"));
    store.failRead = false;
    // Ambiguous upload: the private intent must outlive the persisted blob.
    await pool.query("UPDATE ruang_simpan_files SET extracted_text='Revision for failed upload',updated_at=clock_timestamp() WHERE id=$1", [a]);
    store.failPut = true;
    const failed = await capture();
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes("PRIVATE PROVIDER"));
    const attempts = await pool.query("SELECT meta FROM workroom_logs WHERE workroom_id=$1 AND type=$2", [id, VERSION_LOG]);
    const failedIntent = attempts.rows.find(row => row.meta.state === "failed")?.meta;
    assert.ok(failedIntent);
    assert.ok(failedIntent.files.some((file: any) => store.objects.has(file.key)), "failed upload remains durably tracked");
    assert.ok(!(await (await request("/source-versions", undefined, "GET")).json())
      .some((version: WorkroomSourceVersion) => version.versionId === failedIntent.versionId));
    store.failPut = false;
    assert.equal((await capture()).status, 201);
    assert.equal(new Set(store.writes).size, store.writes.length, "retries must use entirely fresh keys");
    // Authority cannot be manufactured via the generic journal API.
    await assert.rejects(storage.createWorkroomLog({ workroomId: id, type: VERSION_LOG, content: "forged", meta: manifest }), { statusCode: 400 });
    await pool.query("DELETE FROM ruang_simpan_files WHERE id=$1", [a]);
    assert.equal(await (await download(first)).text(), "A", "historical copy survives source deletion");
    assert.equal((await request("/sources", { fileIds: [] })).status, 200);
    assert.equal(await (await download(first)).text(), "A", "historical copy survives source unlink");

    // Simulate a process dying after a committed intent and partial upload.
    const current = await snapshot();
    const abandoned = versionManifest("fixture-owner", current, [
      { fileId: a, name: "Interrupted copy", mimeType: "application/pdf", bytes: Buffer.from("A") },
    ]);
    await pool.query("INSERT INTO workroom_logs(workroom_id,type,content,meta) VALUES($1,$2,'Interrupted fixture',$3::jsonb)",
      [id, VERSION_LOG, JSON.stringify(abandoned)]);
    store.objects.set(abandoned.files[0].key, Buffer.from("A"));
    assert.equal((await request("", undefined, "DELETE")).status, 409, "fresh interrupted intent must not race deletion");
    await pool.query(`UPDATE workroom_logs SET meta=jsonb_set(meta,'{createdAt}',$1::jsonb)
      WHERE workroom_id=$2 AND meta->>'versionId'=$3`,
    [JSON.stringify(new Date(Date.now() - 181_000).toISOString()), id, abandoned.versionId]);
    // Partial deletion is explicit, durable, blocks archive reads, and is retryable.
    store.failRemoveAfter = 1;
    assert.equal((await request("", undefined, "DELETE")).status, 503);
    assert.equal((await snapshot()).deletionPending, true);
    assert.equal((await download(first)).status, 409);
    assert.equal((await request("", { currentStage: 0 }, "PATCH")).status, 409);
    assert.equal((await request("/log", { type: "note", content: "Not allowed during deletion" })).status, 409);
    store.failRemoveAfter = undefined;
    assert.equal((await request("", undefined, "DELETE", "other-owner")).status, 404);
    assert.equal((await request("", undefined, "DELETE")).status, 200);
    assert.equal(await storage.getWorkroom(id), undefined);
    assert.equal(store.objects.size, 0, "all ready and failed-attempt blobs must be deleted");
    assert.equal((await download(first)).status, 404);
    const remaining = await pool.query("SELECT original_name FROM ruang_simpan_files WHERE id=$1", [b]);
    assert.equal(remaining.rowCount, 1, "deleting Workroom must not delete original Ruang Simpan files");
    const receipts = await pool.query("SELECT meta FROM workroom_logs WHERE workroom_id=$1", [id]);
    assert.ok(receipts.rows.every(row => !JSON.stringify(row.meta).includes("Evidence A.pdf")));
  } finally {
    store.failPut = false; store.failRead = false; store.failRemoveAfter = undefined;
    await pool.query("DELETE FROM ruang_simpan_files WHERE id=ANY($1::uuid[])", [[a, b]]);
  }
}
