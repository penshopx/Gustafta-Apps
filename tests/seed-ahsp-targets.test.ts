import assert from "node:assert/strict";
import test from "node:test";
import {
  KONSTRA_ORCHESTRATOR_SLUG,
  KONSTRA_SPECIALIST_SLUGS,
} from "../shared/multiclaw-agent-slugs";
import {
  AHSP_TARGET_AGENT_SLUGS,
  resolveAhspTargetAgents,
} from "../server/seed-ahsp-hspk";

test("AHSP knowledge seeding resolves only the intended Konstra agents by slug", async () => {
  const calls: string[] = [];
  const idBySlug = new Map<string, number>([
    [KONSTRA_ORCHESTRATOR_SLUG, 9001],
    [KONSTRA_SPECIALIST_SLUGS.teknik, 9002],
    [KONSTRA_SPECIALIST_SLUGS.kontrak, 9003],
    [KONSTRA_SPECIALIST_SLUGS.mutu, 9004],
    [KONSTRA_SPECIALIST_SLUGS.fintax, 9005],
  ]);

  const targets = await resolveAhspTargetAgents(async (slug) => {
    calls.push(slug);
    const id = idBySlug.get(slug);
    return id ? { id } : undefined;
  });

  assert.deepEqual(calls, [...AHSP_TARGET_AGENT_SLUGS]);
  assert.equal(targets.length, 5);
  assert.deepEqual(targets.map((target) => target.agentId), ["9001", "9002", "9003", "9004", "9005"]);
  assert.ok(targets.every((target) => target.agentId !== "1273" && target.agentId !== "1281"));
});

test("AHSP seeding skips unavailable Konstra targets instead of falling back to legacy IDs", async () => {
  const targets = await resolveAhspTargetAgents(async () => undefined);
  assert.deepEqual(targets, []);
});
