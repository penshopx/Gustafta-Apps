import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";

// Never point this test at canonical rows: each invocation owns a disposable schema.
test("Notion startup patches roll back at every stage and resume partial legacy data", {
  skip: !testDatabaseReady && testDbSkip,
}, async () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const namespace = `notion_atomic_${process.pid}_${Date.now()}`;
  let isolated: pg.Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    isolated = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      options: `-c search_path=${namespace}`,
    });
    const sql = (query: string, values?: unknown[]) => isolated!.query(query, values);
    // Clone column defaults but replace serial defaults so even sequences are isolated.
    for (const table of ["series", "toolboxes", "agents", "knowledge_bases"]) {
      await sql(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
      await sql(`CREATE SEQUENCE ${table}_test_seq`);
      await sql(`ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('${table}_test_seq')`);
      await sql(`ALTER SEQUENCE ${table}_test_seq OWNED BY ${table}.id`);
    }
    const database = drizzle(isolated, { schema });
    const { patchLexSkripsiNotionAgent } = await import("../server/patch-lexskripsi-notion-agent");
    const { patchLexSkripsiNotionOrchFix } = await import("../server/patch-lexskripsi-notion-orchestrator-fix");

    async function seed() {
      await sql("TRUNCATE knowledge_bases, agents, toolboxes, series RESTART IDENTITY");
      await sql("INSERT INTO series(name, slug) VALUES ('LexSkripsi', 'lexskripsi-asisten-skripsi-hukum')");
      await sql("INSERT INTO toolboxes(series_id, name) VALUES (1, 'LexSkripsi')");
      await sql("INSERT INTO agents(toolbox_id, name, agentic_sub_agents) VALUES (1, 'LexSkripsi', '[]')");
    }
    async function counts() {
      const [agents, toolboxes, kb, links] = await Promise.all([
        sql("SELECT count(*)::int AS n FROM agents"),
        sql("SELECT count(*)::int AS n FROM toolboxes"),
        sql("SELECT name, count(*)::int AS n FROM knowledge_bases GROUP BY name"),
        sql("SELECT agentic_sub_agents FROM agents WHERE id = 1"),
      ]);
      return {
        agents: agents.rows[0].n as number,
        toolboxes: toolboxes.rows[0].n as number,
        kb: kb.rows.map(({ name, n }) => [name, n]).sort(),
        links: links.rows[0].agentic_sub_agents,
      };
    }

    for (const stage of ["toolbox", "agent", "knowledge-1", "knowledge-2", "link", "marker"] as const) {
      await seed();
      const initial = await counts();
      await assert.rejects(
        patchLexSkripsiNotionAgent({
          database,
          afterStage: (reached) => { if (reached === stage) throw new Error(`fault ${stage}`); },
        }),
        new RegExp(`fault ${stage}`),
      );
      assert.deepEqual(await counts(), initial, `rollback at ${stage}`);
      assert.deepEqual(await patchLexSkripsiNotionAgent({ database }), { done: true, skipped: false });
      const complete = await counts();
      assert.equal(complete.agents, 2);
      assert.equal(complete.toolboxes, 2);
      assert.equal(complete.kb.length, 3);
      assert.ok(complete.kb.every(([, n]) => n === 1));
      assert.equal(complete.links.length, 1);
      assert.deepEqual(await patchLexSkripsiNotionAgent({ database }), { done: false, skipped: true });
      assert.deepEqual(await counts(), complete);
    }

    // A pre-transaction legacy run may have saved KB 1 without KB 2 or the marker.
    await seed();
    await patchLexSkripsiNotionAgent({ database });
    await sql("DELETE FROM knowledge_bases WHERE name LIKE '%LEXSKRIPSI-NOTION-AGENT-v1%' OR name LIKE 'Panduan Perintah AGENT-NOTION%'");
    await patchLexSkripsiNotionAgent({ database });
    let resumed = await counts();
    assert.equal(resumed.kb.length, 3);
    assert.ok(resumed.kb.every(([, n]) => n === 1));
    assert.equal(resumed.links.length, 1);

    // Marker survived but the verified agent did not. Recreate, not link to the deleted ID.
    await sql("DELETE FROM knowledge_bases WHERE agent_id <> 1");
    await sql("DELETE FROM agents WHERE name = 'AGENT-NOTION'");
    await sql("UPDATE agents SET agentic_sub_agents = '[]' WHERE id = 1");
    await patchLexSkripsiNotionAgent({ database });
    resumed = await counts();
    assert.equal(resumed.links.length, 1);
    assert.equal(resumed.agents, 2);
    assert.equal(resumed.kb.length, 3);
    assert.ok(resumed.kb.every(([, n]) => n === 1));

    // Never replace a relation pointing at an unverified agent.
    await sql("UPDATE agents SET agentic_sub_agents = $1::jsonb WHERE id = 1", [
      JSON.stringify([{ role: "AGENT-NOTION", agentId: 99999 }]),
    ]);
    const wrongLink = await counts();
    await assert.rejects(patchLexSkripsiNotionAgent({ database }), /relasi tidak diubah/);
    assert.deepEqual(await counts(), wrongLink);
    await sql("UPDATE agents SET agentic_sub_agents = '[]' WHERE id = 1");
    await patchLexSkripsiNotionAgent({ database });
    assert.equal((await counts()).links.length, 1);

    // A legacy marker can outlive both its owner and its historical Notion agent.
    // Inspect it without writing, require four explicit IDs to move just the marker,
    // and let startup rebuild the missing agent/KB/link afterward.
    await seed();
    const { reviewNotionMarker } = await import("../server/lexskripsi-notion-marker-repair");
    const kbNames = [
      "Panduan Workspace Skripsi di Notion — Template & Struktur yang Disarankan",
      "Panduan Perintah AGENT-NOTION — Cara Meminta & Format Output",
    ];
    await sql(`INSERT INTO knowledge_bases (agent_id, name, type, content) VALUES
      (1447, $1, 'text', 'legacy'), (1447, $2, 'text', 'legacy'),
      (1362, '[PATCH_MARKER] LEXSKRIPSI-NOTION-AGENT-v1 — legacy', 'text',
       'Patch marker: LEXSKRIPSI-NOTION-AGENT-v1. AGENT-NOTION (ID 1447) dibuat sebagai sub-agent LexSkripsi ke-5.')`, kbNames);
    const beforeReview = await counts();
    const report = await reviewNotionMarker(undefined, database);
    assert.equal(report.markerOwnerId, 1362);
    assert.equal(report.orchestratorId, 1);
    assert.equal(report.historicalNotionId, 1447);
    assert.equal(report.historicalKb.length, 2);
    assert.deepEqual(await counts(), beforeReview);
    await assert.rejects(patchLexSkripsiNotionAgent({ database }), /Penanda patch Notion milik ID/);
    const confirmation = { markerId: report.markerId, oldOwnerId: 1362, orchestratorId: 1, historicalNotionId: 1447 };
    await assert.rejects(reviewNotionMarker({ ...confirmation, orchestratorId: 2 }, database), /Konfirmasi ID tidak cocok/);
    assert.deepEqual(await counts(), beforeReview);
    await sql("INSERT INTO agents (id, name) VALUES (1362, 'Other')");
    await assert.rejects(reviewNotionMarker(confirmation, database), /kasus orphan/);
    await sql("DELETE FROM agents WHERE id = 1362");
    assert.equal((await reviewNotionMarker(confirmation, database)).repaired, true);
    await assert.rejects(reviewNotionMarker(confirmation, database), /Konfirmasi ID tidak cocok/);
    const moved = await sql("SELECT agent_id, content FROM knowledge_bases WHERE id = $1", [report.markerId]);
    assert.equal(moved.rows[0].agent_id, 1);
    assert.match(moved.rows[0].content, /semula pada ID 1362/);
    assert.deepEqual(await patchLexSkripsiNotionAgent({ database }), { done: true, skipped: false });
    assert.deepEqual(await patchLexSkripsiNotionAgent({ database }), { done: false, skipped: true });
    const postRepair = await counts();
    assert.equal(postRepair.links.length, 1);
    assert.equal(postRepair.agents, 2);
    assert.equal(postRepair.kb.length, 3); // legacy docs stay untouched, new docs belong to verified agent
    const repairedKb = await sql("SELECT agent_id, name FROM knowledge_bases WHERE name = ANY($1::text[]) ORDER BY agent_id", [kbNames]);
    assert.equal(repairedKb.rows.filter((row) => row.agent_id === 1447).length, 2);
    assert.equal(repairedKb.rows.filter((row) => row.agent_id === postRepair.links[0].agentId).length, 2);

    // The legacy orchestrator-only patch must also commit link and marker together.
    for (const stage of ["link", "marker"] as const) {
      await sql("DELETE FROM knowledge_bases WHERE name LIKE '%LEXSKRIPSI-NOTION-ORCH-FIX-v1%'");
      await sql("UPDATE agents SET agentic_sub_agents = '[]' WHERE id = 1");
      const initial = await counts();
      await assert.rejects(patchLexSkripsiNotionOrchFix({
        database,
        afterStage: (reached) => { if (reached === stage) throw new Error(`fault ${stage}`); },
      }), new RegExp(`fault ${stage}`));
      assert.deepEqual(await counts(), initial);
      await patchLexSkripsiNotionOrchFix({ database });
      assert.equal((await counts()).links.length, 1);
      assert.deepEqual(await patchLexSkripsiNotionOrchFix({ database }), { done: false, skipped: true });
    }

    // Two separate connections model two startup instances. Hold the first
    // transaction after its first write so the second tries to inspect the
    // same still-uncommitted state.
    await seed();
    let releaseFirst!: () => void;
    let firstAtToolbox!: () => void;
    const firstPaused = new Promise<void>((resolve) => { firstAtToolbox = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = patchLexSkripsiNotionAgent({
      database,
      afterStage: async (stage) => {
        if (stage === "toolbox") {
          firstAtToolbox();
          await firstGate;
        }
      },
    });
    await firstPaused;
    let secondAtToolbox = false;
    const second = patchLexSkripsiNotionAgent({
      database,
      afterStage: (stage) => { if (stage === "toolbox") secondAtToolbox = true; },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(secondAtToolbox, false, "startup kedua tidak boleh menulis sebelum transaksi pertama selesai");
    } finally {
      releaseFirst();
    }
    assert.deepEqual(await first, { done: true, skipped: false });
    assert.deepEqual(await second, { done: false, skipped: true });
    assert.equal(secondAtToolbox, false);
    const parallel = await counts();
    assert.equal(parallel.agents, 2);
    assert.equal(parallel.toolboxes, 2);
    assert.equal(parallel.links.length, 1);
    assert.equal(parallel.kb.length, 3);
    assert.ok(parallel.kb.every(([, n]) => n === 1));
    const [{ rows: notionRows }, { rows: relationRows }] = await Promise.all([
      sql("SELECT id FROM agents WHERE name = 'AGENT-NOTION'"),
      sql("SELECT agentic_sub_agents FROM agents WHERE name = 'LexSkripsi'"),
    ]);
    assert.equal(notionRows.length, 1);
    assert.equal(Number(relationRows[0].agentic_sub_agents[0].agentId), notionRows[0].id);

    // The legacy orchestrator-only repair must share the parent lock too.
    // Run it on two pool connections while the first has written its link,
    // but has not committed its marker yet.
    await sql("UPDATE agents SET agentic_sub_agents = '[]' WHERE id = 1");
    let releaseRepair!: () => void;
    let repairAtLink!: () => void;
    const repairPaused = new Promise<void>((resolve) => { repairAtLink = resolve; });
    const repairGate = new Promise<void>((resolve) => { releaseRepair = resolve; });
    const firstRepair = patchLexSkripsiNotionOrchFix({
      database,
      afterStage: async (stage) => {
        if (stage === "link") {
          repairAtLink();
          await repairGate;
        }
      },
    });
    await repairPaused;
    let secondAtLink = false;
    const secondRepair = patchLexSkripsiNotionOrchFix({
      database,
      afterStage: (stage) => { if (stage === "link") secondAtLink = true; },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(secondAtLink, false, "startup kedua tidak boleh memperbaiki relasi sebelum commit pertama");
    } finally {
      releaseRepair();
    }
    assert.deepEqual(await firstRepair, { done: true, skipped: false });
    assert.deepEqual(await secondRepair, { done: false, skipped: true });
    assert.equal(secondAtLink, false);
    const repaired = await sql("SELECT agentic_sub_agents FROM agents WHERE id = 1");
    assert.equal(repaired.rows[0].agentic_sub_agents.length, 1);
    assert.equal(Number(repaired.rows[0].agentic_sub_agents[0].agentId), notionRows[0].id);
    const repairMarkers = await sql("SELECT count(*)::int AS n FROM knowledge_bases WHERE name LIKE '%LEXSKRIPSI-NOTION-ORCH-FIX-v1%'");
    assert.equal(repairMarkers.rows[0].n, 1);

    // Even after serialization, pre-existing conflicting identities must
    // fail closed instead of accepting the first matching row.
    await sql(`INSERT INTO agents (toolbox_id, name, slug, description, system_prompt)
      SELECT toolbox_id, name, slug, description, system_prompt FROM agents WHERE id = $1`, [notionRows[0].id]);
    const ambiguous = await counts();
    await assert.rejects(patchLexSkripsiNotionAgent({ database }), /tidak pasti/);
    await assert.rejects(patchLexSkripsiNotionOrchFix({ database }), /tidak pasti/);
    assert.deepEqual(await counts(), ambiguous);
  } finally {
    await isolated?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await admin.end();
  }
});