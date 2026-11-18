import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PANDUAN_SBU_AGENT_SLUG } from "../shared/multiclaw-agent-slugs";

test("PanduanSBU admin and public lookup use the canonical existing agent slug", () => {
  assert.equal(PANDUAN_SBU_AGENT_SLUG, "hub-sbu-coach-all-in-one");

  const adminPage = readFileSync(new URL("../client/src/pages/multiclaw-admin.tsx", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");

  assert.match(adminPage, /href:\s*"\/panduan-sbu",\s*slug:\s*PANDUAN_SBU_AGENT_SLUG/);
  assert.match(routes, /getAgentBySlug\(PANDUAN_SBU_AGENT_SLUG\)/);
});
