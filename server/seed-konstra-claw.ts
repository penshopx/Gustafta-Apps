import { AGENTS, ORCHESTRATOR_PROMPT } from "../scripts/seed-konstra-agents";
import { reconcileKonstraClaw } from "./lib/konstra-seed";
import { storage } from "./storage";

const LOG = "[Seed KonstraClaw]";

export async function seedKonstraClaw() {
  const result = await reconcileKonstraClaw(
    AGENTS as unknown as Parameters<typeof reconcileKonstraClaw>[0],
    ORCHESTRATOR_PROMPT,
    {
      getAgentBySlug: (slug) => storage.getAgentBySlug(slug),
      createAgent: (data) => storage.createAgent(data as any),
      updateAgent: (id, data) => storage.updateAgent(id, data as any),
    },
  );

  console.log(
    `${new Date().toLocaleTimeString()} [express] ${LOG} ready: ` +
    `${result.orchestratorId} + ${result.specialistIds.length} specialists`,
  );
  return result;
}
