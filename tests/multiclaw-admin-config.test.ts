import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMulticlawAdminOverrides,
  multiclawAdminOverrideKey,
  multiclawAdminPatchSchema,
  updateMulticlawAgentInTransaction,
} from "../server/lib/multiclaw-admin-config";
import { saveAndVerifyMulticlawConfig } from "../client/src/lib/multiclaw-config-save";

test("MultiClaw admin config save verifies system prompt and model from a fresh read", async () => {
  const payload = {
    systemPrompt: "[ARCHITECTURE_PROMPT_v2]\nPrompt hasil perbaikan.",
    aiModel: "gpt-4o",
    temperature: 0.35,
    maxTokens: 3200,
    ragChunkSize: 900,
    ragChunkOverlap: 150,
    ragTopK: 7,
  };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return calls.length === 1
      ? Response.json({ success: true })
      : Response.json({
          id: 44,
          slug: "arsitekturclaw-orchestrator",
          systemPrompt: payload.systemPrompt,
          model: payload.aiModel,
          temperature: payload.temperature,
          maxTokens: payload.maxTokens,
          ragChunkSize: payload.ragChunkSize,
          ragChunkOverlap: payload.ragChunkOverlap,
          ragTopK: payload.ragTopK,
        });
  };

  const saved = await saveAndVerifyMulticlawConfig("arsitekturclaw-orchestrator", payload, request);
  assert.equal(saved.systemPrompt, payload.systemPrompt);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init?.method, "PATCH");
  assert.equal(calls[0].init?.credentials, "include");
  assert.equal(calls[1].init?.cache, "no-store");
});

test("MultiClaw config save reports a readback mismatch instead of false success", async () => {
  let call = 0;
  const request: typeof fetch = async () => {
    call += 1;
    return call === 1
      ? Response.json({ success: true })
      : Response.json({ id: 44, slug: "arsitekturclaw-orchestrator", systemPrompt: "prompt lama" });
  };

  await assert.rejects(
    saveAndVerifyMulticlawConfig(
      "arsitekturclaw-orchestrator",
      { systemPrompt: "prompt hasil perbaikan" },
      request,
    ),
    /systemPrompt belum cocok saat dibaca ulang/,
  );
});

test("MultiClaw config save surfaces authorization errors", async () => {
  const request: typeof fetch = async () => Response.json(
    { error: "Akses ditolak. Hanya admin yang dapat mengakses ini." },
    { status: 403 },
  );
  await assert.rejects(
    saveAndVerifyMulticlawConfig("arsitekturclaw-orchestrator", { systemPrompt: "prompt" }, request),
    /Hanya admin/,
  );
});

test("admin override patch rejects fields outside the editor contract", () => {
  assert.equal(multiclawAdminPatchSchema.safeParse({ systemPrompt: "prompt" }).success, true);
  assert.equal(multiclawAdminPatchSchema.safeParse({ systemPrompt: "prompt", userId: "attacker" }).success, false);
  assert.equal(multiclawAdminPatchSchema.safeParse({ conversationStarters: Array(7).fill("x") }).success, false);
});

test("transactional agent update keeps the storage receiver bound", async () => {
  const executor = { transaction: true };
  const storage = {
    marker: "storage-instance",
    async updateAgent(this: { marker: string }, id: string, patch: Record<string, unknown>) {
      return { id, marker: this.marker, patch, receivedExecutor: arguments[2] };
    },
  };

  const result = await updateMulticlawAgentInTransaction(
    storage,
    "42",
    { systemPrompt: "updated prompt" },
    executor,
  ) as { id: string; marker: string; patch: Record<string, unknown>; receivedExecutor: unknown };

  assert.equal(result.id, "42");
  assert.equal(result.marker, "storage-instance");
  assert.deepEqual(result.patch, { systemPrompt: "updated prompt" });
  assert.equal(result.receivedExecutor, executor);
});

test("saved MultiClaw edits are reapplied after startup seeds overwrite the database row", async () => {
  const slug = "arsitekturclaw-orchestrator";
  let agent = { id: 73, systemPrompt: "seed prompt", greetingMessage: "seed greeting" };
  const result = await applyMulticlawAdminOverrides(
    [{
      key: multiclawAdminOverrideKey(slug),
      value: JSON.stringify({
        systemPrompt: "admin-edited prompt",
        greetingMessage: "admin-edited greeting",
      }),
    }],
    {
      getAgentBySlug: async (requestedSlug) => requestedSlug === slug ? { id: agent.id } : undefined,
      updateAgent: async (_id, patch) => { agent = { ...agent, ...patch }; },
    },
  );

  assert.deepEqual(result, { applied: 1, skipped: 0 });
  assert.equal(agent.systemPrompt, "admin-edited prompt");
  assert.equal(agent.greetingMessage, "admin-edited greeting");
});
