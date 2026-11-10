import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkroomSources, requireAvailableWorkroomSources, workroomSourceIds } from "../server/lib/workroom-sources";

const id = "00000000-0000-4000-8000-000000000001";
const context = { ruangSimpanSourceIds: [id] };
const row = {
  file_id: id, original_name: "Private document", doc_status: "aktif", size_bytes: "1",
  storage_key: `ruang-simpan/owner/${id}/document.pdf`, has_bytes: false, database_digest: "",
  update_identity: "2026-10-26T12:00:00.000001", extracted_digest: "text", kb_status: "ready",
};
const execute = async () => ({ rows: [row] });

test("source IDs are bounded, canonical and duplicate-free", () => {
  assert.deepEqual(workroomSourceIds({}), []);
  assert.deepEqual(workroomSourceIds(context), [id]);
  for (const ids of [[id, id], [id, id, id, id, id, id], ["bad"], "bad", null]) {
    assert.throws(() => workroomSourceIds({ ruangSimpanSourceIds: ids }), { statusCode: 400 });
  }
});

test("object bytes are hashed, not just a filename or database timestamp", async () => {
  const first = await loadWorkroomSources(execute, "owner", context, async () => Buffer.from("A"));
  const next = await loadWorkroomSources(execute, "owner", context, async () => Buffer.from("B"));
  assert.equal(first[0].availability, "available");
  assert.notEqual(first[0].revision, next[0].revision);
  assert.ok(!JSON.stringify(first).includes("storage_key"));
  assert.ok(!JSON.stringify(first).includes("ruang-simpan/owner"));
});

test("storage errors remain verification failures, with no provider error disclosure", async () => {
  const failed = await loadWorkroomSources(execute, "owner", context, async () => { throw new Error("PRIVATE PROVIDER DETAILS"); });
  assert.equal(failed[0].availability, "verification_failed");
  assert.ok(!JSON.stringify(failed).includes("PRIVATE PROVIDER DETAILS"));
  assert.throws(() => requireAvailableWorkroomSources(failed), { statusCode: 409 });
  const mismatch = await loadWorkroomSources(execute, "owner", context, async () => Buffer.from("too big"));
  assert.equal(mismatch[0].availability, "verification_failed");
});

test("foreign storage keys are never fetched and missing records disclose no name", async () => {
  let reads = 0;
  const wrong = await loadWorkroomSources(async () => ({ rows: [{ ...row, storage_key: "ruang-simpan/other/secret" }] }),
    "owner", context, async () => { reads++; return Buffer.from("A"); });
  assert.equal(reads, 0);
  assert.equal(wrong[0].availability, "verification_failed");
  const missing = await loadWorkroomSources(async () => ({ rows: [] }), "owner", context);
  assert.equal(missing[0].availability, "unavailable");
  assert.equal(missing[0].name, undefined);
});

test("database failure is not converted to a missing document", async () => {
  await assert.rejects(loadWorkroomSources(async () => { throw new Error("database offline"); }, "owner", context),
    /database offline/);
});
