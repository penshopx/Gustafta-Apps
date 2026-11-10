import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { downloadFile } from "./object-storage";
import { WorkroomTransitionError, type WorkroomSourceState } from "@shared/workroom-transitions";

export const WORKROOM_SOURCE_LIMIT = 5;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type WorkroomSourceExecute = (query: SQL) => PromiseLike<{ rows: any[] }>;
export interface CapturedWorkroomSource {
  fileId: string; name: string; mimeType: string; bytes: Buffer;
}

export function workroomSourceIds(context: any): string[] {
  const ids = context?.ruangSimpanSourceIds;
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > WORKROOM_SOURCE_LIMIT ||
      ids.some(id => typeof id !== "string" || !UUID.test(id))) {
    throw new WorkroomTransitionError("Pilih maksimal 5 ID dokumen Ruang Simpan yang valid.", 400);
  }
  const normalized = ids.map(id => id.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new WorkroomTransitionError("Dokumen sumber tidak boleh dipilih dua kali.", 400);
  }
  return normalized.sort();
}

export function requireAvailableWorkroomSources(sources: WorkroomSourceState[]): void {
  if (sources.some(source => source.availability !== "available")) {
    throw new WorkroomTransitionError("Sumber tidak tersedia atau belum dapat diverifikasi. Periksa dokumen di Ruang Simpan atau lepaskan tautannya sebelum meninjau ulang.");
  }
}

async function boundedRead(read: () => Promise<Buffer>): Promise<Buffer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Source verification timeout")), 3000);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Owner-only pilot. Never reads grants, public flags, or a caller-supplied key.
 * All SQL uses the caller's transaction; source rows stay share-locked until its
 * review decision/transition commits. Storage failures are not "missing files". */
export async function loadWorkroomSources(
  execute: WorkroomSourceExecute, userId: string, context: unknown,
  readBytes: (key: string) => Promise<Buffer> = downloadFile,
  captured?: CapturedWorkroomSource[],
): Promise<WorkroomSourceState[]> {
  const ids = workroomSourceIds(context);
  if (!ids.length) return [];
  const { rows } = await execute(sql`
    SELECT id::text AS file_id, original_name, mime_type, doc_status, storage_key,
      size_bytes::text AS size_bytes, kb_status,
      CASE WHEN ${!!captured} THEN file_content ELSE NULL END AS captured_bytes,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS update_identity,
      file_content IS NOT NULL AS has_bytes,
      encode(sha256(COALESCE(file_content, ''::bytea)), 'hex') AS database_digest,
      encode(sha256(convert_to(COALESCE(extracted_text, ''), 'UTF8')), 'hex') AS extracted_digest
    FROM ruang_simpan_files
    WHERE user_id = ${userId} AND id IN (
      SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid
    )
    ORDER BY id FOR SHARE`);
  if (rows.reduce((sum, row) => sum + Math.max(0, Number(row.size_bytes) || 0), 0) > MAX_TOTAL_BYTES) {
    throw new WorkroomTransitionError("Total ukuran sumber Workroom maksimal 20 MB.", 400);
  }
  const byId = new Map(rows.map(row => [row.file_id, row]));
  return Promise.all(ids.map(async fileId => {
    const row = byId.get(fileId);
    if (!row || row.doc_status !== "aktif") {
      // Do not disclose the name/status/owner of missing or foreign documents.
      return { fileId, availability: "unavailable" as const, revision: "unavailable" };
    }
    let digest = row.database_digest;
    let capturedBytes: Buffer | undefined;
    try {
      if (row.storage_key) {
        if (!row.storage_key.startsWith(`ruang-simpan/${userId}/${fileId}/`)) throw new Error("Invalid source ownership");
        const bytes = await boundedRead(() => readBytes(row.storage_key));
        if (bytes.length !== Number(row.size_bytes) || bytes.length > MAX_TOTAL_BYTES) throw new Error("Source size changed");
        digest = createHash("sha256").update(bytes).digest("hex");
        capturedBytes = bytes;
      } else if (!row.has_bytes) {
        throw new Error("Source bytes not ready");
      } else if (captured) {
        capturedBytes = Buffer.from(row.captured_bytes);
        if (capturedBytes.length !== Number(row.size_bytes)) throw new Error("Source size changed");
      }
    } catch {
      return { fileId, name: row.original_name, availability: "verification_failed" as const, revision: "verification_failed" };
    }
    const revision = createHash("sha256").update(JSON.stringify([
      digest, row.update_identity, row.extracted_digest, row.kb_status, row.original_name, row.size_bytes,
    ])).digest("hex");
    if (captured && capturedBytes) captured.push({
      fileId, name: row.original_name, mimeType: row.mime_type, bytes: capturedBytes,
    });
    return { fileId, name: row.original_name, availability: "available" as const, revision };
  }));
}
