import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cloneAiBuilderSystemTemplate,
  includeAiBuilderPrivateCloneConfig,
  isAiBuilderPrivateCloneOwner,
  listAiBuilderOwnedAgents,
  listAiBuilderTemplates,
} from "../server/lib/ai-builder-access";

const routesSource = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");

const agents = [
  { id: 1, name: "System Specialist", userId: null, clonedFromAgentId: null, archived: false, isEnabled: true, isPublic: true },
  { id: 2, name: "Owner A manual", userId: "owner-a", clonedFromAgentId: null, archived: false },
  { id: 3, name: "Owner A private copy", userId: "owner-a", clonedFromAgentId: 1, archived: false },
  { id: 4, name: "Owner B private copy", userId: "owner-b", clonedFromAgentId: 1, archived: false },
  { id: 5, name: "Archived system", userId: null, clonedFromAgentId: null, archived: true, isEnabled: true },
  { id: 6, name: "Disabled system", userId: null, clonedFromAgentId: null, archived: false, isEnabled: false },
  { id: 7, name: "Clone is not a template", userId: null, clonedFromAgentId: 1, archived: false, isEnabled: true, isPublic: true },
];

test("template catalogue contains only enabled, unarchived system roots and exposes display fields only", () => {
  const templates = listAiBuilderTemplates([
    ...agents,
    { id: 8, name: "Prompt must stay private", isPublic: true, systemPrompt: "secret text", customApiKey: "must not be returned" },
  ]);

  assert.deepEqual(templates.map((template) => template.id), [8, 1]);
  assert.equal("systemPrompt" in templates[0], false);
  assert.equal("customApiKey" in templates[0], false);
});

test("AI Saya contains only exact-owner, unarchived creations and excludes collaborators", () => {
  const owned = listAiBuilderOwnedAgents(
    [...agents, { id: 9, name: "Shared to A", userId: "owner-b", clonedFromAgentId: null, archived: false }],
    "owner-a",
  );

  assert.deepEqual(owned.map((agent) => agent.id), [2, 3]);
  assert.equal(owned.find((agent) => agent.id === 3)?.clonedFromAgentId, "1");
});

test("only the owner of a private copy receives editable prompt wiring", () => {
  const clone = {
    id: 3,
    userId: "owner-a",
    clonedFromAgentId: 1,
    isPublic: false,
    isListed: false,
    systemPrompt: "private editable prompt",
  };
  const publicSafeFields = { id: 3, name: "Owner A private copy" };

  assert.equal(isAiBuilderPrivateCloneOwner(clone, "owner-a"), true);
  assert.equal(isAiBuilderPrivateCloneOwner(clone, "owner-b"), false);
  assert.equal(isAiBuilderPrivateCloneOwner({ ...clone, isPublic: true }, "owner-a"), false);
  assert.deepEqual(
    includeAiBuilderPrivateCloneConfig(publicSafeFields, clone, "owner-a", [{ role: "specialist" }]),
    {
      id: 3,
      name: "Owner A private copy",
      systemPrompt: "private editable prompt",
      agenticSubAgents: [{ role: "specialist" }],
    },
  );
  assert.deepEqual(
    includeAiBuilderPrivateCloneConfig(publicSafeFields, clone, "owner-b", [{ role: "specialist" }]),
    publicSafeFields,
  );
});

test("creating a private copy verifies owner/source on readback and leaves the template unchanged", async () => {
  const template = {
    id: 21,
    name: "System specialist",
    userId: null,
    clonedFromAgentId: null,
    isPublic: true,
    isListed: true,
    isEnabled: true,
    archived: false,
    isPublic: true,
    isListed: true,
    systemPrompt: "canonical prompt",
    knowledgeBase: [{ title: "platform KB" }],
  };
  const sourceSnapshot = structuredClone(template);
  const records = new Map<string, any>([["21", template]]);
  let cloneCalls = 0;

  const store = {
      getAgent: async (id: string) => records.get(id),
      getCloneForOwner: async (masterId: number, ownerUserId: string) =>
        [...records.values()].find((agent) => agent.clonedFromAgentId === masterId && agent.userId === ownerUserId),
      cloneAgentForOwner: async (masterId: number, ownerUserId: string) => {
        cloneCalls += 1;
        const master = records.get(String(masterId))!;
        const created = {
          ...structuredClone(master),
          id: 22,
          userId: ownerUserId,
          clonedFromAgentId: masterId,
          isPublic: false,
          isListed: false,
        };
        records.set("22", created);
        return created;
      },
  };
  const result = await cloneAiBuilderSystemTemplate(store, "21", "owner-a");
  const clone = result.agent;

  assert.equal(clone.id, 22);
  assert.equal(result.reused, false);
  assert.equal(clone.userId, "owner-a");
  assert.equal(clone.clonedFromAgentId, 21);
  assert.equal(clone.systemPrompt, "canonical prompt");
  assert.deepEqual(records.get("21"), sourceSnapshot);
  assert.deepEqual(listAiBuilderOwnedAgents([...records.values()], "owner-a").map((agent) => agent.id), [22]);

  records.get("22").systemPrompt = "owner's saved prompt";
  const secondResult = await cloneAiBuilderSystemTemplate(store, "21", "owner-a");
  assert.equal(secondResult.reused, true);
  assert.equal(secondResult.agent.systemPrompt, "owner's saved prompt");
  assert.equal(cloneCalls, 1, "repeat visits must not overwrite or recreate the owner's private edits");
});

test("all AI Builder API routes require an authenticated admin", () => {
  assert.match(routesSource, /app\.get\("\/api\/ai-builder\/mine",\s*isAuthenticated,\s*requireAdmin,/);
  assert.match(routesSource, /app\.get\("\/api\/ai-builder\/templates",\s*isAuthenticated,\s*requireAdmin,/);
  assert.match(routesSource, /app\.post\("\/api\/ai-builder\/templates\/:id\/clone",\s*isAuthenticated,\s*requireAdmin,/);
  assert.match(routesSource, /cloneAiBuilderSystemTemplate\(storage,\s*idText,\s*userId\)/);
});

