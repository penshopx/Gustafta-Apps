import { test } from "node:test";
import assert from "node:assert/strict";
import { agents as patchAgents } from "../server/db/schema";
import { agents as runtimeAgents } from "../shared/schema";

test("patch dan runtime memakai kolom orkestrasi agen yang sama", () => {
  assert.strictEqual(patchAgents, runtimeAgents, "patch harus memakai tabel agen kanonik");
  for (const key of ["id", "toolboxId", "parentAgentId", "bigIdeaId", "isOrchestrator", "orchestratorRole", "agenticSubAgents", "agenticConfig", "orchestratorConfig", "isActive"] as const) {
    const patch = patchAgents[key];
    const runtime = runtimeAgents[key];
    assert.equal(patch.name, runtime.name, `${key}: nama kolom berbeda`);
    assert.equal(patch.dataType, runtime.dataType, `${key}: tipe kolom berbeda`);
    assert.deepEqual(patch.default, runtime.default, `${key}: default berbeda`);
  }
  assert.equal(patchAgents.agenticSubAgents.name, "agentic_sub_agents");
  assert.equal(patchAgents.id.dataType, "number");
  assert.equal(patchAgents.toolboxId.dataType, "number");
  assert.equal(patchAgents.parentAgentId.dataType, "number");
  assert.equal(patchAgents.toolboxId.default, undefined);
  assert.equal(patchAgents.parentAgentId.default, undefined);
});