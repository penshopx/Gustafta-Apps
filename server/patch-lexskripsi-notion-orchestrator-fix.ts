/**
 * patch-lexskripsi-notion-orchestrator-fix.ts
 * Fix: tambah AGENT-NOTION ke agenticSubAgents orchestrator LexSkripsi
 */

import { db } from "./db";
import { agents, knowledgeBases, series, toolboxes } from "../shared/schema";
import { eq, inArray, like } from "drizzle-orm";
import { selectLexSkripsiTargets } from "./lexskripsi-patch-targets";
import { inspectNotionPatchState } from "./lexskripsi-notion-patch-state";

const log = (msg: string) =>
  console.log(`${new Date().toLocaleTimeString()} [express] ${msg}`);

const PATCH_MARKER = "LEXSKRIPSI-NOTION-ORCH-FIX-v1";

export async function patchLexSkripsiNotionOrchFix(
  options: { database?: typeof db; afterStage?: (stage: "link" | "marker") => void | Promise<void> } = {},
): Promise<{ done: boolean; skipped: boolean }> {
  return (options.database ?? db).transaction(async (tx) => {
  // Use the same parent lock as patchLexSkripsiNotionAgent. Acquire it before
  // reading the marker, candidates, or link so another startup sees our commit.
  const lexSeriesRows = await tx.select({ id: series.id }).from(series)
    .where(eq(series.slug, "lexskripsi-asisten-skripsi-hukum")).for("update");
  if (lexSeriesRows.length !== 1) throw new Error("Seri LexSkripsi tidak pasti; patch NOTION-ORCH-FIX dibatalkan");

  const markers = await tx.select({ agentId: knowledgeBases.agentId }).from(knowledgeBases)
    .where(like(knowledgeBases.name, `%${PATCH_MARKER}%`));
  const rows = await tx.select({
    id: agents.id, name: agents.name, slug: agents.slug,
    description: agents.description, systemPrompt: agents.systemPrompt,
    seriesSlug: series.slug,
  }).from(agents).leftJoin(toolboxes, eq(agents.toolboxId, toolboxes.id))
    .leftJoin(series, eq(toolboxes.seriesId, series.id))
    .where(inArray(agents.name, ["LexSkripsi", "AGENT-NOTION"]));
  const targets = selectLexSkripsiTargets(rows, ["orchestrator", "notion"]);
  const [orch] = await tx.select({ agenticSubAgents: agents.agenticSubAgents })
    .from(agents).where(eq(agents.id, targets.orchestrator.id)).limit(1);
  const state = inspectNotionPatchState([targets.notion], markers, targets.orchestrator.id, orch?.agenticSubAgents);
  if (state.markerExists && state.linked) {
    log("[Patch NOTION-ORCH-FIX] Penanda, agen, dan relasi terverifikasi, skip.");
    return { done: false, skipped: true };
  }
  log("[Patch NOTION-ORCH-FIX] Menambah AGENT-NOTION ke agenticSubAgents orchestrator...");
  const currentSubAgents = orch.agenticSubAgents as Array<{ agentId: number | string; role: string; description: string }>;
  const alreadyIn = currentSubAgents.some((subAgent) => Number(subAgent.agentId) === targets.notion.id && subAgent.role === "AGENT-NOTION");
  if (currentSubAgents.some((subAgent) => subAgent.role === "AGENT-NOTION" && Number(subAgent.agentId) !== targets.notion.id))
    throw new Error("Relasi AGENT-NOTION menunjuk agen lain; patch dibatalkan");

  if (!alreadyIn) {
    const newSubAgents = [
      ...currentSubAgents,
      {
        agentId: targets.notion.id,
        role: "AGENT-NOTION",
        description: "Manajemen workspace Notion: simpan catatan bimbingan, buat database tracker bab, update progress, cari dokumen skripsi",
      },
    ];

    await tx.update(agents).set({ agenticSubAgents: newSubAgents })
      .where(eq(agents.id, targets.orchestrator.id));

    log(`[Patch NOTION-ORCH-FIX] ✅ Orchestrator (${targets.orchestrator.id}) — agenticSubAgents sekarang ${newSubAgents.length} sub-agent`);
  } else {
    log("[Patch NOTION-ORCH-FIX] AGENT-NOTION sudah ada di agenticSubAgents, skip.");
  }
  await options.afterStage?.("link");

  if (!state.markerExists) await tx.insert(knowledgeBases).values({
    agentId: targets.orchestrator.id,
    name: `[PATCH_MARKER] ${PATCH_MARKER} — ${new Date().toISOString()}`,
    type: "text",
    content: `Patch marker: ${PATCH_MARKER}. AGENT-NOTION (${targets.notion.id}) ditambahkan ke orchestrator ${targets.orchestrator.id}.`,
    description: "Patch marker otomatis",
    processingStatus: "completed",
    status: "active",
  });
  await options.afterStage?.("marker");

  log("[Patch NOTION-ORCH-FIX] SELESAI");
  return { done: true, skipped: false };
  });
}
