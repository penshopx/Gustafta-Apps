import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectNotionPatchState } from "../server/lexskripsi-notion-patch-state";

const agent = {
  id: 9006,
  name: "AGENT-NOTION",
  slug: "lexskripsi-agent-notion",
  description: "Sub-agent LexSkripsi",
  systemPrompt: "Kamu adalah anggota tim LexSkripsi",
  seriesSlug: "lexskripsi-asisten-skripsi-hukum",
};
const marker = [{ agentId: 9001 }];

test("penanda ada namun agen hilang: pulihkan hanya saat tidak ada kandidat atau relasi spekulatif", () => {
  assert.deepEqual(inspectNotionPatchState([], marker, 9001, []), {
    notionId: null, linked: false, markerExists: true,
  });
  assert.throws(
    () => inspectNotionPatchState([], marker, 9001, [{ role: "AGENT-NOTION", agentId: 1447 }]),
    /agen hilang/,
  );
});

test("agen ada: skip hanya setelah identitas, seri, marker dan relasi diperiksa", () => {
  assert.deepEqual(inspectNotionPatchState([agent], marker, 9001, [{ role: "AGENT-NOTION", agentId: 9006 }]), {
    notionId: 9006, linked: true, markerExists: true,
  });
  assert.throws(() => inspectNotionPatchState([{ ...agent, seriesSlug: "other" }], marker, 9001, []), /tidak pasti/);
  assert.throws(() => inspectNotionPatchState([agent, { ...agent, id: 9007 }], marker, 9001, []), /tidak pasti/);
  assert.throws(() => inspectNotionPatchState([agent], [{ agentId: 777 }], 9001, []), /ID 777.*9001.*relasi tidak diubah/);
  assert.throws(() => inspectNotionPatchState([agent], marker, 9001, [{ role: "AGENT-NOTION", agentId: 777 }]), /relasi tidak diubah/);
});

test("penanda fix tidak cukup bila hubungan belum ada; identitas terbukti bisa diperbaiki", () => {
  assert.deepEqual(inspectNotionPatchState([agent], marker, 9001, []), {
    notionId: 9006, linked: false, markerExists: true,
  });
});