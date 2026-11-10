import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { DatabaseStorage } from "../server/db-storage";
import { WorkroomTransitionError } from "../shared/workroom-transitions";

type Request = (path: string, body: any, method?: string, owner?: string | null, withReview?: boolean) => Promise<Response>;

/** Called only after prepareTestDatabase() has proven the disposable database. */
export async function assertWorkroomSources(storage: DatabaseStorage, pool: Pool, id: number, request: Request) {
  const a = randomUUID(), b = randomUUID(), foreign = randomUUID();
  const extraRooms: number[] = [];
  const snapshot = async () => {
    const room = await storage.getWorkroomReviewSnapshot(id, "fixture-owner");
    assert.ok(room);
    return room;
  };
  const expected = (room: Awaited<ReturnType<typeof snapshot>>) => ({
    expectedReviewRevision: room.reviewRevision, expectedReviewFingerprint: room.reviewFingerprint,
  });
  async function approveAll() {
    for (const gate of (await snapshot()).gates) {
      assert.equal((await request(`/gate/${gate.id}/decide`, { status: "approved" })).status, 200);
    }
  }
  await pool.query(`CREATE TABLE ruang_simpan_files (
    id uuid PRIMARY KEY, user_id text NOT NULL, original_name text NOT NULL,
    mime_type text NOT NULL DEFAULT 'application/octet-stream',
    doc_status text NOT NULL DEFAULT 'aktif', size_bytes bigint NOT NULL,
    storage_key text, file_content bytea, extracted_text text, kb_status text NOT NULL DEFAULT 'ready',
    updated_at timestamptz NOT NULL DEFAULT now())`);
  try {
    for (const [fileId, user, name] of [[a, "fixture-owner", "Owned A"], [b, "fixture-owner", "Owned B"], [foreign, "other-owner", "PRIVATE FOREIGN TITLE"]]) {
      await pool.query("INSERT INTO ruang_simpan_files(id,user_id,original_name,size_bytes,file_content) VALUES($1,$2,$3,1,$4)",
        [fileId, user, name, Buffer.from("A")]);
    }
    const options = await (await request("/source-options", undefined, "GET")).json();
    assert.deepEqual(options.map((o: any) => o.fileId).sort(), [a, b].sort());
    assert.equal((await request("/source-options", undefined, "GET", "other-owner")).status, 404);
    assert.equal((await request("/source-options", undefined, "GET", null)).status, 401);
    assert.equal((await request("/sources", { fileIds: [a] }, "POST", "other-owner")).status, 404);
    assert.equal((await request("/sources", { fileIds: [a] }, "POST", null)).status, 401);
    assert.equal((await request("/sources", { fileIds: ["not-a-uuid"] })).status, 400);
    const beforeInvalid = await snapshot();
    const denied = await request("/sources", { fileIds: [foreign] });
    assert.equal(denied.status, 409);
    assert.ok(!(await denied.text()).includes("PRIVATE FOREIGN TITLE"));
    assert.deepEqual(await snapshot(), beforeInvalid, "invalid selection must not partially write context or logs");
    assert.equal((await request("/sources", { fileIds: [a] })).status, 200);
    assert.equal((await snapshot()).sources[0].name, "Owned A");
    await approveAll();
    assert.equal((await request("", { status: "done" }, "PATCH")).status, 200);
    const original = await snapshot();
    assert.equal(original.status, "done");
    assert.equal((await request("", { title: "Changed together with completion", status: "done" }, "PATCH")).status, 409);
    assert.equal((await snapshot()).title, original.title);
    await pool.query("UPDATE ruang_simpan_files SET file_content=$1,size_bytes=2,updated_at=clock_timestamp() WHERE id=$2", [Buffer.from("A2"), a]);
    const changed = await snapshot();
    assert.equal(changed.status, "active", "completion of an older source version is not current completion");
    assert.equal(changed.reviewRevision, original.reviewRevision);
    assert.notEqual(changed.reviewFingerprint, original.reviewFingerprint);
    assert.ok(changed.gates.every(g => g.status === "pending"));
    assert.equal((await request(`/gate/${changed.gates[0].id}/decide`, { status: "approved", ...expected(original) })).status, 409);
    assert.equal((await request("", { status: "done" }, "PATCH")).status, 409);
    await pool.query("UPDATE ruang_simpan_files SET file_content=$1,size_bytes=1,updated_at=clock_timestamp() WHERE id=$2", [Buffer.from("A"), a]);
    assert.notEqual((await snapshot()).sources[0].revision, original.sources[0].revision, "A→B→A through versioned source writes cannot revive approval");
    await approveAll();
    const beforeRace = await snapshot();
    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      const holder = await writer.query("SELECT pg_backend_pid() AS pid");
      await writer.query("SELECT id FROM ruang_simpan_files WHERE id=$1 FOR UPDATE", [a]);
      const pending = storage.decideWorkroomGate(beforeRace.gates[0].id, "approved", "", "fixture-owner", expected(beforeRace))
        .then(() => null, error => error);
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const check = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))", [holder.rows[0].pid]);
        if (check.rowCount) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await writer.query("UPDATE ruang_simpan_files SET extracted_text='New source extraction',updated_at=clock_timestamp() WHERE id=$1", [a]);
      await writer.query("COMMIT");
      const error = await pending;
      assert.ok(blocked, "approval must share-lock the actual source row");
      assert.ok(error instanceof WorkroomTransitionError && error.statusCode === 409);
      assert.equal((await snapshot()).logs.length, beforeRace.logs.length, "stale approval must not append a success record");
    } finally { await writer.query("ROLLBACK"); writer.release(); }
    await pool.query("UPDATE ruang_simpan_files SET doc_status='arsip',updated_at=clock_timestamp() WHERE id=$1", [a]);
    const archived = await snapshot();
    assert.equal(archived.sources[0].availability, "unavailable");
    assert.equal((await request(`/gate/${archived.gates[0].id}/decide`, { status: "approved" })).status, 409);
    await pool.query("UPDATE ruang_simpan_files SET doc_status='aktif',user_id='other-owner',updated_at=clock_timestamp() WHERE id=$1", [a]);
    assert.equal((await snapshot()).sources[0].name, undefined, "ownership loss must not expose source metadata");
    await pool.query("DELETE FROM ruang_simpan_files WHERE id=$1", [a]);
    assert.equal((await snapshot()).sources[0].availability, "unavailable");
    assert.equal((await request("/sources", { fileIds: [] })).status, 200, "owner can detach an unavailable source");
    assert.deepEqual((await snapshot()).sources, []);

    // Source guards also protect rooms with no human gates.
    const empty = await storage.createWorkroom({ userId: "fixture-owner", title: "No-gate fixture",
      stages: [{ key: "brief", label: "Brief" }, { key: "review", label: "Review" }],
      context: { ruangSimpanSourceIds: [b] } });
    extraRooms.push(empty.id);
    const fresh = await storage.getWorkroomReviewSnapshot(empty.id, "fixture-owner");
    assert.ok(fresh);
    await assert.rejects(storage.updateWorkroom(empty.id, { currentStage: 1 }), { statusCode: 409 });
    await storage.updateWorkroom(empty.id, { status: "done" }, expected(fresh));
    assert.equal((await storage.getWorkroomReviewSnapshot(empty.id, "fixture-owner"))?.status, "done");
    await pool.query("UPDATE ruang_simpan_files SET file_content=NULL,updated_at=clock_timestamp() WHERE id=$1", [b]);
    const unreadable = await storage.getWorkroomReviewSnapshot(empty.id, "fixture-owner");
    assert.equal(unreadable?.sources[0].availability, "verification_failed", "missing bytes are not a missing record");
    assert.equal(unreadable?.status, "active");
    await assert.rejects(storage.updateWorkroom(empty.id, { status: "done" }, expected(fresh)), { statusCode: 409 });
    await assert.rejects(storage.createWorkroom({ userId: "fixture-owner", title: "Forbidden initial source", context: { ruangSimpanSourceIds: [foreign] } }), { statusCode: 409 });
  } finally {
    for (const roomId of extraRooms) await storage.deleteWorkroom(roomId);
    await pool.query("DELETE FROM ruang_simpan_files WHERE id=ANY($1::uuid[])", [[a, b, foreign]]);
  }
}
