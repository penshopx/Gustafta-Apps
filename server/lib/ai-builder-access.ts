export interface AiBuilderAgentRecord {
  id: number | string;
  name?: string | null;
  tagline?: string | null;
  avatar?: string | null;
  createdAt?: string | Date | null;
  userId?: string | null;
  clonedFromAgentId?: number | string | null;
  archived?: boolean | null;
  isPublic?: boolean | null;
  isListed?: boolean | null;
  isEnabled?: boolean | null;
  systemPrompt?: string | null;
  agenticSubAgents?: unknown;
}

export interface AiBuilderTemplateCard {
  id: number | string;
  name: string;
  tagline: string | null;
  avatar: string | null;
}

export interface AiBuilderOwnedAgentCard extends AiBuilderTemplateCard {
  createdAt: string | Date | null;
  clonedFromAgentId: string | null;
}

export class AiBuilderTemplateError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 500) {
    super(message);
    this.name = "AiBuilderTemplateError";
  }
}

function hasCloneSource(agent: AiBuilderAgentRecord): boolean {
  return agent.clonedFromAgentId != null && String(agent.clonedFromAgentId).trim() !== "";
}

function toCard(agent: AiBuilderAgentRecord): AiBuilderTemplateCard {
  return {
    id: agent.id,
    name: String(agent.name || "AI tanpa nama"),
    tagline: agent.tagline || null,
    avatar: agent.avatar || null,
  };
}

/** Only system-owned root agents are eligible as internal Builder templates. */
export function isAiBuilderSystemTemplate(agent: AiBuilderAgentRecord): boolean {
  return !String(agent.userId || "").trim()
    && !hasCloneSource(agent)
    && agent.archived !== true
    && agent.isEnabled !== false
    && (agent.isPublic === true || agent.isListed === true);
}

/** Return only safe display fields for templates; never expose prompts or credentials. */
export function listAiBuilderTemplates<T extends AiBuilderAgentRecord>(agents: T[]): AiBuilderTemplateCard[] {
  return agents
    .filter(isAiBuilderSystemTemplate)
    .map(toCard)
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}

/** Return only the signed-in user's own, non-archived agents (not collaborations). */
export function listAiBuilderOwnedAgents<T extends AiBuilderAgentRecord>(
  agents: T[],
  userId: string,
): AiBuilderOwnedAgentCard[] {
  if (!userId) return [];
  return agents
    .filter((agent) => String(agent.userId || "") === userId && agent.archived !== true)
    .map((agent) => ({
      ...toCard(agent),
      createdAt: agent.createdAt || null,
      clonedFromAgentId: hasCloneSource(agent) ? String(agent.clonedFromAgentId) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}

/** Owners may read editable brain wiring only on their private system-AI copies. */
export function isAiBuilderPrivateCloneOwner(agent: AiBuilderAgentRecord, userId: string): boolean {
  return Boolean(userId)
    && String(agent.userId || "") === userId
    && hasCloneSource(agent)
    && agent.isPublic === false
    && agent.isListed === false;
}

export function includeAiBuilderPrivateCloneConfig<T extends Record<string, any>>(
  sanitizedAgent: T,
  sourceAgent: AiBuilderAgentRecord,
  userId: string,
  parsedSubAgents: unknown,
): T {
  if (!isAiBuilderPrivateCloneOwner(sourceAgent, userId)) return sanitizedAgent;
  return {
    ...sanitizedAgent,
    systemPrompt: typeof sourceAgent.systemPrompt === "string" ? sourceAgent.systemPrompt : "",
    agenticSubAgents: Array.isArray(parsedSubAgents) ? parsedSubAgents : [],
  };
}

export async function cloneAiBuilderSystemTemplate<T extends AiBuilderAgentRecord>(
  store: {
    getAgent(id: string): Promise<T | undefined>;
    getCloneForOwner(masterAgentId: number, ownerUserId: string): Promise<T | undefined>;
    cloneAgentForOwner(masterAgentId: number, ownerUserId: string): Promise<T>;
  },
  idText: string,
  userId: string,
): Promise<{ agent: T; reused: boolean }> {
  if (!/^[1-9]\d*$/.test(idText)) {
    throw new AiBuilderTemplateError("ID AI Specialist tidak valid.", 400);
  }
  if (!userId) {
    throw new AiBuilderTemplateError("Tidak terautentikasi", 404);
  }

  const master = await store.getAgent(idText);
  if (!master || !isAiBuilderSystemTemplate(master)) {
    throw new AiBuilderTemplateError("AI Specialist sistem tidak ditemukan atau tidak tersedia.", 404);
  }

  const existing = await store.getCloneForOwner(Number(idText), userId);
  const created = existing || await store.cloneAgentForOwner(Number(idText), userId);
  const persisted = await store.getAgent(String(created.id));
  if (!persisted
    || String(persisted.userId || "") !== userId
    || String(persisted.clonedFromAgentId || "") !== idText
    || persisted.isPublic !== false
    || persisted.isListed !== false) {
    throw new AiBuilderTemplateError("Salinan privat belum terverifikasi setelah dibuat.", 500);
  }
  return { agent: persisted, reused: Boolean(existing) };
}

