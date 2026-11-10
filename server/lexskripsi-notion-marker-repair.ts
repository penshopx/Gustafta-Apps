import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "./db";
import { agents, knowledgeBases, series, toolboxes } from "../shared/schema";
import { LEX_NOTION_SLUG, selectLexSkripsiTargets } from "./lexskripsi-patch-targets";
import { inspectNotionPatchState } from "./lexskripsi-notion-patch-state";

const MARKER = "LEXSKRIPSI-NOTION-AGENT-v1";
const SERIES = "lexskripsi-asisten-skripsi-hukum";
const LEGACY_KB = [
  "Panduan Workspace Skripsi di Notion — Template & Struktur yang Disarankan",
  "Panduan Perintah AGENT-NOTION — Cara Meminta & Format Output",
];

export type NotionMarkerConfirmation = {
  markerId: number;
  oldOwnerId: number;
  orchestratorId: number;
  historicalNotionId: number;
};

/**
 * Read-only by default. In apply mode every supplied ID is a required assertion,
 * not a target chosen from a list. The series lock serializes this with startup.
 * Legacy KBs are deliberately left untouched as historical evidence.
 */
export async function reviewNotionMarker(
  confirmation?: NotionMarkerConfirmation,
  database: typeof db = db,
) {
  return database.transaction(async (tx) => {
    const lexSeries = await tx.select({ id: series.id }).from(series)
      .where(eq(series.slug, SERIES)).for(confirmation ? "update" : "share");
    if (lexSeries.length !== 1) throw new Error("Seri LexSkripsi tidak pasti");
    const rows = await tx.select({
      id: agents.id, name: agents.name, slug: agents.slug,
      description: agents.description, systemPrompt: agents.systemPrompt,
      toolboxId: agents.toolboxId, seriesSlug: series.slug,
    }).from(agents).leftJoin(toolboxes, eq(agents.toolboxId, toolboxes.id))
      .leftJoin(series, eq(toolboxes.seriesId, series.id))
      .where(or(eq(agents.name, "LexSkripsi"), eq(agents.name, "AGENT-NOTION"),
        eq(agents.slug, LEX_NOTION_SLUG)));
    const { orchestrator } = selectLexSkripsiTargets(rows, ["orchestrator"]);
    const candidates = rows.filter((row) => row.name === "AGENT-NOTION" || row.slug === LEX_NOTION_SLUG);
    const notion = candidates.length ? selectLexSkripsiTargets(candidates, ["notion"]).notion : null;
    if (candidates.length > 1) throw new Error("Kandidat Notion ambigu");

    const markers = await tx.select({
      id: knowledgeBases.id, agentId: knowledgeBases.agentId,
      name: knowledgeBases.name, content: knowledgeBases.content,
    }).from(knowledgeBases).where(like(knowledgeBases.name, `%${MARKER}%`));
    if (markers.length !== 1 || !markers[0].name.startsWith(`[PATCH_MARKER] ${MARKER} — `))
      throw new Error("Penanda Notion hilang, ganda, atau format tidak dikenal");
    const marker = markers[0];
    const historicalId = marker.content.match(/^Patch marker: LEXSKRIPSI-NOTION-AGENT-v1\. AGENT-NOTION \(ID ([1-9]\d*)\) dibuat sebagai sub-agent LexSkripsi ke-5\./)?.[1];
    if (!historicalId) throw new Error("Riwayat agen di penanda tidak dapat dibuktikan");
    // Read the exact historical IDs, including unrelated agents, rather than
    // assuming that a removed ID still belongs to LexSkripsi.
    const historicalRows = await tx.select({
      id: agents.id, name: agents.name, seriesSlug: series.slug,
    }).from(agents).leftJoin(toolboxes, eq(agents.toolboxId, toolboxes.id))
      .leftJoin(series, eq(toolboxes.seriesId, series.id))
      .where(inArray(agents.id, [marker.agentId, Number(historicalId)]));
    const historicalOwner = historicalRows.find((row) => row.id === marker.agentId);
    const historicalAgent = historicalRows.filter((row) => row.id === Number(historicalId));
    const oldKb = await tx.select({ id: knowledgeBases.id, name: knowledgeBases.name })
      .from(knowledgeBases).where(and(
        eq(knowledgeBases.agentId, Number(historicalId)),
        inArray(knowledgeBases.name, LEGACY_KB),
      ));
    const [orch] = await tx.select({ agenticSubAgents: agents.agenticSubAgents })
      .from(agents).where(eq(agents.id, orchestrator.id));
    // Check the relation independent of the misplaced marker; still reject
    // wrong, duplicate or unverified AGENT-NOTION links.
    const state = inspectNotionPatchState(notion ? [notion] : [], [{ agentId: orchestrator.id }],
      orchestrator.id, orch?.agenticSubAgents);

    const report = {
      markerId: marker.id, markerOwnerId: marker.agentId,
      markerOwner: historicalOwner?.name ?? null,
      markerOwnerSeries: historicalOwner?.seriesSlug ?? null,
      orchestratorId: orchestrator.id, orchestratorSeries: orchestrator.seriesSlug,
      historicalNotionId: Number(historicalId),
      historicalNotion: historicalAgent[0]?.name ?? null,
      historicalNotionSeries: historicalAgent[0]?.seriesSlug ?? null,
      historicalKb: oldKb.map((kb) => ({ id: kb.id, name: kb.name })),
      currentNotionId: notion?.id ?? null, linked: state.linked,
    };
    if (!confirmation) return { ...report, repaired: false };
    if (!Object.values(confirmation).every((id) => Number.isSafeInteger(id) && id > 0) ||
      confirmation.markerId !== marker.id || confirmation.oldOwnerId !== marker.agentId ||
      confirmation.orchestratorId !== orchestrator.id ||
      confirmation.historicalNotionId !== Number(historicalId))
      throw new Error("Konfirmasi ID tidak cocok; penanda tidak diubah");
    if (marker.agentId === orchestrator.id ||
      historicalOwner || historicalAgent.length ||
      oldKb.length !== LEGACY_KB.length ||
      !LEGACY_KB.every((name) => oldKb.some((kb) => kb.name === name)))
      throw new Error("Riwayat agen tidak cocok dengan kasus orphan; penanda tidak diubah");

    const updated = await tx.update(knowledgeBases).set({
      agentId: orchestrator.id,
      content: `${marker.content}\nPemulihan terverifikasi: penanda ${marker.id} semula pada ID ${marker.agentId}; orchestrator seri ${SERIES} ID ${orchestrator.id}. Dokumen historis agen ${historicalId} tetap tidak dipindahkan.`,
    }).where(and(eq(knowledgeBases.id, marker.id), eq(knowledgeBases.agentId, marker.agentId)))
      .returning({ id: knowledgeBases.id });
    if (updated.length !== 1) throw new Error("Penanda berubah saat pemulihan; dibatalkan");
    return { ...report, repaired: true };
  });
}