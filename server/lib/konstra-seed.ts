import {
  KONSTRA_LEGACY_ORCHESTRATOR_SLUG,
  KONSTRA_ORCHESTRATOR_SLUG,
  KONSTRA_SPECIALIST_SLUGS,
} from "../../shared/multiclaw-agent-slugs";

export interface KonstraSeedSource {
  id: number;
  name: string;
  tagline?: string;
  description?: string;
  system_prompt?: string;
  greeting_message?: string;
  personality?: string;
  conversation_starters?: string[];
  ai_model?: string;
}

export interface KonstraSeedAgent {
  id: string | number;
}

export interface KonstraSeedDependencies {
  getAgentBySlug(slug: string): Promise<KonstraSeedAgent | undefined | null>;
  createAgent(data: Record<string, unknown>): Promise<KonstraSeedAgent>;
  updateAgent(id: string, data: Record<string, unknown>): Promise<unknown>;
}

const SPECIALIST_SLUG_BY_LEGACY_ID: Readonly<Record<number, string>> = {
  1272: KONSTRA_SPECIALIST_SLUGS.proxima,
  1273: KONSTRA_SPECIALIST_SLUGS.teknik,
  1274: KONSTRA_SPECIALIST_SLUGS.kontrak,
  1275: KONSTRA_SPECIALIST_SLUGS.safira,
  1276: KONSTRA_SPECIALIST_SLUGS.mutu,
  1277: KONSTRA_SPECIALIST_SLUGS.envira,
  1278: KONSTRA_SPECIALIST_SLUGS.equipra,
  1279: KONSTRA_SPECIALIST_SLUGS.logis,
  1280: KONSTRA_SPECIALIST_SLUGS.fintax,
};

const SPECIALIST_ROLES: Readonly<Record<number, string>> = {
  1272: "AGENT-PROXIMA",
  1273: "AGENT-TEKNIK",
  1274: "AGENT-KONTRAK",
  1275: "AGENT-SAFIRA",
  1276: "AGENT-MUTU",
  1277: "AGENT-ENVIRA",
  1278: "AGENT-EQUIPRA",
  1279: "AGENT-LOGIS",
  1280: "AGENT-FINTAX",
};

function buildAgentPatch(
  source: KonstraSeedSource,
  slug: string,
  parentAgentId: string | null,
  subAgents: Array<{ agentId: string; role: string; description: string }> = [],
) {
  const isOrchestrator = source.id === 1281;
  return {
    slug,
    name: source.name,
    tagline: source.tagline || "",
    description: source.description || "",
    systemPrompt: source.system_prompt || "",
    greetingMessage: source.greeting_message || "",
    personality: source.personality || "",
    conversationStarters: source.conversation_starters || [],
    language: "id",
    category: "Teknik Konstruksi",
    aiModel: source.ai_model || "gpt-4o",
    temperature: isOrchestrator ? 0.4 : 0.3,
    maxTokens: isOrchestrator ? 4096 : 2500,
    ragEnabled: true,
    ragChunkSize: 800,
    ragChunkOverlap: 200,
    ragTopK: 5,
    isPublic: false,
    isActive: true,
    isEnabled: true,
    isOrchestrator,
    orchestratorRole: isOrchestrator ? "master" : "specialist",
    agenticMode: isOrchestrator,
    parentAgentId,
    agenticSubAgents: subAgents,
    avatar: isOrchestrator ? "🏗️" : "👷",
  };
}

async function upsertByStableSlug(
  source: KonstraSeedSource,
  slug: string,
  patch: Record<string, unknown>,
  dependencies: KonstraSeedDependencies,
  legacySlug?: string,
): Promise<KonstraSeedAgent> {
  const existing =
    await dependencies.getAgentBySlug(slug) ??
    (legacySlug ? await dependencies.getAgentBySlug(legacySlug) : undefined);

  if (existing) {
    await dependencies.updateAgent(String(existing.id), patch);
    return { id: existing.id };
  }
  return dependencies.createAgent(patch);
}

/**
 * Recreate/reconcile the Konstra system from canonical prompt data without
 * trusting its historical numeric IDs. All references are rebuilt from the
 * IDs returned by the current database.
 */
export async function reconcileKonstraClaw(
  sources: KonstraSeedSource[],
  orchestratorPrompt: string,
  dependencies: KonstraSeedDependencies,
) {
  const parentSource = sources.find((source) => source.id === 1281);
  const specialists = sources
    .filter((source) => source.id !== 1281)
    .sort((left, right) => left.id - right.id);

  if (!parentSource || specialists.length !== 9) {
    throw new Error("Seed Konstra harus memuat satu orchestrator dan sembilan spesialis.");
  }

  const createdOrUpdated: Record<string, string> = {};
  const specialistRows: Array<{ source: KonstraSeedSource; slug: string; agent: KonstraSeedAgent }> = [];

  for (const source of specialists) {
    const slug = SPECIALIST_SLUG_BY_LEGACY_ID[source.id];
    const role = SPECIALIST_ROLES[source.id];
    if (!slug || !role) throw new Error(`ID seed spesialis Konstra tidak dikenal: ${source.id}`);

    const patch = buildAgentPatch(source, slug, null);
    const agent = await upsertByStableSlug(source, slug, patch, dependencies);
    specialistRows.push({ source, slug, agent });
    createdOrUpdated[slug] = String(agent.id);
  }

  const parentPatch = buildAgentPatch(parentSource, KONSTRA_ORCHESTRATOR_SLUG, null);
  parentPatch.systemPrompt = orchestratorPrompt;
  parentPatch.agenticSubAgents = specialistRows.map(({ source, agent }) => ({
    agentId: String(agent.id),
    role: SPECIALIST_ROLES[source.id],
    description: source.description || source.name,
  }));

  const parent = await upsertByStableSlug(
    parentSource,
    KONSTRA_ORCHESTRATOR_SLUG,
    parentPatch,
    dependencies,
    KONSTRA_LEGACY_ORCHESTRATOR_SLUG,
  );
  createdOrUpdated[KONSTRA_ORCHESTRATOR_SLUG] = String(parent.id);

  for (const { source, slug } of specialistRows) {
    await dependencies.updateAgent(createdOrUpdated[slug], {
      parentAgentId: String(parent.id),
      isPublic: false,
      isActive: true,
    });
  }

  return {
    orchestratorId: String(parent.id),
    specialistIds: specialistRows.map(({ agent }) => String(agent.id)),
  };
}
