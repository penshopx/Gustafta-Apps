import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";

test("empat patch rollback pada tulis tengah batch dan retry tanpa duplikasi", { skip: !testDatabaseReady && testDbSkip }, async (t) => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const namespace = `lex_atomic_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE SCHEMA ${namespace}`);
  const isolated = new pg.Pool({
    connectionString: process.env.DATABASE_URL, max: 2,
    options: `-c search_path=${namespace}`,
  });
  const sql = (query: string) => isolated.query(query);
  try {
    for (const table of ["series", "toolboxes", "agents", "knowledge_bases", "mini_apps"]) {
      await sql(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
      await sql(`CREATE SEQUENCE ${table}_test_seq`);
      await sql(`ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('${table}_test_seq')`);
      await sql(`ALTER SEQUENCE ${table}_test_seq OWNED BY ${table}.id`);
    }
    const database = drizzle(isolated, { schema });
    const { patchLexSkripsiKbFinal } = await import("../server/patch-lexskripsi-kb-final");
    const { patchLexSkripsiOnboardingV3 } = await import("../server/patch-lexskripsi-onboarding-v3");
    const { patchLexSkripsiPersonaV4 } = await import("../server/patch-lexskripsi-persona-v4");
    const { patchLexSkripsiMiniApps } = await import("../server/patch-lexskripsi-mini-apps");
    const roles = ["LexSkripsi", "AGENT-METODE", "AGENT-SUBSTANSI", "AGENT-LAPANGAN", "AGENT-SIDANG", "AGENT-NOTION"];
    async function seed() {
      await sql("TRUNCATE mini_apps, knowledge_bases, agents, toolboxes, series RESTART IDENTITY");
      await sql("INSERT INTO series(name, slug) VALUES ('LexSkripsi', 'lexskripsi-asisten-skripsi-hukum')");
      await sql("INSERT INTO toolboxes(name, series_id) VALUES ('LexSkripsi', 1)");
      for (const name of roles) {
        const slug = name === "AGENT-NOTION" ? "lexskripsi-agent-notion" : null;
        await isolated.query(
          "INSERT INTO agents(name, toolbox_id, slug, description, system_prompt) VALUES ($1, 1, $2, 'Sub-agent LexSkripsi', 'Kamu anggota tim LexSkripsi')",
          [name, slug],
        );
      }
    }
    async function snapshot() {
      const [agents, kb, apps] = await Promise.all([
        sql("SELECT id, system_prompt FROM agents ORDER BY id"),
        sql("SELECT agent_id, name FROM knowledge_bases ORDER BY agent_id, name"),
        sql("SELECT agent_id, name, type FROM mini_apps ORDER BY agent_id, name"),
      ]);
      return { agents: agents.rows, kb: kb.rows, apps: apps.rows };
    }
    for (const [name, patch] of [
      ["kb", patchLexSkripsiKbFinal],
      ["onboarding", patchLexSkripsiOnboardingV3],
      ["persona", patchLexSkripsiPersonaV4],
      ["mini-apps", patchLexSkripsiMiniApps],
    ] as const) {
      await t.test(name, async () => {
        await seed();
        const initial = await snapshot();
        for (const stage of [2, name === "kb" ? 8 : name === "mini-apps" ? 10 : 6]) {
          await assert.rejects(
            patch({ database, afterWrite: (index) => { if (index === stage) throw new Error(`fault ${stage}`); } }),
            new RegExp(`fault ${stage}`),
          );
          assert.deepEqual(await snapshot(), initial, `rollback at write ${stage}`);
        }
        const success = await patch({ database });
        assert.equal(success.skipped, false);
        const complete = await snapshot();
        assert.equal(complete.kb.filter((row) => row.name.startsWith("[PATCH_MARKER]")).length, 1);
        assert.equal((await patch({ database })).skipped, true);
        assert.deepEqual(await snapshot(), complete);
        if (name === "kb" || name === "mini-apps") {
          // Simulate a pre-transaction partial run: marker gone, one entry survived.
          await sql("DELETE FROM knowledge_bases WHERE name LIKE '[PATCH_MARKER] %'");
          await patch({ database });
          const recovered = await snapshot();
          assert.equal(recovered.kb.filter((row) => row.name.startsWith("[PATCH_MARKER]")).length, 1);
          assert.equal(new Set(recovered.kb.map((row) => `${row.agent_id}:${row.name}`)).size, recovered.kb.length);
          assert.equal(new Set(recovered.apps.map((row) => `${row.agent_id}:${row.name}:${row.type}`)).size, recovered.apps.length);
          assert.equal(recovered.kb.length, complete.kb.length);
          assert.equal(recovered.apps.length, complete.apps.length);
        }
        if (name === "mini-apps") {
          // Legacy mini-app patch wrote the marker even when an insert failed.
          await sql("DELETE FROM mini_apps WHERE id = (SELECT min(id) FROM mini_apps)");
          const repaired = await patch({ database });
          assert.equal(repaired.skipped, false);
          assert.equal(repaired.created, 1);
          const recovered = await snapshot();
          assert.equal(recovered.apps.length, complete.apps.length);
          assert.equal(recovered.kb.length, complete.kb.length);
          assert.equal((await patch({ database })).skipped, true);
        }
      });
    }
  } finally {
    await isolated.end();
    await admin.query(`DROP SCHEMA ${namespace} CASCADE`);
    await admin.end();
  }
});