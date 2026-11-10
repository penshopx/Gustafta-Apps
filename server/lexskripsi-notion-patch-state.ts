import { LEX_NOTION_SLUG, selectLexSkripsiTargets } from "./lexskripsi-patch-targets";

type NotionCandidate = {
  id: number;
  name: string;
  slug: string | null;
  description: string | null;
  systemPrompt: string | null;
  seriesSlug: string | null;
};
type Link = { agentId: number | string; role: string };
type Marker = { agentId: number | string };

/**
 * Fail closed before any patch write. A marker records history, not proof that
 * the agent still exists or that a similarly named row belongs to LexSkripsi.
 */
export function inspectNotionPatchState(
  candidates: NotionCandidate[],
  markers: Marker[],
  orchestratorId: number,
  links: unknown,
): { notionId: number | null; linked: boolean; markerExists: boolean } {
  const foreignMarker = markers.find((marker) => String(marker.agentId) !== String(orchestratorId));
  if (foreignMarker)
    throw new Error(`Penanda patch Notion milik ID ${foreignMarker.agentId}, bukan orchestrator LexSkripsi terverifikasi (${orchestratorId}); relasi tidak diubah`);
  if (!Array.isArray(links) || links.some((link) =>
    !link || typeof link !== "object" || !("role" in link) || !("agentId" in link)))
    throw new Error("Relasi subagen LexSkripsi tidak valid");

  const matching = candidates.filter((candidate) =>
    candidate.name === "AGENT-NOTION" || candidate.slug === LEX_NOTION_SLUG);
  const notion = matching.length
    ? selectLexSkripsiTargets(matching, ["notion"]).notion
    : null;
  if (matching.length !== (notion ? 1 : 0))
    throw new Error("Identitas atau seri AGENT-NOTION tidak terbukti; relasi tidak diubah");

  const notionLinks = (links as Link[]).filter((link) => link.role === "AGENT-NOTION");
  if (notionLinks.length > 1 || notionLinks.some((link) => !notion || Number(link.agentId) !== notion.id))
    throw new Error("Relasi AGENT-NOTION menunjuk agen lain atau agen hilang; relasi tidak diubah");

  return { notionId: notion?.id ?? null, linked: notionLinks.length === 1, markerExists: markers.length > 0 };
}