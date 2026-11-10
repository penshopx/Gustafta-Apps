import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  extractKepdirjen281ChunksFromBytes,
  KEPDIRJEN_281_KB_NAME,
  KEPDIRJEN_281_PAGES,
  KEPDIRJEN_281_SHA256,
  KEPDIRJEN_281_TARGET_SLUGS,
} from "../server/seed-kepdirjen-281-claw-kb";

const sourcePath = path.resolve(
  process.cwd(),
  "attached_assets/KEP_DIRJEN_BK_281_STANDAR_SKEMA_SERTIFIKASI_26_AGUSTUS_2026_SU_1788273103134.pdf",
);

test("KB Kepdirjen 281 menargetkan empat Claw BUJK/SBU", () => {
  assert.deepEqual(KEPDIRJEN_281_TARGET_SLUGS, [
    "sbuclaw-orchestrator",
    "skema-claw-orchestrator",
    "pjbu-claw-orchestrator",
    "oss-claw-orchestrator",
  ]);
  assert.match(KEPDIRJEN_281_KB_NAME, /281\/KPTS\/DK\/2026/);
  assert.equal(KEPDIRJEN_281_SHA256.length, 64);
});

test("PDF resmi 281/2026 menghasilkan chunk berlabel halaman untuk RAG", async () => {
  const chunks = await extractKepdirjen281ChunksFromBytes(
    await readFile(sourcePath),
  );
  assert.ok(chunks.length >= Math.floor(KEPDIRJEN_281_PAGES * 0.8));
  assert.equal(chunks[0].pageNumber, 1);
  assert.match(chunks[0].content, /Halaman 1 dari 186/);

  const searchable = chunks.map((chunk) => chunk.content).join("\n");
  assert.match(searchable, /Standar Skema Sertifikasi Badan Usaha Jasa Konstruksi/i);
  assert.match(searchable, /Peraturan Menteri Pekerjaan Umum Nomor 6 Tahun 2025/i);
  assert.match(searchable, /surveilans/i);
  assert.match(searchable, /kompetensi personel/i);
});

test("seeder mempertahankan ID KB dan menolak embedding kosong", async () => {
  const source = await readFile(
    path.resolve(process.cwd(), "server/seed-kepdirjen-281-claw-kb.ts"),
    "utf8",
  );
  assert.match(source, /const keepId = existing\.rows\[0\]\?\.id/);
  assert.match(source, /UPDATE knowledge_bases/);
  assert.match(source, /Embedding Kepdirjen 281\/2026 tidak lengkap; KB lama tidak diubah/);
  assert.doesNotMatch(source, /DELETE FROM agents/);
});