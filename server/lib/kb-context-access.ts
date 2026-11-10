import type { KnowledgeBase, KnowledgeChunk } from "@shared/schema";

// Never infer permission from an agent's public flag or a cached chunk's metadata.
// An unlabelled/missing parent is excluded rather than becoming public context.
export function canUseKBInContext(kb: KnowledgeBase, viewerId?: string | null): boolean {
  return kb.visibility === "platform"
    || (kb.visibility === "published" && !!kb.ownerUserId)
    || (kb.visibility === "private" && !!viewerId && !!kb.ownerUserId && kb.ownerUserId === viewerId);
}

export function selectContextKB(kbs: KnowledgeBase[], viewerId?: string | null): KnowledgeBase[] {
  return kbs.filter(kb => canUseKBInContext(kb, viewerId));
}

export function selectContextChunks(chunks: KnowledgeChunk[], kbs: KnowledgeBase[]): KnowledgeChunk[] {
  const allowed = new Set(kbs.map(kb => Number(kb.id)));
  return chunks.filter(chunk => allowed.has(chunk.knowledgeBaseId));
}

export async function loadContextSources(
  source: {
    getKnowledgeBases(agentId: string): Promise<KnowledgeBase[]>;
    getChunksByAgent(agentId: string): Promise<KnowledgeChunk[]>;
  },
  agentId: string,
  viewerId?: string | null,
) {
  const kbs = selectContextKB(await source.getKnowledgeBases(agentId), viewerId);
  const chunks = selectContextChunks(await source.getChunksByAgent(agentId), kbs);
  return { kbs, chunks };
}