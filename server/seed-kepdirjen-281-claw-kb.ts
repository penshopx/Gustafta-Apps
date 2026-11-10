import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { PDFParse } from "pdf-parse";
import { pool } from "./db";
import { createEmbeddings } from "./lib/rag-service";

export const KEPDIRJEN_281_KB_NAME =
  "[REGULASI RESMI] Kepdirjen PU 281/KPTS/DK/2026 — Standar Skema Sertifikasi BUJK";
export const KEPDIRJEN_281_SHA256 =
  "8055de1c63f7139a680540ae6da789c663029b4a5d1683a1e2ca28a4259a588f";
export const KEPDIRJEN_281_PAGES = 186;
export const KEPDIRJEN_281_EFFECTIVE_DATE = "2026-08-26";
export const KEPDIRJEN_281_SOURCE_URL =
  "https://s.pu.go.id/MTY4Mg/KepdirjenBK281";
export const KEPDIRJEN_281_TARGET_SLUGS = [
  "sbuclaw-orchestrator",
  "skema-claw-orchestrator",
  "pjbu-claw-orchestrator",
  "oss-claw-orchestrator",
] as const;

const SOURCE_FILE =
  "KEP_DIRJEN_BK_281_STANDAR_SKEMA_SERTIFIKASI_26_AGUSTUS_2026_SU_1788273103134.pdf";
const SOURCE_CANDIDATES = [
  path.resolve(process.cwd(), "dist/private-assets", SOURCE_FILE),
  path.resolve(process.cwd(), "attached_assets", SOURCE_FILE),
];
const KB_DESCRIPTION_PREFIX =
  "Sumber primer BUJK/SBU; Kepdirjen 281/2026 menggantikan Kepdirjen 37/2025 dan menjadi petunjuk pelaksanaan Permen PU 06/2025.";

export type Kepdirjen281Chunk = {
  pageNumber: number;
  pageChunkIndex: number;
  content: string;
};

function normalizePdfText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitPageText(value: string, maxChars = 3_000): string[] {
  const chunks: string[] = [];
  let remaining = value.trim();
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf("\n", maxChars);
    if (cut < Math.floor(maxChars * 0.65)) {
      cut = remaining.lastIndexOf(" ", maxChars);
    }
    if (cut < Math.floor(maxChars * 0.5)) cut = maxChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function extractKepdirjen281ChunksFromBytes(
  bytes: Buffer,
): Promise<Kepdirjen281Chunk[]> {
  if (bytes.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("Aset Kepdirjen 281/2026 bukan PDF.");
  }
  const actualSha = createHash("sha256").update(bytes).digest("hex");
  if (actualSha !== KEPDIRJEN_281_SHA256) {
    throw new Error(`Hash PDF Kepdirjen 281/2026 tidak cocok (${actualSha}).`);
  }

  const parser = new PDFParse({ data: bytes });
  try {
    const parsed = await parser.getText();
    if (parsed.total !== KEPDIRJEN_281_PAGES) {
      throw new Error(
        `PDF Kepdirjen 281/2026 berisi ${parsed.total} halaman; seharusnya ${KEPDIRJEN_281_PAGES}.`,
      );
    }

    const chunks: Kepdirjen281Chunk[] = [];
    for (const page of parsed.pages) {
      const pageText = normalizePdfText(page.text || "");
      if (!pageText) continue;
      splitPageText(pageText).forEach((text, pageChunkIndex) => {
        chunks.push({
          pageNumber: page.num,
          pageChunkIndex,
          content: `Kepdirjen PU 281/KPTS/DK/2026 — Halaman ${page.num} dari ${KEPDIRJEN_281_PAGES}\n\n${text}`,
        });
      });
    }
    if (chunks.length < Math.floor(KEPDIRJEN_281_PAGES * 0.8)) {
      throw new Error(
        `Ekstraksi Kepdirjen 281/2026 hanya menghasilkan ${chunks.length} chunk.`,
      );
    }
    return chunks;
  } finally {
    await parser.destroy();
  }
}

async function loadOfficialPdf(): Promise<Buffer> {
  for (const candidate of SOURCE_CANDIDATES) {
    try {
      return await readFile(candidate);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`PDF resmi Kepdirjen 281/2026 tidak ditemukan: ${SOURCE_FILE}`);
}

type TargetState = {
  agentId: number;
  slug: string;
  kbId: number | null;
  description: string;
  chunkCount: number;
  embeddedCount: number;
};

async function getTargetStates(): Promise<TargetState[]> {
  const result = await pool.query(
    `SELECT
       a.id AS agent_id,
       a.slug,
       managed.id AS kb_id,
       COALESCE(managed.description, '') AS description,
       COUNT(kc.id)::int AS chunk_count,
       COUNT(kc.id) FILTER (
         WHERE jsonb_typeof(kc.embedding) = 'array'
           AND jsonb_array_length(kc.embedding) > 0
       )::int AS embedded_count
     FROM agents a
     LEFT JOIN LATERAL (
       SELECT kb.id, kb.description
       FROM knowledge_bases kb
       WHERE kb.agent_id = a.id AND kb.name = $2
       ORDER BY kb.id
       LIMIT 1
     ) managed ON TRUE
     LEFT JOIN knowledge_chunks kc ON kc.knowledge_base_id = managed.id
     WHERE a.slug = ANY($1::text[])
     GROUP BY a.id, a.slug, managed.id, managed.description
     ORDER BY a.slug`,
    [KEPDIRJEN_281_TARGET_SLUGS, KEPDIRJEN_281_KB_NAME],
  );
  return result.rows.map((row) => ({
    agentId: Number(row.agent_id),
    slug: String(row.slug),
    kbId: row.kb_id == null ? null : Number(row.kb_id),
    description: String(row.description || ""),
    chunkCount: Number(row.chunk_count || 0),
    embeddedCount: Number(row.embedded_count || 0),
  }));
}

function isComplete(state: TargetState): boolean {
  return (
    state.kbId != null &&
    state.description.includes(`sha256=${KEPDIRJEN_281_SHA256}`) &&
    state.chunkCount >= Math.floor(KEPDIRJEN_281_PAGES * 0.8) &&
    state.embeddedCount === state.chunkCount
  );
}

async function insertChunkBatch(
  client: PoolClient,
  kbId: number,
  agentId: number,
  chunks: Kepdirjen281Chunk[],
  embeddings: number[][],
  start: number,
  end: number,
): Promise<void> {
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (let index = start; index < end; index++) {
    const base = values.length;
    const chunk = chunks[index];
    values.push(
      kbId,
      agentId,
      index,
      chunk.content,
      Math.ceil(chunk.content.length / 4),
      JSON.stringify(embeddings[index]),
      JSON.stringify({
        sourceName: KEPDIRJEN_281_KB_NAME,
        sourceAuthority: "Direktorat Jenderal Bina Konstruksi, Kementerian Pekerjaan Umum",
        sourceSha256: KEPDIRJEN_281_SHA256,
        pageNumber: chunk.pageNumber,
        pageChunkIndex: chunk.pageChunkIndex,
        totalPages: KEPDIRJEN_281_PAGES,
        scope: "BUJK/SBU; bukan dasar langsung sertifikasi SKK",
      }),
    );
    tuples.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6}::jsonb,$${base + 7}::jsonb,NOW())`,
    );
  }
  await client.query(
    `INSERT INTO knowledge_chunks
       (knowledge_base_id, agent_id, chunk_index, content, token_count, embedding, metadata, created_at)
     VALUES ${tuples.join(",")}`,
    values,
  );
}

async function reconcileTarget(
  state: TargetState,
  chunks: Kepdirjen281Chunk[],
  embeddings: number[][],
  extractedText: string,
  fileSize: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `kepdirjen-281-kb:${state.agentId}`,
    ]);

    const existing = await client.query<{ id: number }>(
      `SELECT id FROM knowledge_bases
       WHERE agent_id = $1 AND name = $2
       ORDER BY id
       FOR UPDATE`,
      [state.agentId, KEPDIRJEN_281_KB_NAME],
    );
    const keepId = existing.rows[0]?.id ?? null;
    const allIds = existing.rows.map((row) => row.id);
    if (allIds.length > 0) {
      await client.query(
        "DELETE FROM knowledge_chunks WHERE knowledge_base_id = ANY($1::int[])",
        [allIds],
      );
    }

    const description =
      `${KB_DESCRIPTION_PREFIX} sha256=${KEPDIRJEN_281_SHA256}; ` +
      `pages=${KEPDIRJEN_281_PAGES}; chunks=${chunks.length}.`;
    let kbId: number;
    if (keepId != null) {
      await client.query(
        `UPDATE knowledge_bases
         SET type='pdf', content=$2, description=$3, file_type='application/pdf',
             file_name=$4, file_size=$5, file_url=$6, processing_status='completed',
             extracted_text=$7, knowledge_layer='foundational', source_url=$6,
             source_authority=$8, effective_date=$9::date, status='active'
         WHERE id=$1`,
        [
          keepId,
          KB_DESCRIPTION_PREFIX,
          description,
          SOURCE_FILE,
          fileSize,
          KEPDIRJEN_281_SOURCE_URL,
          extractedText,
          "Direktorat Jenderal Bina Konstruksi, Kementerian Pekerjaan Umum",
          KEPDIRJEN_281_EFFECTIVE_DATE,
        ],
      );
      kbId = keepId;
      if (allIds.length > 1) {
        await client.query(
          "DELETE FROM knowledge_bases WHERE id = ANY($1::int[])",
          [allIds.slice(1)],
        );
      }
    } else {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO knowledge_bases
           (agent_id, name, type, content, description, file_type, file_name,
            file_size, file_url, processing_status, extracted_text,
            knowledge_layer, source_url, source_authority, effective_date,
            status, is_shared, created_at)
         VALUES
           ($1,$2,'pdf',$3,$4,'application/pdf',$5,$6,$7,'completed',$8,
            'foundational',$7,$9,$10::date,'active',false,NOW())
         RETURNING id`,
        [
          state.agentId,
          KEPDIRJEN_281_KB_NAME,
          KB_DESCRIPTION_PREFIX,
          description,
          SOURCE_FILE,
          fileSize,
          KEPDIRJEN_281_SOURCE_URL,
          extractedText,
          "Direktorat Jenderal Bina Konstruksi, Kementerian Pekerjaan Umum",
          KEPDIRJEN_281_EFFECTIVE_DATE,
        ],
      );
      kbId = inserted.rows[0].id;
    }

    for (let start = 0; start < chunks.length; start += 50) {
      await insertChunkBatch(
        client,
        kbId,
        state.agentId,
        chunks,
        embeddings,
        start,
        Math.min(start + 50, chunks.length),
      );
    }
    await client.query(
      "UPDATE agents SET rag_enabled=true WHERE id=$1",
      [state.agentId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function seedKepdirjen281ClawKnowledge(): Promise<void> {
  const prefix = "[Seed Kepdirjen 281 Claw KB]";
  const states = await getTargetStates();
  const foundSlugs = new Set(states.map((state) => state.slug));
  const missing = KEPDIRJEN_281_TARGET_SLUGS.filter(
    (slug) => !foundSlugs.has(slug),
  );
  if (missing.length > 0) {
    throw new Error(`Target Claw tidak ditemukan: ${missing.join(", ")}`);
  }

  await pool.query(
    "UPDATE agents SET rag_enabled=true WHERE slug = ANY($1::text[])",
    [KEPDIRJEN_281_TARGET_SLUGS],
  );
  const stale = states.filter((state) => !isComplete(state));
  if (stale.length === 0) {
    console.log(
      `${prefix} Lengkap pada ${states.length} Claw; semua chunk memiliki embedding.`,
    );
    return;
  }

  const bytes = await loadOfficialPdf();
  const chunks = await extractKepdirjen281ChunksFromBytes(bytes);
  console.log(
    `${prefix} Membuat embedding sekali untuk ${chunks.length} chunk (${stale.length} target perlu rekonsiliasi).`,
  );
  const embeddings = await createEmbeddings(
    chunks.map((chunk) => chunk.content),
  );
  if (
    embeddings.length !== chunks.length ||
    embeddings.some((embedding) => !Array.isArray(embedding) || embedding.length === 0)
  ) {
    throw new Error(
      "Embedding Kepdirjen 281/2026 tidak lengkap; KB lama tidak diubah.",
    );
  }
  const extractedText = chunks.map((chunk) => chunk.content).join("\n\n");
  for (const state of stale) {
    await reconcileTarget(
      state,
      chunks,
      embeddings,
      extractedText,
      bytes.length,
    );
    console.log(
      `${prefix} ${state.slug}: ${chunks.length} chunk ber-embedding tersimpan.`,
    );
  }
}