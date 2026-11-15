type MulticlawAdminAgentSource = {
  id: string | number;
  name: string;
  slug?: string | null;
  aiModel?: string | null;
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  systemPrompt?: string | null;
  isEnabled?: boolean | null;
  agenticSubAgents?: unknown;
  ragChunkSize?: number | null;
  ragChunkOverlap?: number | null;
  tagline?: string | null;
  description?: string | null;
  greetingMessage?: string | null;
  conversationStarters?: unknown;
};

/** Shape consumed by the MultiClaw Admin editor, including persisted UX fields. */
export function toMulticlawAdminAgent(agent: MulticlawAdminAgentSource) {
  return {
    id: agent.id,
    name: agent.name,
    slug: agent.slug || "",
    model: agent.aiModel || agent.model || "gpt-4o-mini",
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.maxTokens ?? 2000,
    systemPrompt: agent.systemPrompt || "",
    isEnabled: agent.isEnabled ?? true,
    agenticSubAgents: agent.agenticSubAgents || null,
    ragChunkSize: agent.ragChunkSize ?? 800,
    ragChunkOverlap: agent.ragChunkOverlap ?? 200,
    tagline: agent.tagline || "",
    description: agent.description || "",
    greetingMessage: agent.greetingMessage || "",
    conversationStarters: Array.isArray(agent.conversationStarters)
      ? agent.conversationStarters.filter((item): item is string => typeof item === "string")
      : [],
  };
}
