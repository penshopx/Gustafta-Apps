import type { Pool } from "pg";
import type { PlanConfig } from "@shared/feature-plans";

export const BEDAH_DOKUMEN_MONTHLY_LIMITS = {
  free: 1,
  starter: 3,
  profesional: 20,
  bisnis: 100,
} as const;

export function getBedahDokumenMonthlyLimit(plan: Pick<PlanConfig, "tier">): number {
  if (plan.tier <= 0) return BEDAH_DOKUMEN_MONTHLY_LIMITS.free;
  if (plan.tier === 1) return BEDAH_DOKUMEN_MONTHLY_LIMITS.starter;
  if (plan.tier === 2) return BEDAH_DOKUMEN_MONTHLY_LIMITS.profesional;
  return BEDAH_DOKUMEN_MONTHLY_LIMITS.bisnis;
}

export function getBedahDokumenMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Gagal menentukan bulan kuota Bedah Dokumen");
  return `${year}-${month}`;
}

export type BedahDokumenQuotaResult =
  | { ok: true; used: number; limit: number; remaining: number; month: string }
  | { ok: false; used: number; limit: number; remaining: 0; month: string };

interface BedahDokumenReservationInput {
  userId: string;
  filename: string;
  originalName: string;
  fileSize: number;
  sourceFileId?: string;
}

export type BedahDokumenReservationResult =
  | { ok: false; quota: Extract<BedahDokumenQuotaResult, { ok: false }> }
  | { ok: true; id: number; created: boolean; quota?: Extract<BedahDokumenQuotaResult, { ok: true }> };

/**
 * Atomically consumes one document from the user's calendar-month allowance.
 * The conditional ON CONFLICT protects the cap across concurrent server instances.
 */
export async function consumeBedahDokumenQuota(
  pool: Pick<Pool, "query">,
  userId: string,
  plan: Pick<PlanConfig, "tier">,
  date = new Date(),
): Promise<BedahDokumenQuotaResult> {
  const month = getBedahDokumenMonth(date);
  const limit = getBedahDokumenMonthlyLimit(plan);
  const consumed = await pool.query<{ count: number }>(
    `INSERT INTO bedah_dokumen_monthly_usage (user_id, month, count, updated_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (user_id, month) DO UPDATE
       SET count = bedah_dokumen_monthly_usage.count + 1,
           updated_at = now()
       WHERE bedah_dokumen_monthly_usage.count < $3
     RETURNING count`,
    [userId, month, limit],
  );

  if (consumed.rows[0]) {
    const used = Number(consumed.rows[0].count);
    return { ok: true, used, limit, remaining: Math.max(0, limit - used), month };
  }

  const current = await pool.query<{ count: number }>(
    `SELECT count FROM bedah_dokumen_monthly_usage
      WHERE user_id = $1 AND month = $2`,
    [userId, month],
  );
  return {
    ok: false,
    used: Number(current.rows[0]?.count ?? limit),
    limit,
    remaining: 0,
    month,
  };
}

/**
 * Atomically reserves quota and creates the durable analysis row. Once quota is
 * charged, even a process crash leaves an analysis the user can see/reprocess.
 * Passing no plan is the explicit admin/superadmin quota bypass.
 */
export async function reserveBedahDokumenAnalysis(
  pool: Pick<Pool, "connect">,
  input: BedahDokumenReservationInput,
  plan?: Pick<PlanConfig, "tier">,
): Promise<BedahDokumenReservationResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let quota: Extract<BedahDokumenQuotaResult, { ok: true }> | undefined;
    if (plan) {
      const consumed = await consumeBedahDokumenQuota(client, input.userId, plan);
      if (!consumed.ok) {
        await client.query("ROLLBACK");
        return { ok: false, quota: consumed };
      }
      quota = consumed;
    }

    const values = [
      input.userId,
      input.filename,
      input.originalName,
      input.fileSize,
      input.sourceFileId ?? null,
    ];
    const insert = input.sourceFileId
      ? await client.query<{ id: number }>(
          `INSERT INTO document_analyses
             (user_id, filename, original_name, file_size, source_file_id, doc_type, extracted_text, status)
           VALUES ($1, $2, $3, $4, $5, 'lainnya', '', 'analyzing')
           ON CONFLICT (user_id, source_file_id) WHERE source_file_id IS NOT NULL DO NOTHING
           RETURNING id`,
          values,
        )
      : await client.query<{ id: number }>(
          `INSERT INTO document_analyses
             (user_id, filename, original_name, file_size, source_file_id, doc_type, extracted_text, status)
           VALUES ($1, $2, $3, $4, $5, 'lainnya', '', 'analyzing')
           RETURNING id`,
          values,
        );

    if (!insert.rows[0] && input.sourceFileId) {
      await client.query("ROLLBACK");
      const winner = await client.query<{ id: number }>(
        `SELECT id FROM document_analyses
          WHERE user_id = $1 AND source_file_id = $2 LIMIT 1`,
        [input.userId, input.sourceFileId],
      );
      if (!winner.rows[0]) throw new Error("Dokumen gagal dibuat");
      return { ok: true, id: Number(winner.rows[0].id), created: false };
    }

    await client.query("COMMIT");
    return { ok: true, id: Number(insert.rows[0].id), created: true, quota };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function bedahDokumenQuotaExceededBody(result: Extract<BedahDokumenQuotaResult, { ok: false }>) {
  const upgradeMessage = result.limit >= BEDAH_DOKUMEN_MONTHLY_LIMITS.bisnis
    ? "Kuota batas wajar bulan ini sudah terpakai. Hubungi tim Gustafta bila Anda membutuhkan kapasitas tambahan."
    : "Upgrade paket untuk mendapatkan kuota Bedah Dokumen yang lebih besar.";
  return {
    error: `Kuota Bedah Dokumen bulan ini sudah habis (${result.used}/${result.limit} dokumen). ${upgradeMessage}`,
    code: "BEDAH_DOKUMEN_QUOTA_EXHAUSTED",
    month: result.month,
    used: result.used,
    limit: result.limit,
    remaining: 0,
    upgradeUrl: "/cashflow-pbj",
  };
}