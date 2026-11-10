/**
 * patch-lexskripsi-fixsubagets.ts
 * Fix agenticSubAgents pada orchestrator LexSkripsi:
 * Pastikan semua 4 sub-agen terdaftar: METODE, SUBSTANSI, LAPANGAN, SIDANG
 */

import { storage } from "./storage";
import { db } from "./db";
import { knowledgeBases } from "./db/schema";
import { like } from "drizzle-orm";
import { resolveLexSkripsiTargets } from "./lexskripsi-patch-targets";

const log = (msg: string) =>
  console.log(`${new Date().toLocaleTimeString()} [express] ${msg}`);

const PATCH_MARKER = "LEXSKRIPSI-SUBAGETS-FIX-v1";

export async function patchLexSkripsiFixSubAgents(): Promise<{ fixed: boolean }> {
  // Cek apakah sudah difix
  const existing = await db
    .select()
    .from(knowledgeBases)
    .where(like(knowledgeBases.name, `%${PATCH_MARKER}%`))
    .limit(1);

  if (existing.length > 0) {
    log("[Patch LexSkripsi SubAgents Fix] Sudah difix sebelumnya, skip.");
    return { fixed: false };
  }

  // Gunakan storage.getAgent agar agenticSubAgents ter-map dengan benar
  const targets = await resolveLexSkripsiTargets(["orchestrator", "metode", "substansi", "lapangan", "sidang"]);
  const orchestrator = await storage.getAgent(String(targets.orchestrator.id));
  if (!orchestrator) {
    log("[Patch LexSkripsi SubAgents Fix] Orchestrator tidak ditemukan!");
    return { fixed: false };
  }

  const currentSubAgents = (orchestrator.agenticSubAgents as any[]) || [];
  log(`[Patch LexSkripsi SubAgents Fix] agenticSubAgents saat ini: ${currentSubAgents.length} agen`);

  // Daftar lengkap 4 sub-agen yang harus ada
  const REQUIRED = [
    {
      agentId: targets.metode.id,
      role: "AGENT-METODE",
      description:
        "Spesialis Metodologi Penelitian Hukum (Purwaka). Dispatch untuk pertanyaan: jenis penelitian, pendekatan, bahan hukum, proposal, Bab III.",
    },
    {
      agentId: targets.substansi.id,
      role: "AGENT-SUBSTANSI",
      description:
        "Spesialis PMH, Strict Liability & Hukum Konsumen. Dispatch untuk pertanyaan: 5 unsur PMH, beban pembuktian terbalik, regulasi MBDK, doktrin product liability.",
    },
    {
      agentId: targets.lapangan.id,
      role: "AGENT-LAPANGAN",
      description:
        "Spesialis Penelitian Empiris & Data Lapangan. Dispatch untuk: wawancara, data DM/MBDK Bekasi, instrumen lapangan Jatiasih, triangulasi.",
    },
    {
      agentId: targets.sidang.id,
      role: "AGENT-SIDANG",
      description:
        "Spesialis Pra-Sidang & Coaching Sidang. Dispatch untuk: audit checklist dokumen, simulasi pertanyaan dewan penguji, coaching real-time saat sidang berlangsung, evaluasi draft berdasarkan koreksian dosen.",
    },
  ];

  // Cek apakah semua 4 sudah ada
  const existingIds = currentSubAgents.map((a: any) => Number(a.agentId));
  const missingIds = REQUIRED.filter((r) => !existingIds.includes(r.agentId));

  if (missingIds.length === 0) {
    log("[Patch LexSkripsi SubAgents Fix] Semua 4 sub-agen sudah terdaftar, tidak perlu fix.");
    // Tetap tulis marker agar tidak dijalankan lagi
    await storage.createKnowledgeBase({
      agentId: String(targets.orchestrator.id),
      name: `[PATCH_MARKER] ${PATCH_MARKER} — Verified OK`,
      type: "text",
      content: `Patch marker: ${PATCH_MARKER}. Semua 4 sub-agen sudah terdaftar.`,
      description: "Patch marker otomatis",
      processingStatus: "completed",
      status: "active",
    } as any);
    return { fixed: true };
  }

  // Set ulang dengan 4 sub-agen lengkap
  await storage.updateAgent(String(targets.orchestrator.id), {
    agenticSubAgents: REQUIRED,
  } as any);
  log(`[Patch LexSkripsi SubAgents Fix] ✅ agenticSubAgents di-set ulang: 4 sub-agen`);
  log(`[Patch LexSkripsi SubAgents Fix]   - AGENT-METODE (${targets.metode.id})`);
  log(`[Patch LexSkripsi SubAgents Fix]   - AGENT-SUBSTANSI (${targets.substansi.id})`);
  log(`[Patch LexSkripsi SubAgents Fix]   - AGENT-LAPANGAN (${targets.lapangan.id})`);
  log(`[Patch LexSkripsi SubAgents Fix]   - AGENT-SIDANG (${targets.sidang.id})`);

  // Tulis marker agar tidak dijalankan lagi
  await storage.createKnowledgeBase({
    agentId: String(targets.orchestrator.id),
    name: `[PATCH_MARKER] ${PATCH_MARKER} — Fixed ${new Date().toISOString()}`,
    type: "text",
    content: `Patch marker: ${PATCH_MARKER}. agenticSubAgents di-set ulang dengan 4 sub-agen: METODE(${targets.metode.id}), SUBSTANSI(${targets.substansi.id}), LAPANGAN(${targets.lapangan.id}), SIDANG(${targets.sidang.id}).`,
    description: "Patch marker otomatis — jangan dihapus",
    processingStatus: "completed",
    status: "active",
  } as any);

  log("[Patch LexSkripsi SubAgents Fix] SELESAI — 4 sub-agen aktif pada orchestrator LexSkripsi");
  return { fixed: true };
}
