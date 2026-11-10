import type { Pool, PoolClient, QueryResult } from "pg";

export const KEPDIRJEN_281_CANONICAL =
  "Keputusan Direktur Jenderal Bina Konstruksi Kementerian Pekerjaan Umum Nomor 281/KPTS/DK/2026 tentang Penetapan Standar Skema Sertifikasi Badan Usaha Jasa Konstruksi";
export const KEPDIRJEN_281_SHORT = "Kepdirjen PU No. 281/KPTS/DK/2026";

const SKK_SCOPE =
  `${KEPDIRJEN_281_SHORT} merupakan pedoman implementasi Permen PU No. 6 Tahun 2025 ` +
  "untuk sertifikasi BUJK/SBU dan tidak mengatur sertifikasi SKK secara langsung; " +
  "SKK hanya muncul sebagai dukungan personel bersertifikat/PJ bagi BUJK/SBU.";
const TECHNICAL_CONFIRMATION =
  `${KEPDIRJEN_281_CANONICAL} telah diterbitkan sebagai pedoman implementasi ` +
  "Permen PU No. 6 Tahun 2025 untuk sertifikasi BUJK/SBU. " +
  "Persyaratan teknis, tabel, kode, ambang, dan pemetaan perlu dikonfirmasi " +
  "terhadap lampiran resmi Kepdirjen PU No. 281/KPTS/DK/2026 " +
  "dan kanal LPJK/LSBU terkini.";
const LEGACY_TECHNICAL_CONFIRMATION =
  "Persyaratan teknis yang sebelumnya diatribusikan kepada Kepdirjen 37/2025 " +
  "perlu dikonfirmasi terhadap lampiran resmi Kepdirjen PU No. 281/KPTS/DK/2026 " +
  "dan kanal LPJK/LSBU terkini.";

// Deliberately finite: this reconciler must not rewrite unrelated mentions of
// the number 37 or infer that every 2025 regulation has been superseded.
const OLD_FULL_REFERENCES: RegExp[] = [
  /Keputusan Direktur Jenderal Bina Konstruksi(?: Kementerian Pekerjaan Umum(?: dan Perumahan Rakyat)?)? Nomor 37\/KPTS\/DK\/2025(?: tentang [^.\n]*)?/gi,
  /Keputusan Dirjen(?:deral)? Bina Konstruksi Nomor 37\/KPTS\/DK\/2025/gi,
];

const OLD_SHORT_REFERENCES: RegExp[] = [
  /Kepdirjen(?: PU| PUPR| BK)?(?: No\.?)?\s*37\/KPTS\/DK\/2025/gi,
  /Kepdirjen(?: PU| PUPR| BK)?(?: No\.?)?\s*37\/2025/gi,
  /SK Dirjen(?: Bina Konstruksi| BK| Binakon)?(?: No\.?)?\s*37\/KPTS\/DK\/2025/gi,
  /SK Dirjen(?: Bina Konstruksi| BK| Binakon)?(?: No\.?)?\s*37\/2025/gi,
  /SK Dirjen(?: Bina Konstruksi| BK| Binakon)?\s+37\/2025/gi,
  /\bSK\s+37\/2025\b/gi,
  /\b37\/KPTS\/DK\/2025\b/gi,
];

const TECHNICAL_WORDING =
  /\b(persyaratan|syarat|standar|komponen wajib|kriteria|minimum|minimal|LKUT|laporan keuangan|tenaga ahli|peralatan|kemampuan keuangan)\b/i;

export function transformKepdirjen281Text(input: string): string {
  let output = input.replace(
    LEGACY_TECHNICAL_CONFIRMATION,
    "Persyaratan teknis, tabel, kode, ambang, dan pemetaan perlu dikonfirmasi " +
      "terhadap lampiran resmi Kepdirjen PU No. 281/KPTS/DK/2026 " +
      "dan kanal LPJK/LSBU terkini.",
  );
  let replacedOldReference = false;

  output = output.replace(
    /[^.\n]*(?:(?:Kepdirjen|SK Dirjen)[^.\n]*pengganti|pengganti[^.\n]*(?:Kepdirjen|SK Dirjen))[^.\n]*(?:37\/2025|37\/KPTS\/DK\/2025)[^.\n]*(?:belum (?:terbit|diterbitkan|tersedia)|masih (?:ditunggu|menunggu))[^.\n]*\.?/gi,
    `${KEPDIRJEN_281_CANONICAL} telah diterbitkan sebagai pedoman implementasi Permen PU No. 6 Tahun 2025 untuk sertifikasi BUJK/SBU.`,
  );

  for (const pattern of OLD_FULL_REFERENCES) {
    output = output.replace(pattern, () => {
      replacedOldReference = true;
      return KEPDIRJEN_281_CANONICAL;
    });
  }
  for (const pattern of OLD_SHORT_REFERENCES) {
    output = output.replace(pattern, () => {
      replacedOldReference = true;
      return KEPDIRJEN_281_SHORT;
    });
  }

  // Remove the known stale transition message, now that 281 has been issued.
  output = output.replace(
    /(?:Kepdirjen PU No\. 281\/KPTS\/DK\/2026|SK Dirjen No\.?\s*37\/2025)\s+masih mengacu Permen lama\.\s*Gunakan\s+\*{0,2}Permen PU 6\/2025\*{0,2}\s+sebagai acuan utama\.?/gi,
    `${KEPDIRJEN_281_CANONICAL} telah diterbitkan sebagai pedoman implementasi Permen PU No. 6 Tahun 2025 untuk sertifikasi BUJK/SBU.`,
  );
  output = output.replace(
    /(?:pengganti|aturan pengganti|keputusan pengganti)(?:\s+Kepdirjen(?: PU)?(?: No\.?)?\s*37(?:\/2025|\/KPTS\/DK\/2025))?\s+(?:masih|sedang)\s+(?:ditunggu|menunggu|belum terbit|belum diterbitkan)/gi,
    `${KEPDIRJEN_281_SHORT} telah diterbitkan sebagai pedoman implementasi Permen PU No. 6 Tahun 2025`,
  );

  if (!replacedOldReference) return output;

  const mentionsSkk = /\b(SKK|Sertifikat Kompetensi Kerja|sertifikasi kompetensi kerja)\b/i.test(output);
  const directlyClaimsSkkScope =
    /\b(mengatur|dasar hukum|acuan|pedoman|standar)\b.{0,80}\b(SKK|sertifikasi kompetensi kerja)\b/i.test(output);
  if (mentionsSkk && directlyClaimsSkkScope && !output.includes(SKK_SCOPE)) {
    output = `${output}\n\n${SKK_SCOPE}`;
  }

  if (TECHNICAL_WORDING.test(input) && !output.includes(TECHNICAL_CONFIRMATION)) {
    output = `${output}\n\n${TECHNICAL_CONFIRMATION}`;
  }
  return output;
}

/** Recursively transforms string leaves without changing JSON/object shape. */
export function transformKepdirjen281Value(value: unknown): unknown {
  if (typeof value === "string") return transformKepdirjen281Text(value);
  if (Array.isArray(value)) return value.map(transformKepdirjen281Value);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        transformKepdirjen281Value(child),
      ]),
    );
  }
  return value;
}

type TableSpec = {
  table: string;
  columns: readonly string[];
  optional?: boolean;
  preserveSourceSha256?: string;
};

const OFFICIAL_KEPDIRJEN_281_SHA256 =
  "8055de1c63f7139a680540ae6da789c663029b4a5d1683a1e2ca28a4259a588f";

export const KEPDIRJEN_281_TABLES: readonly TableSpec[] = [
  { table: "series", columns: ["name", "description", "tagline", "category", "tags"] },
  { table: "cores", columns: ["name", "description"] },
  {
    table: "big_ideas",
    columns: ["name", "type", "description", "goals", "target_audience", "expected_outcome"],
  },
  {
    table: "toolboxes",
    columns: ["name", "description", "purpose", "capabilities", "limitations"],
  },
  {
    table: "agents",
    columns: [
      "name", "description", "tagline", "philosophy", "off_topic_response",
      "system_prompt", "greeting_message", "conversation_starters", "category",
      "subcategory", "context_priority", "proactive_help_types", "action_boundary",
      "escalation_rules", "source_priority", "personality", "expertise",
      "avoid_topics", "key_phrases", "product_summary", "product_features",
      "product_use_cases", "product_target_user", "product_problem",
      "context_questions", "landing_hero_headline", "landing_hero_subheadline",
      "landing_pain_points", "landing_solution_text", "landing_benefits",
      "landing_demo_items", "landing_faq", "landing_authority", "landing_guarantees",
      "ad_copies", "image_hook_prompts", "video_reel_prompts", "open_claw_rulebook",
      "open_claw_rulebook_category", "primary_outcome", "conversation_win_conditions",
      "fallback_objective", "brand_voice_spec", "reasoning_policy",
      "interaction_policy", "domain_charter", "quality_bar", "risk_compliance",
      "deliverables", "deliverable_bundle", "orchestrator_config",
      "agentic_sub_agents", "agentic_config", "tags",
    ],
  },
  {
    table: "knowledge_bases",
    columns: [
      "name", "type", "content", "description", "file_name", "extracted_text",
      "knowledge_layer", "source_authority",
    ],
    preserveSourceSha256: OFFICIAL_KEPDIRJEN_281_SHA256,
  },
  {
    table: "knowledge_chunks",
    columns: ["content", "metadata"],
    preserveSourceSha256: OFFICIAL_KEPDIRJEN_281_SHA256,
  },
  {
    table: "product_registry",
    columns: [
      "name", "short_description", "long_description", "target_users",
      "features", "benefits", "gallery",
    ],
  },
  {
    table: "store_products",
    columns: ["name", "description", "category", "features", "scalev_product_name"],
  },
  {
    table: "sbu_skk_tutor_sources",
    columns: ["source_title", "content", "search_terms"],
    optional: true,
  },
] as const;

type ReconcilePool = Pick<Pool, "connect">;
type ReconcileLogger = (message: string) => void;
const LEGACY_ROW_PATTERN =
  "37/(?:KPTS/DK/)?2025|SK Dirjen baru|Kepdirjen baru|keputusan pengganti";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function queryChangedRows(result: QueryResult): number {
  return result.rowCount ?? result.rows.length;
}

function serializeUpdatedValue(before: unknown, after: unknown): unknown {
  if (before !== null && typeof before === "object") {
    return JSON.stringify(after);
  }
  return after;
}

export async function reconcileKepdirjen281(
  dbPool: ReconcilePool,
  logger: ReconcileLogger = console.log,
): Promise<Record<string, number>> {
  const client = await dbPool.connect();
  const counts: Record<string, number> = {};
  try {
    await client.query("BEGIN");
    for (const spec of KEPDIRJEN_281_TABLES) {
      if (spec.optional) {
        const presence = await client.query(
          "SELECT to_regclass($1) AS table_name",
          [`public.${spec.table}`],
        );
        if (!presence.rows[0]?.table_name) {
          counts[spec.table] = 0;
          continue;
        }
      }
      const columnsSql = spec.columns.map(quoteIdentifier).join(", ");
      const searchableColumnsSql = spec.columns
        .map((column) => `COALESCE(${quoteIdentifier(column)}::text, '')`)
        .join(", ");
      const preserveSourceSql = spec.preserveSourceSha256
        ? spec.table === "knowledge_bases"
          ? " AND COALESCE(description, '') NOT LIKE '%' || $2 || '%'"
          : " AND COALESCE(metadata->>'sourceSha256', '') <> $2"
        : "";
      const selectParams = spec.preserveSourceSha256
        ? [LEGACY_ROW_PATTERN, spec.preserveSourceSha256]
        : [LEGACY_ROW_PATTERN];
      const selected = await client.query(
        `SELECT id, ${columnsSql} FROM ${quoteIdentifier(spec.table)}
         WHERE CONCAT_WS(' ', ${searchableColumnsSql}) ~* $1${preserveSourceSql}`,
        selectParams,
      );
      let changedRows = 0;
      for (const row of selected.rows) {
        const changedColumns: string[] = [];
        const params: unknown[] = [];
        for (const column of spec.columns) {
          const before = row[column];
          const after = transformKepdirjen281Value(before);
          if (JSON.stringify(after) !== JSON.stringify(before)) {
            params.push(serializeUpdatedValue(before, after));
            changedColumns.push(`${quoteIdentifier(column)} = $${params.length}`);
          }
        }
        if (changedColumns.length === 0) continue;
        params.push(row.id);
        const updated = await client.query(
          `UPDATE ${quoteIdentifier(spec.table)} SET ${changedColumns.join(", ")} WHERE id = $${params.length}`,
          params,
        );
        changedRows += queryChangedRows(updated);
      }
      counts[spec.table] = changedRows;
    }
    await client.query("COMMIT");
    for (const spec of KEPDIRJEN_281_TABLES) {
      logger(`[Kepdirjen281] ${spec.table}: ${counts[spec.table]} row(s) updated`);
    }
    logger("[Kepdirjen281] reconciliation committed");
    return counts;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger(`[Kepdirjen281] reconciliation rolled back: ${(error as Error).message}`);
    throw error;
  } finally {
    (client as PoolClient).release();
  }
}