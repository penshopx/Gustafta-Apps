import assert from "node:assert/strict";
import test from "node:test";
import {
  KONSTRA_LEGACY_ORCHESTRATOR_SLUG,
  KONSTRA_ORCHESTRATOR_SLUG,
  KONSTRA_SPECIALIST_SLUGS,
} from "../shared/multiclaw-agent-slugs";
import { reconcileKonstraClaw } from "../server/lib/konstra-seed";

const specialistIds = [1272, 1273, 1274, 1275, 1276, 1277, 1278, 1279, 1280];

function createSources() {
  return [
    ...specialistIds.map((id) => ({
      id,
      name: `Konstra specialist ${id}`,
      tagline: `tagline ${id}`,
      description: `description ${id}`,
      system_prompt: `prompt ${id}`,
      greeting_message: `hello ${id}`,
      personality: `persona ${id}`,
      conversation_starters: [`starter ${id}`],
      ai_model: "gpt-4o",
    })),
    {
      id: 1281,
      name: "KONSTRA-ORCHESTRATOR",
      tagline: "System induk",
      description: "Manajemen proyek konstruksi",
      system_prompt: "old prompt source",
      greeting_message: "welcome",
      personality: "coordinator",
      conversation_starters: ["Mulai proyek"],
      ai_model: "gpt-4o",
    },
  ];
}

function createMemoryDependencies(startId = 5000, existing: Array<Record<string, any>> = []) {
  const rowsBySlug = new Map<string, Record<string, any>>();
  for (const row of existing) rowsBySlug.set(row.slug, { ...row });
  let nextId = startId;
  let createCount = 0;
  let updateCount = 0;

  return {
    rowsBySlug,
    get createCount() { return createCount; },
    get updateCount() { return updateCount; },
    dependencies: {
      async getAgentBySlug(slug: string) {
        return rowsBySlug.get(slug);
      },
      async createAgent(data: Record<string, unknown>) {
        const row = { ...data, id: nextId++ };
        rowsBySlug.set(String(data.slug), row);
        createCount += 1;
        return row;
      },
      async updateAgent(id: string, data: Record<string, unknown>) {
        const row = [...rowsBySlug.values()].find((candidate) => String(candidate.id) === id);
        assert.ok(row, `expected agent ${id} to exist`);
        if (row.slug && row.slug !== data.slug) rowsBySlug.delete(String(row.slug));
        Object.assign(row, data);
        rowsBySlug.set(String(row.slug), row);
        updateCount += 1;
        return row;
      },
    },
  };
}

test("Konstra seed allocates fresh IDs and rebuilds links without touching historical IDs", async () => {
  const unrelatedRows = Array.from({ length: 10 }, (_, index) => {
    const id = 1272 + index;
    return {
      id,
      slug: `unrelated-agent-${id}`,
      name: `Unrelated agent ${id}`,
      systemPrompt: `preserve this row ${id}`,
    };
  });
  const memory = createMemoryDependencies(11000, unrelatedRows);
  const first = await reconcileKonstraClaw(
    createSources(),
    "canonical orchestrator prompt",
    memory.dependencies,
  );

  assert.equal(memory.createCount, 10);
  assert.equal(memory.rowsBySlug.size, 20);
  for (const oldRow of unrelatedRows) {
    assert.equal(memory.rowsBySlug.get(oldRow.slug)?.systemPrompt, oldRow.systemPrompt);
  }
  assert.equal(first.specialistIds.length, 9);
  assert.ok(Number(first.orchestratorId) >= 5000);
  assert.ok(first.specialistIds.every((id) => Number(id) >= 5000));
  assert.ok([...first.specialistIds, first.orchestratorId].every((id) => {
    const numericId = Number(id);
    return numericId < 1272 || numericId > 1281;
  }));

  const parent = memory.rowsBySlug.get(KONSTRA_ORCHESTRATOR_SLUG);
  assert.equal(parent?.systemPrompt, "canonical orchestrator prompt");
  assert.equal(parent?.agenticSubAgents.length, 9);
  assert.equal(parent?.ragEnabled, true);
  assert.equal(parent?.ragTopK, 5);
  assert.equal(parent?.isEnabled, true);
  assert.deepEqual(
    parent?.agenticSubAgents.map((item: { agentId: string }) => item.agentId),
    first.specialistIds,
  );

  for (const id of first.specialistIds) {
    const child = [...memory.rowsBySlug.values()].find((row) => String(row.id) === id);
    assert.equal(child?.parentAgentId, first.orchestratorId);
    assert.equal(child?.isPublic, false);
  }

  const second = await reconcileKonstraClaw(
    createSources(),
    "canonical orchestrator prompt",
    memory.dependencies,
  );
  assert.equal(memory.createCount, 10, "second run must reconcile, not duplicate");
  assert.equal(second.orchestratorId, first.orchestratorId);
  assert.equal(memory.rowsBySlug.size, 20, "unrelated historical ID rows must remain untouched");
});

test("Konstra seed upgrades its known legacy parent slug to the canonical admin slug", async () => {
  const memory = createMemoryDependencies(6000, [{
    id: 3001,
    slug: KONSTRA_LEGACY_ORCHESTRATOR_SLUG,
    name: "legacy parent",
  }]);

  const result = await reconcileKonstraClaw(
    createSources(),
    "canonical prompt",
    memory.dependencies,
  );

  assert.equal(result.orchestratorId, "3001");
  assert.equal(memory.rowsBySlug.has(KONSTRA_LEGACY_ORCHESTRATOR_SLUG), false);
  assert.equal(memory.rowsBySlug.get(KONSTRA_ORCHESTRATOR_SLUG)?.id, 3001);
  assert.equal(memory.createCount, 9);
  assert.ok(Object.values(KONSTRA_SPECIALIST_SLUGS).every((slug) => memory.rowsBySlug.has(slug)));
});
