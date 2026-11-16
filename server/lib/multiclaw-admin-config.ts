import { z } from "zod";

export const MULTICLAW_ADMIN_OVERRIDE_PREFIX = "multiclaw_admin_config:";

const subAgentSchema = z.object({
  role: z.string().trim().min(1).max(120),
  agentId: z.union([
    z.number().int().positive(),
    z.string().regex(/^[1-9]\d*$/, "ID sub-agent harus berupa bilangan positif."),
  ]),
  description: z.string().max(2_000),
}).strict();

const editableFields = {
  systemPrompt: z.string().max(500_000, "System prompt terlalu panjang."),
  aiModel: z.string().trim().min(1).max(120),
  temperature: z.number().finite().min(0).max(2),
  maxTokens: z.number().int().min(100).max(8_000),
  ragChunkSize: z.number().int().min(200).max(2_000),
  ragChunkOverlap: z.number().int().min(0).max(500),
  ragTopK: z.number().int().min(1).max(20),
  greetingMessage: z.string().max(20_000),
  conversationStarters: z.array(z.string().max(500)).max(6),
  isEnabled: z.boolean(),
  agenticSubAgents: z.array(subAgentSchema).max(100),
};

export const multiclawAdminPatchSchema = z.object(editableFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, "Tidak ada pengaturan MultiClaw yang dikirim.");

export type MulticlawAdminPatch = z.infer<typeof multiclawAdminPatchSchema>;

export interface MulticlawAgentUpdateStorage {
  updateAgent: (id: string, data: Record<string, unknown>) => Promise<unknown>;
}

/** Keep the storage receiver bound when passing its transaction executor. */
export function updateMulticlawAgentInTransaction(
  storage: MulticlawAgentUpdateStorage,
  id: string,
  patch: MulticlawAdminPatch,
  executor: unknown,
): Promise<unknown> {
  const update = storage.updateAgent as unknown as (
    this: MulticlawAgentUpdateStorage,
    agentId: string,
    data: MulticlawAdminPatch,
    transactionExecutor: unknown,
  ) => Promise<unknown>;
  return update.call(storage, id, patch, executor);
}

export function multiclawAdminOverrideKey(slug: string): string {
  return `${MULTICLAW_ADMIN_OVERRIDE_PREFIX}${slug}`;
}

export function multiclawAdminOverrideSlug(key: string): string | null {
  if (!key.startsWith(MULTICLAW_ADMIN_OVERRIDE_PREFIX)) return null;
  const slug = key.slice(MULTICLAW_ADMIN_OVERRIDE_PREFIX.length);
  return slug && !slug.includes(":") ? slug : null;
}

export function parseMulticlawAdminOverride(value: string): MulticlawAdminPatch | null {
  try {
    const parsed = multiclawAdminPatchSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface MulticlawOverrideRow {
  key: string;
  value: string;
}

export interface MulticlawOverrideApplyDependencies {
  getAgentBySlug: (slug: string) => Promise<{ id: string | number } | undefined>;
  updateAgent: (agentId: string, patch: MulticlawAdminPatch) => Promise<unknown>;
}

/** Reapply operator edits after boot-time seed reconciliation has run. */
export async function applyMulticlawAdminOverrides(
  rows: MulticlawOverrideRow[],
  deps: MulticlawOverrideApplyDependencies,
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;

  for (const row of rows) {
    const slug = multiclawAdminOverrideSlug(row.key);
    const patch = parseMulticlawAdminOverride(row.value);
    if (!slug || !patch) {
      skipped += 1;
      continue;
    }
    const agent = await deps.getAgentBySlug(slug);
    if (!agent) {
      skipped += 1;
      continue;
    }
    await deps.updateAgent(String(agent.id), patch);
    applied += 1;
  }

  return { applied, skipped };
}
