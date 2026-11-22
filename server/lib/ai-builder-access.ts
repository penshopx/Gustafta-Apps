import {
  BASE_CLAW_ROUTES,
  CLAW_PACKAGES,
  isBaseClawRoute,
  packageAllowanceForTier,
  packageForRoute,
} from "@shared/claw-packages";
import { MULTICLAW_AGENT_ROUTE_BY_SLUG } from "@shared/multiclaw-agent-slugs";

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
  slug?: string | null;
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

export interface AiBuilderTemplateEntitlements {
  isAdmin?: boolean;
  tier: number;
  selectedPackageIds?: readonly string[];
  individuallyLicensedAgentIds?: ReadonlySet<string>;
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

function routeForTemplate(agent: AiBuilderAgentRecord): string | null {
  const slug = String(agent.slug || "").trim().replace(/^\/+|\/+$/g, "");
  if (!slug) return null;
  const route = MULTICLAW_AGENT_ROUTE_BY_SLUG[slug];
  if (!route) return null;
  return BASE_CLAW_ROUTES.includes(route) || CLAW_PACKAGES.some((pkg) => pkg.routes.includes(route))
    ? route
    : null;
}

/** Server-side Claw entitlement for Builder visibility and cloning. Unknown route
 * mappings fail closed; an individual active license can still grant that Claw. */
export function canUseAiBuilderTemplate(
  agent: AiBuilderAgentRecord,
  entitlements: AiBuilderTemplateEntitlements,
): boolean {
  if (!isAiBuilderSystemTemplate(agent)) return false;
  if (entitlements.isAdmin) return true;
  if (entitlements.individuallyLicensedAgentIds?.has(String(agent.id))) return true;

  const route = routeForTemplate(agent);
  if (!route) return false;
  if (isBaseClawRoute(route)) return entitlements.tier >= 1;

  const pkg = packageForRoute(route);
  if (!pkg) return false;
  const allowance = packageAllowanceForTier(entitlements.tier);
  return allowance === "all"
    || (typeof allowance === "number" && allowance > 0 && entitlements.selectedPackageIds?.includes(pkg.id) === true);
}

export function listEntitledAiBuilderTemplates<T extends AiBuilderAgentRecord>(
  agents: T[],
  entitlements: AiBuilderTemplateEntitlements,
): AiBuilderTemplateCard[] {
  const eligibleIds = new Set(
    agents.filter((agent) => canUseAiBuilderTemplate(agent, entitlements)).map((agent) => String(agent.id)),
  );
  return listAiBuilderTemplates(agents.filter((agent) => eligibleIds.has(String(agent.id))));
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

