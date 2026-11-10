import { pool } from "../db";
import { deleteFileStrict } from "./object-storage";

/** No FK: this intent must survive deletion of failed upload metadata. */
export async function ensureUploadCleanupTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ruang_simpan_upload_cleanup (
      storage_key TEXT PRIMARY KEY,
      file_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS rs_upload_cleanup_due
      ON ruang_simpan_upload_cleanup (next_attempt_at);
    CREATE INDEX IF NOT EXISTS rs_files_storage_key
      ON ruang_simpan_files (storage_key) WHERE storage_key IS NOT NULL
  `);
}

/** Bounded, multi-replica safe retries. Never infer absence from a failed DB read.
 * Intents share the reservation's one-hour grace until the writer settles.
 * Writers hold the file row lock through upload and content commit. NOWAIT
 * protects even a storage call that outlasts the grace period.
 */
export async function reconcileUploadCleanup(storageKey?: string): Promise<void> {
  const pending = await pool.query<{ storage_key: string }>(
    `SELECT storage_key FROM ruang_simpan_upload_cleanup
     WHERE next_attempt_at <= now() AND ($1::text IS NULL OR storage_key = $1)
     ORDER BY next_attempt_at LIMIT 20`, [storageKey ?? null],
  );
  for (const { storage_key: key } of pending.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const intent = await client.query(
        `SELECT file_id, user_id FROM ruang_simpan_upload_cleanup
         WHERE storage_key = $1 AND next_attempt_at <= now()
         FOR UPDATE SKIP LOCKED`, [key],
      );
      if (!intent.rowCount) {
        await client.query("ROLLBACK");
        continue;
      }
      const { file_id: fileId, user_id: userId } = intent.rows[0];
      await client.query(
        `SELECT id FROM ruang_simpan_files WHERE id = $1 FOR UPDATE NOWAIT`, [fileId],
      );
      const referenced = await client.query(
        `SELECT id FROM ruang_simpan_files WHERE storage_key = $1 LIMIT 1`, [key],
      );
      if (!referenced.rowCount) {
        // Empty metadata can only be a failed/crashed writer here. Reclaim its
        // quota too. A DB fallback (including zero bytes) is never removed.
        await client.query(
          `DELETE FROM ruang_simpan_files WHERE id = $1 AND user_id = $2
           AND storage_key IS NULL AND file_content IS NULL
           AND kb_status = 'pending' AND extracted_text IS NULL AND kb_chunk_count = 0
           AND NOT EXISTS (SELECT 1 FROM ruang_simpan_chunks WHERE file_id = $1)`,
          [fileId, userId],
        );
        await deleteFileStrict(key);
      }
      await client.query(`DELETE FROM ruang_simpan_upload_cleanup WHERE storage_key = $1`, [key]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      // Active writers are not failed cleanups; retry on the next sweep.
      if ((error as { code?: string }).code !== "55P03") {
        await client.query(
          `UPDATE ruang_simpan_upload_cleanup
           SET attempts = attempts + 1, next_attempt_at = now() + interval '1 minute'
           WHERE storage_key = $1`, [key],
        );
        console.error("[RuangSimpan] Upload cleanup deferred; object retained for retry");
      }
    } finally {
      client.release();
    }
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | undefined;
export function startUploadCleanup(): void {
  if (cleanupTimer) return;
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try { await reconcileUploadCleanup(); }
    catch { console.error("[RuangSimpan] Upload cleanup sweep failed; intents retained"); }
    finally { running = false; }
  };
  cleanupTimer = setInterval(() => { void sweep(); }, 60_000);
  cleanupTimer.unref();
  void sweep();
}
